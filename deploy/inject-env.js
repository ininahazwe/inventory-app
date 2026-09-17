#!/usr/bin/env node
/**
 * Injecte window.__ENV__ dans le index.html produit par vite.
 *
 * Usage : node deploy/inject-env.js <chemin/vers/dist/index.html>
 *
 * Les valeurs sont lues dans process.env. Le script de deploiement les charge
 * depuis ~/deploy-config/build.env avant de nous appeler.
 *
 * Difference avec le ./inject-env.js historique a la racine du depot : celui-ci
 * prend le chemin en argument (pas de __dirname devine) et refuse de produire
 * un fichier avec des variables vides — une VITE_GOOGLE_CLIENT_ID vide casse la
 * connexion Google sans aucune erreur visible, ce qui est pire qu'un echec net.
 */

const fs = require('fs');

const distIndexPath = process.argv[2];

if (!distIndexPath) {
  console.error('inject-env: chemin de index.html manquant');
  process.exit(1);
}
if (!fs.existsSync(distIndexPath)) {
  console.error(`inject-env: ${distIndexPath} introuvable`);
  process.exit(1);
}

const envVars = {
  VITE_GOOGLE_CLIENT_ID: process.env.VITE_GOOGLE_CLIENT_ID || '',
  VITE_CLOUDINARY_CLOUD_NAME: process.env.VITE_CLOUDINARY_CLOUD_NAME || '',
  VITE_CLOUDINARY_UPLOAD_PRESET: process.env.VITE_CLOUDINARY_UPLOAD_PRESET || '',
  VITE_API_URL: process.env.VITE_API_URL || '',
};

const required = ['VITE_GOOGLE_CLIENT_ID', 'VITE_API_URL'];
const missing = required.filter((k) => !envVars[k]);
if (missing.length > 0) {
  console.error(`inject-env: variables obligatoires vides : ${missing.join(', ')}`);
  process.exit(1);
}

let html = fs.readFileSync(distIndexPath, 'utf-8');

if (html.includes('window.__ENV__')) {
  console.error('inject-env: window.__ENV__ est deja present, injection annulee');
  process.exit(1);
}

const idx = html.indexOf('<script');
if (idx === -1) {
  console.error('inject-env: aucune balise <script> trouvee dans index.html');
  process.exit(1);
}

const snippet = `<script>\nwindow.__ENV__ = ${JSON.stringify(envVars, null, 2)};\n</script>\n`;
html = html.slice(0, idx) + snippet + html.slice(idx);

fs.writeFileSync(distIndexPath, html, 'utf-8');
console.log(`inject-env: ${Object.keys(envVars).length} variables injectees dans ${distIndexPath}`);
