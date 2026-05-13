#!/usr/bin/env node
/**
 * Post-build script : injecter window.__ENV__ dans dist/index.html
 * Exécuté APRÈS `vite build` et AVANT déploiement sur le serveur
 *
 * Les variables doivent exister dans process.env au moment du build
 * Elles seront lues depuis le .env du projet ou les variables GitHub Actions
 */

const fs = require('fs');
const path = require('path');

const distIndexPath = path.join(__dirname, 'dist', 'index.html');

if (!fs.existsSync(distIndexPath)) {
    console.error('❌ dist/index.html not found. Run `npm run build` first.');
    process.exit(1);
}

// Variables à injecter (lire depuis process.env)
const envVars = {
    VITE_GOOGLE_CLIENT_ID: process.env.VITE_GOOGLE_CLIENT_ID || '',
    VITE_CLOUDINARY_CLOUD_NAME: process.env.VITE_CLOUDINARY_CLOUD_NAME || '',
    VITE_CLOUDINARY_UPLOAD_PRESET: process.env.VITE_CLOUDINARY_UPLOAD_PRESET || '',
    VITE_API_URL: process.env.VITE_API_URL || '',
};

console.log('📝 Injecting environment variables into dist/index.html');
console.log('Variables:', Object.keys(envVars).join(', '));

// Créer le script d'injection
const injectionScript = `<script>
window.__ENV__ = ${JSON.stringify(envVars, null, 2)};
console.log('✅ Environment injected into window.__ENV__');
</script>`;

// Lire le HTML
let html = fs.readFileSync(distIndexPath, 'utf-8');

// Chercher le premier <script> tag
const scriptIndex = html.indexOf('<script');
if (scriptIndex === -1) {
    console.error('❌ No <script> tag found in dist/index.html');
    process.exit(1);
}

// Injecter AVANT le premier <script>
html = html.slice(0, scriptIndex) + injectionScript + '\n' + html.slice(scriptIndex);

// Écrire le HTML modifié
fs.writeFileSync(distIndexPath, html, 'utf-8');

console.log('✅ Environment injected successfully');
console.log(`📁 File: ${distIndexPath}`);