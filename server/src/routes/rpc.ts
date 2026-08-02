import { Router, Request, Response } from 'express';
import { db } from '../database/connection';
import { logger } from '../middleware/logger';
import { requireAuth } from '../middleware/auth';
import { logAudit } from './audit';
import { AppException, NotFoundException, BusinessException } from '../exceptions';
import { todayDateString, currentMonthBounds } from '../utils/dateHelpers';

const router = Router();

// Helper: Audit log function
async function auditLog(userEmail: string, action: string, targetTable: string, targetId: number, oldValue?: any, newValue?: any) {
    try {
        await db.query(`
      INSERT INTO audit_log (user_id, action, target_table, target_id, old_value, new_value, created_at)
      VALUES (?, ?, ?, ?, ?, ?, NOW())
    `, [
            userEmail,
            action,
            targetTable,
            targetId,
            oldValue ? JSON.stringify(oldValue) : null,
            newValue ? JSON.stringify(newValue) : null
        ]);
        logger.info(`✅ Audit logged: ${action} on ${targetTable}:${targetId} by ${userEmail}`, 'AUDIT');
    } catch (err) {
        logger.error('❌ auditLog error:', err as Error);
    }
}

// ✅ Verify route is registered
console.log('🔧 RPC router initializing...');

// POST /api/rpc/return_asset
router.post('/return_asset', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { p_asset_id } = req.body;

        if (!p_asset_id) {
            return res.status(400).json({ error: 'p_asset_id required' });
        }

        // ✅ Transaction: verrou (FOR UPDATE) sur l'asset + update assignment + update
        // statut asset, atomiques. Empêche deux return_asset concurrents sur le même asset.
        const { oldValue, newValue } = await db.transaction(async (tx) => {
            const [oldAsset] = await tx.execute('SELECT * FROM assets WHERE id = ? FOR UPDATE', [p_asset_id]);
            if (!(oldAsset as any[]).length) {
                throw new NotFoundException('Asset not found');
            }
            const oldValue = (oldAsset as any[])[0];

            // ✅ Only an assigned asset can be returned (avoids silently resetting repair/auctioned/retired)
            if (oldValue.status !== 'assigned') {
                throw new BusinessException(`Asset is not assigned (status: ${oldValue.status})`);
            }

            // Update assignment
            await tx.execute(
                'UPDATE assignments SET status = ?, returned_at = ? WHERE asset_id = ? AND status = ?',
                ['returned', todayDateString(), p_asset_id, 'active']
            );

            // Update asset
            await tx.execute('UPDATE assets SET status = ? WHERE id = ?', ['in_stock', p_asset_id]);

            const [newAsset] = await tx.execute('SELECT * FROM assets WHERE id = ?', [p_asset_id]);
            return { oldValue, newValue: (newAsset as any[])[0] };
        });

        // Log audit (une seule fois)
        await logAudit(user.email, 'asset_returned', 'assets', p_asset_id, oldValue, newValue);

        logger.info(`Asset ${p_asset_id} returned to stock`, 'RPC');
        return res.json({ success: true });
    } catch (err) {
        if (err instanceof AppException) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        logger.error('return_asset error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

// POST /api/rpc/send_to_repair
router.post('/send_to_repair', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { p_asset_id, p_notes } = req.body;

        if (!p_asset_id) {
            return res.status(400).json({ error: 'p_asset_id required' });
        }

        // ✅ Transaction: verrou (FOR UPDATE) + update statut + lifecycle_events atomiques
        const { oldValue, newValue } = await db.transaction(async (tx) => {
            const [assetCheck] = await tx.execute('SELECT * FROM assets WHERE id = ? FOR UPDATE', [p_asset_id]);
            if (!(assetCheck as any[]).length) {
                throw new NotFoundException('Asset not found');
            }

            const oldValue = (assetCheck as any[])[0];
            if (oldValue.status === 'repair') {
                throw new BusinessException('Asset is already in repair');
            }
            if (oldValue.status === 'retired') {
                throw new BusinessException('Cannot repair a retired asset');
            }

            await tx.execute('UPDATE assets SET status = ? WHERE id = ?', ['repair', p_asset_id]);

            const [newAsset] = await tx.execute('SELECT * FROM assets WHERE id = ?', [p_asset_id]);
            const newValue = (newAsset as any[])[0];

            await tx.execute(
                'INSERT INTO lifecycle_events (asset_id, event_type, notes, created_by, status) VALUES (?, ?, ?, ?, ?)',
                [p_asset_id, 'repair', p_notes || 'Sent for repair', user.email, 'open']
            );

            return { oldValue, newValue };
        });

        // Log audit
        await auditLog(user.email, 'asset_sent_to_repair', 'assets', p_asset_id, oldValue, newValue);

        logger.info(`Asset ${p_asset_id} sent to repair`, 'RPC');
        return res.json({ success: true, message: 'Asset sent for repair' });
    } catch (err) {
        if (err instanceof AppException) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        logger.error('send_to_repair error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

// POST /api/rpc/exit_repair
router.post('/exit_repair', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { p_asset_id, p_notes, p_cost } = req.body;

        if (!p_asset_id) {
            return res.status(400).json({ error: 'p_asset_id required' });
        }

        // Validate cost
        let repairCost = null;
        if (p_cost !== null && p_cost !== undefined && p_cost !== '') {
            repairCost = parseFloat(p_cost);
            if (isNaN(repairCost) || repairCost < 0) {
                return res.status(400).json({ error: 'Invalid repair cost' });
            }
            repairCost = parseFloat(repairCost.toFixed(2));
        }

        // ✅ Transaction: verrou (FOR UPDATE) + update statut + lifecycle_events atomiques
        const { oldValue, newValue } = await db.transaction(async (tx) => {
            const [assetCheck] = await tx.execute('SELECT * FROM assets WHERE id = ? FOR UPDATE', [p_asset_id]);
            if (!(assetCheck as any[]).length) {
                throw new NotFoundException('Asset not found');
            }

            const oldValue = (assetCheck as any[])[0];
            if (oldValue.status !== 'repair') {
                throw new BusinessException('Asset is not in repair status');
            }

            await tx.execute('UPDATE assets SET status = ? WHERE id = ?', ['in_stock', p_asset_id]);

            const [newAsset] = await tx.execute('SELECT * FROM assets WHERE id = ?', [p_asset_id]);
            const newValue = (newAsset as any[])[0];

            // ✅ Coût dans une colonne dédiée (plus concaténé dans notes) — agrégeable
            // en SQL pour le total de maintenance par asset (retire vs repair).
            await tx.execute(
                'INSERT INTO lifecycle_events (asset_id, event_type, notes, cost, created_by, status) VALUES (?, ?, ?, ?, ?, ?)',
                [p_asset_id, 'maintenance', p_notes || 'Repair completed', repairCost, user.email, 'resolved']
            );

            return { oldValue, newValue };
        });

        // Log audit
        await auditLog(user.email, 'asset_repair_completed', 'assets', p_asset_id, oldValue, newValue);

        logger.info(`Asset ${p_asset_id} repair completed`, 'RPC');
        return res.json({
            success: true,
            message: 'Repair completed, asset returned to stock',
            repair_cost: repairCost
        });
    } catch (err) {
        if (err instanceof AppException) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        logger.error('exit_repair error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

// POST /api/rpc/retire_asset
router.post('/retire_asset', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { p_asset_id, p_notes } = req.body;

        if (!p_asset_id) {
            return res.status(400).json({ error: 'p_asset_id required' });
        }

        // ✅ Transaction: verrou (FOR UPDATE) + update statut + clôture assignment +
        // lifecycle_events atomiques
        const { oldValue, newValue } = await db.transaction(async (tx) => {
            const [assetCheck] = await tx.execute('SELECT * FROM assets WHERE id = ? FOR UPDATE', [p_asset_id]);
            if (!(assetCheck as any[]).length) {
                throw new NotFoundException('Asset not found');
            }

            const oldValue = (assetCheck as any[])[0];
            if (oldValue.status === 'retired') {
                throw new BusinessException('Asset is already retired');
            }

            await tx.execute('UPDATE assets SET status = ? WHERE id = ?', ['retired', p_asset_id]);

            // Close assignment if active
            await tx.execute(
                'UPDATE assignments SET status = ?, returned_at = ? WHERE asset_id = ? AND status = ?',
                ['returned', todayDateString(), p_asset_id, 'active']
            );

            const [newAsset] = await tx.execute('SELECT * FROM assets WHERE id = ?', [p_asset_id]);
            const newValue = (newAsset as any[])[0];

            await tx.execute(
                'INSERT INTO lifecycle_events (asset_id, event_type, notes, created_by, status) VALUES (?, ?, ?, ?, ?)',
                [p_asset_id, 'retired', p_notes || 'Withdrawn from service', user.email, 'resolved']
            );

            return { oldValue, newValue };
        });

        // Log audit
        await auditLog(user.email, 'asset_retired', 'assets', p_asset_id, oldValue, newValue);

        logger.info(`Asset ${p_asset_id} retired`, 'RPC');
        return res.json({ success: true, message: 'Asset permanently retired' });
    } catch (err) {
        if (err instanceof AppException) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        logger.error('retire_asset error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

// POST /api/rpc/get_asset_stats
router.post('/get_asset_stats', requireAuth, async (req: Request, res: Response) => {
    try {
        const [stats] = await db.query(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'in_stock' THEN 1 ELSE 0 END) as in_stock,
        SUM(CASE WHEN status = 'assigned' THEN 1 ELSE 0 END) as assigned,
        SUM(CASE WHEN status = 'repair' THEN 1 ELSE 0 END) as repair,
        SUM(CASE WHEN status = 'retired' THEN 1 ELSE 0 END) as retired
      FROM assets
    `);

        logger.info(`Fetched asset stats`, 'RPC');
        return res.json((stats as any[])[0]);
    } catch (err) {
        logger.error('get_asset_stats error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

// POST /api/rpc/get_dashboard_kpis - KPIs croisés pour la page d'accueil
// (valeur du parc, coût supplies du mois, incidents ouverts, enchères actives)
router.post('/get_dashboard_kpis', requireAuth, async (_req: Request, res: Response) => {
    try {
        const { from, to } = currentMonthBounds();

        const [rows] = await db.query(
            `SELECT
                (SELECT COALESCE(SUM(purchase_price), 0) FROM assets WHERE status != 'retired') AS fleet_value,
                (SELECT COALESCE(SUM(cost), 0) FROM supplies WHERE purchase_date BETWEEN ? AND ?) AS supplies_cost_month,
                (SELECT COUNT(*) FROM incidents WHERE status IN ('open', 'in_progress')) AS open_incidents,
                (SELECT COUNT(*) FROM auctions WHERE status = 'active') AS active_auctions
            `,
            [from, to]
        );

        const kpis = (rows as any[])[0];
        logger.info('Fetched dashboard KPIs', 'RPC');
        return res.json({
            fleet_value: parseFloat(kpis.fleet_value) || 0,
            supplies_cost_month: parseFloat(kpis.supplies_cost_month) || 0,
            open_incidents: Number(kpis.open_incidents) || 0,
            active_auctions: Number(kpis.active_auctions) || 0,
            period: { from, to },
        });
    } catch (err) {
        logger.error('get_dashboard_kpis error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

// ✅ Log all registered POST routes
console.log('✅ RPC routes registered: /return_asset, /send_to_repair, /exit_repair, /retire_asset, /get_asset_stats, /get_dashboard_kpis, /assignees_rename, /assignees_delete');

export default router;