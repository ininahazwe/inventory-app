/**
 * Cron task: Auto-close expired auctions
 * Runs every hour at :00
 * Calls POST /api/auctions/auto-close on assets.mfwa.org
 */

const schedule = require('node-schedule');

// Run every hour at :00 (e.g., 13:00, 14:00, 15:00...)
const job = schedule.scheduleJob('0 * * * *', async () => {
    const now = new Date();
    console.log(`\n[${now.toISOString()}] 🔄 Running auction auto-close cron...`);

    try {
        // Call the auction auto-close endpoint on the public domain
        const response = await fetch('https://assets.mfwa.org/api/auctions/auto-close', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({})
        });

        const result = await response.json();

        if (response.ok) {
            console.log(`✅ Cron result: ${result.message || result.success}`);
            if (result.closedCount) {
                console.log(`   Closed ${result.closedCount} auction(s)`);
            }
        } else {
            console.error(`❌ Cron error (${response.status}): ${result.error || 'Unknown error'}`);
        }
    } catch (err) {
        console.error(`❌ Cron request failed: ${err.message}`);
    }
});

console.log('✅ Auction auto-close cron scheduled (runs every hour at :00)');

module.exports = job;