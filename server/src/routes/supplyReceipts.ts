// server/src/routes/supplyReceipts.ts
// Nouvelle route (Phase 3) : POST /api/supply-receipts — écrit exclusivement
// via supplyLedger.postReceipt(), dans la même transaction que le document.
import { Router, Request, Response } from 'express';
import { db } from '../database/connection';
import { logger } from '../middleware/logger';
import { requireAuth } from '../middleware/auth';
import { logAudit } from './audit';
import { postReceipt } from '../services/supplyLedger';
import { AppException, BusinessException } from '../exceptions';

const router = Router();

// POST /api/supply-receipts - { received_date, supplier_id?, invoice_ref?, reference?, lines: [...] }
router.post('/', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { received_date, supplier_id, invoice_ref, reference, lines } = req.body;

        if (!received_date || !Array.isArray(lines) || lines.length === 0) {
            return res.status(400).json({ error: 'received_date and at least one line are required' });
        }

        for (const line of lines) {
            if (!line.item_id || !line.packs_received || !line.quantity_base || line.line_total === undefined || line.unit_cost_base === undefined) {
                return res.status(400).json({ error: 'Each line requires item_id, packs_received, quantity_base, line_total, unit_cost_base' });
            }
            if (!Number.isInteger(Number(line.quantity_base)) || Number(line.quantity_base) <= 0) {
                throw new BusinessException('quantity_base must be a positive integer');
            }
        }

        const { receiptId, lineIds } = await db.transaction(async (tx) => {
            return postReceipt({
                received_date: received_date.includes('T') ? received_date.split('T')[0] : received_date,
                supplier_id: supplier_id || null,
                invoice_ref: invoice_ref || null,
                reference: reference || null,
                received_by_uid: user.uid !== undefined ? String(user.uid) : null,
                lines,
            }, tx);
        });

        const [rows] = await db.execute(
            `SELECT r.id, r.reference, r.received_date, r.invoice_ref, r.supplier_id,
                    rl.id AS line_id, rl.item_id, rl.pack_size, rl.packs_received, rl.quantity_base, rl.line_total, rl.unit_cost_base
             FROM supply_receipts r JOIN supply_receipt_lines rl ON rl.receipt_id = r.id
             WHERE r.id = ?`,
            [receiptId]
        );

        await logAudit(user.email, 'supply_receipt_created', 'supply_receipts', receiptId, null, { receiptId, lineIds });

        logger.info(`Created supply receipt #${receiptId} (${lineIds.length} lines)`, 'SUPPLY_RECEIPTS');
        return res.status(201).json({ id: receiptId, lines: rows });
    } catch (err) {
        if (err instanceof AppException) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        logger.error('POST /supply-receipts error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

export default router;
