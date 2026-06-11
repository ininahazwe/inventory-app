import { Router, Request, Response } from 'express';
import { db } from '../database/connection';
import { logger } from '../middleware/logger';
import { requireAuth } from '../middleware/auth';
import { logAudit } from './audit';
import {AuthUser} from "../types/requests";

const router = Router();

// ✅ Helper: clean date to YYYY-MM-DD format
const cleanDate = (dateStr: any): string | null => {
    if (!dateStr) return null;
    if (typeof dateStr !== 'string') return null;

    // Already YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;

    // ISO format with time
    if (dateStr.includes('T')) return dateStr.split('T')[0];

    // Try to parse
    try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return null;
        return d.toISOString().split('T')[0];
    } catch {
        return null;
    }
};

// GET /api/assets - List all assets with pagination
router.get('/', requireAuth, async (req: Request, res: Response) => {
    try {
        const { page = 1, limit = 10, category_name, label } = req.query;
        const pageNum = parseInt(page as string) || 1;
        const pageSize = parseInt(limit as string) || 10;
        const offset = (pageNum - 1) * pageSize;

        let whereConditions: string[] = [];
        let params: any[] = [];

        if (label) {
            whereConditions.push(`(a.label LIKE ? OR a.serial_no LIKE ? OR asn.assignee_name LIKE ? OR asn.assignee_email LIKE ?)`);
            const searchTerm = `%${label}%`;
            params.push(searchTerm, searchTerm, searchTerm, searchTerm);
        }

        if (category_name) {
            whereConditions.push('c.name = ?');
            params.push(category_name);
        }

        const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

        const countQuery = `
            SELECT COUNT(DISTINCT a.id) as count FROM assets a
                LEFT JOIN categories c ON a.category_id = c.id
                LEFT JOIN assignments asn ON a.id = asn.asset_id AND asn.status = 'active'
                ${whereClause}
        `;
        const [countResult] = await db.query(countQuery, params);
        const totalCount = (countResult as any[])[0]?.count || 0;

        const dataQuery = `
            SELECT
                a.id,
                a.label,
                a.status,
                a.serial_no,
                a.funder,
                c.name as category_name,
                asn.assignee_name,
                asn.assignee_email
            FROM assets a
                     LEFT JOIN categories c ON a.category_id = c.id
                     LEFT JOIN assignments asn ON a.id = asn.asset_id AND asn.status = 'active'
                ${whereClause}
            ORDER BY a.label ASC
                LIMIT ? OFFSET ?
        `;
        params.push(pageSize, offset);

        const [assets] = await db.query(dataQuery, params);

        logger.info(`Fetched ${(assets as any[]).length} assets`, 'ASSETS');
        return res.json({
            data: assets,
            pagination: { page: pageNum, limit: pageSize, total: totalCount }
        });
    } catch (err) {
        logger.error('GET /assets error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

// GET /api/assets/:id - Get single asset
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
    try {
        const id = String(req.params.id);

        const [asset] = await db.query(`
            SELECT
                a.id,
                a.label,
                a.serial_no,
                a.status,
                a.category_id,
                c.name as category_name,
                a.purchase_price,
                a.purchased_at,
                a.supplier,
                a.warranty_end,
                a.notes,
                a.funder,
                a.qr_slug,
                a.photo_url,
                a.created_at,
                asn.assignee_name,
                asn.assignee_email,
                asn.assigned_at,
                u.email as owner_email
            FROM assets a
                     LEFT JOIN categories c ON a.category_id = c.id
                     LEFT JOIN assignments asn ON a.id = asn.asset_id AND asn.status = 'active'
                     LEFT JOIN users u ON a.owner_uid = u.id
            WHERE a.id = ?
        `, [id]);

        if (!(asset as any[]).length) {
            return res.status(404).json({ error: 'Asset not found' });
        }

        const assetObj = (asset as any[])[0];
        if (assetObj.purchase_price) {
            assetObj.purchase_price = parseFloat(assetObj.purchase_price);
        }

        return res.json(assetObj);
    } catch (err) {
        logger.error(`GET /assets/:id error:`, err as Error);
        return res.status(500).json({ error: 'Failed to fetch asset' });
    }
});

// POST /api/assets - Create new asset
router.post('/', requireAuth, async (req: Request, res: Response) => {
    try {
        const { label, serial_no, category_id, status, funder, purchase_price, photo_url } = req.body;
        const user = (req as any).user;

        if (!label) {
            return res.status(400).json({ error: 'label is required' });
        }

        const [result] = await db.query(
            `INSERT INTO assets (label, serial_no, category_id, status, funder, purchase_price, photo_url )
             VALUES (?, ?, ?, ?, ?, ?)`,
            [label, serial_no || null, category_id || null, status || 'in_stock', funder || null, purchase_price || null]
        );

        const assetId = (result as any).insertId;

        // ✅ Log audit
        await logAudit(
            user.email,
            'asset_created',
            'assets',
            assetId,
            null,
            { label, serial_no, category_id, status, funder, purchase_price }
        );

        logger.info(`Created asset: ${label}`, 'ASSETS');
        return res.status(201).json({
            id: assetId,
            label,
            serial_no,
            category_id,
            status,
            funder,
            purchase_price
        });
    } catch (err) {
        logger.error('POST /assets error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

// PUT /api/assets/:id - Update asset
router.put('/:id', requireAuth, async (req: Request, res: Response) => {
    // ✅ Type id correctly (req.params.id is string | string[])
    const id = String(req.params.id);
    const assetId = parseInt(id, 10);

    const {
        label,
        serial_no,
        category_id,
        purchased_at,
        purchase_price,
        supplier,
        funder,
        photo_url,
        warranty_end,
        notes
    } = req.body;
    const user = (req as any).user;

    try {
        if (!label || !label.trim()) {
            return res.status(400).json({ error: 'label is required' });
        }

        // ✅ Get old state for audit
        const [oldAssetResult] = await db.query('SELECT * FROM assets WHERE id = ?', [assetId]);
        if (!(oldAssetResult as any[]).length) {
            return res.status(404).json({ error: 'Asset not found' });
        }
        const oldValue = (oldAssetResult as any[])[0];

        let parsedPrice = null;
        if (purchase_price !== null && purchase_price !== undefined && purchase_price !== '') {
            parsedPrice = parseFloat(purchase_price);
            if (isNaN(parsedPrice)) {
                return res.status(400).json({ error: 'Invalid purchase_price format' });
            }
            parsedPrice = parseFloat(parsedPrice.toFixed(2));
        }

        // ✅ Clean dates to YYYY-MM-DD before MySQL
        const cleanPurchasedAt = cleanDate(purchased_at);
        const cleanWarrantyEnd = cleanDate(warranty_end);

        const sql = `
            UPDATE assets
            SET
                label = ?,
                serial_no = ?,
                category_id = ?,
                purchased_at = ?,
                purchase_price = ?,
                supplier = ?,
                funder = ?,
                photo_url = ?,
                warranty_end = ?,
                notes = ?
            WHERE id = ?
        `;

        const params = [
            label.trim(),
            serial_no || null,
            category_id || null,
            cleanPurchasedAt,
            parsedPrice,
            supplier || null,
            funder || null,
            photo_url || null,
            cleanWarrantyEnd,
            notes || null,
            assetId
        ];

        await db.query(sql, params);

        // ✅ Get new state for audit
        const [newAssetResult] = await db.query('SELECT * FROM assets WHERE id = ?', [assetId]);
        const newValue = (newAssetResult as any[])[0];

        // ✅ Log audit (now with correct type)
        await logAudit(user.email, 'asset_updated', 'assets', assetId, oldValue, newValue);

        logger.info(`Updated asset ${assetId}`, 'ASSETS');
        res.json({ message: 'Asset updated successfully' });
    } catch (err) {
        logger.error('PUT /assets/:id error:', err as Error);
        res.status(500).json({ error: 'Failed to update asset' });
    }
});

// DELETE /api/assets/:id - Supprimer un asset
// ✅ Requiert auth + admin

router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = req.user as AuthUser;
        const assetId = parseInt(req.params.id as string, 10);

        if (isNaN(assetId)) {
            return res.status(400).json({ error: 'Invalid asset ID' });
        }

        // 1. Vérifier que l'asset existe
        const [assetData] = await db.query(
            'SELECT id, label FROM assets WHERE id = ?',
            [assetId]
        );

        if (!assetData || (assetData as any[]).length === 0) {
            return res.status(404).json({ error: 'Asset not found' });
        }

        const asset = (assetData as any[])[0];

        // 2. Vérifier qu'il n'y a pas d'enchères actives sur cet asset
        const [auctionsCount] = await db.query(
            'SELECT COUNT(*) as count FROM auctions WHERE asset_id = ? AND status = "active"',
            [assetId]
        );

        const activeAuctionCount = (auctionsCount as any[])[0]?.count || 0;
        if (activeAuctionCount > 0) {
            return res.status(400).json({
                error: `Cannot delete asset with ${activeAuctionCount} active auction(s)`
            });
        }

        // 3. Supprimer l'asset
        const [result] = await db.query('DELETE FROM assets WHERE id = ?', [assetId]);

        // 4. Enregistrer l'audit
        await logAudit(
            user.uid.toString(),
            'DELETE_ASSET',
            `Deleted asset: ${asset.label}`,
            assetId
        );

        logger.info(`Asset #${assetId} deleted by user ${user.uid}`, 'ASSETS');

        return res.json({
            success: true,
            message: `Asset "${asset.label}" deleted successfully`
        });

    } catch (err) {
        logger.error(`DELETE /assets/:id error:`, err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

// GET /api/assets/:id/overview - Route PUBLIQUE pour le scan de QR Code (Sans requireAuth)
router.get('/:id/overview', async (req: Request, res: Response) => {
    try {
        const assetId = req.params.id;

        // On ne sélectionne QUE les colonnes non-sensibles pour le public
        const [assetData] = await db.query(
            `SELECT a.id, a.label, a.serial_no, a.status, a.funder, a.created_at,
                    c.name as category_name
             FROM assets a
             LEFT JOIN categories c ON a.category_id = c.id
             WHERE a.id = ?`,
            [assetId]
        );

        if (!assetData || (assetData as any[]).length === 0) {
            return res.status(404).json({ error: 'Asset not found' });
        }

        const asset = (assetData as any[])[0];
        return res.json(asset);

    } catch (error) {
        return res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;