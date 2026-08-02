import dotenv from 'dotenv';
import { logger } from './middleware/logger.js';
import { createApp } from './app.js';
import { initializePool } from './database/connection.js';
import { validateEnv } from './config/env.js';
import { startScheduler } from './scheduler.js';

dotenv.config();

async function startServer() {
    // ✅ Fail fast: pas de secret hardcodé en fallback si la config est incomplète
    validateEnv();
    await initializePool();
    const app = createApp();
    const PORT = process.env.PORT || 3003;

    app.listen(PORT, () => {
        logger.info(`Server running on port ${PORT}`, 'SERVER');
    });

    // ✅ Auto-close enchères + relance SLA incidents: en process, plus besoin
    // d'un cron externe qui appelle une route publique (voir src/scheduler.ts).
    startScheduler();
}

startServer().catch(error => {
    logger.error('Failed to start server', error);
    process.exit(1);
});