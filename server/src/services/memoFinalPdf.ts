// server/src/services/memoFinalPdf.ts
// Chargement des données d'un mémo pour le PDF, et archivage du PDF FINAL au
// décaissement. Une fois `released`, un mémo ne change plus : on fige donc son PDF
// (fichier sur disque hors dossier public, nom = SHA-256 du fichier, empreinte et
// chemin dans memos.pdf_path / pdf_sha256) pour que chaque téléchargement ultérieur
// rende exactement le même document, signatures comprises.
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { db } from '../database/connection';
import { logger } from '../middleware/logger';
import { NotFoundException } from '../exceptions';
import { buildMemoPdf } from './memoPdf';
import { readSignaturePng, storageRoot } from './signatureStorage';
import { readAttachment } from './attachmentStorage';
import { recordMemoEvent } from './memoService';

export const MEMO_PDF_SELECT = `
    SELECT m.*, ty.name AS type_name, pr.code AS project_code, pr.title AS project_title
    FROM memos m JOIN memo_types ty ON ty.id = m.type_id
         LEFT JOIN memo_projects pr ON pr.id = m.project_id
    WHERE m.id = ?`;

/** Génère le PDF d'un mémo (ligne issue de MEMO_PDF_SELECT) à partir de l'état courant. */
export async function renderMemoPdf(memo: any): Promise<Buffer> {
    const [stepRows] = await db.query(
        `SELECT s.step_no, s.kind, s.status, s.acted_by_email, s.acted_at, s.comment, p.label AS position_label,
                sg.image_path
         FROM memo_steps s JOIN memo_positions p ON p.id = s.position_id
              LEFT JOIN user_signatures sg ON sg.id = s.signature_id
         WHERE s.memo_id = ? AND s.revision_no = ? ORDER BY s.step_no`,
        [memo.id, memo.revision_no]
    );
    const steps = [];
    for (const s of ((stepRows as any[]) || [])) {
        let signature: Buffer | null = null;
        if (s.image_path) { try { signature = await readSignaturePng(s.image_path); } catch { signature = null; } }
        steps.push({ ...s, signature });
    }
    const [attRows] = await db.query(
        `SELECT original_name, size_bytes, sha256 FROM memo_attachments WHERE memo_id = ? AND revision_no = ? ORDER BY id`,
        [memo.id, memo.revision_no]
    );
    return buildMemoPdf({ memo, steps, attachments: (attRows as any[]) || [] });
}

export const pdfFileName = (memo: any): string =>
    `${memo.reference ? String(memo.reference).replace(/[^A-Za-z0-9]+/g, '-') : `memo-${memo.id}-draft`}.pdf`;

/**
 * Archive le PDF final d'un mémo décaissé (une seule fois). Renvoie null si le mémo n'est pas
 * `released` ou déjà archivé. Peut lever une exception : l'appelant décide s'il est bloquant.
 */
export async function archiveFinalPdf(memoId: number): Promise<{ sha256: string; relPath: string } | null> {
    const [rows] = await db.query(MEMO_PDF_SELECT, [memoId]);
    const memo = (rows as any[])[0];
    if (!memo) throw new NotFoundException('Memo not found');
    if (memo.status !== 'released' || memo.pdf_path) return null;

    const pdf = await renderMemoPdf(memo);
    const sha256 = crypto.createHash('sha256').update(pdf).digest('hex');
    const relPath = path.posix.join('final-pdfs', `${sha256}.pdf`);
    const abs = path.join(storageRoot(), relPath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, pdf, { mode: 0o600 });

    // `AND pdf_path IS NULL` : si deux requêtes arrivent ensemble, une seule archive gagne.
    const [upd] = await db.query(
        'UPDATE memos SET pdf_path = ?, pdf_sha256 = ? WHERE id = ? AND status = ? AND pdf_path IS NULL',
        [relPath, sha256, memoId, 'released']
    );
    if (!(upd as any).affectedRows) return null;

    await db.transaction(async tx => recordMemoEvent(tx as any, {
        memo_id: memoId, revision_no: memo.revision_no, event_type: 'pdf_archived',
        payload: { sha256, bytes: pdf.length },
    }));
    logger.info(`Memo #${memoId}: final PDF archived (${sha256.slice(0, 12)}…)`, 'MEMOS');
    return { sha256, relPath };
}

/** Relit le PDF archivé et vérifie son empreinte. Lève si le fichier manque ou a été altéré. */
export async function readArchivedPdf(memo: { pdf_path: string; pdf_sha256: string }): Promise<Buffer> {
    const data = await readAttachment(memo.pdf_path);
    const actual = crypto.createHash('sha256').update(data).digest('hex');
    if (actual !== memo.pdf_sha256) {
        throw new Error('The archived PDF does not match its recorded fingerprint');
    }
    return data;
}
