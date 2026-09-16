// server/src/routes/supplyIssues.ts
// Nouvelle route (Phase 3) : POST /api/supply-issues — écrit exclusivement
// via supplyLedger.postIssue(), dans la même transaction que le document.
import { Router, Request, Response } from 'express';
import { db } from '../database/connection';
import { logger } from '../middleware/logger';
import { requireAuth } from '../middleware/auth';
import { logAudit } from './audit';
import { postIssue } from '../services/supplyLedger';
import { AppException, BusinessException } from '../exceptions';

const router = Router();

// POST /api/supply-issues - { issue_date, destination_location_id?, recipient_uid?, purpose?, lines: [...] }
router.post('/', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { issue_date, destination_location_id, recipient_uid, purpose, reference, lines } = req.body;

        if (!issue_date || !Array.isArray(lines) || lines.length === 0) {
            return res.status(400).json({ error: 'issue_date and at least one line are required' });
        }
        if (!destination_location_id && !recipient_uid) {
            return res.status(400).json({ error: 'destination_location_id or recipient_uid is required' });
        }

        for (const line of lines) {
            if (!line.item_id || line.quantity_base === undefined) {
                return res.status(400).json({ error: 'Each line requires item_id and quantity_base' });
            }
            if (!Number.isInteger(Number(line.quantity_base)) || Number(line.quantity_base) <= 0) {
                throw new BusinessException('quantity_base must be a positive integer');
            }
        }

        const { issueId, lineIds } = await db.transaction(async (tx) => {
            return postIssue({
                issue_date: issue_date.includes('T') ? issue_date.split('T')[0] : issue_date,
                destination_location_id: destination_location_id || null,
                recipient_uid: recipient_uid || null,
                issued_by_uid: user.uid !== undefined ? String(user.uid) : null,
                purpose: purpose || null,
                reference: reference || null,
                lines,
            }, tx);
        });

        const [rows] = await db.execute(
            `SELECT q.id, q.reference, q.issue_date, q.destination_location_id, q.recipient_uid, q.purpose,
                    il.id AS line_id, il.item_id, il.quantity_base
             FROM supply_issues q JOIN supply_issue_lines il ON il.issue_id = q.id
             WHERE q.id = ?`,
            [issueId]
        );

        await logAudit(user.email, 'supply_issue_created', 'supply_issues', issueId, null, { issueId, lineIds });

        logger.info(`Created supply issue #${issueId} (${lineIds.length} lines)`, 'SUPPLY_ISSUES');
        return res.status(201).json({ id: issueId, lines: rows });
    } catch (err) {
        if (err instanceof AppException) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        logger.error('POST /supply-issues error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

export default router;
