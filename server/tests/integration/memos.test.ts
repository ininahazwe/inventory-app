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
        expect(mockedQuery.mock.calls.some(c => /audit_log/.test(c[0]) && c[1].includes('memo_approve'))).toBe(true);
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
