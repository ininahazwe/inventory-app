// server/src/services/memoPdf.ts
// PDF officiel d'un mémo : en-tête, corps, pièces jointes, puis le bloc de
// signatures (une case par niveau du circuit, avec l'image de signature figée à
// l'étape, l'identité, l'horodatage et le commentaire) et un tampon d'état.
// Pied de page : empreinte SHA-256 du contenu, pour retrouver une copie modifiée.
// Fonction pure : elle reçoit les données et les images déjà chargées, ne touche
// ni la base ni le disque — c'est la route qui les prépare.
import PDFDocument from 'pdfkit';
import crypto from 'crypto';

export type PdfStep = {
    step_no: number;
    kind: string;                  // submit | recommend | approve | release
    position_label: string;
    status: string;                // pending | active | done | returned | rejected | refused | skipped
    acted_by_email: string | null;
    acted_at: string | Date | null;
    comment: string | null;
    signature: Buffer | null;
};

export type PdfMemo = {
    id: number;
    reference: string | null;
    type_name: string;
    status: string;
    revision_no: number;
    to_label: string;
    from_label: string;
    subject: string;
    body: string | null;
    memo_date: string | Date | null;
    amount: string | number | null;
    currency: string | null;
    project_code: string | null;
    project_title: string | null;
    activity_ref: string | null;
    release_reference: string | null;
    author_email: string;
};

export type PdfAttachment = { original_name: string; size_bytes: number; sha256: string };

/** Empreinte du contenu rédigé : change dès qu'un champ imprimé change. */
export function memoFingerprint(m: PdfMemo): string {
    const canonical = JSON.stringify([
        m.reference, m.revision_no, m.to_label, m.from_label, String(m.memo_date || '').slice(0, 10),
        m.subject, m.body || '', m.amount == null ? null : Number(m.amount), m.currency,
        m.project_code, m.activity_ref,
    ]);
    return crypto.createHash('sha256').update(canonical).digest('hex');
}

// Les polices intégrées de PDF (Helvetica) couvrent le Latin-1 + quelques signes
// Windows-1252 ; le reste (flèches, emojis) s'imprimerait en bouillie.
const printable = (s: unknown): string =>
    String(s ?? '')
        .replace(/→/g, '->').replace(/…/g, '...')
        .replace(/[^\u0009\u000a -ÿ‘’“”–—•€]/g, '?');

const fmtDate = (v: string | Date | null) =>
    v ? new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const fmtDateTime = (v: string | Date | null) =>
    v ? new Date(v).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC' : '—';

const KIND_VERB: Record<string, string> = { submit: 'Submitted', recommend: 'Recommended', approve: 'Approved', release: 'Released' };

const STAMP: Record<string, { text: string; color: string } | undefined> = {
    approved: { text: 'APPROVED', color: '#15803d' },
    released: { text: 'RELEASED', color: '#15803d' },
    rejected: { text: 'REJECTED', color: '#b91c1c' },
    release_refused: { text: 'RELEASE REFUSED', color: '#c2410c' },
    withdrawn: { text: 'WITHDRAWN', color: '#6b7280' },
};

const NOT_FINAL: Record<string, string> = {
    draft: 'DRAFT - NOT VALID',
    in_review: 'IN REVIEW - SIGNATURES PENDING',
    returned: 'RETURNED FOR CHANGES - NOT VALID',
};

export function buildMemoPdf(input: { memo: PdfMemo; steps: PdfStep[]; attachments: PdfAttachment[]; generatedAt?: Date }): Promise<Buffer> {
    const { memo, steps, attachments } = input;
    const generatedAt = input.generatedAt || new Date();

    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({
            size: 'A4', margin: 50, bufferPages: true,
            info: { Title: printable(memo.subject) || 'Memo', Author: memo.author_email, Subject: memo.reference || 'Memo draft' },
        });
        const chunks: Buffer[] = [];
        doc.on('data', c => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        const L = doc.page.margins.left;
        const W = doc.page.width - L - doc.page.margins.right;
        const ensure = (h: number) => { if (doc.y + h > doc.page.height - doc.page.margins.bottom - 30) doc.addPage(); };

        // ── En-tête ──────────────────────────────────────────────
        doc.font('Helvetica-Bold').fontSize(11).fillColor('#111827').text('MFWA', L, 50);
        doc.font('Helvetica').fontSize(9).fillColor('#6b7280')
            .text(printable(memo.type_name), L, 50, { width: W, align: 'right' })
            .text(printable(memo.reference || 'No reference yet'), L, 63, { width: W, align: 'right' });
        doc.moveTo(L, 82).lineTo(L + W, 82).strokeColor('#d1d5db').lineWidth(0.7).stroke();
        doc.font('Helvetica-Bold').fontSize(18).fillColor('#111827').text('MEMORANDUM', L, 96, { width: W, align: 'center', characterSpacing: 3 });

        const banner = NOT_FINAL[memo.status];
        doc.y = 126;
        if (banner) {
            doc.font('Helvetica-Bold').fontSize(9).fillColor('#b45309').text(banner, L, doc.y, { width: W, align: 'center' });
            doc.moveDown(0.6);
        }

        // ── Champs ───────────────────────────────────────────────
        const rows: Array<[string, string]> = [
            ['TO', memo.to_label], ['FROM', memo.from_label], ['DATE', fmtDate(memo.memo_date)], ['SUBJECT', memo.subject],
        ];
        if (memo.project_code) rows.push(['PROJECT', `${memo.project_code}${memo.project_title ? ' - ' + memo.project_title : ''}`]);
        if (memo.activity_ref) rows.push(['ACTIVITY', memo.activity_ref]);
        if (memo.amount != null && memo.amount !== '') {
            rows.push(['AMOUNT', `${Number(memo.amount).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${memo.currency || ''}`.trim()]);
        }
        if (memo.release_reference) rows.push(['PAYMENT REF.', memo.release_reference]);
        doc.moveDown(0.5);
        for (const [k, v] of rows) {
            const y = doc.y;
            doc.font('Helvetica').fontSize(9).fillColor('#6b7280').text(k, L, y + 1, { width: 80 });
            doc.font(k === 'SUBJECT' ? 'Helvetica-Bold' : 'Helvetica').fontSize(10.5).fillColor('#111827')
                .text(printable(v) || '—', L + 90, y, { width: W - 90 });
            doc.moveDown(0.25);
        }
        doc.moveDown(0.3);
        doc.moveTo(L, doc.y).lineTo(L + W, doc.y).strokeColor('#d1d5db').stroke();
        doc.moveDown(0.8);

        // ── Corps ────────────────────────────────────────────────
        doc.font('Helvetica').fontSize(10.5).fillColor('#111827').text(printable(memo.body) || '', L, doc.y, { width: W, align: 'left', lineGap: 2 });

        // ── Pièces jointes ───────────────────────────────────────
        if (attachments.length) {
            ensure(30 + attachments.length * 13);
            doc.moveDown(1);
            doc.font('Helvetica-Bold').fontSize(9).fillColor('#374151').text('ATTACHMENTS', L, doc.y);
            doc.font('Helvetica').fontSize(9).fillColor('#374151');
            for (const a of attachments) {
                const kb = Math.max(1, Math.round(a.size_bytes / 1024));
                doc.text(`- ${printable(a.original_name)}  (${kb} KB, sha256 ${a.sha256.slice(0, 12)}...)`, L, doc.y, { width: W });
            }
        }

        // ── Bloc de signatures ───────────────────────────────────
        const BOX_H = 92;
        const COLS = 2;
        const GAP = 14;
        const BOX_W = (W - GAP * (COLS - 1)) / COLS;
        ensure(40 + BOX_H);
        doc.moveDown(1.2);
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#374151').text('SIGNATURES', L, doc.y);
        doc.moveDown(0.4);

        let col = 0;
        let rowTop = doc.y;
        for (const s of steps) {
            if (col === 0) {
                if (rowTop + BOX_H > doc.page.height - doc.page.margins.bottom - 30) { doc.addPage(); rowTop = doc.page.margins.top; }
            }
            const x = L + col * (BOX_W + GAP);
            const done = s.status === 'done';
            doc.roundedRect(x, rowTop, BOX_W, BOX_H, 4).lineWidth(0.8).strokeColor(done ? '#9ca3af' : '#e5e7eb').stroke();
            doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#374151').text(printable(s.position_label).toUpperCase(), x + 8, rowTop + 7, { width: BOX_W - 16 });
            if (done) {
                if (s.signature) {
                    try { doc.image(s.signature, x + 8, rowTop + 20, { fit: [BOX_W - 16, 36] }); } catch { /* image illisible : on garde l'identité */ }
                }
                doc.font('Helvetica').fontSize(8).fillColor('#111827')
                    .text(`${KIND_VERB[s.kind] || 'Done'} by ${printable(s.acted_by_email)}`, x + 8, rowTop + 60, { width: BOX_W - 16, lineBreak: false, ellipsis: true })
                    .fillColor('#6b7280').text(fmtDateTime(s.acted_at), x + 8, rowTop + 71, { width: BOX_W - 16, lineBreak: false });
                if (s.comment) doc.fillColor('#6b7280').text(`"${printable(s.comment)}"`, x + 8, rowTop + 81, { width: BOX_W - 16, lineBreak: false, ellipsis: true });
            } else {
                const label = s.status === 'active' ? 'Awaiting signature' : s.status === 'pending' ? 'Pending' : s.status === 'skipped' ? 'Not reached' : s.status.charAt(0).toUpperCase() + s.status.slice(1);
                doc.font('Helvetica-Oblique').fontSize(9).fillColor('#9ca3af').text(label, x + 8, rowTop + 40, { width: BOX_W - 16 });
                if (s.acted_by_email) doc.font('Helvetica').fontSize(8).fillColor('#6b7280').text(`by ${printable(s.acted_by_email)} - ${fmtDateTime(s.acted_at)}`, x + 8, rowTop + 62, { width: BOX_W - 16 });
                if (s.comment) doc.font('Helvetica').fontSize(8).fillColor('#6b7280').text(`"${printable(s.comment)}"`, x + 8, rowTop + 74, { width: BOX_W - 16, lineBreak: false, ellipsis: true });
            }
            col += 1;
            if (col === COLS) { col = 0; rowTop += BOX_H + 10; }
        }
        if (col !== 0) rowTop += BOX_H + 10;
        doc.y = rowTop;

        // ── Tampon d'état ────────────────────────────────────────
        const stamp = STAMP[memo.status];
        if (stamp) {
            const lastActed = [...steps].reverse().find(s => s.acted_at);
            ensure(70);
            const sx = L + W - 190;
            const sy = Math.max(doc.y + 6, 120);
            doc.save();
            doc.rotate(-8, { origin: [sx + 90, sy + 25] });
            doc.roundedRect(sx, sy, 180, 50, 5).lineWidth(2).strokeColor(stamp.color).stroke();
            doc.font('Helvetica-Bold').fontSize(16).fillColor(stamp.color).text(stamp.text, sx, sy + 8, { width: 180, align: 'center', lineBreak: false });
            doc.font('Helvetica').fontSize(8).text(`${fmtDate(lastActed?.acted_at || null)}${memo.reference ? ' - ' + memo.reference : ''}`, sx, sy + 32, { width: 180, align: 'center', lineBreak: false });
            doc.restore();
        }

        // ── Pied de page sur chaque page ─────────────────────────
        const fp = memoFingerprint(memo);
        const range = doc.bufferedPageRange();
        for (let i = 0; i < range.count; i++) {
            doc.switchToPage(range.start + i);
            const saved = doc.page.margins.bottom;
            doc.page.margins.bottom = 0;            // sinon pdfkit saute une page pour écrire sous la marge
            doc.font('Helvetica').fontSize(7).fillColor('#9ca3af');
            doc.text(
                `${memo.reference || 'Draft'} - revision ${memo.revision_no} - content fingerprint ${fp.slice(0, 24)} - generated ${fmtDateTime(generatedAt)}`,
                L, doc.page.height - 38, { width: W, align: 'left', lineBreak: false });
            doc.text(`Page ${i + 1} / ${range.count}`, L, doc.page.height - 38, { width: W, align: 'right', lineBreak: false });
            doc.page.margins.bottom = saved;
        }

        doc.end();
    });
}
