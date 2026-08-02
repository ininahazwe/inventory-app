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

    // ✅ Repli pour formats inattendus uniquement. Getters locaux plutôt que
    // toISOString() pour ne pas ajouter un second décalage UTC par-dessus un
    // parsing déjà ambigu.
    try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return null;
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    } catch {
        return null;
    }
};

// GET /api/assets - List all assets with pagination
router.get('/', requireAuth, async (req: Request, res: Response) => {
    try {
        const { page = 1, limit = 10, category_name, label, status } = req.query;
        const pageNum = parseInt(page as string) || 1;
        const pageSize = parseInt(limit as string) || 10;
        const offset = (pageNum - 1) * pageSize;

        let whereConditions: string[] = [];
        let params: any[] = [];

        if (label) {
            whereConditions.push(`(a.label LIKE ? OR a.serial_no LIKE ? OR c.name LIKE ? OR asn.assignee_name LIKE ? OR asn.assignee_email LIKE ?)`);
            const searchTerm = `%${label}%`;
            params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
        }

        if (category_name) {
            whereConditions.push('c.name = ?');
            params.push(category_name);
        }

        // ✅ Filtre statut — était documenté/appelé par le frontend (ex: ?status=in_stock)
        // mais silencieusement ignoré ici, donc jamais réellement filtré côté serveur.
        if (status) {
            whereConditions.push('a.status = ?');
            params.push(status);
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

        // ✅ Coût total de maintenance (colonne dédiée, agrégeable) — aide à la
        // décision retire vs repair (ex: coût cumulé qui dépasse la valeur d'achat).
        const [costResult] = await db.query(
            `SELECT COALESCE(SUM(cost), 0) AS total_repair_cost
             FROM lifecycle_events WHERE asset_id = ? AND event_type = 'maintenance'`,
            [id]
        );
        assetObj.total_repair_cost = parseFloat((costResult as any[])[0]?.total_repair_cost) || 0;

        return res.json(assetObj);
    } catch (err) {
        logger.error(`GET /assets/:id error:`, err as Error);
        return res.status(500).json({ error: 'Failed to fetch asset' });
    }
});

// POST /api/assets - Create new asset
router.post('/', requireAuth, async (req: Request, res: Response) => {
    try {
        const { label, serial_no, category_id, status, funder, purchase_price, photo_url, purchased_at, warranty_end, supplier, notes } = req.body;
        const user = (req as any).user;

        if (!label) {
            return res.status(400).json({ error: 'label is required' });
        }

        const [result] = await db.query(
            `INSERT INTO assets (label, serial_no, category_id, status, funder, purchase_price, photo_url, purchased_at, warranty_end, supplier, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                label,
                serial_no || null,
                category_id || null,
                status || 'in_stock',
                funder || null,
                purchase_price || null,
                photo_url || null,
                cleanDate(purchased_at),
                cleanDate(warranty_end),
                supplier || null,
                notes || null
            ]
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
            (user as any).email || user.uid.toString(),
            'asset_deleted',
            'assets',
            assetId,
            asset,
            null
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

// ✅ Libellés lisibles pour les event_type de lifecycle_events (repair/maintenance/
// retired sont écrits par rpc.ts ; assigned/returned/other peuvent venir de données
// historiques antérieures à la table `assignments`).
const LIFECYCLE_LABELS: Record<string, string> = {
    repair: 'Sent for repair',
    maintenance: 'Repair completed',
    retired: 'Retired',
    assigned: 'Assigned',
    returned: 'Returned to stock',
};

// GET /api/assets/:id/timeline - Historique unifié (assignments + réparations +
// incidents + enchères), fusionné et trié par date décroissante. Les données
// existaient déjà, dispersées sur 4 tables — pas de nouvelle table, juste l'agrégation.
router.get('/:id/timeline', requireAuth, async (req: Request, res: Response) => {
    try {
        const assetId = parseInt(req.params.id as string, 10);
        if (isNaN(assetId)) {
            return res.status(400).json({ error: 'Invalid asset ID' });
        }

        const [assetCheck] = await db.execute('SELECT id FROM assets WHERE id = ?', [assetId]);
        if (!(assetCheck as any[]).length) {
            return res.status(404).json({ error: 'Asset not found' });
        }

        const [assignmentRows] = await db.execute(
            `SELECT id, assignee_name, assignee_email, assigned_at, returned_at, status, created_at
             FROM assignments WHERE asset_id = ? ORDER BY created_at DESC`,
            [assetId]
        );

        const [lifecycleRows] = await db.execute(
            `SELECT id, event_type, event_date, notes, cost, created_at, created_by, status, resolved_at
             FROM lifecycle_events WHERE asset_id = ? ORDER BY created_at DESC`,
            [assetId]
        );

        const [incidentRows] = await db.execute(
            `SELECT id, incident_type, title, severity, description, status, reported_by_email, created_at, resolved_at
             FROM incidents WHERE asset_id = ? ORDER BY created_at DESC`,
            [assetId]
        );

        const [auctionRows] = await db.execute(
            `SELECT a.id, a.starting_price, a.current_highest_bid, a.status, a.created_at, a.end_date, a.winner_uid,
                    u.email AS winner_email,
                    (SELECT COUNT(*) FROM bids b WHERE b.auction_id = a.id) AS bid_count
             FROM auctions a
                      LEFT JOIN users u ON a.winner_uid = u.id
             WHERE a.asset_id = ? ORDER BY a.created_at DESC`,
            [assetId]
        );

        type TimelineEvent = {
            type: string;
            at: string;
            title: string;
            detail: string;
            status?: string | null;
            source_id: number;
        };

        const events: TimelineEvent[] = [];

        for (const r of assignmentRows as any[]) {
            const who = r.assignee_name || r.assignee_email || 'user';
            events.push({
                type: 'assignment',
                at: new Date(r.assigned_at || r.created_at).toISOString(),
                title: r.status === 'active' ? `Assigned to ${who}` : `Assignment ended (${who})`,
                detail: [
                    `Assigned to ${who}`,
                    r.assigned_at ? `from ${r.assigned_at}` : null,
                    r.returned_at ? `to ${r.returned_at}` : (r.status === 'active' ? '(ongoing)' : null),
                ].filter(Boolean).join(' '),
                status: r.status,
                source_id: r.id,
            });
        }

        for (const r of lifecycleRows as any[]) {
            const cost = r.cost != null ? Number(r.cost) : null;
            events.push({
                type: r.event_type || 'lifecycle',
                at: new Date(r.event_date || r.created_at).toISOString(),
                title: LIFECYCLE_LABELS[r.event_type] || r.event_type || 'Lifecycle event',
                detail: [r.notes, cost != null ? `Cost: GH₵${cost.toFixed(2)}` : null].filter(Boolean).join(' — '),
                status: r.status,
                source_id: r.id,
            });
        }

        for (const r of incidentRows as any[]) {
            events.push({
                type: 'incident',
                at: new Date(r.created_at).toISOString(),
                title: r.title || `Incident: ${r.incident_type}`,
                detail: [r.description, r.severity ? `Severity: ${r.severity}` : null].filter(Boolean).join(' — '),
                status: r.status,
                source_id: r.id,
            });
        }

        for (const r of auctionRows as any[]) {
            const highest = r.current_highest_bid != null ? `GH₵${Number(r.current_highest_bid).toFixed(2)}` : '—';
            events.push({
                type: 'auction',
                at: new Date(r.created_at).toISOString(),
                title: `Auction ${r.status}`,
                detail: [
                    `Starting GH₵${Number(r.starting_price).toFixed(2)}`,
                    `highest bid ${highest} (${r.bid_count} bid${r.bid_count === 1 ? '' : 's'})`,
                    r.winner_email ? `won by ${r.winner_email}` : null,
                ].filter(Boolean).join(', '),
                status: r.status,
                source_id: r.id,
            });
        }

        events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

        return res.json({ asset_id: assetId, events });
    } catch (err) {
        logger.error('GET /assets/:id/timeline error:', err as Error);
        return res.status(500).json({ error: 'Failed to fetch asset timeline' });
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