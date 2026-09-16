// server/src/routes/supplies.ts
//
// Phase 3 — ADAPTATEUR. Ce fichier ne touche plus aux anciennes tables
// (`supplies`, `supply_movements`) : il lit et écrit exclusivement via les
// nouvelles tables (supply_receipts / supply_receipt_lines / supply_items)
// et supplyLedger.ts, mais renvoie EXACTEMENT le même contrat JSON qu'avant
// — le front (jusqu'à la Phase 4) continue de fonctionner sans modification.
//
// Correspondance : une ligne `supplies` d'avant = une ligne
// `supply_receipt_lines` aujourd'hui (même granularité, un lot = un achat).
// `id` exposé = COALESCE(legacy_supply_id, id) : les 37 lots historiques
// gardent leur ancien id (1-46), tout nouvel achat reçoit un id ≥ 100000
// (voir migrations/2026-09-16-phase3-ledger-lockdown.sql) — jamais de
// collision entre les deux espaces.
//
// Champs désormais partagés par tous les lots d'un même article (ils vivent
// sur supply_items, pas sur le lot) : category_id, low_stock_threshold. Les
// modifier via ce formulaire les modifie pour TOUS les lots de l'article —
// c'est plus correct qu'avant (ces notions n'ont jamais vraiment eu de sens
// "par lot"), mais c'est un changement de comportement à connaître.
//
// Non supporté ici (délibérément) : changer l'article (`name`) d'un lot déjà
// créé. Rattacher un lot à un autre article est une opération sensible pour
// l'intégrité du ledger ; ce formulaire n'est pas l'endroit pour ça pendant
// la transition. Le message d'erreur guide vers la marche à suivre.
import { Router, Request, Response } from 'express';
import { db } from '../database/connection';
import { logger } from '../middleware/logger';
import { requireAuth } from '../middleware/auth';
import { logAudit } from './audit';
import { postReceipt } from '../services/supplyLedger';
import { AppException, BusinessException, NotFoundException } from '../exceptions';

const router = Router();

// Une ligne = un lot ; ce SELECT reconstruit exactement la forme de l'ancienne table `supplies`.
const ROW_SELECT = `
    SELECT
        COALESCE(rl.legacy_supply_id, rl.id) AS id,
        i.name AS name,
        r.received_date AS purchase_date,
        rl.line_total AS cost,
        rl.brand AS brand,
        rl.quantity_base AS quantity,
        r.received_by_uid AS receiver_uid,
        r.received_by_uid AS created_by_uid,
        i.category_id AS category_id,
        i.reorder_point AS low_stock_threshold,
        r.created_at AS created_at,
        r.created_at AS updated_at,
        u.email AS receiver_email,
        c.name AS category_name,
        rl.id AS _line_id,
        rl.item_id AS _item_id,
        r.id AS _receipt_id,
        r.received_date AS _receipt_date,
        r.received_by_uid AS _receipt_receiver,
        r.supplier_id AS _supplier_id,
        r.invoice_ref AS _invoice_ref,
        rl.quantity_base AS _quantity_base,
        rl.line_total AS _line_total,
        rl.unit_cost_base AS _unit_cost_base
    FROM supply_receipt_lines rl
             JOIN supply_receipts r ON r.id = rl.receipt_id
             JOIN supply_items i ON i.id = rl.item_id
             LEFT JOIN categories c ON c.id = i.category_id
             LEFT JOIN users u ON u.id = CAST(r.received_by_uid AS UNSIGNED)
`;

function stripInternal(row: any) {
    const { _line_id, _item_id, _receipt_id, _receipt_date, _receipt_receiver, _supplier_id, _invoice_ref, _quantity_base, _line_total, _unit_cost_base, ...rest } = row;
    return rest;
}

// GET /api/supplies - List all supplies with category filtering
router.get('/', requireAuth, async (req: Request, res: Response) => {
    try {
        const { category_id } = req.query;
        let whereClause = '';
        const params: any[] = [];

        if (category_id) {
            whereClause = 'WHERE i.category_id = ?';
            params.push(parseInt(category_id as string));
        }

        const [rows] = await db.execute(`${ROW_SELECT} ${whereClause} ORDER BY r.received_date DESC, rl.id DESC`, params);
        const supplies = (rows as any[]).map(stripInternal);

        const totalCost = supplies.reduce((sum, s) => sum + Number(s.cost || 0), 0);

        logger.info(`Fetched ${supplies.length} supplies`, 'SUPPLIES');
        return res.json({
            supplies,
            totalCost: Math.round(totalCost * 100) / 100,
            totalQuantity: supplies.length,
        });
    } catch (err) {
        logger.error('GET /supplies error:', err as Error);
        return res.status(500).json({ error: 'Failed to fetch supplies' });
    }
});

// GET /api/supplies/search-names?q= - Suggest existing items (avoid duplicate naming)
router.get('/search-names', requireAuth, async (req: Request, res: Response) => {
    try {
        const q = ((req.query.q as string) || '').trim();
        if (q.length < 3) {
            return res.json([]);
        }

        const [rows] = await db.execute(
            `SELECT i.name,
                    i.category_id,
                    c.name AS category_name,
                    (SELECT rl.brand FROM supply_receipt_lines rl WHERE rl.item_id = i.id AND rl.brand IS NOT NULL ORDER BY rl.id DESC LIMIT 1) AS brand,
                    (SELECT COUNT(*) FROM supply_receipt_lines rl2 WHERE rl2.item_id = i.id) AS usage_count
             FROM supply_items i
                      LEFT JOIN categories c ON c.id = i.category_id
             WHERE i.name LIKE ? AND i.is_active = 1
             ORDER BY usage_count DESC, i.name ASC
             LIMIT 8`,
            [`%${q}%`]
        );

        return res.json(rows);
    } catch (err) {
        logger.error('GET /supplies/search-names error:', err as Error);
        return res.status(500).json({ error: 'Failed to search supply names' });
    }
});

// GET /api/supplies/:id - Get single supply (lot)
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id as string);

        const [rows] = await db.execute(
            `${ROW_SELECT} WHERE COALESCE(rl.legacy_supply_id, rl.id) = ?`,
            [id]
        );

        if (!(rows as any[]).length) {
            return res.status(404).json({ error: 'Supply not found' });
        }

        return res.json(stripInternal((rows as any[])[0]));
    } catch (err) {
        logger.error('GET /supplies/:id error:', err as Error);
        return res.status(500).json({ error: 'Failed to fetch supply' });
    }
});

// POST /api/supplies - Log a new purchase (lot) against an existing item
router.post('/', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { name, purchase_date, cost, brand, quantity, receiver_uid, category_id, low_stock_threshold } = req.body;

        if (!name || !purchase_date || !cost || !quantity || !receiver_uid) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        let cleanThreshold: number | null | undefined = undefined;
        if (low_stock_threshold !== undefined && low_stock_threshold !== null && low_stock_threshold !== '') {
            const t = parseInt(String(low_stock_threshold), 10);
            if (!Number.isInteger(t) || t < 0) {
                return res.status(400).json({ error: 'low_stock_threshold must be a non-negative integer' });
            }
            cleanThreshold = t;
        }

        const [userResult] = await db.execute(`SELECT id FROM users WHERE email = ? LIMIT 1`, [receiver_uid]);
        if (!(userResult as any[]).length) {
            return res.status(404).json({ error: 'User not found' });
        }
        const userId = (userResult as any[])[0].id;

        const cleanDate = purchase_date.includes('T') ? purchase_date.split('T')[0] : purchase_date;

        let validatedCategoryId = null;
        if (category_id) {
            const [catResult] = await db.execute(`SELECT id, type FROM categories WHERE id = ? AND type = 'supply'`, [category_id]);
            if ((catResult as any[]).length) {
                validatedCategoryId = category_id;
            } else {
                return res.status(400).json({ error: 'Invalid or non-supply category' });
            }
        }

        // ✅ Résolution stricte : l'article doit déjà exister (les 20 issus de la
        // Phase 1, ou tout nouvel article créé depuis). Pas de création implicite
        // ici — /supplies/search-names guide vers les noms existants.
        const [itemResult] = await db.execute(`SELECT id, category_id FROM supply_items WHERE LOWER(name) = LOWER(?) AND is_active = 1`, [name]);
        if (!(itemResult as any[]).length) {
            return res.status(400).json({
                error: `Unknown item "${name}" — use one of the existing item names (see the name suggestions), or ask to have the new item added before logging this purchase.`,
            });
        }
        const itemId = (itemResult as any[])[0].id;

        const qty = parseInt(String(quantity), 10);
        const costNum = Number(cost);
        const unitCost = Math.round((costNum / qty) * 10000) / 10000;

        const { receiptId, lineIds } = await db.transaction(async (tx) => {
            const created = await postReceipt({
                received_date: cleanDate,
                received_by_uid: String(userId),
                lines: [{
                    item_id: itemId,
                    pack_size: 1,
                    packs_received: qty,
                    quantity_base: qty,
                    line_total: costNum,
                    unit_cost_base: unitCost,
                    brand: brand || null,
                }],
            }, tx);

            if (validatedCategoryId !== null || cleanThreshold !== undefined) {
                const itemUpdates: string[] = [];
                const itemValues: any[] = [];
                if (validatedCategoryId !== null) { itemUpdates.push('category_id = ?'); itemValues.push(validatedCategoryId); }
                if (cleanThreshold !== undefined) { itemUpdates.push('reorder_point = ?'); itemValues.push(cleanThreshold); }
                itemValues.push(itemId);
                await tx.execute(`UPDATE supply_items SET ${itemUpdates.join(', ')} WHERE id = ?`, itemValues);
            }

            return created;
        });

        const lineId = lineIds[0];
        const [rows] = await db.execute(`${ROW_SELECT} WHERE rl.id = ?`, [lineId]);
        const supply = stripInternal((rows as any[])[0]);

        await logAudit(user.email, 'supply_created', 'supplies', supply.id, null, supply);

        logger.info(`Created supply: ${name}`, 'SUPPLIES');
        return res.status(201).json(supply);
    } catch (err) {
        if (err instanceof AppException) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        logger.error('POST /supplies error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

// PATCH /api/supplies/:id - Update a purchase (lot)
router.patch('/:id', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const id = parseInt(req.params.id as string);

        const [oldRows] = await db.execute(`${ROW_SELECT} WHERE COALESCE(rl.legacy_supply_id, rl.id) = ?`, [id]);
        if (!(oldRows as any[]).length) {
            return res.status(404).json({ error: 'Supply not found' });
        }
        const old = (oldRows as any[])[0];
        const oldSupply = stripInternal(old);

        const { name, purchase_date, cost, brand, quantity, receiver_uid, category_id, low_stock_threshold } = req.body;

        if (name !== undefined && String(name).toLowerCase() !== String(oldSupply.name).toLowerCase()) {
            return res.status(400).json({ error: 'Changing the item of an existing purchase is not supported here during the transition. Delete and re-create the entry instead.' });
        }

        await db.transaction(async (tx) => {
            // ─ receiver / date : si l'un des deux change, on détache la ligne dans
            // un nouvel en-tête plutôt que de modifier l'en-tête partagé (qui peut
            // porter d'autres lots achetés le même jour par la même personne).
            if (receiver_uid !== undefined || purchase_date !== undefined) {
                let newReceiverId = old._receipt_receiver;
                if (receiver_uid !== undefined) {
                    const [userResult] = await tx.execute(`SELECT id FROM users WHERE email = ? LIMIT 1`, [receiver_uid]);
                    if (!(userResult as any[]).length) {
                        throw new NotFoundException('User not found');
                    }
                    newReceiverId = String((userResult as any[])[0].id);
                }
                const newDate = purchase_date !== undefined
                    ? (purchase_date.includes('T') ? purchase_date.split('T')[0] : purchase_date)
                    : old._receipt_date;

                const [headerResult] = await tx.execute(
                    `INSERT INTO supply_receipts (reference, supplier_id, received_date, invoice_ref, received_by_uid)
                     VALUES (NULL, ?, ?, ?, ?)`,
                    [old._supplier_id, newDate, old._invoice_ref, newReceiverId]
                );
                const newReceiptId = (headerResult as any).insertId;
                await tx.execute(`UPDATE supply_receipt_lines SET receipt_id = ? WHERE id = ?`, [newReceiptId, old._line_id]);
            }

            // ─ brand : cosmétique, pas d'impact ledger.
            if (brand !== undefined) {
                await tx.execute(`UPDATE supply_receipt_lines SET brand = ? WHERE id = ?`, [brand || null, old._line_id]);
            }

            // ─ quantity / cost : corrige la ligne ET pose une écriture de
            // correction dans le ledger (delta), jamais un UPDATE du ledger lui-même.
            if (quantity !== undefined || cost !== undefined) {
                const newQty = quantity !== undefined ? parseInt(String(quantity), 10) : old._quantity_base;
                const newCost = cost !== undefined ? Number(cost) : old._line_total;
                const newUnitCost = Math.round((newCost / newQty) * 10000) / 10000;

                await tx.execute(
                    `UPDATE supply_receipt_lines SET packs_received = ?, quantity_base = ?, line_total = ?, unit_cost_base = ? WHERE id = ?`,
                    [newQty, newQty, newCost, newUnitCost, old._line_id]
                );

                const deltaQty = newQty - old._quantity_base;
                const deltaValue = Math.round((newCost - old._line_total) * 100) / 100;
                if (deltaQty !== 0 || deltaValue !== 0) {
                    await tx.execute(
                        `INSERT INTO supply_stock_ledger
                            (item_id, movement_date, reason, quantity_base, unit_cost_base, value, location_id, source_table, source_line_id)
                         VALUES (?, ?, 'receipt', ?, ?, ?, NULL, 'supply_receipt_lines', ?)`,
                        [old._item_id, purchase_date !== undefined ? (purchase_date.includes('T') ? purchase_date.split('T')[0] : purchase_date) : old._receipt_date, deltaQty, newUnitCost, deltaValue, old._line_id]
                    );
                }
            }

            // ─ category / seuil : vivent sur l'article, partagés par tous ses lots.
            if (category_id !== undefined || low_stock_threshold !== undefined) {
                const itemUpdates: string[] = [];
                const itemValues: any[] = [];
                if (category_id !== undefined) {
                    const [catResult] = await tx.execute(`SELECT id FROM categories WHERE id = ? AND type = 'supply'`, [category_id]);
                    if (!(catResult as any[]).length) {
                        throw new BusinessException('Invalid or non-supply category');
                    }
                    itemUpdates.push('category_id = ?');
                    itemValues.push(category_id || null);
                }
                if (low_stock_threshold !== undefined) {
                    if (low_stock_threshold === null || low_stock_threshold === '') {
                        itemUpdates.push('reorder_point = ?');
                        itemValues.push(null);
                    } else {
                        const t = parseInt(String(low_stock_threshold), 10);
                        if (!Number.isInteger(t) || t < 0) {
                            throw new BusinessException('low_stock_threshold must be a non-negative integer');
                        }
                        itemUpdates.push('reorder_point = ?');
                        itemValues.push(t);
                    }
                }
                itemValues.push(old._item_id);
                await tx.execute(`UPDATE supply_items SET ${itemUpdates.join(', ')} WHERE id = ?`, itemValues);
            }
        });

        const [newRows] = await db.execute(`${ROW_SELECT} WHERE rl.id = ?`, [old._line_id]);
        const newSupply = stripInternal((newRows as any[])[0]);

        await logAudit(user.email, 'supply_updated', 'supplies', id, oldSupply, newSupply);

        logger.info(`Updated supply ${id}`, 'SUPPLIES');
        return res.json(newSupply);
    } catch (err) {
        if (err instanceof AppException) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        logger.error('PATCH /supplies/:id error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

// DELETE /api/supplies/:id - Remove a purchase (lot): reverses its ledger
// contribution (invariant 2) then removes the line, matching the old "it's
// gone from the list" behaviour.
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const id = parseInt(req.params.id as string);

        const [rows] = await db.execute(`${ROW_SELECT} WHERE COALESCE(rl.legacy_supply_id, rl.id) = ?`, [id]);
        if (!(rows as any[]).length) {
            return res.status(404).json({ error: 'Supply not found' });
        }
        const old = (rows as any[])[0];
        const oldSupply = stripInternal(old);

        await db.transaction(async (tx) => {
            await tx.execute(
                `INSERT INTO supply_stock_ledger
                    (item_id, movement_date, reason, quantity_base, unit_cost_base, value, location_id, source_table, source_line_id)
                 VALUES (?, ?, 'receipt', ?, ?, ?, NULL, 'supply_receipt_lines', ?)`,
                [old._item_id, old._receipt_date, -old._quantity_base, old._unit_cost_base, -old._line_total, old._line_id]
            );
            await tx.execute(`DELETE FROM supply_receipt_lines WHERE id = ?`, [old._line_id]);
        });

        await logAudit(user.email, 'supply_deleted', 'supplies', id, oldSupply, null);

        logger.info(`Deleted supply ${id}`, 'SUPPLIES');
        return res.json({ message: 'Supply deleted' });
    } catch (err) {
        if (err instanceof AppException) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        logger.error('DELETE /supplies/:id error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

export default router;
