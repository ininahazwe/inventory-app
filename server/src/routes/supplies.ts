import { Router, Request, Response } from 'express';
import { db } from '../database/connection';
import { logger } from '../middleware/logger';
import { requireAuth } from '../middleware/auth';
import { logAudit } from './audit';

const router = Router();

// GET /api/supplies - List all supplies with category filtering
router.get('/', requireAuth, async (req: Request, res: Response) => {
    try {
        const { category_id } = req.query;
        let whereClause = '';
        let params: any[] = [];

        if (category_id) {
            whereClause = 'WHERE s.category_id = ?';
            params.push(parseInt(category_id as string));
        }

        const [supplies] = await db.execute(
            `SELECT s.*, u.email as receiver_email, c.name as category_name
             FROM supplies s
                      LEFT JOIN users u ON s.receiver_uid = u.id
                      LEFT JOIN categories c ON s.category_id = c.id
                 ${whereClause}
             ORDER BY s.purchase_date DESC`,
            params
        );

        // Calculate totals
        const [totalCostResult] = await db.execute(
            `SELECT COALESCE(SUM(cost * quantity), 0) as total FROM supplies ${whereClause}`,
            params
        );
        const totalCost = parseFloat((totalCostResult as any[])[0]?.total) || 0;

        logger.info(`Fetched ${(supplies as any[]).length} supplies`, 'SUPPLIES');
        return res.json({
            supplies: supplies,
            totalCost: totalCost,
            totalQuantity: (supplies as any[]).length,
        });
    } catch (err) {
        logger.error('GET /supplies error:', err as Error);
        return res.status(500).json({ error: 'Failed to fetch supplies' });
    }
});

// GET /api/supplies/search-names?q= - Suggest existing supply names (avoid duplicate naming)
router.get('/search-names', requireAuth, async (req: Request, res: Response) => {
    try {
        const q = ((req.query.q as string) || '').trim();
        if (q.length < 3) {
            return res.json([]);
        }

        // ✅ Group by name to get one suggestion per distinct name,
        // keeping the category/brand combo used most often for that name
        // (helps prevent the same supply being logged under different categories/brands).
        const [rows] = await db.execute(
            `SELECT s.name,
                    s.category_id,
                    c.name as category_name,
                    s.brand,
                    COUNT(*) as usage_count
             FROM supplies s
                      LEFT JOIN categories c ON s.category_id = c.id
             WHERE s.name LIKE ?
             GROUP BY s.name, s.category_id, c.name, s.brand
             ORDER BY usage_count DESC, s.name ASC
             LIMIT 20`,
            [`%${q}%`]
        );

        // ✅ Keep only the top (most-used) category/brand combo per unique name
        const seen = new Set<string>();
        const suggestions = (rows as any[]).filter(r => {
            const key = r.name.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        }).slice(0, 8);

        return res.json(suggestions);
    } catch (err) {
        logger.error('GET /supplies/search-names error:', err as Error);
        return res.status(500).json({ error: 'Failed to search supply names' });
    }
});

// GET /api/supplies/:id - Get single supply
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id as string);

        const [supplies] = await db.execute(
            `SELECT s.*, u.email as receiver_email, c.name as category_name
             FROM supplies s
                      LEFT JOIN users u ON s.receiver_uid = u.id
                      LEFT JOIN categories c ON s.category_id = c.id
             WHERE s.id = ?`,
            [id]
        );

        if (!(supplies as any[]).length) {
            return res.status(404).json({ error: 'Supply not found' });
        }

        return res.json((supplies as any[])[0]);
    } catch (err) {
        logger.error('GET /supplies/:id error:', err as Error);
        return res.status(500).json({ error: 'Failed to fetch supply' });
    }
});

// POST /api/supplies - Create new supply
router.post('/', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { name, purchase_date, cost, brand, quantity, receiver_uid, category_id } = req.body;

        // Validation
        if (!name || !purchase_date || !cost || !quantity || !receiver_uid) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // ✅ Lookup user by email (receiver_uid is the email from frontend)
        const [userResult] = await db.execute(
            `SELECT id FROM users WHERE email = ? LIMIT 1`,
            [receiver_uid]
        );

        if (!(userResult as any[]).length) {
            return res.status(404).json({ error: 'User not found' });
        }

        const userId = (userResult as any[])[0].id;

        // Clean date to YYYY-MM-DD
        const cleanDate = purchase_date.includes('T')
            ? purchase_date.split('T')[0]
            : purchase_date;

        // ✅ If category_id provided, verify it's a 'supply' type category
        let validatedCategoryId = null;
        if (category_id) {
            const [catResult] = await db.execute(
                `SELECT id, type FROM categories WHERE id = ? AND type = 'supply'`,
                [category_id]
            );

            if ((catResult as any[]).length) {
                validatedCategoryId = category_id;
            } else {
                return res.status(400).json({ error: 'Invalid or non-supply category' });
            }
        }

        const [result] = await db.execute(
            `INSERT INTO supplies (name, purchase_date, cost, brand, quantity, receiver_uid, category_id, created_by_uid)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [name, cleanDate, cost, brand || null, quantity, userId, validatedCategoryId, user.uid]
        );

        const supplyId = (result as any).insertId;

        // Get the created supply with receiver email and category name
        const [supplies] = await db.execute(
            `SELECT s.*, u.email as receiver_email, c.name as category_name
             FROM supplies s
                      LEFT JOIN users u ON s.receiver_uid = u.id
                      LEFT JOIN categories c ON s.category_id = c.id
             WHERE s.id = ?`,
            [supplyId]
        );

        const supply = (supplies as any[])[0];

        // Audit log
        await logAudit(user.email, 'supply_created', 'supplies', supplyId, null, supply);

        logger.info(`Created supply: ${name}`, 'SUPPLIES');
        return res.status(201).json(supply);
    } catch (err) {
        logger.error('POST /supplies error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

// PATCH /api/supplies/:id - Update supply
router.patch('/:id', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const id = parseInt(req.params.id as string);

        // Get old state
        const [oldSupplies] = await db.execute(
            `SELECT s.*, u.email as receiver_email, c.name as category_name
             FROM supplies s
                      LEFT JOIN users u ON s.receiver_uid = u.id
                      LEFT JOIN categories c ON s.category_id = c.id
             WHERE s.id = ?`,
            [id]
        );

        if (!(oldSupplies as any[]).length) {
            return res.status(404).json({ error: 'Supply not found' });
        }

        const oldSupply = (oldSupplies as any[])[0];

        const { name, purchase_date, cost, brand, quantity, receiver_uid, category_id } = req.body;

        // Build update query
        const updates: string[] = [];
        const values: any[] = [];

        if (name !== undefined) {
            updates.push('name = ?');
            values.push(name);
        }
        if (purchase_date !== undefined) {
            const cleanDate = purchase_date.includes('T')
                ? purchase_date.split('T')[0]
                : purchase_date;
            updates.push('purchase_date = ?');
            values.push(cleanDate);
        }
        if (cost !== undefined) {
            updates.push('cost = ?');
            values.push(cost);
        }
        if (brand !== undefined) {
            updates.push('brand = ?');
            values.push(brand || null);
        }
        if (quantity !== undefined) {
            updates.push('quantity = ?');
            values.push(quantity);
        }
        if (category_id !== undefined) {
            updates.push('category_id = ?');
            values.push(category_id || null);
        }
        if (receiver_uid !== undefined) {
            // Lookup user by email
            const [userResult] = await db.execute(
                `SELECT id FROM users WHERE email = ? LIMIT 1`,
                [receiver_uid]
            );

            if (!(userResult as any[]).length) {
                return res.status(404).json({ error: 'User not found' });
            }

            const userId = (userResult as any[])[0].id;
            updates.push('receiver_uid = ?');
            values.push(userId);
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        updates.push('updated_at = NOW()');
        values.push(id);

        await db.execute(
            `UPDATE supplies SET ${updates.join(', ')} WHERE id = ?`,
            values
        );

        // Get new state
        const [newSupplies] = await db.execute(
            `SELECT s.*, u.email as receiver_email, c.name as category_name
             FROM supplies s
                      LEFT JOIN users u ON s.receiver_uid = u.id
                      LEFT JOIN categories c ON s.category_id = c.id
             WHERE s.id = ?`,
            [id]
        );

        const newSupply = (newSupplies as any[])[0];

        // Audit log
        await logAudit(user.email, 'supply_updated', 'supplies', id, oldSupply, newSupply);

        logger.info(`Updated supply ${id}`, 'SUPPLIES');
        return res.json(newSupply);
    } catch (err) {
        logger.error('PATCH /supplies/:id error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

// DELETE /api/supplies/:id - Delete supply
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const id = parseInt(req.params.id as string);

        // Get old state
        const [supplies] = await db.execute(
            `SELECT s.*, u.email as receiver_email, c.name as category_name
             FROM supplies s
                      LEFT JOIN users u ON s.receiver_uid = u.id
                      LEFT JOIN categories c ON s.category_id = c.id
             WHERE s.id = ?`,
            [id]
        );

        if (!(supplies as any[]).length) {
            return res.status(404).json({ error: 'Supply not found' });
        }

        const oldSupply = (supplies as any[])[0];

        await db.execute(
            `DELETE FROM supplies WHERE id = ?`,
            [id]
        );

        // Audit log
        await logAudit(user.email, 'supply_deleted', 'supplies', id, oldSupply, null);

        logger.info(`Deleted supply ${id}`, 'SUPPLIES');
        return res.json({ message: 'Supply deleted' });
    } catch (err) {
        logger.error('DELETE /supplies/:id error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

export default router;