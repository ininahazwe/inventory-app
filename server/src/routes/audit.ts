import { Router, Request, Response } from 'express';
import { db } from '../database/connection';
import { logger } from '../middleware/logger';
import { requireAuth } from '../middleware/auth';

const router = Router();

export async function logAudit(
    userId: string | number,
    action: string,
    targetTable: string,
    targetId: number,
    oldValue?: any,
    newValue?: any
): Promise<void> {
    try {
        await db.query(`
            INSERT INTO audit_log (user_id, action, target_table, target_id, old_value, new_value, created_at)
            VALUES (?, ?, ?, ?, ?, ?, NOW())
        `, [
            userId,
            action,
            targetTable,
            targetId,
            oldValue ? JSON.stringify(oldValue) : null,
            newValue ? JSON.stringify(newValue) : null
        ]);
        logger.info(`✅ Audit logged: ${action} on ${targetTable}:${targetId} by ${userId}`, 'AUDIT');
    } catch (err) {
        logger.error('❌ logAudit error:', err as Error);
    }
}

// GET /api/audit - List audit logs
router.get('/', requireAuth, async (req: Request, res: Response) => {
    try {
        const limit = Math.max(1, parseInt(String(req.query.limit || '10')));
        const offset = Math.max(0, parseInt(String(req.query.offset || '0')));
        const targetTable = req.query.entity_type ? String(req.query.entity_type) : null;
        const targetId = req.query.entity_id ? String(req.query.entity_id) : null;

        let query = 'SELECT * FROM audit_log WHERE 1=1';
        const params: any[] = [];

        if (targetTable) {
            query += ' AND target_table = ?';
            params.push(targetTable);
        }

        if (targetId) {
            query += ' AND target_id = ?';
            params.push(parseInt(targetId));
        }

        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);

        const [logs] = await db.query(query, params);

        console.log('🔍 Query params:', { targetTable, targetId, limit, offset });
        console.log('📊 Found logs:', (logs as any[]).length);

        return res.json({
            data: logs || [],
            pagination: { limit, offset }
        });
    } catch (err) {
        logger.error('GET /audit error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

export default router;