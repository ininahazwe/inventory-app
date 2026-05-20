import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth';
import assetsRoutes from './routes/assets';
import assignmentsRoutes from './routes/assignments';
import categoriesRoutes from './routes/categories';
import incidentsRoutes from './routes/incidents';
import usersRoutes from './routes/users';
import rpcRoutes from './routes/rpc';
import suppliesRoutes from './routes/supplies';
import auditRoutes from './routes/audit';
import auctionsRouter from './routes/auctions';
import { errorHandler } from './middleware/errorHandler';
import { requireAuth } from './middleware/auth';

export function createApp() {
    const app = express();

    // ═══════════════════════════════════════════════════════════════════════════
    // MIDDLEWARE (CORS FIRST, before all routes)
    // ═══════════════════════════════════════════════════════════════════════════

    app.use(cors({
        origin: ['http://localhost:5173', 'http://localhost:3002', 'https://assets.mfwa.org'],
        credentials: true,
    }));

    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // ═══════════════════════════════════════════════════════════════════════════
    // PUBLIC ROUTES (no auth)
    // ═══════════════════════════════════════════════════════════════════════════

    app.use('/api/auth', authRoutes);
    app.use('/api/categories', categoriesRoutes);

    // ═══════════════════════════════════════════════════════════════════════════
    // PROTECTED ROUTES (require auth)
    // ═══════════════════════════════════════════════════════════════════════════

    //app.use('/api/me', requireAuth, authRoutes);
    app.use('/api/assets', assetsRoutes);
    app.use('/api/assignments', assignmentsRoutes);
    app.use('/api/incidents', incidentsRoutes);
    app.use('/api/users', usersRoutes);  // ← /rpc/is_admin, /rpc/is_super_admin, etc.
    app.use('/api/rpc', rpcRoutes);      // ← /return_asset, /send_to_repair, /exit_repair, /retire_asset, /get_asset_stats

    // Legacy/Business specific
    app.use('/api/supplies', suppliesRoutes);

    app.use('/api/auctions', auctionsRouter);

    app.use('/api/audit', requireAuth, auditRoutes);

    // ═══════════════════════════════════════════════════════════════════════════
    // ERROR HANDLER (must be last)
    // ═══════════════════════════════════════════════════════════════════════════

    app.use(errorHandler);

    return app;
}