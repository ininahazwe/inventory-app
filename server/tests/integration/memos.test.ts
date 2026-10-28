// tests/integration/memos.test.ts
// Vraie app Express, DB / auth / Gmail mockés (comme loans.test.ts). Couvre la couche
// HTTP du module mémos : périmètre de lecture imposé côté serveur, codes de statut,
// droits admin, signature, et un parcours de décision de bout en bout. La logique
// d'états fine est testée dans tests/unit/memoService.test.ts.
import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createTestApp, mockRows, mockOk, asUser } from '../helpers/testApp';
import { db } from '../../src/database/connection';
import { notifyMemoEvent } from '../../src/services/memoMailer';
import crypto from 'crypto';

// Les e-mails ont leurs propres tests (unit/memoMailer) : ici on vérifie seulement qu'ils sont déclenchés.
jest.mock('../../src/services/memoMailer', () => ({
    notifyMemoEvent: jest.fn().mockResolvedValue(undefined),
    checkMemosWaiting: jest.fn(),
}));

const mockedExecute = db.execute as jest.Mock;
const mockedQuery = db.query as jest.Mock;

const AUTHOR = { uid: 'u-1' as any, email: 'agent@mfwa.org', role: 'user' };
const MANAGER = { uid: 'u-2' as any, email: 'manager@mfwa.org', role: 'user' };
const STRANGER = { uid: 'u-9' as any, email: 'stranger@mfwa.org', role: 'user' };
const ADMIN = { uid: 'u-0' as any, email: 'admin@mfwa.org', role: 'admin' };

const memoRow = (o: Record<string, any> = {}) => ({
    id: 5, reference: 'MFWA/MEMO/2026/0012', type_id: 1, template_id: 1, author_email: AUTHOR.email,
    subject: 'Request for funds', body: '…', status: 'in_review', revision_no: 1, current_step_no: 1, ...o,
});
const stepRow = (no: number, kind: string, pos: number, status: string, label = 'Manager') => ({
    id: 100 + no, memo_id: 5, revision_no: 1, step_no: no, kind, position_id: pos, label: `${kind}`, status, position_label: label,
});

// PNG 1×1 valide
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const PNG_URL = `data:image/png;base64,${PNG_B64}`;

beforeEach(() => { mockedExecute.mockReset(); mockedQuery.mockReset(); });

describe('GET /api/memos', () => {
    const app = createTestApp();

    it('rejects an unknown scope (400) without touching the database', async () => {
        const res = await request(app).get('/api/memos?scope=bogus').set(asUser(AUTHOR));
        expect(res.status).toBe(400);
        expect(mockedQuery).not.toHaveBeenCalled();
    });

    it('a user only ever sees their own memos or those of a level they hold — enforced in SQL', async () => {
        mockedQuery.mockResolvedValueOnce(mockRows([]));
        await request(app).get('/api/memos?scope=all').set(asUser(AUTHOR));
        const [sql, params] = mockedQuery.mock.calls[0];
        expect(sql).toContain('m.author_email = ? OR 0 OR');   // pas de clause admin
        expect(sql).toContain('memo_position_holders');
        expect(params.slice(0, 3)).toEqual([AUTHOR.email, AUTHOR.email, AUTHOR.email]);
    });

    it('an admin sees every memo except drafts', async () => {
        mockedQuery.mockResolvedValueOnce(mockRows([]));
        await request(app).get('/api/memos?scope=all').set(asUser(ADMIN));
        expect(mockedQuery.mock.calls[0][0]).toContain(`OR m.status <> 'draft' OR`);
    });

    it('« to_act » restricts to steps the user can decide and excludes their own memos', async () => {
        mockedQuery.mockResolvedValueOnce(mockRows([{ id: 5 }]));
        const res = await request(app).get('/api/memos?scope=to_act').set(asUser(MANAGER));
        expect(res.status).toBe(200);
        const [sql, params] = mockedQuery.mock.calls[0];
        expect(sql).toContain('m.author_email <> ?');
        expect(sql).toContain(`s.status = 'active'`);
        expect(params.slice(-3)).toEqual([MANAGER.email, MANAGER.email, MANAGER.email]);
    });
});

describe('GET /api/memos/:id', () => {
    const app = createTestApp();

    it('returns 403 to someone who is neither author, admin, holder nor actor', async () => {
        mockedQuery.mockResolvedValueOnce(mockRows([memoRow()]));
        mockedExecute.mockResolvedValueOnce(mockRows([]));          // canViewMemo → aucun pas lié à lui
        const res = await request(app).get('/api/memos/5').set(asUser(STRANGER));
        expect(res.status).toBe(403);
    });

    it('returns 404 for an unknown memo and 400 for a non-numeric id', async () => {
        mockedQuery.mockResolvedValueOnce(mockRows([]));
        expect((await request(app).get('/api/memos/99').set(asUser(AUTHOR))).status).toBe(404);
        expect((await request(app).get('/api/memos/abc').set(asUser(AUTHOR))).status).toBe(400);
    });

    it('gives the author the memo, its steps, events and what they can do', async () => {
        mockedQuery
            .mockResolvedValueOnce(mockRows([memoRow()]))                                  // memo
            .mockResolvedValueOnce(mockRows([stepRow(0, 'submit', 1, 'done', 'Agent'), stepRow(1, 'recommend', 2, 'active')]))
            .mockResolvedValueOnce(mockRows([]))                                           // attachments
            .mockResolvedValueOnce(mockRows([{ id: 1, event_type: 'submitted' }]))         // events
            .mockResolvedValueOnce(mockRows([]));                                          // niveaux détenus
        const res = await request(app).get('/api/memos/5').set(asUser(AUTHOR));
        expect(res.status).toBe(200);
        expect(res.body.steps).toHaveLength(2);
        expect(res.body.capabilities).toMatchObject({ edit: false, withdraw: true, decide: false, waiting_for: 'Manager' });
    });

    it('tells the holder of the active level that they can decide', async () => {
        mockedQuery
            .mockResolvedValueOnce(mockRows([memoRow()]))
            .mockResolvedValueOnce(mockRows([stepRow(0, 'submit', 1, 'done', 'Agent'), stepRow(1, 'recommend', 2, 'active')]))
            .mockResolvedValueOnce(mockRows([]))
            .mockResolvedValueOnce(mockRows([]))
            .mockResolvedValueOnce(mockRows([{ position_id: 2 }]));
        mockedExecute.mockResolvedValueOnce(mockRows([{ 1: 1 }]));                          // canViewMemo : titulaire
        const res = await request(app).get('/api/memos/5').set(asUser(MANAGER));
        expect(res.status).toBe(200);
        expect(res.body.capabilities.decide).toBe(true);
    });
});

describe('writes', () => {
    const app = createTestApp();

    it('POST /api/memos requires a type (400) and creates a draft (201)', async () => {
        expect((await request(app).post('/api/memos').set(asUser(AUTHOR)).send({ subject: 'x' })).status).toBe(400);

        mockedExecute
            .mockResolvedValueOnce(mockRows([{ id: 1, is_active: 1 }]))
            .mockResolvedValueOnce(mockRows([{ id: 7 }]))
            .mockResolvedValueOnce(mockOk({ insertId: 42 }))
            .mockResolvedValueOnce(mockOk());
        const res = await request(app).post('/api/memos').set(asUser(AUTHOR))
            .send({ type_id: 1, subject: 'Fire certificate', amount: 2855.39, currency: 'ghs' });
        expect(res.status).toBe(201);
        expect(res.body).toMatchObject({ id: 42, status: 'draft', template_id: 7 });
    });

    it('PATCH submit by someone other than the author is a 403', async () => {
        mockedExecute.mockResolvedValueOnce(mockRows([memoRow({ status: 'draft' })]));
        const res = await request(app).patch('/api/memos/5/submit').set(asUser(MANAGER));
        expect(res.status).toBe(403);
    });

    it('PATCH decision rejects an unknown decision (400) and a decision on your own memo (403)', async () => {
        expect((await request(app).patch('/api/memos/5/decision').set(asUser(MANAGER)).send({ decision: 'maybe' })).status).toBe(400);

        mockedExecute
            .mockResolvedValueOnce(mockRows([memoRow()]))
            .mockResolvedValueOnce(mockRows([stepRow(0, 'submit', 1, 'done', 'Agent'), stepRow(1, 'recommend', 2, 'active')]));
        const res = await request(app).patch('/api/memos/5/decision').set(asUser(AUTHOR)).send({ decision: 'approve' });
        expect(res.status).toBe(403);
        expect(res.body.error).toContain('own memo');
    });

    it('PATCH decision without a signature answers 400 with the code the client needs', async () => {
        mockedExecute
            .mockResolvedValueOnce(mockRows([memoRow()]))
            .mockResolvedValueOnce(mockRows([stepRow(0, 'submit', 1, 'done', 'Agent'), stepRow(1, 'recommend', 2, 'active')]))
            .mockResolvedValueOnce(mockRows([{ 1: 1 }]))      // titulaire
            .mockResolvedValueOnce(mockRows([]));             // pas de signature
        const res = await request(app).patch('/api/memos/5/decision').set(asUser(MANAGER)).send({ decision: 'approve' });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('SIGNATURE_REQUIRED');
    });

    it('a manager recommends: the memo moves on to the next level and the action is audited', async () => {
        mockedExecute
            .mockResolvedValueOnce(mockRows([memoRow()]))
            .mockResolvedValueOnce(mockRows([
                stepRow(0, 'submit', 1, 'done', 'Agent'), stepRow(1, 'recommend', 2, 'active'), stepRow(2, 'approve', 3, 'pending', 'Director'),
            ]))
            .mockResolvedValueOnce(mockRows([{ 1: 1 }]))                       // titulaire
            .mockResolvedValueOnce(mockRows([{ id: 9, sha256: 'a'.repeat(64) }]))
            .mockResolvedValueOnce(mockOk())                                   // step done
            .mockResolvedValueOnce(mockOk())                                   // next step active
            .mockResolvedValueOnce(mockOk())                                   // memo update
            .mockResolvedValueOnce(mockOk());                                  // event
        mockedQuery.mockResolvedValue(mockOk());                               // audit_log

        const res = await request(app).patch('/api/memos/5/decision').set(asUser(MANAGER)).send({ decision: 'approve', comment: 'ok' });
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ success: true, status: 'in_review' });
        expect(notifyMemoEvent).toHaveBeenCalledWith('decided', 5, MANAGER.email, expect.anything());
        expect(mockedQuery.mock.calls.some(c => /audit_log/.test(c[0]) && c[1].includes('memo_approve'))).toBe(true);
    });

    it('notifies after a successful decision, and not after a refused one', async () => {
        (notifyMemoEvent as jest.Mock).mockClear();
        mockedExecute.mockResolvedValueOnce(mockRows([memoRow()]))
            .mockResolvedValueOnce(mockRows([stepRow(0, 'submit', 1, 'done', 'Agent'), stepRow(1, 'recommend', 2, 'active')]));
        await request(app).patch('/api/memos/5/decision').set(asUser(AUTHOR)).send({ decision: 'approve' });   // 403 : son propre mémo
        expect(notifyMemoEvent).not.toHaveBeenCalled();
    });
});

describe('GET /api/memos/:id/pdf', () => {
    const app = createTestApp();
    const binary = (res: any, cb: any) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); };

    it('is refused (403) to someone who cannot see the memo', async () => {
        mockedQuery.mockResolvedValueOnce(mockRows([memoRow()]));
        mockedExecute.mockResolvedValueOnce(mockRows([]));
        expect((await request(app).get('/api/memos/5/pdf').set(asUser(STRANGER))).status).toBe(403);
    });

    it('is 404 for an unknown memo', async () => {
        mockedQuery.mockResolvedValueOnce(mockRows([]));
        expect((await request(app).get('/api/memos/99/pdf').set(asUser(AUTHOR))).status).toBe(404);
    });

    describe('released memo: the archived final PDF is served as is', () => {
        let dir: string;
        beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memo-pdf-int-')); process.env.MEMO_STORAGE_DIR = dir; });
        afterAll(() => { delete process.env.MEMO_STORAGE_DIR; fs.rmSync(dir, { recursive: true, force: true }); });

        const archived = (content: Buffer): Record<string, any> => {
            const sha = crypto.createHash('sha256').update(content).digest('hex');
            const rel = `final-pdfs/${sha}.pdf`;
            fs.mkdirSync(path.join(dir, 'final-pdfs'), { recursive: true });
            fs.writeFileSync(path.join(dir, rel), content);
            return memoRow({ status: 'released', pdf_path: rel, pdf_sha256: sha });
        };

        it('returns the stored bytes with their fingerprint, without re-rendering', async () => {
            const content = Buffer.from('%PDF-1.4 final archived');
            mockedQuery.mockResolvedValueOnce(mockRows([archived(content)]));
            const res = await request(app).get('/api/memos/5/pdf').set(asUser(AUTHOR)).buffer(true).parse(binary);
            expect(res.status).toBe(200);
            expect((res.body as Buffer).equals(content)).toBe(true);
            expect(res.headers['x-pdf-sha256']).toBe(crypto.createHash('sha256').update(content).digest('hex'));
            expect(mockedQuery).toHaveBeenCalledTimes(1);
        });

        it('refuses (500) rather than serve a file that no longer matches its fingerprint', async () => {
            const row = archived(Buffer.from('%PDF-1.4 original'));
            fs.writeFileSync(path.join(dir, row.pdf_path), Buffer.from('%PDF-1.4 tampered'));
            mockedQuery.mockResolvedValueOnce(mockRows([row]));
            const res = await request(app).get('/api/memos/5/pdf').set(asUser(AUTHOR));
            expect(res.status).toBe(500);
        });
    });

    it('streams a real PDF named after the reference to the author', async () => {
        mockedQuery
            .mockResolvedValueOnce(mockRows([memoRow({ type_name: 'Request for funds', to_label: 'Director', from_label: 'Agent', memo_date: '2026-10-20' })]))
            .mockResolvedValueOnce(mockRows([{ ...stepRow(0, 'submit', 1, 'done', 'Agent'), acted_by_email: AUTHOR.email, image_path: null }, stepRow(1, 'recommend', 2, 'active')]))
            .mockResolvedValueOnce(mockRows([]));
        const res = await request(app).get('/api/memos/5/pdf').set(asUser(AUTHOR)).buffer(true).parse(binary);
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toContain('application/pdf');
        expect(res.headers['content-disposition']).toContain('MFWA-MEMO-2026-0012.pdf');
        expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    });
});

describe('admin: holders per level', () => {
    const app = createTestApp();

    it('is closed to non-admins (403)', async () => {
        const res = await request(app).post('/api/memos/admin/positions/director/holders').set(asUser(AUTHOR)).send({ email: 'x@mfwa.org' });
        expect(res.status).toBe(403);
        expect((await request(app).get('/api/memos/admin/positions').set(asUser(AUTHOR))).status).toBe(403);
    });

    it('adds a holder to an existing level for an existing user (201), audited', async () => {
        mockedQuery
            .mockResolvedValueOnce(mockRows([{ id: 3 }]))                      // niveau
            .mockResolvedValueOnce(mockRows([{ email: 'dir@mfwa.org' }]))      // utilisateur
            .mockResolvedValueOnce(mockOk({ insertId: 4 }))                    // insert
            .mockResolvedValueOnce(mockOk());                                  // audit
        const res = await request(app).post('/api/memos/admin/positions/director/holders').set(asUser(ADMIN))
            .send({ email: ' Dir@MFWA.org ', holder_role: 'deputy' });
        expect(res.status).toBe(201);
        expect(res.body).toMatchObject({ level: 'director', email: 'dir@mfwa.org', holder_role: 'deputy' });
    });

    it('refuses holders on the agent level (400) and unknown users (404)', async () => {
        expect((await request(app).post('/api/memos/admin/positions/agent/holders').set(asUser(ADMIN)).send({ email: 'x@mfwa.org' })).status).toBe(400);

        mockedQuery.mockResolvedValueOnce(mockRows([{ id: 3 }])).mockResolvedValueOnce(mockRows([]));
        expect((await request(app).post('/api/memos/admin/positions/director/holders').set(asUser(ADMIN)).send({ email: 'ghost@mfwa.org' })).status).toBe(404);
    });

    it('deactivates a holder instead of deleting (404 when unknown)', async () => {
        mockedQuery.mockResolvedValueOnce(mockOk()).mockResolvedValueOnce(mockOk());
        expect((await request(app).patch('/api/memos/admin/holders/4').set(asUser(ADMIN)).send({ is_active: false })).status).toBe(200);
        expect(mockedQuery.mock.calls[0][0]).toContain('UPDATE memo_position_holders SET is_active = ?');

        mockedQuery.mockResolvedValueOnce(mockOk({ affectedRows: 0 }));
        expect((await request(app).patch('/api/memos/admin/holders/999').set(asUser(ADMIN)).send({ is_active: false })).status).toBe(404);
    });
});

describe('signature', () => {
    const app = createTestApp();
    let dir: string;
    beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memo-sig-')); process.env.MEMO_STORAGE_DIR = dir; });
    afterAll(() => { delete process.env.MEMO_STORAGE_DIR; fs.rmSync(dir, { recursive: true, force: true }); });

    it('refuses an SVG or a bad source (400)', async () => {
        const svg = 'data:image/svg+xml;base64,PHN2Zy8+';
        expect((await request(app).post('/api/memos/signature').set(asUser(AUTHOR)).send({ image: svg, source: 'drawn' })).status).toBe(400);
        expect((await request(app).post('/api/memos/signature').set(asUser(AUTHOR)).send({ image: PNG_URL, source: 'photo' })).status).toBe(400);
    });

    it('stores a PNG, replaces the previous signature, and serves it back only to its owner', async () => {
        mockedExecute.mockResolvedValueOnce(mockOk()).mockResolvedValueOnce(mockOk({ insertId: 3 }));
        mockedQuery.mockResolvedValueOnce(mockOk());                                   // audit
        const saved = await request(app).post('/api/memos/signature').set(asUser(AUTHOR)).send({ image: PNG_URL, source: 'drawn' });
        expect(saved.status).toBe(201);
        expect(saved.body.id).toBe(3);
        expect(mockedExecute.mock.calls[0][0]).toContain('SET is_active = 0');          // l'ancienne devient inactive, pas supprimée

        const rel = `signatures/${saved.body.sha256}.png`;
        expect(fs.existsSync(path.join(dir, rel))).toBe(true);

        mockedQuery.mockResolvedValueOnce(mockRows([{ image_path: rel }]));
        const img = await request(app).get('/api/memos/signature/image').set(asUser(AUTHOR));
        expect(img.status).toBe(200);
        expect(img.headers['content-type']).toContain('image/png');
        expect(Buffer.from(img.body).equals(Buffer.from(PNG_B64, 'base64'))).toBe(true);
        expect(mockedQuery.mock.calls.slice(-1)[0][1]).toEqual([AUTHOR.email]);         // toujours SA signature
    });

    it('the signature of a step is only visible to people who can see the memo (403 otherwise)', async () => {
        mockedQuery.mockResolvedValueOnce(mockRows([{ id: 5, author_email: AUTHOR.email, status: 'in_review' }]));
        mockedExecute.mockResolvedValueOnce(mockRows([]));
        const res = await request(app).get('/api/memos/5/steps/101/signature').set(asUser(STRANGER));
        expect(res.status).toBe(403);
    });
});

describe('admin: projects, types and chains', () => {
    const app = createTestApp();

    it('is closed to non-admins (403) on every route', async () => {
        for (const [method, url] of [
            ['get', '/api/memos/admin/config'], ['post', '/api/memos/admin/projects'], ['patch', '/api/memos/admin/projects/1'],
            ['post', '/api/memos/admin/types'], ['patch', '/api/memos/admin/types/1'], ['post', '/api/memos/admin/types/1/templates'],
            ['patch', '/api/memos/admin/templates/1'], ['put', '/api/memos/admin/templates/1/chain'],
        ] as const) {
            expect((await (request(app) as any)[method](url).set(asUser(AUTHOR)).send({})).status).toBe(403);
        }
        expect(mockedExecute).not.toHaveBeenCalled();
    });

    it('creates a project (201, audited) and refuses a duplicate code (409)', async () => {
        mockedExecute.mockResolvedValueOnce(mockRows([])).mockResolvedValueOnce(mockOk({ insertId: 7 }));
        mockedQuery.mockResolvedValue(mockOk());
        const res = await request(app).post('/api/memos/admin/projects').set(asUser(ADMIN)).send({ code: 'EU-2026', title: 'Media' });
        expect(res.status).toBe(201);
        expect(res.body.id).toBe(7);

        mockedExecute.mockResolvedValueOnce(mockRows([{ id: 7 }]));
        expect((await request(app).post('/api/memos/admin/projects').set(asUser(ADMIN)).send({ code: 'EU-2026', title: 'Media' })).status).toBe(409);
    });

    it('rejects an invalid chain (400) before touching the database', async () => {
        const res = await request(app).put('/api/memos/admin/templates/3/chain').set(asUser(ADMIN))
            .send({ steps: [{ kind: 'release', position_code: 'finance' }] });
        expect(res.status).toBe(400);
        expect(mockedExecute).not.toHaveBeenCalled();
    });

    it('lists the whole configuration in one call', async () => {
        mockedExecute
            .mockResolvedValueOnce(mockRows([{ id: 1, code: 'funds_request', name: 'Request for funds' }]))
            .mockResolvedValueOnce(mockRows([{ id: 3, type_id: 1, name: 'Standard', is_default: 1, is_active: 1 }]))
            .mockResolvedValueOnce(mockRows([{ template_id: 3, step_no: 1, kind: 'approve', position_code: 'director', holders: 1 }]))
            .mockResolvedValueOnce(mockRows([{ id: 1, code: 'P1' }]))
            .mockResolvedValueOnce(mockRows([{ code: 'manager', label: 'Manager' }]));
        const res = await request(app).get('/api/memos/admin/config').set(asUser(ADMIN));
        expect(res.status).toBe(200);
        expect(res.body.types[0].templates[0].steps).toHaveLength(1);
        expect(res.body.levels).toEqual([{ code: 'manager', label: 'Manager' }]);
    });
});

describe('PATCH /api/memos/:id/assignee (choice of the manager)', () => {
    const app = createTestApp();
    const script = (mgr: any) => {
        mockedExecute
            .mockResolvedValueOnce(mockRows([memoRow()]))                                              // FOR UPDATE
            .mockResolvedValueOnce(mockRows([stepRow(0, 'submit', 1, 'done', 'Agent'), stepRow(1, 'recommend', 2, 'active')]))
            .mockResolvedValueOnce(mockRows(mgr))                                                       // titulaire ?
            .mockResolvedValueOnce(mockOk()).mockResolvedValueOnce(mockOk()).mockResolvedValueOnce(mockOk());
        mockedQuery.mockResolvedValue(mockOk());                                                        // audit
    };

    it('the author changes the manager (200) and the new manager is notified', async () => {
        script([{ 1: 1 }]);
        const res = await request(app).patch('/api/memos/5/assignee').set(asUser(AUTHOR)).send({ email: 'Manager2@mfwa.org' });
        expect(res.status).toBe(200);
        expect(res.body.assigned_email).toBe('manager2@mfwa.org');
        expect(notifyMemoEvent).toHaveBeenCalledWith('reassigned', 5, AUTHOR.email);
    });

    it('another user gets 403, and a non-holder as target gets 400', async () => {
        mockedExecute.mockResolvedValueOnce(mockRows([memoRow()]));
        expect((await request(app).patch('/api/memos/5/assignee').set(asUser(STRANGER)).send({ email: 'manager2@mfwa.org' })).status).toBe(403);

        mockedExecute.mockReset();
        script([]);
        expect((await request(app).patch('/api/memos/5/assignee').set(asUser(AUTHOR)).send({ email: 'nobody@mfwa.org' })).status).toBe(400);
    });
});
