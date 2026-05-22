import express from 'express';
import cors from 'cors';
import path from 'path';
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
import healthRoutes from './routes/health';

export function createApp() {
    const app = express();

    // ═══════════════════════════════════════════════════════════════════════════
    // MIDDLEWARE (CORS FIRST)
    // ═══════════════════════════════════════════════════════════════════════════

    app.use(cors({
        origin: ['http://localhost:5173', 'http://localhost:3002', 'https://assets.mfwa.org'],
        credentials: true,
    }));

    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // ═══════════════════════════════════════════════════════════════════════════
    // API ROUTES (BEFORE STATIC FILES - CRITICAL!)
    // ═══════════════════════════════════════════════════════════════════════════

    app.use('/api/health', healthRoutes);
    app.use('/api/auth', authRoutes);
    app.use('/api/categories', categoriesRoutes);
    app.use('/api/assets', assetsRoutes);
    app.use('/api/assignments', assignmentsRoutes);
    app.use('/api/incidents', incidentsRoutes);
    app.use('/api/users', usersRoutes);
    app.use('/api/rpc', rpcRoutes);
    app.use('/api/supplies', suppliesRoutes);
    app.use('/api/auctions', auctionsRouter);
    app.use('/api/audit', requireAuth, auditRoutes);

    // ═══════════════════════════════════════════════════════════════════════════
    // STATIC FILES (AFTER API ROUTES)
    // ═══════════════════════════════════════════════════════════════════════════

    app.use(express.static(path.join(__dirname, '../public'), {
        maxAge: '1d',
        etag: false
    }));

    // SPA FALLBACK - Only for non-API routes
    app.use((req, res, next) => {
        // If it's an API route, skip SPA fallback (should have been caught by app.use('/api/...') above)
        if (req.path.startsWith('/api')) {
            return next();  // Pass to error handler
        }

        res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
        res.sendFile(path.join(__dirname, '../public/index.html'));
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // ERROR HANDLER (must be last)
    // ═══════════════════════════════════════════════════════════════════════════

    app.use(errorHandler);

    return app;
}