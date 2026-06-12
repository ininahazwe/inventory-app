import express from 'express';
import cors from 'cors';
import path from 'path';
import authRoutes from './routes/auth';
import assetsRoutes from './routes/assets';
import assignmentsRoutes from './routes/assignments';
import locationsRoutes from './routes/locations';
import categoriesRoutes from './routes/categories';
import incidentsRoutes from './routes/incidents';
import usersRoutes from './routes/users';
import rpcRoutes from './routes/rpc';
import suppliesRoutes from './routes/supplies';
import supplyAssignmentsRoutes from './routes/supplyAssignments';
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
    app.use('/api/locations', locationsRoutes);
    app.use('/api/supply-assignments', supplyAssignmentsRoutes);
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

    // ═══════════════════════════════════════════════════════════════════════════
    // SPA FALLBACK (must be AFTER static files, BEFORE error handler)
    // CRITICAL: Only fallback for non-API, non-static routes
    // ═══════════════════════════════════════════════════════════════════════════

    app.use((req, res) => {
        // If it's an API route that wasn't caught above, return 404 (don't serve SPA)
        if (req.path.startsWith('/api')) {
            return res.status(404).json({ error: 'API route not found', path: req.path });
        }

        // For all other routes (SPA routes), serve index.html
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