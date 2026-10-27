// tests/unit/memoPdf.test.ts
import { buildMemoPdf, memoFingerprint, type PdfMemo, type PdfStep } from '../../src/services/memoPdf';

// PNG 1×1 valide
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

const memo = (o: Partial<PdfMemo> = {}): PdfMemo => ({
    id: 5, reference: 'MFWA/MEMO/2026/0012', type_name: 'Request for funds', status: 'approved', revision_no: 1,
    to_label: 'The Director', from_label: 'Agent Smith', subject: 'Certificat de sécurité incendie', body: 'Please approve — thank you.',
    memo_date: '2026-10-20', amount: 2855.39, currency: 'USD', project_code: 'P-12', project_title: 'Safety', activity_ref: null,
    release_reference: null, author_email: 'agent@mfwa.org', ...o,
});
const step = (no: number, kind: string, label: string, status: string, o: Partial<PdfStep> = {}): PdfStep => ({
    step_no: no, kind, position_label: label, status, acted_by_email: status === 'done' ? `${label.toLowerCase()}@mfwa.org` : null,
    acted_at: status === 'done' ? '2026-10-21T09:30:00Z' : null, comment: null, signature: status === 'done' ? PNG : null, ...o,
});
const chain = [
    step(0, 'submit', 'Agent', 'done'), step(1, 'recommend', 'Manager', 'done'),
    step(2, 'approve', 'Director', 'done'), step(3, 'release', 'Finance', 'pending'),
];

const pages = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type \/Page(?!s)/g) || []).length;

describe('buildMemoPdf', () => {
    it('produces a well-formed PDF with signatures and stamp', async () => {
        const pdf = await buildMemoPdf({ memo: memo(), steps: chain, attachments: [{ original_name: 'budget.xlsx', size_bytes: 20480, sha256: 'a'.repeat(64) }] });
        expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
        expect(pdf.subarray(-8).toString()).toContain('%%EOF');
        expect(pdf.length).toBeGreaterThan(2000);
        expect(pages(pdf)).toBe(1);
    });

    it('survives characters the built-in font cannot print, and a missing signature image', async () => {
        const pdf = await buildMemoPdf({
            memo: memo({ subject: 'Fonds → projet 🚀', body: 'été ✓ 日本' }),
            steps: [step(0, 'submit', 'Agent', 'done', { signature: Buffer.from('not a png') })],
            attachments: [],
        });
        expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    });

    it('flows a long body over several pages and numbers them', async () => {
        const body = Array.from({ length: 140 }, (_, i) => `Line ${i + 1}: lorem ipsum dolor sit amet.`).join('\n');
        const pdf = await buildMemoPdf({ memo: memo({ body }), steps: chain, attachments: [] });
        expect(pages(pdf)).toBeGreaterThanOrEqual(3);
    });

    it('renders every state (draft, in review, returned, rejected, refused, withdrawn, released)', async () => {
        for (const status of ['draft', 'in_review', 'returned', 'rejected', 'release_refused', 'withdrawn', 'released']) {
            const pdf = await buildMemoPdf({ memo: memo({ status, reference: status === 'draft' ? null : 'MFWA/MEMO/2026/0001' }), steps: chain, attachments: [] });
            expect(pdf.length).toBeGreaterThan(1500);
        }
    });
});

describe('memoFingerprint', () => {
    it('is stable for the same content and changes when a printed field changes', () => {
        expect(memoFingerprint(memo())).toBe(memoFingerprint(memo()));
        expect(memoFingerprint(memo())).toMatch(/^[0-9a-f]{64}$/);
        for (const change of [{ body: 'Please approve — thanks.' }, { amount: 2855.4 }, { subject: 'Other' }, { revision_no: 2 }]) {
            expect(memoFingerprint(memo(change))).not.toBe(memoFingerprint(memo()));
        }
    });

    it('does not depend on the status (a stamp is not content)', () => {
        expect(memoFingerprint(memo({ status: 'released' }))).toBe(memoFingerprint(memo({ status: 'approved' })));
    });
});
