import { Router, Request, Response } from 'express';
import { db } from '../database/connection';
import { logger } from '../middleware/logger';
import { requireAuth } from '../middleware/auth';
import type { AuthUser } from '../types/requests';
import { logAudit } from "./audit";
import {
    getBidderConfirmationEmail,
    getCreatorNotificationEmail,
    getOutbidNotificationEmail,
    sendEmail
} from "../services/gmailService";

const router = Router();

// Helper pour formater proprement les objets Date pour MySQL (YYYY-MM-DD HH:mm:ss)
const formatDateTimeForMySQL = (date: Date): string => {
    return date.toISOString().slice(0, 19).replace('T', ' ');
};

// ────────────────────────────────────────────────────────────────────────────
// GET /api/auctions - Liste toutes les enchères (avec pagination)
// ────────────────────────────────────────────────────────────────────────────
router.get('/', async (req: Request, res: Response) => {
    try {
        const { page = 1, limit = 20, status = 'all' } = req.query;
        const pageNum = parseInt(page as string, 10) || 1;
        const pageSize = Math.min(parseInt(limit as string, 10) || 20, 100);
        const offset = (pageNum - 1) * pageSize;

        // Compter le total
        let countQuery = `
            SELECT COUNT(DISTINCT a.id) as total
            FROM auctions a
            WHERE 1=1
        `;
        const countParams: any[] = [];

        if (status !== 'all') {
            countQuery += ` AND a.status = ?`;
            countParams.push(status);
        }

        const [countResult] = await db.query(countQuery, countParams);
        const total = (countResult as any[])[0]?.total || 0;

        // Récupérer les enchères avec les colonnes attendues par le frontend
        let auctionsQuery = `
            SELECT a.id,
                   a.asset_id,
                   asst.label,
                   asst.serial_no,
                   COALESCE(cat.name, 'N/A') as category,
                   a.starting_price,
                   a.current_highest_bid,
                   a.duration_days,
                   a.status,
                   a.end_date,
                   COUNT(b.id) as bid_count,
                   a.created_by_uid as created_by
            FROM auctions a
                     JOIN assets asst ON a.asset_id = asst.id
                     LEFT JOIN categories cat ON asst.category_id = cat.id
                     LEFT JOIN bids b ON a.id = b.auction_id
            WHERE 1=1
        `;
        const auctionsParams: any[] = [];

        if (status !== 'all') {
            auctionsQuery += ` AND a.status = ?`;
            auctionsParams.push(status);
        }

        auctionsQuery += ` GROUP BY a.id, asst.label, asst.serial_no, cat.name ORDER BY a.created_at DESC LIMIT ? OFFSET ?`;
        auctionsParams.push(pageSize, offset);

        const [auctionList] = await db.query(auctionsQuery, auctionsParams);

        // ✅ FIX: Convertir les prix en nombre (MySQL retourne string)
        const normalizedAuctions = (auctionList as any[]).map(auction => ({
            ...auction,
            starting_price: parseFloat(auction.starting_price),
            current_highest_bid: auction.current_highest_bid ? parseFloat(auction.current_highest_bid) : null,
        }));

        return res.json({
            data: normalizedAuctions,
            total,
            page: pageNum,
            limit: pageSize
        });
    } catch (err) {
        logger.error('GET /auctions error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

// ────────────────────────────────────────────────────────────────────────────
// GET /api/auctions/:id - Détails d'une enchère et sa meilleure offre
// ────────────────────────────────────────────────────────────────────────────
router.get('/:id', async (req: Request, res: Response) => {
    try {
        const auctionId = parseInt(req.params.id as string, 10);
        if (isNaN(auctionId)) {
            return res.status(400).json({ error: 'Invalid auction ID' });
        }

        // Récupérer les détails de l'enchère
        const [singleAuctionResult] = await db.query(`
            SELECT a.id,
                   a.asset_id,
                   asst.label,
                   asst.serial_no,
                   COALESCE(cat.name, 'N/A') as category,
                   a.starting_price,
                   a.current_highest_bid,
                   a.duration_days,
                   a.status,
                   a.end_date,
                   a.created_by_uid as created_by,
                   a.notes,
                   a.created_at,
                   u.email as created_by_email,
                   asst.status as asset_status,
                   a.winner_uid,
                   (SELECT u2.email FROM users u2 WHERE u2.id = a.winner_uid) as winner_email
            FROM auctions a
                     JOIN assets asst ON a.asset_id = asst.id
                     JOIN users u ON a.created_by_uid = u.id
                     LEFT JOIN categories cat ON asst.category_id = cat.id
            WHERE a.id = ? LIMIT 1
        `, [auctionId]);

        if (!singleAuctionResult || (singleAuctionResult as any[]).length === 0) {
            return res.status(404).json({ error: 'Auction not found' });
        }

        const auction = (singleAuctionResult as any[])[0];

        // Récupération des offres
        const [bids] = await db.query(`
            SELECT b.id,
                   b.amount,
                   u.email as bidder_email,
                   b.user_uid,
                   b.created_at
            FROM bids b
                     JOIN users u ON b.user_uid = u.id
            WHERE b.auction_id = ?
            ORDER BY b.amount DESC
        `, [auctionId]);

        // Récupérer les images de l'enchère
        const [images] = await db.query(`
            SELECT image_url
            FROM auction_images
            WHERE auction_id = ?
            ORDER BY created_at ASC
        `, [auctionId]);

        // ✅ Convertir les prix en nombre (MySQL retourne string)
        auction.starting_price = parseFloat(auction.starting_price);
        if (auction.current_highest_bid) {
            auction.current_highest_bid = parseFloat(auction.current_highest_bid);
        }

        // ✅ Mapper les bids correctement
        const formattedBids = (bids as any[]).map(bid => ({
            id: bid.id,
            amount: parseFloat(bid.amount),
            bidder_email: bid.bidder_email,
            user_uid: bid.user_uid,
            created_at: bid.created_at,
        }));

        // ✅ Extraire juste les URLs des images
        const imageUrls = (images as any[]).map(img => img.image_url) || [];

        return res.json({
            auction,
            bids: formattedBids,
            images: imageUrls,
        });
    } catch (err) {
        logger.error(`GET /auctions/${req.params.id} error:`, err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

// ────────────────────────────────────────────────────────────────────────────
// POST /api/auctions - Création d'une enchère
// ────────────────────────────────────────────────────────────────────────────
router.post('/', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = req.user as AuthUser;
        const creatorId = user.uid;

        if (user.role === 'accountant') {
            return res.status(403).json({
                error: "Droit refusé : Le rôle 'accountant' n'est pas autorisé à créer des enchères."
            });
        }

        // Extraction des clés envoyées par CreateAuctionPage.tsx
        const { asset_id, starting_price, duration_days, notes, images } = req.body;

        if (!asset_id || !starting_price || !duration_days) {
            return res.status(400).json({ error: 'Please fill in all required fields (Asset, Price, Duration)' });
        }

        // 1. Vérification de l'existence et récupération de l'actif
        const [assets] = await db.query('SELECT id, status, label FROM assets WHERE id = ?', [asset_id]);
        if (!assets || (assets as any[]).length === 0) {
            return res.status(404).json({ error: 'Asset not found' });
        }

        const asset = (assets as any[])[0];
        if (asset.status === 'auctioned') {
            return res.status(400).json({ error: 'Asset is already listed in another auction' });
        }

        // 2. Calcul dynamique des dates à partir de duration_days
        const now = new Date();
        const expiration = new Date();
        expiration.setDate(now.getDate() + parseInt(duration_days, 10));

        const startDateMySQL = formatDateTimeForMySQL(now);
        const endDateMySQL = formatDateTimeForMySQL(expiration);
        const startPriceFormatted = parseFloat(starting_price);

        // 3. FIX: Utiliser les vrais noms de colonnes SQL (starting_price, current_highest_bid)
        const [result] = await db.query(`
            INSERT INTO auctions (asset_id, starting_price, current_highest_bid, start_date, end_date, status, created_by_uid, notes, duration_days)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [asset_id, startPriceFormatted, startPriceFormatted, startDateMySQL, endDateMySQL, 'active', creatorId, notes || null, parseInt(duration_days, 10)]);

        const newAuctionId = (result as any).insertId;

        // 4. Insérer les images si fournies
        if (Array.isArray(images) && images.length > 0) {
            for (const imageUrl of images) {
                await db.query(
                    'INSERT INTO auction_images (auction_id, image_url) VALUES (?, ?)',
                    [newAuctionId, imageUrl]
                );
            }
        }

        // 5. Mise à jour du statut de l'actif
        await db.query('UPDATE assets SET status = ? WHERE id = ?', ['auctioned', asset_id]);

        // 6. Enregistrement de l'audit
        await logAudit(
            creatorId.toString(),
            'CREATE_AUCTION',
            `Created auction #${newAuctionId} for asset #${asset_id}`,
            newAuctionId
        );

        logger.info(`Auction #${newAuctionId} created successfully by user ID ${creatorId}`, 'AUCTIONS');

        // 7. Retour au frontend
        return res.status(201).json({
            id: newAuctionId,
            title: `Enchère - ${asset.label}`,
            asset_id,
            starting_price: startPriceFormatted,
            status: 'active',
            start_date: startDateMySQL,
            end_date: endDateMySQL,
            duration_days: parseInt(duration_days, 10)
        });

    } catch (err) {
        logger.error('POST /auctions error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

// POST /api/auctions/:id/bids - Placer une enchère

router.post('/:id/bids', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = req.user as AuthUser;
        const auctionId = parseInt(req.params.id as string, 10);
        const { amount } = req.body;

        // Validation
        if (isNaN(auctionId)) {
            return res.status(400).json({ error: 'Invalid auction ID' });
        }

        if (!amount || parseFloat(amount) <= 0) {
            return res.status(400).json({ error: 'Invalid bid amount' });
        }

        const bidAmount = parseFloat(amount);

        // 1. Vérifier que l'enchère existe et est active
        const [auctionData] = await db.query(
            `SELECT a.id, a.status, a.starting_price, a.current_highest_bid, 
                    a.created_by_uid, asst.label
             FROM auctions a
             JOIN assets asst ON a.asset_id = asst.id
             WHERE a.id = ?`,
            [auctionId]
        );

        if (!auctionData || (auctionData as any[]).length === 0) {
            return res.status(404).json({ error: 'Auction not found' });
        }

        const auction = (auctionData as any[])[0];

        if (auction.status !== 'active') {
            return res.status(400).json({ error: 'Auction is not active' });
        }

        // 2. Vérifier que l'enchère est >= au minimum
        const minBid = auction.current_highest_bid
            ? parseFloat(auction.current_highest_bid) + 1
            : parseFloat(auction.starting_price);

        if (bidAmount < minBid) {
            return res.status(400).json({
                error: `Bid must be at least ${minBid}. Current highest bid is ${auction.current_highest_bid || auction.starting_price}`
            });
        }

        // 3. Récupérer l'email du créateur et de l'enchérisseur
        const [creatorData] = await db.query(
            'SELECT email FROM users WHERE id = ?',
            [auction.created_by_uid]
        );

        const [bidderData] = await db.query(
            'SELECT email FROM users WHERE id = ?',
            [user.uid]
        );

        const creatorEmail = (creatorData as any[])[0]?.email;
        const bidderEmail = (bidderData as any[])[0]?.email;

        if (!bidderEmail) {
            return res.status(400).json({ error: 'Bidder email not found' });
        }

        // 4. Insérer la nouvelle enchère
        const [result] = await db.query(
            'INSERT INTO bids (auction_id, user_uid, amount) VALUES (?, ?, ?)',
            [auctionId, user.uid, bidAmount]
        );

        const newBidId = (result as any).insertId;

        // 5. Récupérer les anciens enchérisseurs AVANT la mise à jour
        const [previousBidders] = await db.query(
            `SELECT DISTINCT u.email, b.user_uid
             FROM bids b
             JOIN users u ON b.user_uid = u.id
             WHERE b.auction_id = ? AND b.user_uid != ?
             GROUP BY b.user_uid`,
            [auctionId, user.uid]
        );

        // 6. Mettre à jour current_highest_bid dans l'enchère
        await db.query(
            'UPDATE auctions SET current_highest_bid = ? WHERE id = ?',
            [bidAmount, auctionId]
        );

        // 7. Enregistrement audit
        await logAudit(
            user.uid.toString(),
            'PLACE_BID',
            `Placed bid of ${bidAmount} on auction #${auctionId}`,
            auctionId
        );

        logger.info(`Bid #${newBidId} placed by user ${user.uid} on auction ${auctionId}`, 'BIDS');

        // 8. Envoyer les emails EN ARRIÈRE-PLAN (ne pas bloquer la réponse)
        const auctionUrl = `${process.env.FRONTEND_URL}/auctions/${auctionId}`;

        // Email au créateur
        if (creatorEmail && creatorEmail !== bidderEmail) {
            const creatorEmail_payload = getCreatorNotificationEmail(
                creatorEmail,
                auction.label,
                bidderEmail,
                bidAmount,
                auctionUrl
            );
            sendEmail(creatorEmail_payload).catch(err =>
                logger.error('Failed to send creator email', err)
            );
        }

        // Email au bidder (confirmation)
        const bidderConfirmation = getBidderConfirmationEmail(
            bidderEmail,
            auction.label,
            bidAmount,
            auctionUrl
        );
        sendEmail(bidderConfirmation).catch(err =>
            logger.error('Failed to send bidder confirmation email', err)
        );

        // Emails aux autres enchérisseurs (outbid)
        (previousBidders as any[]).forEach(prevBidder => {
            if (prevBidder.email && prevBidder.email !== bidderEmail) {
                const outbidEmail = getOutbidNotificationEmail(
                    prevBidder.email,
                    auction.label,
                    bidAmount,
                    auctionUrl
                );
                sendEmail(outbidEmail).catch(err =>
                    logger.error('Failed to send outbid email', err)
                );
            }
        });

        // 9. Retourner la réponse (les emails s'envoient en arrière-plan)
        return res.status(201).json({
            success: true,
            id: newBidId,
            auction_id: auctionId,
            amount: bidAmount,
            message: `Bid of ${bidAmount} placed successfully`
        });

    } catch (err) {
        logger.error(`POST /auctions/:id/bids error:`, err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});


export default router;