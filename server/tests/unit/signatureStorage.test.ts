// tests/unit/signatureStorage.test.ts
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
    parsePngDataUrl,
    saveSignaturePng,
    readSignaturePng,
    MAX_SIGNATURE_BYTES,
} from '../../src/services/signatureStorage';

// PNG 1×1 valide (70 octets)
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const png = () => Buffer.from(PNG_B64, 'base64');
const url = (b: Buffer) => `data:image/png;base64,${b.toString('base64')}`;

describe('parsePngDataUrl', () => {
    it('accepts a valid PNG data URL', () => {
        expect(parsePngDataUrl(url(png())).equals(png())).toBe(true);
    });

    it('refuses anything that is not a PNG data URL (400)', () => {
        for (const bad of [undefined, 42, '', 'data:image/svg+xml;base64,PHN2Zy8+', 'data:image/jpeg;base64,AAAA', 'not a url']) {
            expect(() => parsePngDataUrl(bad)).toThrow(expect.objectContaining({ statusCode: 400 }));
        }
    });

    it('refuses bytes that only claim to be a PNG', () => {
        expect(() => parsePngDataUrl(url(Buffer.alloc(100, 1)))).toThrow(/valid PNG/);
    });

    it('refuses an image that is too large in bytes or in pixels', () => {
        expect(() => parsePngDataUrl(url(Buffer.concat([png(), Buffer.alloc(MAX_SIGNATURE_BYTES)])))).toThrow(/too large/);
        const wide = Buffer.from(png());
        wide.writeUInt32BE(5000, 16);       // largeur dans l'IHDR
        expect(() => parsePngDataUrl(url(wide))).toThrow(/pixels/);
    });
});

describe('saveSignaturePng / readSignaturePng', () => {
    let dir: string;
    beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memo-sig-unit-')); process.env.MEMO_STORAGE_DIR = dir; });
    afterAll(() => { delete process.env.MEMO_STORAGE_DIR; fs.rmSync(dir, { recursive: true, force: true }); });

    it('names the file after its SHA-256 and reads it back', async () => {
        const { relPath, sha256 } = await saveSignaturePng(png());
        expect(relPath).toBe(`signatures/${sha256}.png`);
        expect(sha256).toMatch(/^[0-9a-f]{64}$/);
        expect((await readSignaturePng(relPath)).equals(png())).toBe(true);
    });

    it('storing the same image twice yields the same file (content-addressed)', async () => {
        const a = await saveSignaturePng(png());
        const b = await saveSignaturePng(png());
        expect(a).toEqual(b);
    });

    it('never reads outside the storage folder (404)', async () => {
        await expect(readSignaturePng('../../etc/passwd')).rejects.toMatchObject({ statusCode: 404 });
        await expect(readSignaturePng('signatures/missing.png')).rejects.toMatchObject({ statusCode: 404 });
    });
});
