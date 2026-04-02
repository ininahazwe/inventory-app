// routes/auctions.js
const { sendOutbidNotification, sendWinnerNotification } = require('../emailService-resend');

module.exports = function(app, dbPromise, verifyJWT) {

    // GET: Lister toutes les enchères (avec pagination)
    app.get('/api/auctions', async (req, res) => {
        try {
            const { page = 1, limit = 20 } = req.query;
            const pageNum = parseInt(page) || 1;
            const pageSize = Math.min(parseInt(limit) || 20, 100); // Max 100 per page
            const offset = (pageNum - 1) * pageSize;

            // Compter le total
            const [countResult] = await dbPromise.query(`
                SELECT COUNT(DISTINCT a.id) as total
                FROM auctions a
                WHERE a.status IN ('active', 'ended')
            `);
            const total = countResult[0]?.total || 0;

            // Récupérer les enchères avec pagination
            const [auctions] = await dbPromise.query(`
                SELECT
                    a.id,
                    a.asset_id,
                    ast.label,
                    ast.serial_no,
                    c.name as category,
                    a.starting_price,
                    a.current_highest_bid,
                    a.duration_days,
                    a.status,
                    a.end_date,
                    COUNT(DISTINCT b.id) as bid_count,
                    u.email as created_by
                FROM auctions a
                         JOIN assets ast ON a.asset_id = ast.id
                         LEFT JOIN categories c ON ast.category_id = c.id
                         LEFT JOIN bids b ON a.id = b.auction_id
                         LEFT JOIN users u ON a.created_by_uid = u.id
                WHERE a.status IN ('active', 'ended')
                GROUP BY a.id
                ORDER BY a.end_date ASC
                    LIMIT ? OFFSET ?
            `, [pageSize, offset]);

            return res.json({
                data: auctions,
                pagination: { page: pageNum, limit: pageSize, total }
            });
        } catch (err) {
            console.error('GET /api/auctions error:', err);
            return res.status(500).json({ error: 'Failed to fetch auctions' });
        }
    });

    // GET: Détail enchère
    app.get('/api/auctions/:auctionId', async (req, res) => {
        const { auctionId } = req.params;
        try {
            const [auctions] = await dbPromise.query(`
                SELECT
                    a.*,
                    ast.label,
                    ast.serial_no,
                    ast.purchase_price,
                    c.name as category,
                    u.email as created_by,
                    u_winner.email as winner_email
                FROM auctions a
                         JOIN assets ast ON a.asset_id = ast.id
                         LEFT JOIN categories c ON ast.category_id = c.id
                         LEFT JOIN users u ON a.created_by_uid = u.id
                         LEFT JOIN users u_winner ON a.winner_uid = u_winner.id
                WHERE a.id = ?
            `, [auctionId]);

            if (!auctions.length) {
                return res.status(404).json({ error: 'Auction not found' });
            }

            const [bids] = await dbPromise.query(`
                SELECT
                    b.id,
                    b.amount,
                    u.email as bidder_email,
                    u.id as user_uid
                FROM bids b
                         JOIN users u ON b.user_uid = u.id
                WHERE b.auction_id = ?
                ORDER BY b.amount DESC
            `, [auctionId]);

            // Fetch images
            const [images] = await dbPromise.query(`
                SELECT image_url
                FROM auction_images
                WHERE auction_id = ?
                ORDER BY created_at ASC
            `, [auctionId]);

            return res.json({
                auction: auctions[0],
                bids,
                images: images.map(img => img.image_url)
            });
        } catch (err) {
            console.error(`GET /api/auctions/${auctionId} error:`, err);
            return res.status(500).json({ error: 'Failed to fetch auction' });
        }
    });

    // POST: Créer une enchère (admin)
    app.post('/api/auctions', verifyJWT, async (req, res) => {
        const { asset_id, starting_price, duration_days, images } = req.body;
        const user_email = req.user.email;

        console.log('🔍 POST /api/auctions');
        console.log('  user_email:', user_email);
        console.log('  asset_id:', asset_id);
        console.log('  starting_price:', starting_price);
        console.log('  duration_days:', duration_days);
        console.log('  images count:', images?.length || 0);

        try {
            // Vérifier que c'est un admin
            console.log('  Checking admin status...');
            const [user] = await dbPromise.query('SELECT role FROM users WHERE email = ?', [user_email]);
            console.log('  User found:', user.length > 0, 'Role:', user[0]?.role);

            if (!user.length || (user[0].role !== 'super_admin' && user[0].role !== 'admin')) {
                return res.status(403).json({ error: 'Only admins can create auctions' });
            }

            console.log('  ✅ Admin check passed');

            const [assets] = await dbPromise.query(
                'SELECT status FROM assets WHERE id = ?',
                [asset_id]
            );
            console.log('  Asset check - found:', assets.length > 0);

            if (!assets.length) {
                return res.status(404).json({ error: 'Asset not found' });
            }
            if (assets[0].status !== 'in_stock') {
                return res.status(400).json({ error: 'Asset must be in_stock to auction' });
            }

            console.log('  ✅ Asset check passed');

            console.log('  Checking existing auctions...');
            const [existing] = await dbPromise.query(
                'SELECT id FROM auctions WHERE asset_id = ? AND status IN ("active", "ended")',
                [asset_id]
            );
            console.log('  Existing auctions found:', existing.length);

            if (existing.length) {
                return res.status(400).json({ error: 'Asset already has an active auction' });
            }

            console.log('  ✅ Existing auction check passed');

            const end_date = new Date();
            end_date.setDate(end_date.getDate() + (duration_days || 7));
            const end_date_str = end_date.toISOString().split('T')[0];

            console.log('  end_date_str:', end_date_str);

            // Récupérer le user_id
            console.log('  Fetching user_id...');
            const [userRecord] = await dbPromise.query('SELECT id FROM users WHERE email = ?', [user_email]);
            const user_id = userRecord[0]?.id;

            console.log('  user_id:', user_id);

            if (!user_id) {
                console.error('  ❌ user_id not found for email:', user_email);
                return res.status(500).json({ error: 'User ID not found' });
            }

            console.log('  Inserting auction with values:', { asset_id, starting_price, duration_days: duration_days || 7, user_id, end_date_str });

            const [result] = await dbPromise.query(`
                INSERT INTO auctions (asset_id, starting_price, duration_days, created_by_uid, end_date)
                VALUES (?, ?, ?, ?, ?)
            `, [asset_id, starting_price, duration_days || 7, user_id, end_date_str]);

            const auctionId = result.insertId;
            console.log('  ✅ Auction created, id:', auctionId);

            // 🔥 FIX: Mettre à jour le statut de l'asset à 'auctioned'
            console.log('  Updating asset status to auctioned...');
            await dbPromise.query(
                'UPDATE assets SET status = ? WHERE id = ?',
                ['auctioned', asset_id]
            );
            console.log('  ✅ Asset status updated to auctioned');

            // Sauvegarder les images
            if (images && Array.isArray(images) && images.length > 0) {
                console.log('  Saving', images.length, 'images...');
                try {
                    for (const imageUrl of images) {
                        console.log('    Saving image URL length:', imageUrl.length);
                        await dbPromise.query(`
                            INSERT INTO auction_images (auction_id, image_url)
                            VALUES (?, ?)
                        `, [auctionId, imageUrl]);
                    }
                    console.log('  ✅ All images saved');
                } catch (imgErr) {
                    console.error('  ❌ Image save error:', imgErr.message);
                }
            }

            console.log('  ✅ SUCCESS - Returning response');

            return res.status(201).json({
                id: auctionId,
                asset_id,
                starting_price,
                duration_days: duration_days || 7,
                status: 'active',
                created_by_uid: user_id,
                end_date: end_date_str,
                message: 'Auction created successfully'
            });
        } catch (err) {
            console.error('POST /api/auctions error:', err);
            return res.status(500).json({ error: err.message });
        }
    });

    // DELETE: Annuler une enchère (admin)
    app.post('/api/auctions/:auctionId/cancel', verifyJWT, async (req, res) => {
        const { auctionId } = req.params;

        try {
            const [auctions] = await dbPromise.query('SELECT * FROM auctions WHERE id = ?', [auctionId]);
            if (!auctions.length) {
                return res.status(404).json({ error: 'Auction not found' });
            }

            const auction = auctions[0];

            if (auction.status !== 'active') {
                return res.status(400).json({ error: 'Only active auctions can be cancelled' });
            }

            // Vérifier que c'est l'admin qui a créé
            if (req.user.email !== auction.created_by_uid) {
                const [creator] = await dbPromise.query('SELECT email FROM users WHERE id = ?', [auction.created_by_uid]);
                if (creator[0]?.email !== req.user.email) {
                    return res.status(403).json({ error: 'Only creator can cancel' });
                }
            }

            // 🔥 FIX: Restaurer le statut de l'asset à 'in_stock'
            await dbPromise.query(
                'UPDATE assets SET status = ? WHERE id = ?',
                ['in_stock', auction.asset_id]
            );

            await dbPromise.query(
                'UPDATE auctions SET status = ? WHERE id = ?',
                ['cancelled', auctionId]
            );

            return res.json({ success: true });
        } catch (err) {
            console.error(`POST /api/auctions/${auctionId}/cancel error:`, err);
            return res.status(500).json({ error: 'Failed to cancel auction' });
        }
    });

    // POST: Placer une mise (enchérisseur)
    app.post('/api/auctions/:auctionId/bid', verifyJWT, async (req, res) => {
        const { auctionId } = req.params;
        const { amount } = req.body;
        const user_email = req.user.email;

        try {
            const [auctions] = await dbPromise.query(
                'SELECT * FROM auctions WHERE id = ?',
                [auctionId]
            );
            if (!auctions.length) {
                return res.status(404).json({ error: 'Auction not found' });
            }

            const auction = auctions[0];

            if (auction.status !== 'active') {
                return res.status(400).json({ error: 'Auction is not active' });
            }

            // 🔥 FIX: Utiliser NOW() avec timezone awareness
            if (new Date() > new Date(auction.end_date)) {
                return res.status(400).json({ error: 'Auction has ended' });
            }

            const minBid = auction.current_highest_bid
                ? auction.current_highest_bid + 1
                : auction.starting_price;

            if (amount < minBid) {
                return res.status(400).json({
                    error: `Bid must be at least ${minBid}`,
                    minBid
                });
            }

            // Récupérer le user_id (UUID) par EMAIL
            const [userRecord] = await dbPromise.query('SELECT id FROM users WHERE email = ?', [user_email]);
            const user_id = userRecord[0]?.id;

            if (!user_id) {
                return res.status(401).json({ error: 'User not found' });
            }

            // 🔥 FIX: Vérifier que l'utilisateur n'a pas déjà une mise sur cette enchère
            // Option: Remplacer le bid existant (meilleur UX)
            const [userBids] = await dbPromise.query(`
                SELECT id FROM bids WHERE auction_id = ? AND user_uid = ?
            `, [auctionId, user_id]);

            if (userBids.length > 0) {
                // Supprimer l'ancien bid et continuer
                console.log(`  ℹ️  User ${user_email} already has a bid on this auction, replacing it`);
                await dbPromise.query('DELETE FROM bids WHERE id = ?', [userBids[0].id]);
            }

            // Récupérer le TOP bidder AVANT d'insérer le nouveau bid
            const [topBidBefore] = await dbPromise.query(`
                SELECT u.email, b.amount
                FROM bids b
                         JOIN users u ON b.user_uid = u.id
                WHERE b.auction_id = ?
                ORDER BY b.amount DESC
                    LIMIT 1
            `, [auctionId]);

            const topBidderEmailBefore = topBidBefore && topBidBefore.length > 0 ? topBidBefore[0].email : null;

            // Insérer le nouveau bid
            const [insertResult] = await dbPromise.query(`
                INSERT INTO bids (auction_id, user_uid, amount, auto_bid_max)
                VALUES (?, ?, ?, ?)
            `, [auctionId, user_id, amount, amount]);

            const newBidId = insertResult.insertId;

            // 🔥 SIMPLIFIED: Pas d'auto-bid complexe, juste mettre à jour le highest bid
            // Mettre à jour l'enchère avec le top bid (amount du nouveau bid)
            await dbPromise.query(
                'UPDATE auctions SET current_highest_bid = ? WHERE id = ?',
                [amount, auctionId]
            );

            // 📧 ENVOYER EMAIL DE SURENCHÈRE si quelqu'un était en tête
            if (topBidderEmailBefore && topBidderEmailBefore !== user_email) {
                console.log(`📧 Sending outbid email to ${topBidderEmailBefore}`);
                // 🔥 FIX: Wrapper dans try-catch pour éviter crash du cron
                try {
                    await sendOutbidNotification(auctionId, topBidderEmailBefore, amount);
                } catch (emailErr) {
                    console.error(`⚠️  Outbid email failed: ${emailErr.message}`);
                    // Continuer quand même - la mise a été placée
                }
            }

            return res.status(201).json({
                success: true,
                your_bid: amount,
                current_highest_bid: amount,
                message: 'You are the highest bidder.',
                toast: {
                    type: 'success',
                    title: '✅ Enchère placée',
                    message: `Vous êtes le plus offrant (${amount} FCFA)`
                }
            });
        } catch (err) {
            console.error(`POST /api/auctions/${auctionId}/bid error:`, err);
            return res.status(500).json({ error: 'Failed to place bid' });
        }
    });

    // POST: Auto-close auctions (Cron ou manuel)
    app.post('/api/auctions/auto-close', async (req, res) => {
        try {
            console.log('🕐 Running auction auto-close...');

            // 🔥 FIX: Utiliser DATE(NOW()) au lieu de CURDATE() pour timezone awareness
            const [expiredAuctions] = await dbPromise.query(`
                SELECT a.id, a.created_by_uid, u_creator.email as creator_email, a.asset_id
                FROM auctions a
                         JOIN users u_creator ON a.created_by_uid = u_creator.id
                WHERE a.status = 'active' AND a.end_date <= DATE(NOW())
            `);

            console.log(`Found ${expiredAuctions.length} expired auctions`);

            for (const auction of expiredAuctions) {
                // Récupérer le top bidder (gagnant)
                const [winnerBid] = await dbPromise.query(`
                    SELECT b.user_uid, b.amount, u.email as winner_email
                    FROM bids b
                             JOIN users u ON b.user_uid = u.id
                    WHERE b.auction_id = ?
                    ORDER BY b.amount DESC
                        LIMIT 1
                `, [auction.id]);

                if (winnerBid && winnerBid.length > 0) {
                    const winner = winnerBid[0];
                    const finalAmount = winner.amount;

                    // Mettre à jour l'enchère avec le gagnant
                    await dbPromise.query(
                        'UPDATE auctions SET status = ?, winner_uid = ? WHERE id = ?',
                        ['ended', winner.user_uid, auction.id]
                    );

                    console.log(`✅ Auction ${auction.id} closed. Winner: ${winner.winner_email}, Amount: ${finalAmount}`);

                    // 📧 ENVOYER EMAIL AU GAGNANT
                    // 🔥 FIX: Wrapper dans try-catch pour éviter crash du cron
                    try {
                        await sendWinnerNotification(
                            auction.id,
                            winner.winner_email,
                            auction.creator_email,
                            finalAmount
                        );
                    } catch (emailErr) {
                        console.error(`⚠️  Winner email failed for auction ${auction.id}: ${emailErr.message}`);
                        // Continuer quand même - l'enchère est fermée
                    }
                } else {
                    // Pas de bids, fermer sans gagnant
                    await dbPromise.query(
                        'UPDATE auctions SET status = ? WHERE id = ?',
                        ['ended', auction.id]
                    );
                    console.log(`✅ Auction ${auction.id} closed. No bids received.`);
                }
            }

            return res.json({ success: true, closedCount: expiredAuctions.length });
        } catch (err) {
            console.error('POST /api/auctions/auto-close error:', err);
            return res.status(500).json({ error: 'Failed to close auctions' });
        }
    });
};