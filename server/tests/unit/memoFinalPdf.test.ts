// tests/unit/memoFinalPdf.test.ts
// Archivage du PDF final au décaissement : DB mockée, vrai système de fichiers (dossier temporaire).
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { db } from '../../src/database/connection';
import { archiveFinalPdf, readArchivedPdf, pdfFileName } from '../../src/services/memoFinalPdf';

const query = db.query as jest.Mock;
const execute = db.execute as jest.Mock;
const rows = (r: any[]) => [r, []];

const released = (o: Record<string, any> = {}) => ({
    id: 5, reference: 'MFWA/MEMO/2026/0012', type_name: 'Request for funds', status: 'released', revision_no: 1,
    to_label: 'Director', from_label: 'Agent', subject: 'Fire certificate', body: 'Please release.', memo_date: '2026-10-20',
    amount: 100, currency: 'USD', project_code: null, project_title: null, activity_ref: null,
    release_reference: 'PAY-1', author_email: 'agent@mfwa.org', pdf_path: null, pdf_sha256: null, ...o,
});

let dir: string;
beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memo-final-')); process.env.MEMO_STORAGE_DIR = dir; });
afterAll(() => { delete process.env.MEMO_STORAGE_DIR; fs.rmSync(dir, { recursive: true, force: true }); });
beforeEach(() => { query.mockReset(); execute.mockReset(); execute.mockResolvedValue([{ affectedRows: 1, insertId: 1 }, []]); });

describe('archiveFinalPdf', () => {
    it('renders once, stores the file under its SHA-256, records path + fingerprint and a journal event', async () => {
        query
            .mockResolvedValueOnce(rows([released()]))      // mémo
            .mockResolvedValueOnce(rows([]))                // pas
            .mockResolvedValueOnce(rows([]))                // pièces
            .mockResolvedValueOnce([{ affectedRows: 1 }, []]);   // UPDATE memos

        const r = await archiveFinalPdf(5);
        expect(r).not.toBeNull();
        expect(r!.relPath).toBe(`final-pdfs/${r!.sha256}.pdf`);

        const file = fs.readFileSync(path.join(dir, r!.relPath));
        expect(file.subarray(0, 5).toString()).toBe('%PDF-');
        expect(crypto.createHash('sha256').update(file).digest('hex')).toBe(r!.sha256);

        const [updSql, updParams] = query.mock.calls[3];
        expect(updSql).toContain('pdf_path IS NULL');
        expect(updParams).toEqual([r!.relPath, r!.sha256, 5, 'released']);
        expect(execute.mock.calls[0][0]).toContain('INSERT INTO memo_events');
        expect(execute.mock.calls[0][1]).toContain('pdf_archived');
    });

    it('does nothing for a memo that is not released, or already archived', async () => {
        query.mockResolvedValueOnce(rows([released({ status: 'approved' })]));
        expect(await archiveFinalPdf(5)).toBeNull();
        query.mockResolvedValueOnce(rows([released({ pdf_path: 'final-pdfs/x.pdf', pdf_sha256: 'x' })]));
        expect(await archiveFinalPdf(5)).toBeNull();
        expect(query).toHaveBeenCalledTimes(2);          // pas de rendu : seulement les deux lectures du mémo
    });

    it('when another request archived first (UPDATE matches no row), it reports nothing and adds no event', async () => {
        query
            .mockResolvedValueOnce(rows([released()]))
            .mockResolvedValueOnce(rows([]))
            .mockResolvedValueOnce(rows([]))
            .mockResolvedValueOnce([{ affectedRows: 0 }, []]);
        expect(await archiveFinalPdf(5)).toBeNull();
        expect(execute).not.toHaveBeenCalled();
    });

    it('404 for an unknown memo', async () => {
        query.mockResolvedValueOnce(rows([]));
        await expect(archiveFinalPdf(99)).rejects.toMatchObject({ statusCode: 404 });
    });
});

describe('readArchivedPdf', () => {
    const store = (content: Buffer) => {
        const sha = crypto.createHash('sha256').update(content).digest('hex');
        const rel = `final-pdfs/${sha}.pdf`;
        fs.mkdirSync(path.join(dir, 'final-pdfs'), { recursive: true });
        fs.writeFileSync(path.join(dir, rel), content);
        return { pdf_path: rel, pdf_sha256: sha };
    };

    it('returns the stored bytes when the fingerprint matches', async () => {
        const content = Buffer.from('%PDF-1.4 final');
        expect((await readArchivedPdf(store(content))).equals(content)).toBe(true);
    });

    it('refuses a file that was altered after archiving', async () => {
        const m = store(Buffer.from('%PDF-1.4 original'));
        fs.writeFileSync(path.join(dir, m.pdf_path), Buffer.from('%PDF-1.4 tampered'));
        await expect(readArchivedPdf(m)).rejects.toThrow(/fingerprint/);
    });

    it('404 when the file is missing', async () => {
        await expect(readArchivedPdf({ pdf_path: 'final-pdfs/missing.pdf', pdf_sha256: 'a'.repeat(64) })).rejects.toMatchObject({ statusCode: 404 });
    });
});

describe('pdfFileName', () => {
    it('is derived from the reference, or marked draft', () => {
        expect(pdfFileName({ id: 5, reference: 'MFWA/MEMO/2026/0012' })).toBe('MFWA-MEMO-2026-0012.pdf');
        expect(pdfFileName({ id: 7, reference: null })).toBe('memo-7-draft.pdf');
    });
});
