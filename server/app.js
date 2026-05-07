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

require('./cron-auto-close');  // Charge et lance le cron

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
  //keepAliveInitialDelayMs: 0,
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

// ═══════════════════════════════════════════════════════════════════════════════
// JWT HELPERS - DÉCLARER AVANT LES ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

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
// ROUTES: Auctions (modulaire) - APRÈS verifyJWT déclaré
// ═══════════════════════════════════════════════════════════════════════════════

const setupAuctionsRoutes = require('./routes/auctions');
setupAuctionsRoutes(app, dbPromise, verifyJWT);

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
      ORDER BY a.label ASC
        LIMIT ? OFFSET ?
    `;
    params.push(pageSize, offset);

    const [assets] = await dbPromise.query(dataQuery, params);

    return res.json({
      data: assets,
      pagination: { page: pageNum, limit: pageSize, total: totalCount }
    });
  } catch (err) {
    console.error('GET /api/assets error:', err);
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/assets', verifyJWT, async (req, res) => {
  try {
    const { label, serial_no, category_id, status, funder, purchase_price } = req.body;

    if (!label) {
      return res.status(400).json({ error: 'label is required' });
    }

    const [result] = await dbPromise.query(
        `INSERT INTO assets (label, serial_no, category_id, status, funder, purchase_price)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [label, serial_no || null, category_id || null, status || 'in_stock', funder || null, purchase_price || null]
    );

    return res.status(201).json({
      id: result.insertId,
      label,
      serial_no,
      category_id,
      status,
      funder,
      purchase_price
    });
  } catch (err) {
    console.error('POST /api/assets error:', err);
    return res.status(500).json({ error: err.message });
  }
});

app.patch('/api/assets/:id', verifyJWT, async (req, res) => {
  try {
    const { id } = req.params;
    const { label, serial_no, category_id, status, funder, purchase_price } = req.body;

    const updates = [];
    const values = [];

    if (label !== undefined) {
      updates.push('label = ?');
      values.push(label);
    }
    if (serial_no !== undefined) {
      updates.push('serial_no = ?');
      values.push(serial_no);
    }
    if (category_id !== undefined) {
      updates.push('category_id = ?');
      values.push(category_id);
    }
    if (status !== undefined) {
      updates.push('status = ?');
      values.push(status);
    }
    if (funder !== undefined) {
      updates.push('funder = ?');
      values.push(funder);
    }
    if (purchase_price !== undefined) {
      updates.push('purchase_price = ?');
      values.push(purchase_price);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(id);

    const [result] = await dbPromise.query(
        `UPDATE assets SET ${updates.join(', ')} WHERE id = ?`,
        values
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Asset not found' });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error('PATCH /api/assets/:id error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTES: Assignments
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/assignments', verifyJWT, async (req, res) => {
  try {
    const [assignments] = await dbPromise.query(
        `SELECT a.id, a.asset_id, a.assignee_name, a.assignee_email, a.status, a.assigned_at, a.returned_at
         FROM assignments a
         WHERE a.status IN ('active', 'returned')
         ORDER BY a.assigned_at DESC`
    );
    return res.json(assignments || []);
  } catch (err) {
    console.error('GET /api/assignments error:', err);
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/assignments/assignees', verifyJWT, async (req, res) => {
  try {
    const { page = 1, limit = 10, q = '' } = req.query;
    const pageNum = parseInt(page) || 1;
    const pageSize = Math.min(parseInt(limit) || 10, 100);
    const offset = (pageNum - 1) * pageSize;
    const searchTerm = (q || '').toString().trim();

    // Compter le total (exclure les NULL emails)
    let countQuery = `
      SELECT COUNT(DISTINCT TRIM(assignee_email)) as total 
      FROM assignments 
      WHERE status = 'active' AND assignee_email IS NOT NULL
    `;
    const countParams = [];

    if (searchTerm) {
      countQuery += ' AND (TRIM(assignee_name) LIKE ? OR TRIM(assignee_email) LIKE ?)';
      countParams.push(`%${searchTerm}%`, `%${searchTerm}%`);
    }

    const [countResult] = await dbPromise.query(countQuery, countParams);
    const total = countResult[0]?.total || 0;

    // Récupérer les assignees avec pagination
    let dataQuery = `
      SELECT 
        TRIM(assignee_email) as assignee_email,
        MAX(TRIM(assignee_name)) as assignee_name,
        COUNT(asset_id) as asset_count
      FROM assignments
      WHERE status = 'active' AND assignee_email IS NOT NULL
    `;
    const dataParams = [];

    if (searchTerm) {
      dataQuery += ' AND (TRIM(assignee_name) LIKE ? OR TRIM(assignee_email) LIKE ?)';
      dataParams.push(`%${searchTerm}%`, `%${searchTerm}%`);
    }

    dataQuery += `
      GROUP BY TRIM(assignee_email)
      ORDER BY assignee_name ASC
      LIMIT ? OFFSET ?
    `;
    dataParams.push(pageSize, offset);

    const [assignees] = await dbPromise.query(dataQuery, dataParams);

    return res.json({
      data: assignees || [],
      count: total
    });
  } catch (err) {
    console.error('GET /api/assignments/assignees error:', err);
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/assignments', verifyJWT, async (req, res) => {
  try {
    const { asset_id, assignee_name, assignee_email } = req.body;

    if (!asset_id || !assignee_name || !assignee_email) {
      return res.status(400).json({ error: 'asset_id, assignee_name, assignee_email required' });
    }

    // Close previous active assignment
    await dbPromise.query(
        'UPDATE assignments SET status = ?, returned_at = ? WHERE asset_id = ? AND status = ?',
        ['returned', new Date().toISOString().split('T')[0], asset_id, 'active']
    );

    // Create new assignment
    const [result] = await dbPromise.query(
        `INSERT INTO assignments (asset_id, assignee_name, assignee_email, status)
         VALUES (?, ?, ?, ?)`,
        [asset_id, assignee_name, assignee_email, 'active']
    );

    // Update asset status
    await dbPromise.query('UPDATE assets SET status = ? WHERE id = ?', ['assigned', asset_id]);

    return res.status(201).json({
      id: result.insertId,
      asset_id,
      assignee_name,
      assignee_email,
      status: 'active'
    });
  } catch (err) {
    console.error('POST /api/assignments error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTES: Incidents
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/incidents', verifyJWT, async (req, res) => {
  try {
    const [incidents] = await dbPromise.query(`
      SELECT
        i.id,
        i.asset_id,
        a.label as asset_label,
        i.incident_type,
        i.severity,
        i.description,
        i.status,
        i.reported_by_email,
        i.assigned_to,
        i.created_at,
        i.resolved_at,
        i.notes
      FROM incidents i
             LEFT JOIN assets a ON i.asset_id = a.id
      ORDER BY i.created_at DESC
    `);
    return res.json(incidents || []);
  } catch (err) {
    console.error('GET /api/incidents error:', err);
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/incidents', verifyJWT, async (req, res) => {
  try {
    const { asset_id, incident_type, severity, description } = req.body;
    const { email } = req.user;

    if (!asset_id) {
      return res.status(400).json({ error: 'asset_id required' });
    }

    const [result] = await dbPromise.query(
        `INSERT INTO incidents (asset_id, incident_type, severity, description, status, reported_by_email, created_at)
         VALUES (?, ?, ?, ?, ?, ?, NOW())`,
        [asset_id, incident_type || 'other', severity || 'medium', description || null, 'open', email]
    );

    return res.status(201).json({
      id: result.insertId,
      asset_id,
      incident_type: incident_type || 'other',
      severity: severity || 'medium',
      description,
      status: 'open',
      reported_by_email: email,
      created_at: new Date().toISOString()
    });
  } catch (err) {
    console.error('POST /api/incidents error:', err);
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/incidents/:id', verifyJWT, async (req, res) => {
  try {
    const { id } = req.params;
    const [incidents] = await dbPromise.query(`
      SELECT
        i.id,
        i.asset_id,
        a.label as asset_label,
        i.incident_type,
        i.severity,
        i.description,
        i.status,
        i.reported_by_email,
        i.assigned_to,
        i.created_at,
        i.resolved_at,
        i.notes
      FROM incidents i
             LEFT JOIN assets a ON i.asset_id = a.id
      WHERE i.id = ?
    `, [id]);

    if (!incidents.length) {
      return res.status(404).json({ error: 'Incident not found' });
    }

    return res.json(incidents[0]);
  } catch (err) {
    console.error(`GET /api/incidents/:id error:`, err);
    return res.status(500).json({ error: err.message });
  }
});

app.patch('/api/incidents/:id/status', verifyJWT, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({ error: 'status required' });
    }

    const resolvedAt = status === 'resolved' ? new Date().toISOString().split('T')[0] : null;

    const [result] = await dbPromise.query(
        `UPDATE incidents
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

    if (name === 'assignees_rename') {
      const { p_email, p_new_name } = params;
      if (!p_email || !p_new_name) return res.status(400).json({ error: 'p_email and p_new_name required' });

      const [result] = await dbPromise.query(
          'UPDATE assignments SET assignee_name = ? WHERE assignee_email = ?',
          [p_new_name, p_email]
      );

      return res.json({ success: true, affectedRows: result.affectedRows });
    }

    if (name === 'assignees_delete') {
      const { p_email, p_name } = params;
      if (!p_email && !p_name) return res.status(400).json({ error: 'p_email or p_name required' });

      const [result] = await dbPromise.query(
          'DELETE FROM assignments WHERE assignee_email = ? OR assignee_name = ?',
          [p_email || '', p_name || '']
      );

      return res.json({ success: true, deletedRows: result.affectedRows });
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

// ═══════════════════════════════════════════════════════════════════════════════
// NOTE: Auctions auto-close route is now in routes/auctions.js
// It's called by the cron job and includes email notifications
// ═══════════════════════════════════════════════════════════════════════════════

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