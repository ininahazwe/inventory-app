// routes/auctions.js - VERSION NETTOYÉE ET COMPLÈTE
const { sendBidConfirmationEmail, sendOutbidNotificationEmails } = require('../services/gmailService');

module.exports = function(app, dbPromise, verifyJWT) {

    // ============================================================
    // GET: Lister toutes les enchères (avec pagination)
    // ============================================================
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

    // ============================================================
    // GET: Détail d'une enchère (par ID)
    // ============================================================
    app.get('/api/auctions/:auctionId', async (req, res) => {
        const { auctionId } = req.params;
        console.log(`GET /api/auctions/${auctionId}`);

        try {
            // 1. Récupérer l'enchère avec ses détails
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
                console.log(`  ❌ Auction ${auctionId} not found`);
                return res.status(404).json({ error: 'Auction not found' });
            }

            console.log(`  ✅ Auction found: ${auctions[0].label}`);

            // 2. Récupérer les enchères (bids)
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

            console.log(`  ✅ Found ${bids.length} bids`);

            // 3. Récupérer les images
            const [images] = await dbPromise.query(`
                SELECT image_url
                FROM auction_images
                WHERE auction_id = ?
                ORDER BY created_at ASC
            `, [auctionId]);

            console.log(`  ✅ Found ${images.length} images`);

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

    // ============================================================
    // POST: Placer une enchère
    // ============================================================
    app.post('/api/auctions/:auctionId/bid', verifyJWT, async (req, res) => {
        const { auctionId } = req.params;
        const { amount } = req.body;

        const userEmail = req.user?.email;
        const userUid = req.user?.id;

        console.log(`\n🔍 POST /api/auctions/${auctionId}/bid`);
        console.log('  userEmail:', userEmail);
        console.log('  userUid:', userUid, `(type: ${typeof userUid})`);
        console.log('  amount:', amount);

        // Vérifier que l'user est authentifié
        if (!userEmail || !userUid) {
            console.error('  ❌ Authentication failed - missing user data');
            return res.status(401).json({
                success: false,
                message: 'Authentication required',
                toast: {
                    type: 'error',
                    title: 'Not Authenticated',
                    message: 'Please log in to place a bid',
                },
            });
        }

        try {
            // Step 1: Vérifier que l'user existe dans la table users
            console.log('  [Step 1] Verifying user exists...');
            const [userExists] = await dbPromise.query(
                'SELECT id, email FROM users WHERE id = ?',
                [userUid]
            );

            if (!userExists || userExists.length === 0) {
                console.error(`  ❌ User NOT found in users table!`);
                console.error(`     Looking for: userUid = "${userUid}"`);

                // Debug: afficher tous les users
                const [allUsers] = await dbPromise.query(
                    'SELECT id, email FROM users LIMIT 10'
                );
                console.error('     Users in DB:', allUsers.map(u => ({ id: u.id, email: u.email })));

                return res.status(400).json({
                    success: false,
                    message: 'User account not found in system',
                    toast: {
                        type: 'error',
                        title: 'Account Error',
                        message: 'Your user account is invalid. Please contact support.',
                    },
                });
            }

            console.log(`  ✅ User verified:`, userExists[0].email);

            // Step 2: Vérifier que l'enchère existe et est active
            console.log('  [Step 2] Checking auction...');
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

            if (!auctions || auctions.length === 0) {
                console.log(`  ❌ Auction ${auctionId} not found or not active`);
                return res.status(404).json({
                    success: false,
                    message: 'Auction not found or inactive'
                });
            }

            const auction = auctions[0];
            console.log(`  ✅ Auction found: "${auction.label}"`);

            // Step 3: Valider le montant de la mise
            console.log('  [Step 3] Validating bid amount...');
            const minBid = auction.current_highest_bid
                ? auction.current_highest_bid + 1
                : auction.starting_price;

            if (amount < minBid) {
                console.log(`  ❌ Bid amount too low: $${amount} < $${minBid}`);
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

            console.log(`  ✅ Bid amount valid: $${amount}`);

            // Step 4: Vérifier si l'utilisateur a déjà une mise
            console.log('  [Step 4] Checking for previous bids...');
            const [existingBids] = await dbPromise.query(
                `SELECT id, amount FROM bids WHERE auction_id = ? AND user_uid = ? ORDER BY amount DESC LIMIT 1`,
                [auctionId, userUid]
            );

            if (existingBids && existingBids.length > 0) {
                const previousBid = existingBids[0];
                if (amount <= previousBid.amount) {
                    console.log(`  ❌ New bid not higher: $${amount} <= $${previousBid.amount}`);
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
                console.log(`  ✅ Previous bid removed (was $${previousBid.amount})`);
            } else {
                console.log('  ℹ️ No previous bids found');
            }

            // Step 5: Récupérer les enchérisseurs précédents
            console.log('  [Step 5] Getting previous bidders...');
            const [previousBidders] = await dbPromise.query(
                `SELECT DISTINCT u.email FROM bids b 
                 JOIN users u ON b.user_uid = u.id 
                 WHERE b.auction_id = ? AND b.user_uid != ?`,
                [auctionId, userUid]
            );

            const biddersList = Array.isArray(previousBidders) ? previousBidders : [];
            const previousBidderEmails = biddersList.map((bid) => bid.email);
            console.log(`  ✅ Found ${previousBidderEmails.length} previous bidders to notify`);

            // Step 6: Insérer la nouvelle mise
            console.log('  [Step 6] Inserting bid...');
            await dbPromise.query(
                `INSERT INTO bids (auction_id, user_uid, amount) VALUES (?, ?, ?)`,
                [auctionId, userUid, amount]
            );
            console.log('  ✅ Bid inserted');

            // Step 7: Mettre à jour current_highest_bid
            console.log('  [Step 7] Updating auction...');
            await dbPromise.query(
                `UPDATE auctions SET current_highest_bid = ? WHERE id = ?`,
                [amount, auctionId]
            );
            console.log(`  ✅ Auction updated: highest bid now $${amount}`);

            // Step 8: Envoyer l'email de confirmation
            try {
                console.log('  [Step 8] Sending confirmation email...');
                await sendBidConfirmationEmail(userEmail, auction, amount);
                console.log(`  ✅ Confirmation email sent to ${userEmail}`);
            } catch (emailError) {
                console.error('  ⚠️ Email failed (non-fatal):', emailError.message);
            }

            // Step 9: Envoyer les emails de notification aux autres enchérisseurs
            if (previousBidderEmails.length > 0) {
                try {
                    console.log('  [Step 9] Sending outbid notifications...');
                    await sendOutbidNotificationEmails(previousBidderEmails, auction, amount, userEmail);
                    console.log(`  ✅ Outbid notifications sent to ${previousBidderEmails.length} users`);
                } catch (emailError) {
                    console.error('  ⚠️ Outbid notifications failed (non-fatal):', emailError.message);
                }
            }

            console.log('  ✅ Bid placed successfully!');
            console.log('================================\n');

            return res.json({
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
            console.error('\n❌ Error placing bid:', error.message);
            console.error('Stack trace:', error.stack);
            console.error('================================\n');

            // Déterminer le message d'erreur à afficher
            let userMessage = 'Failed to place bid. Please try again.';

            if (error.message.includes('foreign key constraint')) {
                userMessage = 'There was a problem with your account. Please contact support.';
            } else if (error.message.includes('DUPLICATE')) {
                userMessage = 'This bid already exists. Please try a different amount.';
            }

            return res.status(500).json({
                success: false,
                message: 'Error placing bid',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined,
                toast: {
                    type: 'error',
                    title: 'Error',
                    message: userMessage,
                },
            });
        }
    });

    // ============================================================
    // POST: Auto-close auctions
    // ============================================================
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