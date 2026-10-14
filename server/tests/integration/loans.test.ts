// tests/integration/loans.test.ts
// Vraie app Express, DB et Gmail mockés. Couvre le cycle complet d'un prêt
// (demande → approbation → sortie → retour) et les deux garde-fous qui font
// la valeur du module : pas de chevauchement de réservation, et pas de
// transition hors de la machine à états.
import request from 'supertest';
import { createTestApp, mockRows, mockOk, asUser } from '../helpers/testApp';
import { db } from '../../src/database/connection';

const mockedExecute = db.execute as jest.Mock;
const mockedQuery = db.query as jest.Mock;

const loanRow = (overrides: Record<string, any> = {}) => ({
    id: 7,
    asset_id: 12,
    borrower_uid: 'u-1',
    borrower_email: 'borrower@mfwa.org',
    start_date: '2026-10-20',
    due_date: '2026-10-27',
    status: 'requested',
    requested_by_email: 'borrower@mfwa.org',
    asset_status_before: null,
    extended_count: 0,
    ...overrides,
});

describe('POST /api/loans', () => {
    const app = createTestApp();
    beforeEach(() => { mockedExecute.mockReset(); mockedQuery.mockReset(); });

    it('creates a request when the asset is free over the window', async () => {
        mockedExecute
            .mockResolvedValueOnce(mockRows([{ id: 12, label: 'Canon C70', status: 'in_stock' }])) // lock asset
            .mockResolvedValueOnce(mockRows([]))                                                   // no clash
            .mockResolvedValueOnce(mockOk({ insertId: 7 }))                                        // insert loan
            .mockResolvedValueOnce(mockOk());                                                      // loan_events
        mockedQuery
            .mockResolvedValueOnce(mockOk())                                                       // audit_log
            .mockResolvedValueOnce(mockRows([{ label: 'Canon C70' }]))                             // asset label
            .mockResolvedValueOnce(mockRows([{ email: 'admin@mfwa.org' }]));                       // admins

        const res = await request(app)
            .post('/api/loans')
            .set(asUser({ uid: 'u-1' as any, email: 'borrower@mfwa.org', role: 'user' }))
            .send({ asset_id: 12, start_date: '2026-10-20', due_date: '2026-10-27', purpose: 'Field shoot' });

        expect(res.status).toBe(201);
        expect(res.body).toMatchObject({ id: 7, status: 'requested' });
    });

    it('refuses a window that overlaps an existing booking', async () => {
        mockedExecute
            .mockResolvedValueOnce(mockRows([{ id: 12, label: 'Canon C70', status: 'in_stock' }]))
            .mockResolvedValueOnce(mockRows([
                { id: 3, status: 'approved', start_date: '2026-10-25', due_date: '2026-10-30', borrower_email: 'other@mfwa.org' },
            ]));

        const res = await request(app)
            .post('/api/loans')
            .send({ asset_id: 12, start_date: '2026-10-20', due_date: '2026-10-27' });

        expect(res.status).toBe(409);
        expect(res.body.error).toContain('already booked');
    });

    it('refuses to lend a retired asset', async () => {
        mockedExecute.mockResolvedValueOnce(mockRows([{ id: 12, label: 'Old laptop', status: 'retired' }]));

        const res = await request(app)
            .post('/api/loans')
            .send({ asset_id: 12, start_date: '2026-10-20', due_date: '2026-10-27' });

        expect(res.status).toBe(409);
    });

    it('rejects a due date before the start date', async () => {
        const res = await request(app)
            .post('/api/loans')
            .send({ asset_id: 12, start_date: '2026-10-27', due_date: '2026-10-20' });

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('due_date');
    });

    it('forbids a non-admin from borrowing on behalf of someone else', async () => {
        const res = await request(app)
            .post('/api/loans')
            .set(asUser({ uid: 'u-1' as any, email: 'borrower@mfwa.org', role: 'user' }))
            .send({ asset_id: 12, start_date: '2026-10-20', due_date: '2026-10-27', borrower_uid: 'u-2' });

        expect(res.status).toBe(403);
    });
});

describe('PATCH /api/loans/:id/decision', () => {
    const app = createTestApp();
    beforeEach(() => { mockedExecute.mockReset(); mockedQuery.mockReset(); });

    it('approves a pending request and re-checks availability', async () => {
        mockedExecute
            .mockResolvedValueOnce(mockRows([loanRow()]))                                          // load FOR UPDATE
            .mockResolvedValueOnce(mockRows([{ id: 12, label: 'Canon C70', status: 'in_stock' }])) // lock asset
            .mockResolvedValueOnce(mockRows([]))                                                   // still free
            .mockResolvedValueOnce(mockOk())                                                       // update
            .mockResolvedValueOnce(mockOk());                                                      // event
        mockedQuery
            .mockResolvedValueOnce(mockOk())
            .mockResolvedValueOnce(mockRows([{ label: 'Canon C70' }]));

        const res = await request(app).patch('/api/loans/7/decision').send({ decision: 'approved' });

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ success: true, status: 'approved' });
    });

    it('refuses to approve a loan that is already returned', async () => {
        mockedExecute.mockResolvedValueOnce(mockRows([loanRow({ status: 'returned' })]));

        const res = await request(app).patch('/api/loans/7/decision').send({ decision: 'approved' });

        expect(res.status).toBe(409);
        expect(res.body.error).toContain('already closed');
    });

    it('is admin-only', async () => {
        const res = await request(app)
            .patch('/api/loans/7/decision')
            .set(asUser({ role: 'user' }))
            .send({ decision: 'approved' });

        expect(res.status).toBe(403);
    });
});

describe('PATCH /api/loans/:id/checkout', () => {
    const app = createTestApp();
    beforeEach(() => { mockedExecute.mockReset(); mockedQuery.mockReset(); });

    it('marks the asset as on_loan and remembers its previous status', async () => {
        mockedExecute
            .mockResolvedValueOnce(mockRows([loanRow({ status: 'approved', start_date: '2026-01-01' })]))
            .mockResolvedValueOnce(mockRows([{ id: 12, label: 'Canon C70', status: 'assigned' }]))
            .mockResolvedValueOnce(mockRows([]))   // aucun autre prêt sorti
            .mockResolvedValueOnce(mockOk())       // update loan
            .mockResolvedValueOnce(mockOk())       // update asset
            .mockResolvedValueOnce(mockOk());      // event
        mockedQuery.mockResolvedValue(mockOk());

        const res = await request(app).patch('/api/loans/7/checkout').send({ condition_out: 'good' });

        expect(res.status).toBe(200);
        const assetUpdate = mockedExecute.mock.calls.find(c => String(c[0]).includes("UPDATE assets SET status = 'on_loan'"));
        expect(assetUpdate).toBeDefined();
        const loanUpdate = mockedExecute.mock.calls.find(c => String(c[0]).includes('asset_status_before'));
        expect(loanUpdate![1]).toContain('assigned');
    });

    it('refuses when the asset is already out on another loan', async () => {
        mockedExecute
            .mockResolvedValueOnce(mockRows([loanRow({ status: 'approved' })]))
            .mockResolvedValueOnce(mockRows([{ id: 12, label: 'Canon C70', status: 'in_stock' }]))
            .mockResolvedValueOnce(mockRows([{ id: 99 }]));

        const res = await request(app).patch('/api/loans/7/checkout').send({});

        expect(res.status).toBe(409);
        expect(res.body.error).toContain('already checked out');
    });
});

describe('PATCH /api/loans/:id/checkout — sortie anticipée', () => {
    const app = createTestApp();
    beforeEach(() => { mockedExecute.mockReset(); mockedQuery.mockReset(); });

    it('re-checks the real window and moves start_date to today', async () => {
        mockedExecute
            .mockResolvedValueOnce(mockRows([loanRow({ status: 'approved', start_date: '2099-01-10', due_date: '2099-01-20' })]))
            .mockResolvedValueOnce(mockRows([{ id: 12, label: 'Canon C70', status: 'in_stock' }]))
            .mockResolvedValueOnce(mockRows([]))   // aucun autre prêt sorti
            .mockResolvedValueOnce(mockRows([]))   // fenêtre [aujourd'hui, retour] libre
            .mockResolvedValueOnce(mockOk())       // update loan
            .mockResolvedValueOnce(mockOk())       // update asset
            .mockResolvedValueOnce(mockOk());      // event
        mockedQuery.mockResolvedValue(mockOk());

        const res = await request(app).patch('/api/loans/7/checkout').send({});

        expect(res.status).toBe(200);
        const update = mockedExecute.mock.calls.find(c => String(c[0]).includes('asset_status_before'));
        const today = new Date();
        const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        expect(update![1]).toContain(iso);
        const event = mockedExecute.mock.calls.find(c => String(c[0]).includes('INSERT INTO loan_events'));
        expect(String(event![1][5])).toContain('early_checkout');
    });

    it('refuses an early check-out when another booking covers the days gained', async () => {
        mockedExecute
            .mockResolvedValueOnce(mockRows([loanRow({ status: 'approved', start_date: '2099-01-10', due_date: '2099-01-20' })]))
            .mockResolvedValueOnce(mockRows([{ id: 12, label: 'Canon C70', status: 'in_stock' }]))
            .mockResolvedValueOnce(mockRows([]))
            .mockResolvedValueOnce(mockRows([
                { id: 3, status: 'approved', start_date: '2099-01-05', due_date: '2099-01-08', borrower_email: 'other@mfwa.org' },
            ]));

        const res = await request(app).patch('/api/loans/7/checkout').send({});

        expect(res.status).toBe(409);
        expect(res.body.error).toContain('already booked');
    });
});

describe('checkLoansNoShow', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { checkLoansNoShow } = require('../../src/routes/loans');
    beforeEach(() => { mockedExecute.mockReset(); mockedQuery.mockReset(); delete process.env.LOAN_NOSHOW_GRACE_DAYS; });

    it('auto-cancels an approved loan past the grace period, as the system', async () => {
        mockedQuery
            .mockResolvedValueOnce(mockRows([{ email: 'admin@mfwa.org' }]))                       // admins
            .mockResolvedValueOnce(mockRows([{ id: 7, asset_id: 12, borrower_email: 'b@mfwa.org', start_date: '2026-01-01', asset_label: 'Canon C70' }]))
            .mockResolvedValueOnce(mockRows([]));                                                  // aucune relance
        mockedExecute
            .mockResolvedValueOnce(mockRows([loanRow({ status: 'approved' })]))                    // load FOR UPDATE
            .mockResolvedValueOnce(mockOk())                                                       // update
            .mockResolvedValueOnce(mockOk());                                                      // event

        const result = await checkLoansNoShow();

        expect(result).toEqual({ reminded: 0, cancelled: 1 });
        const event = mockedExecute.mock.calls.find(c => String(c[0]).includes('INSERT INTO loan_events'));
        expect(event![1][4]).toBe('system');
        expect(String(event![1][5])).toContain('no_show');
    });

    it('sends one pickup reminder inside the grace period and locks it', async () => {
        mockedQuery
            .mockResolvedValueOnce(mockRows([{ email: 'admin@mfwa.org' }]))
            .mockResolvedValueOnce(mockRows([]))                                                   // rien à annuler
            .mockResolvedValueOnce(mockRows([{ id: 7, asset_id: 12, borrower_email: 'b@mfwa.org', start_date: '2026-10-13', days_since_start: 1, asset_label: 'Canon C70' }]))
            .mockResolvedValue(mockOk());                                                          // lock + event

        const result = await checkLoansNoShow();

        expect(result).toEqual({ reminded: 1, cancelled: 0 });
        expect(mockedQuery.mock.calls.some(c => String(c[0]).includes('pickup_reminder_sent_at = NOW()'))).toBe(true);
    });

    it('does nothing when no approved loan is late', async () => {
        mockedQuery
            .mockResolvedValueOnce(mockRows([]))
            .mockResolvedValueOnce(mockRows([]))
            .mockResolvedValueOnce(mockRows([]));

        expect(await checkLoansNoShow()).toEqual({ reminded: 0, cancelled: 0 });
    });
});

describe('PATCH /api/loans/:id/checkin', () => {
    const app = createTestApp();
    beforeEach(() => { mockedExecute.mockReset(); mockedQuery.mockReset(); });

    it('restores the status the asset had before the loan', async () => {
        mockedExecute
            .mockResolvedValueOnce(mockRows([loanRow({ status: 'checked_out', asset_status_before: 'assigned' })]))
            .mockResolvedValueOnce(mockOk())  // update loan
            .mockResolvedValueOnce(mockOk())  // update asset
            .mockResolvedValueOnce(mockOk()); // event
        mockedQuery.mockResolvedValue(mockRows([{ label: 'Canon C70' }]));

        const res = await request(app).patch('/api/loans/7/checkin').send({ condition_in: 'good' });

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ status: 'returned', asset_status: 'assigned', incident_id: null });
    });

    it('opens an incident and sends the asset to repair when it comes back damaged', async () => {
        mockedExecute
            .mockResolvedValueOnce(mockRows([loanRow({ status: 'checked_out', asset_status_before: 'in_stock' })]))
            .mockResolvedValueOnce(mockOk({ insertId: 42 })) // incident
            .mockResolvedValueOnce(mockOk())                 // update loan
            .mockResolvedValueOnce(mockOk())                 // update asset
            .mockResolvedValueOnce(mockOk());                // event
        mockedQuery.mockResolvedValue(mockRows([{ label: 'Canon C70' }]));

        const res = await request(app).patch('/api/loans/7/checkin').send({ condition_in: 'damaged' });

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ incident_id: 42, asset_status: 'repair' });
    });

    it('does not re-close a loan that is already returned', async () => {
        mockedExecute.mockResolvedValueOnce(mockRows([loanRow({ status: 'returned' })]));

        const res = await request(app).patch('/api/loans/7/checkin').send({ condition_in: 'good' });

        expect(res.status).toBe(409);
    });
});

describe('PATCH /api/loans/:id/extend', () => {
    const app = createTestApp();
    beforeEach(() => { mockedExecute.mockReset(); mockedQuery.mockReset(); });

    it('refuses a new due date that is not later than the current one', async () => {
        mockedExecute.mockResolvedValueOnce(mockRows([loanRow({ status: 'checked_out' })]));

        const res = await request(app).patch('/api/loans/7/extend').send({ due_date: '2026-10-27' });

        expect(res.status).toBe(400);
    });

    it('extends and clears the overdue reminder lock', async () => {
        mockedExecute
            .mockResolvedValueOnce(mockRows([loanRow({ status: 'checked_out' })]))
            .mockResolvedValueOnce(mockRows([]))  // pas de réservation suivante
            .mockResolvedValueOnce(mockOk())      // update
            .mockResolvedValueOnce(mockOk());     // event
        mockedQuery.mockResolvedValue(mockOk());

        const res = await request(app).patch('/api/loans/7/extend').send({ due_date: '2026-11-03' });

        expect(res.status).toBe(200);
        const update = mockedExecute.mock.calls.find(c => String(c[0]).includes('extended_count = extended_count + 1'));
        expect(String(update![0])).toContain('overdue_reminder_sent_at = NULL');
    });
});

describe('GET /api/loans', () => {
    const app = createTestApp();
    beforeEach(() => { mockedExecute.mockReset(); mockedQuery.mockReset(); });

    it('scopes a non-admin to their own loans', async () => {
        mockedQuery.mockResolvedValueOnce(mockRows([]));

        const res = await request(app)
            .get('/api/loans')
            .set(asUser({ email: 'borrower@mfwa.org', role: 'user' }));

        expect(res.status).toBe(200);
        const [sql, params] = mockedQuery.mock.calls[0];
        expect(String(sql)).toContain('l.borrower_email = ?');
        expect(params).toContain('borrower@mfwa.org');
    });

    it('derives overdue from due_date rather than storing it', async () => {
        mockedQuery.mockResolvedValueOnce(mockRows([{ id: 7, status: 'checked_out', is_overdue: 1, days_past_due: 3 }]));

        const res = await request(app).get('/api/loans?overdue=1');

        expect(res.status).toBe(200);
        expect(String(mockedQuery.mock.calls[0][0])).toContain("l.due_date < CURDATE()");
        expect(res.body[0].days_past_due).toBe(3);
    });
});
