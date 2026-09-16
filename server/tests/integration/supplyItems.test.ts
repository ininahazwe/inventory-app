// tests/integration/supplyItems.test.ts
// Vraie app Express, DB mockée. Couvre les routes de lecture supply-items,
// notamment /:id/ledger (historique complet, paginé) ajoutée en Phase 4a.
import request from 'supertest';
import { createTestApp } from '../helpers/testApp';
import { mockRows } from '../helpers/testApp';
import { db } from '../../src/database/connection';

const mockedExecute = db.execute as jest.Mock;

describe('GET /api/supply-items', () => {
    const app = createTestApp();

    beforeEach(() => {
        mockedExecute.mockReset();
    });

    it('lists items with their current stock joined from v_supply_stock', async () => {
        mockedExecute.mockResolvedValueOnce(mockRows([
            { id: 1, code: 'TOILET-ROLL', name: 'Toilet Roll', category_id: 2, category_name: 'Tissue', base_unit: 'roll', is_batch_tracked: 0, reorder_point: 20, target_level: 100, is_active: 1, qty_on_hand: 45, value_on_hand: 112.5, avg_unit_cost: 2.5 },
        ]));

        const res = await request(app).get('/api/supply-items');

        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(1);
        expect(res.body[0].qty_on_hand).toBe(45);
    });
});

describe('GET /api/supply-items/:id/stock', () => {
    const app = createTestApp();

    beforeEach(() => {
        mockedExecute.mockReset();
    });

    it('404s when the item does not exist', async () => {
        mockedExecute.mockResolvedValueOnce(mockRows([]));

        const res = await request(app).get('/api/supply-items/999/stock');

        expect(res.status).toBe(404);
    });

    it('merges item identity, stock and cover into one payload', async () => {
        mockedExecute
            .mockResolvedValueOnce(mockRows([{ id: 1, code: 'TOILET-ROLL', name: 'Toilet Roll', reorder_point: 20, target_level: 100 }]))
            .mockResolvedValueOnce(mockRows([{ qty_on_hand: 45, value_on_hand: 112.5, avg_unit_cost: 2.5 }]))
            .mockResolvedValueOnce(mockRows([{ avg_daily_qty_out: 3, cover_days: 15 }]));

        const res = await request(app).get('/api/supply-items/1/stock');

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
            id: 1, name: 'Toilet Roll', qty_on_hand: 45, avg_unit_cost: 2.5, cover_days: 15,
        });
    });
});

describe('GET /api/supply-items/:id/ledger', () => {
    const app = createTestApp();

    beforeEach(() => {
        mockedExecute.mockReset();
    });

    it('404s when the item does not exist', async () => {
        mockedExecute.mockResolvedValueOnce(mockRows([]));

        const res = await request(app).get('/api/supply-items/999/ledger');

        expect(res.status).toBe(404);
    });

    it('returns paginated entries with total count, defaulting to page 1 / 20 per page', async () => {
        mockedExecute
            .mockResolvedValueOnce(mockRows([{ id: 1 }])) // item exists
            .mockResolvedValueOnce(mockRows([{ total: 37 }])) // count
            .mockResolvedValueOnce(mockRows([
                { id: 501, movement_date: '2026-08-27', reason: 'count_variance', quantity_base: -2, unit_cost_base: '50.0000', value: '-100.00', location_id: null, location_name: null, batch_id: null, source_table: 'supply_adjustment_lines', source_line_id: 12, reverses_id: null, created_by_uid: 'gyan-uid', document_reference: null },
            ]));

        const res = await request(app).get('/api/supply-items/1/ledger');

        expect(res.status).toBe(200);
        expect(res.body.total).toBe(37);
        expect(res.body.page).toBe(1);
        expect(res.body.per_page).toBe(20);
        expect(res.body.entries).toHaveLength(1);
        expect(res.body.entries[0].reason).toBe('count_variance');

        // vérifie LIMIT/OFFSET par défaut
        const ledgerCall = mockedExecute.mock.calls[2];
        expect(ledgerCall[1]).toEqual([1, 20, 0]);
    });

    it('honors page and per_page query params, capping per_page at 100', async () => {
        mockedExecute
            .mockResolvedValueOnce(mockRows([{ id: 1 }]))
            .mockResolvedValueOnce(mockRows([{ total: 250 }]))
            .mockResolvedValueOnce(mockRows([]));

        const res = await request(app).get('/api/supply-items/1/ledger?page=3&per_page=500');

        expect(res.status).toBe(200);
        expect(res.body.page).toBe(3);
        expect(res.body.per_page).toBe(100);

        const ledgerCall = mockedExecute.mock.calls[2];
        expect(ledgerCall[1]).toEqual([1, 100, 200]); // offset = (3-1) * 100
    });
});
