// routes/auctions.js
const { sendBidConfirmationEmail, sendOutbidNotificationEmails } = require('../services/gmailService');

module.exports = function(app, dbPromise, verifyJWT) {

    // GET: Lister toutes les enchères (avec pagination)
    app.get('/api/auctions', async (req, res) => {
        try {
            const { page = 1, limit = 20 } = req.query;
            const pageNum = parseInt(page) || 1;
            const pageSize = Math.min(parseInt(limit) || 20, 100);
            const offset = (pageNum - 1) * pageSize;

            const [countResult] = await dbPromise.query(`
                SELECT COUNT(DISTINCT a.id) as total
                FROM auctions a
                WHERE a.status IN ('active', 'ended')
            `);
            const total = countResult[0]?.total || 0;

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

            console.log('  Fetching user_id...');
            const [userRecord] = await dbPromise.query('SELECT id FROM users WHERE email = ?', [user_email]);
            const user_id = userRecord[0]?.id;

            console.log('  user_id:', user_id);

            if (!user_id) {
                console.error('  ❌ user_id not found for email:', user_email);
                return res.status(500).json({ error: 'User ID not found' });
            }

            console.log('  Inserting auction with values:', { asset_id, starting_price, duration_days: duration_days || 7, user_id, end_date_str });

            const [result] = await dbPromise.query(
                `INSERT INTO auctions (asset_id, starting_price, duration_days, created_by_uid, end_date, status)
                 VALUES (?, ?, ?, ?, ?, 'active')`,
                [asset_id, starting_price, duration_days || 7, user_id, end_date_str]
            );

            const auctionId = result.insertId;
            console.log('  ✅ Auction created with ID:', auctionId);

            if (images && images.length > 0) {
                for (const imageUrl of images) {
                    await dbPromise.query(
                        'INSERT INTO auction_images (auction_id, image_url) VALUES (?, ?)',
                        [auctionId, imageUrl]
                    );
                }
                console.log('  ✅ Images inserted:', images.length);
            }

            return res.status(201).json({
                success: true,
                auction_id: auctionId,
                message: 'Auction created successfully'
            });
        } catch (err) {
            console.error('POST /api/auctions error:', err);
            return res.status(500).json({ error: 'Failed to create auction' });
        }
    });

    // POST: Placer une enchère
    app.post('/api/auctions/:auctionId/bid', verifyJWT, async (req, res) => {
        const { auctionId } = req.params;
        const { amount } = req.body;
        const userEmail = req.user.email;
        const userUid = req.user.id;

        console.log(`🔍 POST /api/auctions/${auctionId}/bid`);
        console.log('  userEmail:', userEmail);
        console.log('  userUid:', userUid);
        console.log('  amount:', amount);

        try {
            // 1. Vérifier que l'enchère existe et est active
            const [auctions] = await dbPromise.query(`
                SELECT
                    a.id, a.starting_price, a.current_highest_bid, a.end_date,
                    ast.label, ast.serial_no, ast.purchase_price,
                    c.name as category
                FROM auctions a
                JOIN assets ast ON a.asset_id = ast.id
                LEFT JOIN categories c ON ast.category_id = c.id
                WHERE a.id = ? AND a.status = 'active'`,
                [auctionId]
            );

            if (auctions.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Auction not found or inactive'
                });
            }

            const auction = auctions[0];

            // 2. Valider le montant de la mise
            const minBid = auction.current_highest_bid
                ? auction.current_highest_bid + 1
                : auction.starting_price;

            if (amount < minBid) {
                return res.status(400).json({
                    success: false,
                    message: `Bid must be at least $${minBid}`,
                    toast: {
                        type: 'error',
                        title: 'Invalid Bid',
                        message: `Minimum bid is $${minBid}`,
                    },
                });
            }

            // 3. Vérifier si l'utilisateur a déjà une mise
            const [existingBids] = await dbPromise.query(
                `SELECT id, amount FROM bids WHERE auction_id = ? AND user_uid = ? ORDER BY amount DESC LIMIT 1`,
                [auctionId, userUid]
            );

            if (existingBids.length > 0) {
                const previousBid = existingBids[0];
                if (amount <= previousBid.amount) {
                    return res.status(400).json({
                        success: false,
                        message: `Your new bid ($${amount}) must be higher than your previous bid ($${previousBid.amount})`,
                        toast: {
                            type: 'error',
                            title: 'Invalid Bid',
                            message: `New bid must exceed your previous bid of $${previousBid.amount}`,
                        },
                    });
                }
                // Supprimer la mise précédente
                await dbPromise.query(`DELETE FROM bids WHERE id = ?`, [previousBid.id]);
                console.log('  ✅ Previous bid removed');
            }

            // 4. Récupérer tous les enchérisseurs précédents (sauf le nouvel enchérisseur)
            const [previousBidders] = await dbPromise.query(
                `SELECT DISTINCT u.email FROM bids b 
                 JOIN users u ON b.user_uid = u.id 
                 WHERE b.auction_id = ? AND b.user_uid != ?`,
                [auctionId, userUid]
            );

            const previousBidderEmails = previousBidders.map((bid) => bid.email);
            console.log('  Previous bidders to notify:', previousBidderEmails.length);

            // 5. Insérer la nouvelle mise
            await dbPromise.query(
                `INSERT INTO bids (auction_id, user_uid, amount) VALUES (?, ?, ?)`,
                [auctionId, userUid, amount]
            );
            console.log('  ✅ Bid inserted');

            // 6. Mettre à jour current_highest_bid
            await dbPromise.query(
                `UPDATE auctions SET current_highest_bid = ? WHERE id = ?`,
                [amount, auctionId]
            );
            console.log('  ✅ Auction highest bid updated');

            // 7. Envoyer l'email de confirmation au nouvel enchérisseur
            try {
                await sendBidConfirmationEmail(userEmail, auction, amount);
                console.log('  ✅ Bid confirmation email sent');
            } catch (emailError) {
                console.error('  ⚠️ Failed to send bid confirmation email:', emailError.message);
            }

            // 8. Envoyer les emails de notification aux autres enchérisseurs
            if (previousBidderEmails.length > 0) {
                try {
                    await sendOutbidNotificationEmails(previousBidderEmails, auction, amount, userEmail);
                    console.log('  ✅ Outbid notifications sent');
                } catch (emailError) {
                    console.error('  ⚠️ Failed to send outbid notifications:', emailError.message);
                }
            }

            res.json({
                success: true,
                your_bid: amount,
                current_highest_bid: amount,
                message: 'Bid placed successfully',
                toast: {
                    type: 'success',
                    title: 'Bid Confirmed',
                    message: `Your bid of $${amount.toFixed(2)} has been placed. A confirmation email has been sent.`,
                },
            });
        } catch (error) {
            console.error('Error placing bid:', error);
            res.status(500).json({
                success: false,
                message: 'Error placing bid',
                toast: {
                    type: 'error',
                    title: 'Error',
                    message: 'Failed to place bid. Please try again.',
                },
            });
        }
    });

    // POST: Auto-close auctions
    app.post('/api/auctions/auto-close', async (req, res) => {
        try {
            console.log('🕐 Running auction auto-close...');

            const [expiredAuctions] = await dbPromise.query(`
                SELECT a.id, a.created_by_uid, u_creator.email as creator_email, a.asset_id
                FROM auctions a
                         JOIN users u_creator ON a.created_by_uid = u_creator.id
                WHERE a.status = 'active' AND a.end_date <= DATE(NOW())
            `);

            console.log(`Found ${expiredAuctions.length} expired auctions`);

            for (const auction of expiredAuctions) {
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

                    await dbPromise.query(
                        'UPDATE auctions SET status = ?, winner_uid = ? WHERE id = ?',
                        ['ended', winner.user_uid, auction.id]
                    );

                    console.log(`✅ Auction ${auction.id} closed. Winner: ${winner.winner_email}, Amount: ${finalAmount}`);
                } else {
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