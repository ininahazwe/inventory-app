// server/routes/assets-audit.ts
// À ajouter dans app.js : const { logAudit } = require('./routes/audit')(app, dbPromise, verifyJWT);

module.exports = function(app, dbPromise, verifyJWT, logAudit) {

    // POST: Créer un asset
    app.post('/api/assets', verifyJWT, async (req, res) => {
        try {
            const { label, serial_no, category_id, purchase_price, funder } = req.body;

            // Validation
            if (!label) return res.status(400).json({ error: 'label required' });

            const [result] = await dbPromise.query(`
                INSERT INTO assets (label, serial_no, category_id, purchase_price, funder, status)
                VALUES (?, ?, ?, ?, ?, 'in_stock')
            `, [label, serial_no || null, category_id || null, purchase_price || null, funder || null]);

            const assetId = result.insertId;

            // Get created asset for audit
            const [newAsset] = await dbPromise.query('SELECT * FROM assets WHERE id = ?', [assetId]);
            const newValue = newAsset[0];

            // ✅ Log audit - asset created
            await logAudit(req.user.email, 'asset_created', 'assets', assetId, null, newValue);

            return res.status(201).json({ id: assetId, label, status: 'in_stock' });
        } catch (err) {
            console.error('POST /api/assets error:', err);
            return res.status(500).json({ error: err.message });
        }
    });

    // ✅ PUT: Modifier un asset (THIS IS THE ONE USED BY FRONTEND)
    app.put('/api/assets/:id', verifyJWT, async (req, res) => {
        try {
            const { id } = req.params;
            const {
                label,
                serial_no,
                category_id,
                purchased_at,
                purchase_price,
                supplier,
                funder,
                warranty_end,
                notes
            } = req.body;

            // Validation
            if (!label || !label.trim()) {
                return res.status(400).json({ error: 'label required' });
            }

            // Récupérer l'asset avant modification
            const [oldAsset] = await dbPromise.query('SELECT * FROM assets WHERE id = ?', [id]);
            if (!oldAsset || oldAsset.length === 0) {
                return res.status(404).json({ error: 'Asset not found' });
            }
            const oldValue = oldAsset[0];

            // Parse price avec validation
            let parsedPrice = null;
            if (purchase_price !== null && purchase_price !== undefined && purchase_price !== '') {
                parsedPrice = parseFloat(purchase_price);
                if (isNaN(parsedPrice)) {
                    return res.status(400).json({ error: 'Invalid purchase_price format' });
                }
                parsedPrice = parseFloat(parsedPrice.toFixed(2));
            }

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
                    warranty_end = ?, 
                    notes = ?
                WHERE id = ?
            `;

            const params = [
                label.trim(),
                serial_no || null,
                category_id || null,
                purchased_at || null,
                parsedPrice,
                supplier || null,
                funder || null,
                warranty_end || null,
                notes || null,
                id
            ];

            await dbPromise.query(sql, params);

            // Récupérer l'asset après modification
            const [newAsset] = await dbPromise.query('SELECT * FROM assets WHERE id = ?', [id]);
            const newValue = newAsset[0];

            // ✅ Log audit - asset updated
            await logAudit(req.user.email, 'asset_updated', 'assets', id, oldValue, newValue);

            return res.json({ success: true, id });
        } catch (err) {
            console.error(`PUT /api/assets/:id error:`, err);
            return res.status(500).json({ error: err.message });
        }
    });

    // PATCH: Modifier un asset (LEGACY - kept for backward compatibility)
    app.patch('/api/assets/:id', verifyJWT, async (req, res) => {
        try {
            const { id } = req.params;
            const { label, serial_no, category_id, purchase_price, funder } = req.body;

            // Récupérer l'asset avant modification (pour old_value)
            const [oldAsset] = await dbPromise.query('SELECT * FROM assets WHERE id = ?', [id]);
            if (!oldAsset.length) return res.status(404).json({ error: 'Asset not found' });

            const oldValue = oldAsset[0];

            // Construire la requête UPDATE dynamiquement
            let updateQuery = 'UPDATE assets SET';
            const updateParams = [];
            const updates = [];

            if (label !== undefined) {
                updates.push('label = ?');
                updateParams.push(label);
            }
            if (serial_no !== undefined) {
                updates.push('serial_no = ?');
                updateParams.push(serial_no);
            }
            if (category_id !== undefined) {
                updates.push('category_id = ?');
                updateParams.push(category_id);
            }
            if (purchase_price !== undefined) {
                updates.push('purchase_price = ?');
                updateParams.push(purchase_price);
            }
            if (funder !== undefined) {
                updates.push('funder = ?');
                updateParams.push(funder);
            }

            if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

            updateQuery += ' ' + updates.join(', ') + ' WHERE id = ?';
            updateParams.push(id);

            await dbPromise.query(updateQuery, updateParams);

            // Récupérer l'asset après modification
            const [newAsset] = await dbPromise.query('SELECT * FROM assets WHERE id = ?', [id]);
            const newValue = newAsset[0];

            // ✅ Log audit
            await logAudit(req.user.email, 'asset_updated', 'assets', id, oldValue, newValue);

            return res.json({ success: true, id });
        } catch (err) {
            console.error(`PATCH /api/assets/${req.params.id} error:`, err);
            return res.status(500).json({ error: err.message });
        }
    });

    // DELETE: Supprimer un asset
    app.delete('/api/assets/:id', verifyJWT, async (req, res) => {
        try {
            const { id } = req.params;

            // Récupérer l'asset avant suppression
            const [asset] = await dbPromise.query('SELECT * FROM assets WHERE id = ?', [id]);
            if (!asset.length) return res.status(404).json({ error: 'Asset not found' });

            const oldValue = asset[0];

            // Supprimer
            await dbPromise.query('DELETE FROM assets WHERE id = ?', [id]);

            // ✅ Log audit
            await logAudit(req.user.email, 'asset_deleted', 'assets', id, oldValue, null);

            return res.json({ success: true });
        } catch (err) {
            console.error(`DELETE /api/assets/${req.params.id} error:`, err);
            return res.status(500).json({ error: err.message });
        }
    });

    // PATCH: Changer le statut d'un asset
    app.patch('/api/assets/:id/status', verifyJWT, async (req, res) => {
        try {
            const { id } = req.params;
            const { status } = req.body;

            if (!status) return res.status(400).json({ error: 'status required' });

            const [asset] = await dbPromise.query('SELECT * FROM assets WHERE id = ?', [id]);
            if (!asset.length) return res.status(404).json({ error: 'Asset not found' });

            const oldValue = asset[0];

            await dbPromise.query('UPDATE assets SET status = ? WHERE id = ?', [status, id]);

            const [newAsset] = await dbPromise.query('SELECT * FROM assets WHERE id = ?', [id]);
            const newValue = newAsset[0];

            // ✅ Log audit
            await logAudit(req.user.email, 'asset_status_changed', 'assets', id, oldValue, newValue);

            return res.json({ success: true });
        } catch (err) {
            console.error(`PATCH /api/assets/${req.params.id}/status error:`, err);
            return res.status(500).json({ error: err.message });
        }
    });
};