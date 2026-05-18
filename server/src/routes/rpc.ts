import { Router, Request, Response } from 'express';
import { db } from '../database/connection';
import { logger } from '../middleware/logger';
import { requireAuth } from '../middleware/auth';
import { logAudit } from './audit';

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

        // Get old state
        const [oldAsset] = await db.query('SELECT * FROM assets WHERE id = ?', [p_asset_id]);
        if (!(oldAsset as any[]).length) {
            return res.status(404).json({ error: 'Asset not found' });
        }
        const oldValue = (oldAsset as any[])[0];

        // Update assignment
        await db.query(
            'UPDATE assignments SET status = ?, returned_at = ? WHERE asset_id = ? AND status = ?',
            ['returned', new Date().toISOString().split('T')[0], p_asset_id, 'active']
        );

        // Update asset
        await db.query('UPDATE assets SET status = ? WHERE id = ?', ['in_stock', p_asset_id]);

        // Get new state
        const [newAsset] = await db.query('SELECT * FROM assets WHERE id = ?', [p_asset_id]);
        const newValue = (newAsset as any[])[0];

        // Log audit
        await auditLog(user.email, 'asset_returned', 'assets', p_asset_id, oldValue, newValue);

        await logAudit(user.email, 'asset_returned', 'assets', p_asset_id, oldValue, newValue);

        logger.info(`Asset ${p_asset_id} returned to stock`, 'RPC');
        return res.json({ success: true });
    } catch (err) {
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

        // Validate asset
        const [assetCheck] = await db.query(
            'SELECT id, status FROM assets WHERE id = ?',
            [p_asset_id]
        );

        if (!(assetCheck as any[]).length) {
            return res.status(404).json({ error: 'Asset not found' });
        }

        const asset = (assetCheck as any[])[0];
        if (asset.status === 'repair') {
            return res.status(400).json({ error: 'Asset is already in repair' });
        }
        if (asset.status === 'retired') {
            return res.status(400).json({ error: 'Cannot repair a retired asset' });
        }

        // Get old state
        const [oldAsset] = await db.query('SELECT * FROM assets WHERE id = ?', [p_asset_id]);
        const oldValue = (oldAsset as any[])[0];

        // Update status
        await db.query('UPDATE assets SET status = ? WHERE id = ?', ['repair', p_asset_id]);

        // Get new state
        const [newAsset] = await db.query('SELECT * FROM assets WHERE id = ?', [p_asset_id]);
        const newValue = (newAsset as any[])[0];

        // Log lifecycle event
        await db.query(
            'INSERT INTO lifecycle_events (asset_id, event_type, notes, created_by, status) VALUES (?, ?, ?, ?, ?)',
            [p_asset_id, 'repair', p_notes || 'Sent for repair', user.email, 'open']
        );

        // Log audit
        await auditLog(user.email, 'asset_sent_to_repair', 'assets', p_asset_id, oldValue, newValue);

        logger.info(`Asset ${p_asset_id} sent to repair`, 'RPC');
        return res.json({ success: true, message: 'Asset sent for repair' });
    } catch (err) {
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

        // Validate asset
        const [assetCheck] = await db.query(
            'SELECT id, status FROM assets WHERE id = ?',
            [p_asset_id]
        );

        if (!(assetCheck as any[]).length) {
            return res.status(404).json({ error: 'Asset not found' });
        }

        const asset = (assetCheck as any[])[0];
        if (asset.status !== 'repair') {
            return res.status(400).json({ error: 'Asset is not in repair status' });
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

        // Get old state
        const [oldAsset] = await db.query('SELECT * FROM assets WHERE id = ?', [p_asset_id]);
        const oldValue = (oldAsset as any[])[0];

        // Update status
        await db.query('UPDATE assets SET status = ? WHERE id = ?', ['in_stock', p_asset_id]);

        // Get new state
        const [newAsset] = await db.query('SELECT * FROM assets WHERE id = ?', [p_asset_id]);
        const newValue = (newAsset as any[])[0];

        // Build notes
        let eventNotes = p_notes || 'Repair completed';
        if (repairCost !== null) {
            eventNotes += ` | Repair cost: $${repairCost.toFixed(2)}`;
        }

        // Log lifecycle event
        await db.query(
            'INSERT INTO lifecycle_events (asset_id, event_type, notes, created_by, status) VALUES (?, ?, ?, ?, ?)',
            [p_asset_id, 'maintenance', eventNotes, user.email, 'resolved']
        );

        // Log audit
        await auditLog(user.email, 'asset_repair_completed', 'assets', p_asset_id, oldValue, newValue);

        logger.info(`Asset ${p_asset_id} repair completed`, 'RPC');
        return res.json({
            success: true,
            message: 'Repair completed, asset returned to stock',
            repair_cost: repairCost
        });
    } catch (err) {
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

        // Validate asset
        const [assetCheck] = await db.query(
            'SELECT id, status FROM assets WHERE id = ?',
            [p_asset_id]
        );

        if (!(assetCheck as any[]).length) {
            return res.status(404).json({ error: 'Asset not found' });
        }

        const asset = (assetCheck as any[])[0];
        if (asset.status === 'retired') {
            return res.status(400).json({ error: 'Asset is already retired' });
        }

        // Get old state
        const [oldAsset] = await db.query('SELECT * FROM assets WHERE id = ?', [p_asset_id]);
        const oldValue = (oldAsset as any[])[0];

        // Update status
        await db.query('UPDATE assets SET status = ? WHERE id = ?', ['retired', p_asset_id]);

        // Close assignment if active
        await db.query(
            'UPDATE assignments SET status = ?, returned_at = ? WHERE asset_id = ? AND status = ?',
            ['returned', new Date().toISOString().split('T')[0], p_asset_id, 'active']
        );

        // Get new state
        const [newAsset] = await db.query('SELECT * FROM assets WHERE id = ?', [p_asset_id]);
        const newValue = (newAsset as any[])[0];

        // Log lifecycle event
        await db.query(
            'INSERT INTO lifecycle_events (asset_id, event_type, notes, created_by, status) VALUES (?, ?, ?, ?, ?)',
            [p_asset_id, 'retired', p_notes || 'Withdrawn from service', user.email, 'resolved']
        );

        // Log audit
        await auditLog(user.email, 'asset_retired', 'assets', p_asset_id, oldValue, newValue);

        logger.info(`Asset ${p_asset_id} retired`, 'RPC');
        return res.json({ success: true, message: 'Asset permanently retired' });
    } catch (err) {
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

// ✅ Log all registered POST routes
console.log('✅ RPC routes registered: /return_asset, /send_to_repair, /exit_repair, /retire_asset, /get_asset_stats');

export default router;