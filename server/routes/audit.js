// server/routes/audit.js
module.exports = function(app, dbPromise, verifyJWT) {

    // Fonction générique pour logger une action
    async function logAudit(userId, action, targetTable, targetId, oldValue = null, newValue = null) {
        try {
            await dbPromise.query(`
        INSERT INTO audit_log (user_id, action, target_table, target_id, old_value, new_value)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [
                userId,
                action,
                targetTable,
                targetId,
                oldValue ? JSON.stringify(oldValue) : null,
                newValue ? JSON.stringify(newValue) : null
            ]);
        } catch (err) {
            console.error('❌ logAudit error:', err.message);
            // Ne pas throw — continuer même si le log échoue
        }
    }

    // GET: Lister les logs d'audit
    app.get('/api/audit', verifyJWT, async (req, res) => {
        try {
            const limit = Math.max(1, parseInt(String(req.query.limit || '10')));
            const offset = Math.max(0, parseInt(String(req.query.offset || '0')));
            const targetTable = req.query.entity_type ? String(req.query.entity_type) : null;
            const targetId = req.query.entity_id ? String(req.query.entity_id) : null;

            let query = 'SELECT * FROM audit_log WHERE 1=1';
            const params = [];

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

            const [logs] = await dbPromise.query(query, params);
            return res.json(logs || []);
        } catch (err) {
            console.error('GET /api/audit error:', err);
            return res.status(500).json({ error: err.message });
        }
    });

    // Exporter la fonction pour l'utiliser dans d'autres routes
    return { logAudit };
};