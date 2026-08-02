// src/config/env.ts
// Valide les variables d'environnement critiques au démarrage — le serveur
// refuse de démarrer plutôt que de retomber sur un secret codé en dur.
// (Avant ce fichier, JWT_SECRET avait un fallback hardcodé dans le code source,
// donc exposé dans l'historique git — voir note de rotation dans le README de migration.)

function required(name: string): string {
    const value = process.env[name];
    if (!value || !value.trim()) {
        throw new Error(
            `Missing required environment variable: ${name}. ` +
            `Set it in your .env file — the server will not start without it.`
        );
    }
    return value;
}

export function validateEnv(): void {
    // Lève une exception listant TOUTES les variables manquantes d'un coup
    const missing: string[] = [];
    for (const name of ['JWT_SECRET', 'DB_HOST', 'DB_USER', 'DB_NAME']) {
        if (!process.env[name] || !process.env[name]?.trim()) {
            missing.push(name);
        }
    }
    if (missing.length > 0) {
        throw new Error(`Missing required environment variable(s): ${missing.join(', ')}`);
    }
}

// Accès centralisé — plus aucun fallback hardcodé ailleurs dans le code
export const JWT_SECRET = (): string => required('JWT_SECRET');
export const JWT_EXPIRES_IN = (): string => process.env.JWT_EXPIRES_IN || '7d';

// Secret partagé pour les appels cron (ex: clôture automatique des enchères).
// Optionnel: si absent, la route protégée reste désactivée (fail closed) plutôt
// que d'accepter tout appelant.
export const CRON_SECRET = (): string | undefined => process.env.CRON_SECRET;
