// server/src/services/attachmentStorage.ts
// Pièces jointes des mémos (budget, facture, scan). Même principe que les signatures :
// fichiers sur disque hors dossier public, nom = empreinte SHA-256 du contenu, lus
// uniquement par les routes authentifiées. Le type annoncé doit être dans une liste
// blanche ET cohérent avec les premiers octets du fichier.
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { BusinessException, NotFoundException } from '../exceptions';
import { storageRoot } from './signatureStorage';

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_REVISION = 10;

const ZIP = [0x50, 0x4b, 0x03, 0x04];
const OLE = [0xd0, 0xcf, 0x11, 0xe0];
const SIGNATURES: Record<string, number[] | null> = {
    'application/pdf': [0x25, 0x50, 0x44, 0x46],
    'image/png': [0x89, 0x50, 0x4e, 0x47],
    'image/jpeg': [0xff, 0xd8, 0xff],
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ZIP,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ZIP,
    'application/vnd.ms-excel': OLE,
    'application/msword': OLE,
    'text/csv': null,                 // texte : pas de signature binaire à vérifier
};

const startsWith = (buf: Buffer, sig: number[]) => sig.every((b, i) => buf[i] === b);

/** Valide type, taille et octets d'en-tête ; renvoie un nom de fichier nettoyé. */
export function validateAttachment(rawName: unknown, mime: unknown, buf: unknown): { name: string; mime: string; data: Buffer } {
    if (!Buffer.isBuffer(buf) || buf.length === 0) throw new BusinessException('The file is empty');
    if (buf.length > MAX_ATTACHMENT_BYTES) {
        throw new BusinessException(`The file is too large (max ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB)`);
    }
    const type = String(mime || '').split(';')[0].trim().toLowerCase();
    if (!(type in SIGNATURES)) {
        throw new BusinessException('File type not allowed — use PDF, PNG, JPG, Word, Excel or CSV');
    }
    const sig = SIGNATURES[type];
    if (sig && !startsWith(buf, sig)) throw new BusinessException('The file content does not match its type');

    let name = String(rawName || '').trim();
    try { name = decodeURIComponent(name); } catch { /* nom déjà en clair */ }
    name = path.basename(name).replace(/[\u0000-\u001f"\\/]/g, '_').slice(0, 200);
    if (!name) throw new BusinessException('The file name is missing');
    return { name, mime: type, data: buf };
}

export async function saveAttachment(buf: Buffer): Promise<{ relPath: string; sha256: string }> {
    const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
    const relPath = path.posix.join('attachments', sha256);
    const abs = path.join(storageRoot(), relPath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, buf, { mode: 0o600 });
    return { relPath, sha256 };
}

export async function readAttachment(relPath: string): Promise<Buffer> {
    const root = storageRoot();
    const abs = path.resolve(root, relPath);
    if (!abs.startsWith(root + path.sep)) throw new NotFoundException('Attachment file not found');
    try { return await fs.readFile(abs); } catch { throw new NotFoundException('Attachment file not found'); }
}
