// server/src/services/signatureStorage.ts
// Stockage des images de signature (module mémos). Les fichiers vivent sur disque,
// HORS du dossier public servi par Express : une signature n'est lisible que par
// les routes authentifiées de /api/memos, jamais par une URL statique.
//
// Dossier : MEMO_STORAGE_DIR si défini, sinon <cwd>/storage. Sur l'hébergement
// mutualisé, définir MEMO_STORAGE_DIR vers un chemin qui survit aux déploiements
// (le déploiement ne remplace que `dist` et `public`).
//
// Format : PNG uniquement (dessin sur canvas, texte rendu en canvas, ou image
// importée convertie côté client). Le SVG est refusé : il peut embarquer du script.
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { BusinessException, NotFoundException } from '../exceptions';

export const MAX_SIGNATURE_BYTES = 300 * 1024;
const MAX_WIDTH = 1600;
const MAX_HEIGHT = 800;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function storageRoot(): string {
    return path.resolve(process.env.MEMO_STORAGE_DIR || path.join(process.cwd(), 'storage'));
}

/** Décode et valide une data URL `data:image/png;base64,…` → octets du PNG. */
export function parsePngDataUrl(dataUrl: unknown): Buffer {
    if (typeof dataUrl !== 'string') throw new BusinessException('image is required');
    const m = /^data:image\/png;base64,([A-Za-z0-9+/=\r\n]+)$/.exec(dataUrl);
    if (!m) throw new BusinessException('The signature must be a PNG image (data URL)');
    const buf = Buffer.from(m[1], 'base64');
    if (buf.length > MAX_SIGNATURE_BYTES) {
        throw new BusinessException(`The signature image is too large (max ${Math.round(MAX_SIGNATURE_BYTES / 1024)} KB)`);
    }
    if (buf.length < 67 || !buf.subarray(0, 8).equals(PNG_MAGIC)) {
        throw new BusinessException('The signature is not a valid PNG image');
    }
    // IHDR : largeur et hauteur en big-endian aux octets 16-23.
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    if (!width || !height || width > MAX_WIDTH || height > MAX_HEIGHT) {
        throw new BusinessException(`The signature image must be at most ${MAX_WIDTH}×${MAX_HEIGHT} pixels`);
    }
    return buf;
}

/** Écrit le PNG (nom = empreinte SHA-256) et renvoie le chemin relatif à stocker en base. */
export async function saveSignaturePng(buf: Buffer): Promise<{ relPath: string; sha256: string }> {
    const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
    const relPath = path.posix.join('signatures', `${sha256}.png`);
    const abs = path.join(storageRoot(), relPath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, buf, { mode: 0o600 });
    return { relPath, sha256 };
}

export async function readSignaturePng(relPath: string): Promise<Buffer> {
    const root = storageRoot();
    const abs = path.resolve(root, relPath);
    if (!abs.startsWith(root + path.sep)) throw new NotFoundException('Signature file not found');
    try {
        return await fs.readFile(abs);
    } catch {
        throw new NotFoundException('Signature file not found');
    }
}
