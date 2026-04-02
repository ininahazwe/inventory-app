#!/usr/bin/env node
/**
 * Script d'injection de window.__ENV__ dans index.html
 * Exécuter APRÈS le build Vite pour injecter les variables d'env en prod
 *
 * Usage: node inject-env.js
 */

const fs = require('fs');
const path = require('path');

// Chemin vers le fichier index.html après build
const distDir = path.join(__dirname, 'dist');
const indexPath = path.join(distDir, 'index.html');

// Variables d'env à injecter
const envVars = {
    VITE_GOOGLE_CLIENT_ID: process.env.VITE_GOOGLE_CLIENT_ID || '',
    VITE_API_URL: process.env.VITE_API_URL || '/api',
    VITE_CLOUDINARY_CLOUD_NAME: process.env.VITE_CLOUDINARY_CLOUD_NAME || '',
    VITE_CLOUDINARY_UPLOAD_PRESET: process.env.VITE_CLOUDINARY_UPLOAD_PRESET || '',
};

console.log('🔧 Injecting environment variables into index.html...');
console.log('Env vars:', envVars);

// Vérifier que le fichier existe
if (!fs.existsSync(indexPath)) {
    console.error(`❌ Error: ${indexPath} not found`);
    console.error('Make sure you run "npm run build" first');
    process.exit(1);
}

// Lire le contenu HTML
let htmlContent = fs.readFileSync(indexPath, 'utf-8');

// Créer le script à injecter
const envScript = `
<script>
  window.__ENV__ = {
    VITE_GOOGLE_CLIENT_ID: '${envVars.VITE_GOOGLE_CLIENT_ID}',
    VITE_API_URL: '${envVars.VITE_API_URL}',
    VITE_CLOUDINARY_CLOUD_NAME: '${envVars.VITE_CLOUDINARY_CLOUD_NAME}',
    VITE_CLOUDINARY_UPLOAD_PRESET: '${envVars.VITE_CLOUDINARY_UPLOAD_PRESET}',
  };
  console.log('✅ Environment loaded:', window.__ENV__);
</script>
`;

// Injecter AVANT le premier <script> pour que ça soit disponible tout de suite
const insertPoint = htmlContent.indexOf('<script');
if (insertPoint === -1) {
    console.error('❌ Error: No <script> tag found in index.html');
    process.exit(1);
}

const newHtmlContent = htmlContent.slice(0, insertPoint) + envScript + htmlContent.slice(insertPoint);

// Écrire le fichier modifié
fs.writeFileSync(indexPath, newHtmlContent);

console.log('✅ Environment variables injected into index.html');
console.log(`📝 File: ${indexPath}`);
console.log(`📦 VITE_GOOGLE_CLIENT_ID: ${envVars.VITE_GOOGLE_CLIENT_ID ? '✓ set' : '❌ missing'}`);