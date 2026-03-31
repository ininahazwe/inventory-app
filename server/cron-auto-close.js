/**
 * Cron task: Auto-close expired auctions
 * Runs every hour at :00
 * Calls POST /api/auctions/auto-close on localhost:3003
 */

const schedule = require('node-schedule');
const http = require('http');

// Run every hour at :00
const job = schedule.scheduleJob('*/5 * * * *', async () => {
    const now = new Date();
    console.log(`\n[${now.toISOString()}] 🔄 Running auto-close cron...`);

    const postData = JSON.stringify({});

    const options = {
        hostname: 'localhost',
        port: 3003,
        path: '/api/auctions/auto-close',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
        },
    };

    const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
            try {
                const result = JSON.parse(data);
                console.log(`✅ Cron result: ${result.message}`);
            } catch (err) {
                console.error('Failed to parse cron response:', err);
            }
        });
    });

    req.on('error', (err) => {
        console.error('❌ Cron error:', err.message);
    });

    req.write(postData);
    req.end();
});

console.log('✅ Auction auto-close cron scheduled (runs every hour)');

module.exports = job;