// tests/unit/attachmentStorage.test.ts
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
    validateAttachment, saveAttachment, readAttachment, MAX_ATTACHMENT_BYTES,
} from '../../src/services/attachmentStorage';

const pdf = () => Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(50, 1)]);

describe('validateAttachment', () => {
    it('accepts a PDF whose bytes match its type', () => {
        const f = validateAttachment('Budget Q4.pdf', 'application/pdf', pdf());
        expect(f).toMatchObject({ name: 'Budget Q4.pdf', mime: 'application/pdf' });
    });

    it('decodes the URI-encoded name and strips any path', () => {
        const f = validateAttachment(encodeURIComponent('../../etc/reçu final.pdf'), 'application/pdf', pdf());
        expect(f.name).toBe('reçu final.pdf');
    });

    it('refuses a type outside the allow-list (400)', () => {
        for (const t of ['text/html', 'image/svg+xml', 'application/x-msdownload', '']) {
            expect(() => validateAttachment('a.bin', t, pdf())).toThrow(expect.objectContaining({ statusCode: 400 }));
        }
    });

    it('refuses bytes that only claim to be a PDF or a PNG', () => {
        expect(() => validateAttachment('a.pdf', 'application/pdf', Buffer.from('<html>nope</html>'))).toThrow(/does not match/);
        expect(() => validateAttachment('a.png', 'image/png', pdf())).toThrow(/does not match/);
    });

    it('refuses empty, oversized and nameless files', () => {
        expect(() => validateAttachment('a.pdf', 'application/pdf', Buffer.alloc(0))).toThrow(/empty/);
        expect(() => validateAttachment('a.pdf', 'application/pdf', Buffer.concat([pdf(), Buffer.alloc(MAX_ATTACHMENT_BYTES)]))).toThrow(/too large/);
        expect(() => validateAttachment('', 'application/pdf', pdf())).toThrow(/name/);
    });

    it('accepts CSV (text) without a binary signature check', () => {
        expect(validateAttachment('lines.csv', 'text/csv; charset=utf-8', Buffer.from('a,b\n1,2\n')).mime).toBe('text/csv');
    });
});

describe('saveAttachment / readAttachment', () => {
    let dir: string;
    beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memo-att-unit-')); process.env.MEMO_STORAGE_DIR = dir; });
    afterAll(() => { delete process.env.MEMO_STORAGE_DIR; fs.rmSync(dir, { recursive: true, force: true }); });

    it('names the file after its SHA-256 and reads it back', async () => {
        const { relPath, sha256 } = await saveAttachment(pdf());
        expect(relPath).toBe(`attachments/${sha256}`);
        expect((await readAttachment(relPath)).equals(pdf())).toBe(true);
    });

    it('never reads outside the storage folder (404)', async () => {
        await expect(readAttachment('../../etc/passwd')).rejects.toMatchObject({ statusCode: 404 });
        await expect(readAttachment('attachments/missing')).rejects.toMatchObject({ statusCode: 404 });
    });
});
