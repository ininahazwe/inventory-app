import { Router, Request, Response } from 'express';
import { db } from '../database/connection';
import { logger } from '../middleware/logger';
import { requireAuth } from '../middleware/auth';
import type { AuthUser } from '../types/requests';
import { logAudit } from "./audit";
import { AppException, NotFoundException, BusinessException } from '../exceptions';
import { CRON_SECRET } from '../config/env';
import {
    getBidderConfirmationEmail,
    getCreatorNotificationEmail,
    getOutbidNotificationEmail, getWinnerNotificationEmail,
    sendEmail
} from "../services/gmailService";
const router = Router();

// Helper pour formater proprement les objets Date pour MySQL (YYYY-MM-DD HH:mm:ss)
const formatDateTimeForMySQL = (date: Date): string => {
    return date.toISOString().slice(0, 19).replace('T', ' ');
};

// ✅ Protège /auto-close : appelé par un cron externe, pas par un utilisateur connecté.
// Fail closed: si CRON_SECRET n'est pas configuré, la route reste inaccessible
// (au lieu d'accepter n'importe quel appelant par défaut).
function requireCronSecret(req: Request, res: Response, next: () => void) {
    const configured = CRON_SECRET();
    if (!configured) {
        logger.error('POST /auctions/auto-close blocked: CRON_SECRET not configured', 'AUCTIONS');
        return res.status(503).json({ error: 'auto-close is not configured (missing CRON_SECRET)' });
    }
    const provided = req.headers['x-cron-secret'];
    if (provided !== configured) {
        return res.status(401).json({ error: 'Invalid or missing cron secret' });
    }
    next();
}

// ────────────────────────────────────────────────────────────────────────────
// GET /api/auctions - Liste toutes les enchères (avec pagination)
// ────────────────────────────────────────────────────────────────────────────
router.get('/', requireAuth, async (req: Request, res: Response) => {
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
// (contient emails créateur/enchérisseurs — auth requise)
// ────────────────────────────────────────────────────────────────────────────
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
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

        // (rôle 'accountant' supprimé — sa seule règle était l'interdiction de créer des enchères)

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
        // ✅ Seul un asset en stock peut être mis aux enchères (avant: seul 'auctioned'
        // était bloqué, donc un asset assigné/en réparation/retiré pouvait être auctionné).
        if (asset.status !== 'in_stock') {
            const reasons: Record<string, string> = {
                auctioned: 'Asset is already listed in another auction',
                assigned: 'Asset is currently assigned and cannot be auctioned',
                repair: 'Asset is in repair and cannot be auctioned',
                retired: 'Asset is retired and cannot be auctioned',
            };
            return res.status(400).json({ error: reasons[asset.status] || `Cannot auction asset with status '${asset.status}'` });
        }

        // 2. Calcul dynamique des dates à partir de duration_days
        const now = new Date();
        const expiration = new Date();
        expiration.setDate(now.getDate() + parseInt(duration_days, 10));

        const startDateMySQL = formatDateTimeForMySQL(now);
        const endDateMySQL = formatDateTimeForMySQL(expiration);
        const startPriceFormatted = parseFloat(starting_price);

        // 3. FIX: Utiliser les vrais noms de colonnes SQL (starting_price, current_highest_bid)
        // current_highest_bid starts NULL: it only reflects real bids (first bid must simply reach starting_price)
        const [result] = await db.query(`
            INSERT INTO auctions (asset_id, starting_price, current_highest_bid, start_date, end_date, status, created_by_uid, notes, duration_days)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [asset_id, startPriceFormatted, null, startDateMySQL, endDateMySQL, 'active', creatorId, notes || null, parseInt(duration_days, 10)]);

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
            user.email || creatorId.toString(),
            'auction_created',
            'auctions',
            newAuctionId,
            null,
            { asset_id, starting_price: startPriceFormatted, duration_days: parseInt(duration_days, 10) }
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

        // Vérifier l'email de l'enchérisseur AVANT d'insérer quoi que ce soit
        const [bidderCheck] = await db.query('SELECT email FROM users WHERE id = ?', [user.uid]);
        const bidderEmail = (bidderCheck as any[])[0]?.email;
        if (!bidderEmail) {
            return res.status(400).json({ error: 'Bidder email not found' });
        }

        // ✅ Tout ce bloc tourne sur UNE connexion en transaction, avec verrou
        // pessimiste (FOR UPDATE) sur la ligne auction : ça sérialise les enchères
        // concurrentes et empêche deux bids simultanés de passer tous les deux le
        // contrôle minBid (race condition possible avant ce correctif).
        const { auction, newBidId } = await db.transaction(async (tx) => {
            // 1. Vérifier que l'enchère existe et est active (verrou ligne)
            const [auctionData] = await tx.query(
                `SELECT a.id, a.status, a.starting_price, a.current_highest_bid,
                        a.created_by_uid, asst.label
                 FROM auctions a
                 JOIN assets asst ON a.asset_id = asst.id
                 WHERE a.id = ?
                 FOR UPDATE`,
                [auctionId]
            );

            if (!auctionData || (auctionData as any[]).length === 0) {
                throw new NotFoundException('Auction not found');
            }

            const auction = (auctionData as any[])[0];

            if (auction.status !== 'active') {
                throw new BusinessException('Auction is not active');
            }

            // 2. Vérifier que l'enchère est >= au minimum
            // (pas de bid: la 1ère offre doit atteindre le prix de départ; sinon: surenchère d'au moins 1)
            const minBid = auction.current_highest_bid != null
                ? parseFloat(auction.current_highest_bid) + 1
                : parseFloat(auction.starting_price);

            if (bidAmount < minBid) {
                throw new BusinessException(
                    `Bid must be at least ${minBid}. Current highest bid is ${auction.current_highest_bid || auction.starting_price}`
                );
            }

            // 3. Insérer la nouvelle enchère
            const [result] = await tx.execute(
                'INSERT INTO bids (auction_id, user_uid, amount) VALUES (?, ?, ?)',
                [auctionId, user.uid, bidAmount]
            );

            const newBidId = (result as any).insertId;

            // 4. Mettre à jour current_highest_bid dans l'enchère
            await tx.execute(
                'UPDATE auctions SET current_highest_bid = ? WHERE id = ?',
                [bidAmount, auctionId]
            );

            return { auction, newBidId };
        });

        // ✅ Hors transaction: lectures pour les emails + audit (pas besoin d'atomicité)
        const [creatorData] = await db.query('SELECT email FROM users WHERE id = ?', [auction.created_by_uid]);
        const [previousBidders] = await db.query(
            `SELECT DISTINCT u.email, b.user_uid
             FROM bids b
             JOIN users u ON b.user_uid = u.id
             WHERE b.auction_id = ? AND b.user_uid != ?
             GROUP BY b.user_uid`,
            [auctionId, user.uid]
        );

        const creatorEmail = (creatorData as any[])[0]?.email;

        // 7. Enregistrement audit
        await logAudit(
            user.email || user.uid.toString(),
            'bid_placed',
            'auctions',
            auctionId,
            null,
            { bid_id: newBidId, amount: bidAmount }
        );

        logger.info(`Bid #${newBidId} placed by user ${user.uid} on auction ${auctionId}`, 'BIDS');

        // 8. Envoyer les emails EN ARRIÈRE-PLAN (ne pas bloquer la réponse)
        const auctionUrl = `${process.env.FRONTEND_URL}/auctions/${auctionId}`;

        // Email au créateur
        if (creatorEmail && creatorEmail !== bidderEmail) {
            const creatorEmail_payload = getCreatorNotificationEmail(
                creatorEmail,
                auction.creator_name || 'Creator',
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
            (req as any).user?.name || 'Bidder',
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
        if (err instanceof AppException) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        logger.error(`POST /auctions/:id/bids error:`, err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

// ────────────────────────────────────────────────────────────────────────────
// Clôture automatique des enchères expirées — logique partagée entre la route
// POST /auto-close (legacy/manuel, cron externe encore possible) et le
// scheduler interne (src/scheduler.ts, node-schedule, pas de dépendance à un
// cron externe qui doit connaître l'URL publique du serveur).
// ────────────────────────────────────────────────────────────────────────────
export async function runAutoCloseAuctions(): Promise<{ closedCount: number }> {
    // 1. Sélectionner les enchères actives dont la date de fin est dépassée
    // (label vient de l'asset lié — la table auctions n'a pas de colonne label)
    const [expiredAuctions] = await db.query(
        `SELECT a.id, a.asset_id, asst.label
         FROM auctions a
                  JOIN assets asst ON a.asset_id = asst.id
         WHERE a.status = 'active' AND a.end_date <= NOW()`
    );

    const auctionsToClose = expiredAuctions as any[];
    let closedCount = 0;

    if (auctionsToClose.length === 0) {
        return { closedCount: 0 };
    }

    // 2. Traiter chaque enchère expirée
    for (const auction of auctionsToClose) {
        // Trouver la mise la plus haute pour cette enchère
        // (jointure sur u.id — la table users n'a pas de colonne uid)
        const [highestBids] = await db.query(
            `SELECT b.user_uid, b.amount, u.email as bidder_email
             FROM bids b
                      JOIN users u ON b.user_uid = u.id
             WHERE b.auction_id = ?
             ORDER BY b.amount DESC LIMIT 1`,
            [auction.id]
        );

        const bids = highestBids as any[];

        if (bids.length > 0) {
            const winnerUid = bids[0].user_uid;
            const winnerEmail = bids[0].bidder_email;
            const winnerName = winnerEmail?.split('@')[0] || 'Winner';
            const finalAmount = bids[0].amount;

            // 1. Enregistrer le gagnant en base de données
            await db.query(
                `UPDATE auctions SET status = 'ended', winner_uid = ? WHERE id = ?`,
                [winnerUid, auction.id]
            );

            // 1b. L'asset vendu sort du parc: statut 'retired' + trace lifecycle
            await db.query(`UPDATE assets SET status = 'retired' WHERE id = ?`, [auction.asset_id]);
            await db.query(
                `INSERT INTO lifecycle_events (asset_id, event_type, notes, created_by, status)
                 VALUES (?, 'retired', ?, 'system:auction', 'resolved')`,
                [auction.asset_id, `Sold at auction #${auction.id} for ${finalAmount} to ${winnerEmail}`]
            );

            // 2. Envoyer l'email en anglais uniquement au vainqueur
            const auctionUrl = `${process.env.FRONTEND_URL || 'https://assets.mfwa.org'}/auctions/${auction.id}`;

            const winnerEmailPayload = getWinnerNotificationEmail(
                winnerEmail,
                winnerName,
                auction.label,
                finalAmount,
                auctionUrl
            );

            sendEmail(winnerEmailPayload).catch(err =>
                logger.error(`Failed to send winner email for auction #${auction.id}`, err)
            );

            logger.info(`🏆 Auction #${auction.id} closed. Winner: ${winnerEmail} (${winnerUid})`);
        } else {
            // Clôture sans offres: l'asset redevient disponible en stock
            await db.query(`UPDATE auctions SET status = 'ended' WHERE id = ?`, [auction.id]);
            await db.query(`UPDATE assets SET status = 'in_stock' WHERE id = ? AND status = 'auctioned'`, [auction.asset_id]);
        }

        closedCount++;
    }

    return { closedCount };
}

// ────────────────────────────────────────────────────────────────────────────
// POST /api/auctions/auto-close - Déclenchement manuel/legacy (cron externe
// encore compatible si configuré). Le scheduler interne (src/scheduler.ts)
// appelle runAutoCloseAuctions() directement, sans passer par HTTP.
// Protégé par header x-cron-secret (voir CRON_SECRET dans .env)
// ────────────────────────────────────────────────────────────────────────────
router.post('/auto-close', requireCronSecret, async (_req: Request, res: Response) => {
    try {
        logger.info("🔄 Reçu demande de clôture automatique des enchères expirées via Cron.");
        const { closedCount } = await runAutoCloseAuctions();

        return res.status(200).json({
            success: true,
            message: closedCount === 0
                ? "Aucune enchère expirée à clôturer."
                : `${closedCount} enchère(s) clôturée(s) avec succès.`,
            closedCount
        });
    } catch (err) {
        logger.error(`❌ Erreur lors du POST /auctions/auto-close:`, err as Error);
        return res.status(500).json({
            success: false,
            error: "Erreur interne lors de la clôture des enchères"
        });
    }
});

export default router;