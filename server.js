import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import mysql from 'mysql2/promise';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import session from 'express-session';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ====== CONFIGURATION ======

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Créer le dossier de logs s'il n'existe pas
const LOG_DIR = process.env.LOG_PATH || path.join(__dirname, 'logs');
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// ====== LOGGER ======

const log = (level, message, data = '') => {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${level}] ${message} ${data ? JSON.stringify(data) : ''}`;
  console.log(logMessage);

  if (NODE_ENV === 'production') {
    fs.appendFileSync(path.join(LOG_DIR, 'app.log'), logMessage + '\n');
  }
};

// ====== POOL DE CONNEXIONS MYSQL ======

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: parseInt(process.env.DB_POOL_MAX || 10),
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelayMs: 0
});

// Test de la connexion au démarrage
pool.getConnection()
    .then(connection => {
      log('INFO', 'Base de données connectée avec succès');
      connection.release();
    })
    .catch(error => {
      log('ERROR', 'Impossible de se connecter à la base de données:', error.message);
      process.exit(1);
    });

// ====== MIDDLEWARE GLOBAL ======

// CORS
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(',');
app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));

// Body parser
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Session
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-session-secret-change-this',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: parseInt(process.env.SESSION_TIMEOUT || 3600000)
  }
}));

// Passport
app.use(passport.initialize());
app.use(passport.session());

// Servir les fichiers statiques (React build)
const distPath = path.join(__dirname, 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  log('INFO', `Fichiers statiques servis depuis: ${distPath}`);
}

// ====== CONFIGURATION PASSPORT GOOGLE OAUTH ======

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: process.env.GOOGLE_REDIRECT_URI
}, async (accessToken, refreshToken, profile, done) => {
  try {
    const email = profile.emails[0].value;

    log('INFO', 'Tentative de connexion Google:', { email });

    // Vérifier si l'email est dans la liste blanche
    const connection = await pool.getConnection();
    const [whitelistResult] = await connection.query(
        'SELECT id FROM allowed_emails WHERE email = ?',
        [email]
    );
    connection.release();

    if (whitelistResult.length === 0) {
      log('WARN', 'Email non autorisé:', { email });
      return done(null, false, { message: 'Email non autorisé' });
    }

    log('INFO', 'Utilisateur authentifié:', { email });

    // Créer ou mettre à jour l'utilisateur
    const user = {
      id: profile.id,
      displayName: profile.displayName,
      email: email,
      picture: profile.photos[0]?.value,
      provider: 'google'
    };

    done(null, user);
  } catch (error) {
    log('ERROR', 'Erreur lors de l\'authentification Google:', error.message);
    done(error);
  }
}));

// Sérialisation/Désérialisation
passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((user, done) => {
  done(null, user);
});

// ====== MIDDLEWARE D'AUTHENTIFICATION ======

const requireAuth = (req, res, next) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Non authentifié' });
  }
  next();
};

// ====== ROUTES AUTHENTIFICATION ======

// Route de santé
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'Server is running',
    timestamp: new Date().toISOString(),
    environment: NODE_ENV
  });
});

// Login Google
app.get('/auth/google', passport.authenticate('google', {
  scope: ['profile', 'email']
}));

// Callback Google
app.get('/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/login' }),
    (req, res) => {
      log('INFO', 'Authentification réussie:', { user: req.user.email });
      res.redirect('/');
    }
);

// Logout
app.get('/auth/logout', (req, res) => {
  req.logout((err) => {
    if (err) {
      log('ERROR', 'Erreur lors de la déconnexion:', err.message);
      return res.status(500).json({ error: err.message });
    }
    log('INFO', 'Utilisateur déconnecté');
    res.json({ message: 'Déconnecté avec succès' });
  });
});

// Infos utilisateur courant
app.get('/api/user', requireAuth, (req, res) => {
  res.json({
    id: req.user.id,
    name: req.user.displayName,
    email: req.user.email,
    picture: req.user.picture
  });
});

// ====== ROUTES API - ASSETS ======

// GET tous les assets
app.get('/api/assets', requireAuth, async (req, res) => {
  try {
    const connection = await pool.getConnection();
    const [assets] = await connection.query(
        'SELECT * FROM assets ORDER BY created_at DESC LIMIT 1000'
    );
    connection.release();
    log('INFO', 'GET /api/assets - Nombre d\'assets:', { count: assets.length });
    res.json(assets);
  } catch (error) {
    log('ERROR', 'GET /api/assets:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET un asset spécifique
app.get('/api/assets/:id', requireAuth, async (req, res) => {
  try {
    const connection = await pool.getConnection();
    const [assets] = await connection.query(
        'SELECT * FROM assets WHERE id = ?',
        [req.params.id]
    );
    connection.release();

    if (assets.length === 0) {
      return res.status(404).json({ error: 'Asset non trouvé' });
    }

    res.json(assets[0]);
  } catch (error) {
    log('ERROR', 'GET /api/assets/:id:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST créer un nouvel asset
app.post('/api/assets', requireAuth, async (req, res) => {
  try {
    const { label, serial_no, status, category_id, purchase_price, notes } = req.body;

    if (!label) {
      return res.status(400).json({ error: 'Label est requis' });
    }

    const connection = await pool.getConnection();
    const [result] = await connection.query(
        'INSERT INTO assets (label, serial_no, status, category_id, purchase_price, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())',
        [label, serial_no || null, status || 'in_stock', category_id || null, purchase_price || null, notes || null]
    );
    connection.release();

    log('INFO', 'Asset créé:', { id: result.insertId, label });
    res.status(201).json({
      id: result.insertId,
      label,
      serial_no,
      status: status || 'in_stock'
    });
  } catch (error) {
    log('ERROR', 'POST /api/assets:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// PUT mettre à jour un asset
app.put('/api/assets/:id', requireAuth, async (req, res) => {
  try {
    const { label, serial_no, status, category_id, purchase_price, notes } = req.body;

    const connection = await pool.getConnection();
    await connection.query(
        'UPDATE assets SET label=?, serial_no=?, status=?, category_id=?, purchase_price=?, notes=? WHERE id=?',
        [label, serial_no, status, category_id, purchase_price, notes, req.params.id]
    );
    connection.release();

    log('INFO', 'Asset mis à jour:', { id: req.params.id });
    res.json({ message: 'Asset mis à jour' });
  } catch (error) {
    log('ERROR', 'PUT /api/assets/:id:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// DELETE un asset
app.delete('/api/assets/:id', requireAuth, async (req, res) => {
  try {
    const connection = await pool.getConnection();
    await connection.query('DELETE FROM assets WHERE id=?', [req.params.id]);
    connection.release();

    log('INFO', 'Asset supprimé:', { id: req.params.id });
    res.json({ message: 'Asset supprimé' });
  } catch (error) {
    log('ERROR', 'DELETE /api/assets/:id:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ====== ROUTES API - CATÉGORIES ======

// GET toutes les catégories
app.get('/api/categories', requireAuth, async (req, res) => {
  try {
    const connection = await pool.getConnection();
    const [categories] = await connection.query('SELECT * FROM categories ORDER BY name');
    connection.release();
    res.json(categories);
  } catch (error) {
    log('ERROR', 'GET /api/categories:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST créer une catégorie
app.post('/api/categories', requireAuth, async (req, res) => {
  try {
    const { name, description } = req.body;

    const connection = await pool.getConnection();
    const [result] = await connection.query(
        'INSERT INTO categories (name, description) VALUES (?, ?)',
        [name, description || null]
    );
    connection.release();

    log('INFO', 'Catégorie créée:', { name });
    res.status(201).json({ id: result.insertId, name, description });
  } catch (error) {
    log('ERROR', 'POST /api/categories:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ====== ROUTES API - ASSIGNEES ======

// GET tous les assignees
app.get('/api/assignees', requireAuth, async (req, res) => {
  try {
    const connection = await pool.getConnection();
    const [assignees] = await connection.query('SELECT * FROM assignees ORDER BY name');
    connection.release();
    res.json(assignees);
  } catch (error) {
    log('ERROR', 'GET /api/assignees:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ====== ROUTES API - INCIDENTS ======

// GET tous les incidents
app.get('/api/incidents', requireAuth, async (req, res) => {
  try {
    const connection = await pool.getConnection();
    const [incidents] = await connection.query(
        'SELECT * FROM incidents ORDER BY created_at DESC'
    );
    connection.release();
    res.json(incidents);
  } catch (error) {
    log('ERROR', 'GET /api/incidents:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST créer un incident
app.post('/api/incidents', requireAuth, async (req, res) => {
  try {
    const { asset_id, type, description, severity } = req.body;

    const connection = await pool.getConnection();
    const [result] = await connection.query(
        'INSERT INTO incidents (asset_id, type, description, severity, created_at) VALUES (?, ?, ?, ?, NOW())',
        [asset_id, type, description, severity || 'medium']
    );
    connection.release();

    log('INFO', 'Incident créé:', { asset_id, type });
    res.status(201).json({ id: result.insertId, asset_id, type, description });
  } catch (error) {
    log('ERROR', 'POST /api/incidents:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ====== SPA FALLBACK ======

// Servir index.html pour toutes les routes non-API (SPA)
app.use((req, res) => {
  const indexPath = path.join(distPath, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).json({ error: 'Application build not found. Run: npm run build' });
  }
});

// ====== GESTION DES ERREURS ======

app.use((err, req, res, next) => {
  log('ERROR', 'Erreur non gérée:', err.message);
  res.status(500).json({
    error: NODE_ENV === 'production' ? 'Erreur serveur' : err.message
  });
});

// ====== DÉMARRAGE DU SERVEUR ======

app.listen(PORT, () => {
  log('INFO', `Serveur en cours d'exécution sur le port ${PORT}`);
  log('INFO', `Environnement: ${NODE_ENV}`);
  log('INFO', `Base de données: ${process.env.DB_NAME}`);
  log('INFO', `URL: https://assets.mfwa.org`);
  log('INFO', `Google OAuth Redirect: ${process.env.GOOGLE_REDIRECT_URI}`);
});

// ====== GESTION DES SIGNAUX ======

process.on('SIGTERM', () => {
  log('INFO', 'SIGTERM reçu, arrêt gracieux...');
  process.exit(0);
});

process.on('SIGINT', () => {
  log('INFO', 'SIGINT reçu, arrêt gracieux...');
  process.exit(0);
});

export default app;