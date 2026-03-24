// Backend complet - assets.mfwa.org
// Port: 3003 via PM2
// Toutes les routes API

require('dotenv').config();
const express = require('express');
const mysql = require('mysql2');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');

const app = express();

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════════════════

const JWT_SECRET = process.env.JWT_SECRET || 'a3c91f805485a745645f1cb0125ddcdc9b28122088e4a2e00c209f087d0f4119';
const JWT_EXPIRES_IN = '7d';

const db = mysql.createPool({
  host: process.env.DB_HOST || '92.205.29.244',  // IP serveur cPanel
  user: process.env.DB_USER || 'techsupport',
  password: process.env.DB_PASSWORD || 'techsupport2026',
  database: process.env.DB_NAME || 'assetmngt',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelayMs: 0,
});

const dbPromise = db.promise();

// ═══════════════════════════════════════════════════════════════════════════════
// MIDDLEWARE
// ═══════════════════════════════════════════════════════════════════════════════

app.use(cors({
  origin: ['https://assets.mfwa.org', 'http://localhost:5173', 'http://localhost:3002'],
  credentials: true,
}));
app.use(express.json());

// Middleware: Extract JWT from header
const getTokenFromRequest = (req) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  return null;
};

// Middleware: Verify JWT
const verifyJWT = (req, res, next) => {
  const token = getTokenFromRequest(req);
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    console.error('JWT verification error:', err.message);
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTES: Auth
// ═══════════════════════════════════════════════════════════════════════════════

app.post('/api/auth/google', async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'No token provided' });

    const decoded = jwt.decode(token);
    if (!decoded) return res.status(400).json({ error: 'Invalid token format' });

    const { email, name, picture, sub } = decoded;

    const [allowed] = await dbPromise.query(
        'SELECT email, role FROM users WHERE email = ?',
        [email]
    );

    if (!allowed || allowed.length === 0) {
      return res.status(403).json({ error: 'Email not authorized' });
    }

    const user = allowed[0];
    const jwtToken = jwt.sign(
        { id: sub, email, name, picture, role: user.role },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
    );

    return res.json({ token: jwtToken });
  } catch (err) {
    console.error('Auth error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTES: User
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/me', verifyJWT, async (req, res) => {
  try {
    const { email } = req.user;
    const [users] = await dbPromise.query(
        'SELECT id, email, role, created_at FROM users WHERE email = ? LIMIT 1',
        [email]
    );

    if (!users || users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json(users[0]);
  } catch (err) {
    console.error('GET /api/me error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTES: Categories
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/categories', async (req, res) => {
  try {
    const { q } = req.query;
    let query = 'SELECT id, name, created_at FROM categories';
    let params = [];

    if (q) {
      query += ' WHERE name LIKE ?';
      params.push(`%${q}%`);
    }

    query += ' ORDER BY name ASC';
    const [categories] = await dbPromise.query(query, params);
    return res.json(categories || []);
  } catch (err) {
    console.error('GET /api/categories error:', err);
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/categories', verifyJWT, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }

    // Categories table uses auto-increment id
    const [result] = await dbPromise.query(
        'INSERT INTO categories (name) VALUES (?)',
        [name]
    );

    return res.status(201).json({ id: result.insertId, name });
  } catch (err) {
    console.error('POST /api/categories error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTES: Assets
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/assets', verifyJWT, async (req, res) => {
  try {
    const { page = 1, limit = 10, category_name, label } = req.query;
    const pageNum = parseInt(page) || 1;
    const pageSize = parseInt(limit) || 10;
    const offset = (pageNum - 1) * pageSize;

    let whereConditions = [];
    let params = [];

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
    const [countResult] = await dbPromise.query(countQuery, params);
    const totalCount = countResult[0]?.count || 0;

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
      ORDER BY a.id DESC
        LIMIT ? OFFSET ?
    `;
    const [rows] = await dbPromise.query(dataQuery, [...params, pageSize, offset]);

    return res.json({
      data: rows || [],
      count: totalCount,
    });
  } catch (err) {
    console.error('GET /api/assets error:', err);
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/assets/:id', verifyJWT, async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await dbPromise.query(
        `SELECT * FROM assets WHERE id = ? LIMIT 1`,
        [id]
    );

    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: 'Asset not found' });
    }

    const asset = rows[0];

    const [assignments] = await dbPromise.query(
        'SELECT * FROM assignments WHERE asset_id = ? ORDER BY created_at DESC',
        [id]
    );

    const [lifecycle] = await dbPromise.query(
        'SELECT * FROM lifecycle_events WHERE asset_id = ? ORDER BY created_at DESC',
        [id]
    );

    return res.json({
      ...asset,
      assignments: assignments || [],
      lifecycle_events: lifecycle || [],
    });
  } catch (err) {
    console.error('GET /api/assets/:id error:', err);
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/assets', verifyJWT, async (req, res) => {
  try {
    const { label, serial_no, category_id, purchase_price, supplier, notes, funder } = req.body;

    if (!label) {
      return res.status(400).json({ error: 'label is required' });
    }

    const [result] = await dbPromise.query(
        `INSERT INTO assets (label, serial_no, category_id, purchase_price, supplier, notes, funder, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'in_stock')`,
        [label, serial_no || null, category_id || null, purchase_price || null, supplier || null, notes || null, funder || null]
    );

    return res.status(201).json({ id: result.insertId, label });
  } catch (err) {
    console.error('POST /api/assets error:', err);
    return res.status(500).json({ error: err.message });
  }
});

app.patch('/api/assets/:id', verifyJWT, async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const allowedFields = ['label', 'serial_no', 'category_id', 'purchase_price', 'supplier', 'notes', 'funder', 'status', 'warranty_end'];
    const setClause = Object.keys(updates)
        .filter(key => allowedFields.includes(key))
        .map(key => `${key} = ?`)
        .join(', ');

    if (!setClause) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const values = Object.keys(updates)
        .filter(key => allowedFields.includes(key))
        .map(key => updates[key]);

    await dbPromise.query(
        `UPDATE assets SET ${setClause} WHERE id = ?`,
        [...values, id]
    );

    return res.json({ success: true });
  } catch (err) {
    console.error('PATCH /api/assets/:id error:', err);
    return res.status(500).json({ error: err.message });
  }
});

app.delete('/api/assets/:id', verifyJWT, async (req, res) => {
  try {
    const { id } = req.params;
    await dbPromise.query('DELETE FROM assets WHERE id = ?', [id]);
    return res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/assets/:id error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTES: Assignments & Assignees
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/assignments', verifyJWT, async (req, res) => {
  try {
    const [assignments] = await dbPromise.query(
        'SELECT * FROM assignments ORDER BY created_at DESC'
    );
    return res.json(assignments || []);
  } catch (err) {
    console.error('GET /api/assignments error:', err);
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/assignments/assignees', verifyJWT, async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const pageNum = parseInt(page) || 1;
    const pageSize = parseInt(limit) || 10;
    const offset = (pageNum - 1) * pageSize;

    const countQuery = `
      SELECT COUNT(DISTINCT assignee_email) as count
      FROM assignments
      WHERE assignee_email IS NOT NULL
    `;
    const [countResult] = await dbPromise.query(countQuery);
    const totalCount = countResult[0]?.count || 0;

    // Fix: GROUP BY all non-aggregated columns
    const dataQuery = `
      SELECT
        assignee_email,
        MAX(assignee_name) as assignee_name,
        COUNT(*) as asset_count
      FROM assignments
      WHERE assignee_email IS NOT NULL
      GROUP BY assignee_email
      ORDER BY assignee_name ASC
        LIMIT ? OFFSET ?
    `;
    const [rows] = await dbPromise.query(dataQuery, [pageSize, offset]);

    return res.json({
      data: rows || [],
      count: totalCount,
    });
  } catch (err) {
    console.error('GET /api/assignments/assignees error:', err);
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/assignments', verifyJWT, async (req, res) => {
  try {
    const { asset_id, assignee_name, assignee_email, assigned_at } = req.body;

    if (!asset_id) {
      return res.status(400).json({ error: 'asset_id is required' });
    }

    const [result] = await dbPromise.query(
        `INSERT INTO assignments (asset_id, assignee_name, assignee_email, assigned_at, status)
         VALUES (?, ?, ?, ?, 'active')`,
        [asset_id, assignee_name || null, assignee_email || null, assigned_at || new Date().toISOString().split('T')[0]]
    );

    await dbPromise.query('UPDATE assets SET status = ? WHERE id = ?', ['assigned', asset_id]);

    return res.status(201).json({ id: result.insertId });
  } catch (err) {
    console.error('POST /api/assignments error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTES: Incidents
// ═══════════════════════════════════════════════════════════════════════════════

// affichage liste incidents
app.get('/api/incidents', verifyJWT, async (req, res) => {
  try {
    const userEmail = req.user.email; // Récupère l'email en JavaScript

    const [incidents] = await dbPromise.query(`
      SELECT 
        le.id,
        le.asset_id,
        a.label as asset_label,
        le.event_type as incident_type,
        'medium' as severity,
        'open' as status,
        ? as reported_by_email,
        le.created_at,
        le.notes
      FROM lifecycle_events le
      LEFT JOIN assets a ON le.asset_id = a.id
      WHERE le.event_type IN ('repair', 'maintenance')
      ORDER BY le.created_at DESC
    `, [userEmail]);

    return res.json(incidents || []);
  } catch (err) {
    console.error('GET /api/incidents error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// affichage incident
app.get('/api/incidents/:id', verifyJWT, async (req, res) => {
  try {
    const { id } = req.params;

    const [incidents] = await dbPromise.query(`
      SELECT 
        le.id,
        le.asset_id,
        a.label as asset_label,
        le.event_type as incident_type,
        'medium' as severity,
        'open' as status,
        le.created_by as reported_by_email,
        le.created_at,
        le.notes
      FROM lifecycle_events le
      LEFT JOIN assets a ON le.asset_id = a.id
      WHERE le.id = ? LIMIT 1
    `, [id]);

    if (!incidents || incidents.length === 0) {
      return res.status(404).json({ error: 'Incident not found' });
    }

    return res.json(incidents[0]);
  } catch (err) {
    console.error('GET /api/incidents/:id error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// creation incident
app.post('/api/incidents', verifyJWT, async (req, res) => {
  try {
    const { asset_id, event_type, notes } = req.body;

    if (!asset_id) {
      return res.status(400).json({ error: 'asset_id is required' });
    }

    const [result] = await dbPromise.query(
        `INSERT INTO lifecycle_events (asset_id, event_type, notes, created_by)
         VALUES (?, ?, ?, ?)`,
        [asset_id, event_type || 'repair', notes || null, req.user.email]
    );

    return res.status(201).json({ id: result.insertId });
  } catch (err) {
    console.error('POST /api/incidents error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// mise à jour statut
app.patch('/api/incidents/:id/status', verifyJWT, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    console.log(`PATCH /incidents/${id}/status -> status: ${status}`);

    if (!status) {
      return res.status(400).json({ error: 'status is required' });
    }

    const validStatuses = ['open', 'in_progress', 'resolved', 'closed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const resolvedAt = status === 'resolved' ? new Date().toISOString().split('T')[0] : null;

    const [result] = await dbPromise.query(
        `UPDATE lifecycle_events 
       SET status = ?, resolved_at = ?
       WHERE id = ?`,
        [status, resolvedAt, id]
    );

    console.log(`Updated ${result.affectedRows} rows`);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Incident not found' });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error('PATCH /api/incidents/:id/status error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTES: RPC
// ═══════════════════════════════════════════════════════════════════════════════

app.post('/api/rpc/:name', verifyJWT, async (req, res) => {
  try {
    const { name } = req.params;
    const params = req.body;

    if (name === 'return_asset') {
      const { p_asset_id } = params;
      if (!p_asset_id) return res.status(400).json({ error: 'p_asset_id required' });

      await dbPromise.query(
          'UPDATE assignments SET status = ?, returned_at = ? WHERE asset_id = ? AND status = ?',
          ['returned', new Date().toISOString().split('T')[0], p_asset_id, 'active']
      );

      await dbPromise.query('UPDATE assets SET status = ? WHERE id = ?', ['in_stock', p_asset_id]);

      return res.json({ success: true });
    }

    if (name === 'get_asset_stats') {
      const [stats] = await dbPromise.query(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN status = 'in_stock' THEN 1 ELSE 0 END) as in_stock,
          SUM(CASE WHEN status = 'assigned' THEN 1 ELSE 0 END) as assigned,
          SUM(CASE WHEN status = 'repair' THEN 1 ELSE 0 END) as repair,
          SUM(CASE WHEN status = 'retired' THEN 1 ELSE 0 END) as retired
        FROM assets
      `);
      return res.json(stats[0]);
    }

    return res.status(404).json({ error: `RPC function '${name}' not found` });
  } catch (err) {
    console.error(`RPC ${name} error:`, err);
    return res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTES: Audit Log
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/audit', verifyJWT, async (req, res) => {
  try {
    const [logs] = await dbPromise.query(
        'SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 100'
    );
    return res.json(logs || []);
  } catch (err) {
    console.error('GET /api/audit error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTES: Users
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/users', verifyJWT, async (req, res) => {
  try {
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const [users] = await dbPromise.query(
        'SELECT id, email, role, created_at FROM users ORDER BY email'
    );
    return res.json(users || []);
  } catch (err) {
    console.error('GET /api/users error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// STATIC FILES & SPA FALLBACK
// ═══════════════════════════════════════════════════════════════════════════════

app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

// SPA fallback for non-API routes
app.use(/^(?!\/api\/).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'), (err) => {
    if (err) {
      console.error('Error serving index.html:', err);
      res.status(500).send('Internal Server Error');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════════════════════════════════════════

const PORT = process.env.PORT || 3003;
const server = app.listen(PORT, () => {
  console.log(`\n✅ Assets Management API running on port ${PORT}`);
  console.log(`   Database: ${process.env.DB_HOST || '92.205.29.244'}`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}\n`);
});

server.on('error', (err) => {
  console.error('Server error:', err);
  process.exit(1);
});

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTES: RPC Helpers
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/rpc/is_admin', verifyJWT, async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) return res.status(400).json({ error: 'email required' });
    const [users] = await dbPromise.query('SELECT role FROM users WHERE email = ? LIMIT 1', [email]);
    const isAdmin = users && users.length > 0 && (users[0].role === 'admin' || users[0].role === 'super_admin');
    return res.json({ result: isAdmin });
  } catch (err) {
    console.error('GET /api/rpc/is_admin error:', err);
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/rpc/is_super_admin', verifyJWT, async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) return res.status(400).json({ error: 'email required' });
    const [users] = await dbPromise.query('SELECT role FROM users WHERE email = ? LIMIT 1', [email]);
    const isSuperAdmin = users && users.length > 0 && users[0].role === 'super_admin';
    return res.json({ result: isSuperAdmin });
  } catch (err) {
    console.error('GET /api/rpc/is_super_admin error:', err);
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/rpc/is_email_allowed', async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) return res.status(400).json({ error: 'email required' });
    const [users] = await dbPromise.query('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
    const isAllowed = users && users.length > 0;
    return res.json({ result: isAllowed });
  } catch (err) {
    console.error('GET /api/rpc/is_email_allowed error:', err);
    return res.status(500).json({ error: err.message });
  }
});