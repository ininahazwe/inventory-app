import dotenv from 'dotenv';
import { logger } from './middleware/logger.js';
import { createApp } from './app.js';
import { initializePool } from './database/connection.js';

dotenv.config();

async function startServer() {
    await initializePool();
    const app = createApp();
    const PORT = process.env.PORT || 3003;

    app.listen(PORT, () => {
        logger.info(`Server running on port ${PORT}`, 'SERVER');
    });
}

startServer().catch(error => {
    logger.error('Failed to start server', error);
    process.exit(1);
});