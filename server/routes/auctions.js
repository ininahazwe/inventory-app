// route/auctions.js
module.exports = function(app, dbPromise, verifyJWT) {

    // GET: Lister toutes les enchères
    app.get('/api/auctions', async (req, res) => {
        try {
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
            `);
            return res.json(auctions);
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

            return res.json({
                auction: auctions[0],
                bids
            });
        } catch (err) {
            console.error(`GET /api/auctions/${auctionId} error:`, err);
            return res.status(500).json({ error: 'Failed to fetch auction' });
        }
    });

    // POST: Créer enchère (admin)
    app.post('/api/auctions', verifyJWT, async (req, res) => {
        const { asset_id, starting_price, duration_days } = req.body;
        const user_email = req.user.email;  // Utilise EMAIL au lieu de ID

        try {
            // Vérifier que c'est un admin en utilisant EMAIL
            const [user] = await dbPromise.query('SELECT role FROM users WHERE email = ?', [user_email]);
            if (!user.length || (user[0].role !== 'super_admin' && user[0].role !== 'admin')) {
                return res.status(403).json({ error: 'Only admins can create auctions' });
            }

            const [assets] = await dbPromise.query(
                'SELECT status FROM assets WHERE id = ?',
                [asset_id]
            );
            if (!assets.length) {
                return res.status(404).json({ error: 'Asset not found' });
            }
            if (assets[0].status !== 'in_stock') {
                return res.status(400).json({ error: 'Asset must be in_stock to auction' });
            }

            const [existing] = await dbPromise.query(
                'SELECT id FROM auctions WHERE asset_id = ? AND status IN ("active", "ended")',
                [asset_id]
            );
            if (existing.length) {
                return res.status(400).json({ error: 'Asset already has an active auction' });
            }

            const end_date = new Date();
            end_date.setDate(end_date.getDate() + (duration_days || 7));

            // Récupérer le user_id (UUID) pour stocker dans created_by_uid
            const [userRecord] = await dbPromise.query('SELECT id FROM users WHERE email = ?', [user_email]);
            const user_id = userRecord[0]?.id;

            const [result] = await dbPromise.query(`
                INSERT INTO auctions (asset_id, starting_price, duration_days, created_by_uid, end_date)
                VALUES (?, ?, ?, ?, ?)
            `, [asset_id, starting_price, duration_days || 7, user_id, end_date.toISOString()]);

            return res.status(201).json({
                id: result.insertId,
                asset_id,
                starting_price,
                duration_days: duration_days || 7,
                end_date: end_date.toISOString()
            });
        } catch (err) {
            console.error('POST /api/auctions error:', err);
            return res.status(500).json({ error: 'Failed to create auction' });
        }
    });

    // PATCH: Modifier durée
    app.patch('/api/auctions/:auctionId/duration', verifyJWT, async (req, res) => {
        const { auctionId } = req.params;
        const { duration_days } = req.body;
        const user_email = req.user.email;  // Utilise EMAIL

        try {
            // Vérifier admin par EMAIL
            const [user] = await dbPromise.query('SELECT role FROM users WHERE email = ?', [user_email]);
            if (!user.length || (user[0].role !== 'super_admin' && user[0].role !== 'admin')) {
                return res.status(403).json({ error: 'Only admins can modify auctions' });
            }

            const [auctions] = await dbPromise.query('SELECT * FROM auctions WHERE id = ?', [auctionId]);
            if (!auctions.length) {
                return res.status(404).json({ error: 'Auction not found' });
            }

            const new_end = new Date(auctions[0].start_date);
            new_end.setDate(new_end.getDate() + duration_days);

            await dbPromise.query(
                'UPDATE auctions SET duration_days = ?, end_date = ? WHERE id = ?',
                [duration_days, new_end.toISOString(), auctionId]
            );

            return res.json({ success: true, new_end_date: new_end.toISOString() });
        } catch (err) {
            console.error(`PATCH /api/auctions/${auctionId}/duration error:`, err);
            return res.status(500).json({ error: 'Failed to update auction' });
        }
    });

    // POST: Annuler enchère (admin)
    app.post('/api/auctions/:auctionId/cancel', verifyJWT, async (req, res) => {
        const { auctionId } = req.params;
        const user_email = req.user.email;  // Utilise EMAIL

        try {
            // Vérifier admin par EMAIL
            const [user] = await dbPromise.query('SELECT role FROM users WHERE email = ?', [user_email]);
            if (!user.length || (user[0].role !== 'super_admin' && user[0].role !== 'admin')) {
                return res.status(403).json({ error: 'Only admins can cancel auctions' });
            }

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

    // POST: Placer mise
    app.post('/api/auctions/:auctionId/bid', verifyJWT, async (req, res) => {
        const { auctionId } = req.params;
        const { amount } = req.body;
        const user_email = req.user.email;  // Utilise EMAIL

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

            const [existingBids] = await dbPromise.query(`
                SELECT user_uid, auto_bid_max, amount
                FROM bids
                WHERE auction_id = ?
                ORDER BY amount DESC
            `, [auctionId]);

            await dbPromise.query(`
                INSERT INTO bids (auction_id, user_uid, amount, auto_bid_max)
                VALUES (?, ?, ?, ?)
            `, [auctionId, user_id, amount, amount]);

            let topBidder = null;
            let topBidAmount = amount;

            for (const bid of existingBids) {
                if (bid.user_uid === user_id) continue;

                if (bid.auto_bid_max >= amount) {
                    topBidder = bid.user_uid;
                    topBidAmount = Math.min(bid.auto_bid_max, amount + 1);
                    break;
                }
            }

            await dbPromise.query(
                'UPDATE auctions SET current_highest_bid = ? WHERE id = ?',
                [topBidAmount, auctionId]
            );

            return res.status(201).json({
                success: true,
                your_bid: amount,
                current_highest_bid: topBidAmount,
                top_bidder_uid: topBidder,
                message: topBidder && topBidder !== user_id
                    ? 'You were outbid. You can raise your bid.'
                    : 'You are the highest bidder.'
            });
        } catch (err) {
            console.error(`POST /api/auctions/${auctionId}/bid error:`, err);
            return res.status(500).json({ error: 'Failed to place bid' });
        }
    });
};