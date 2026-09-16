// server/src/routes/supplyAdjustments.ts
// Nouvelle route (Phase 3) : POST /api/supply-adjustments — écrit exclusivement
// via supplyLedger.postAdjustment(), dans la même transaction que le document.
// L'écart (compté - système) est calculé côté serveur, jamais saisi : le
// client envoie la quantité comptée, pas l'écart (cf. Phase 4, formulaire
// d'ajustement — "l'écart s'affiche avant validation, jamais après").
import { Router, Request, Response } from 'express';
import { db } from '../database/connection';
import { logger } from '../middleware/logger';
import { requireAuth } from '../middleware/auth';
import { logAudit } from './audit';
import { postAdjustment } from '../services/supplyLedger';
import { AppException, BusinessException } from '../exceptions';

const router = Router();

const VALID_REASONS = ['loss', 'breakage', 'expiry', 'error', 'found'];

// POST /api/supply-adjustments - { adjustment_date, source, reason, lines: [{item_id, counted_quantity}] }
router.post('/', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        if (user.role !== 'admin' && user.role !== 'super_admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }

        const { adjustment_date, source, reason, lines } = req.body;

        if (!adjustment_date || !source || !reason || !Array.isArray(lines) || lines.length === 0) {
            return res.status(400).json({ error: 'adjustment_date, source, reason and at least one line are required' });
        }
        if (!['count', 'event'].includes(source)) {
            return res.status(400).json({ error: "source must be 'count' or 'event'" });
        }
        if (!VALID_REASONS.includes(reason)) {
            return res.status(400).json({ error: `reason must be one of: ${VALID_REASONS.join(', ')}` });
        }

        for (const line of lines) {
            if (!line.item_id || line.counted_quantity === undefined) {
                return res.status(400).json({ error: 'Each line requires item_id and counted_quantity' });
            }
            if (!Number.isInteger(Number(line.counted_quantity)) || Number(line.counted_quantity) < 0) {
                throw new BusinessException('counted_quantity must be a non-negative integer');
            }
        }

        const { adjustmentId, lineIds } = await db.transaction(async (tx) => {
            return postAdjustment({
                adjustment_date: adjustment_date.includes('T') ? adjustment_date.split('T')[0] : adjustment_date,
                source,
                reason,
                recorded_by_uid: user.uid !== undefined ? String(user.uid) : null,
                lines: lines.map((l: any) => ({ item_id: l.item_id, counted_quantity: l.counted_quantity, notes: l.notes || null })),
            }, tx);
        });

        const [rows] = await db.execute(
            `SELECT a.id, a.adjustment_date, a.source, a.reason, a.status,
                    al.id AS line_id, al.item_id, al.system_quantity, al.counted_quantity, al.variance
             FROM supply_adjustments a JOIN supply_adjustment_lines al ON al.adjustment_id = a.id
             WHERE a.id = ?`,
            [adjustmentId]
        );

        await logAudit(user.email, 'supply_adjustment_created', 'supply_adjustments', adjustmentId, null, { adjustmentId, lineIds });

        logger.info(`Created supply adjustment #${adjustmentId} (${lineIds.length} lines)`, 'SUPPLY_ADJUSTMENTS');
        return res.status(201).json({ id: adjustmentId, lines: rows });
    } catch (err) {
        if (err instanceof AppException) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        logger.error('POST /supply-adjustments error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

export default router;
