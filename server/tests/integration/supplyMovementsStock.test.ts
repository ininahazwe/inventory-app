// tests/integration/supplyMovementsStock.test.ts
// Vraie app Express, DB mockée. Couvre le calcul is_low ajouté sur
// GET /api/supply-movements/stock : is_low = seuil configuré ET stock <= seuil.
import request from 'supertest';
import { createTestApp } from '../helpers/testApp';
import { mockRows } from '../helpers/testApp';
import { db } from '../../src/database/connection';

const mockedExecute = db.execute as jest.Mock;

describe('GET /api/supply-movements/stock', () => {
    const app = createTestApp();

    beforeEach(() => {
        mockedExecute.mockReset();
    });

    it('flags is_low only for rows with a threshold at or above current stock', async () => {
        mockedExecute.mockResolvedValueOnce(mockRows([
            { supply_id: 1, name: 'Toilet Roll', brand: null, category_name: 'Tissue', low_stock_threshold: 5, total_in: 20, total_out: 17, stock: 3 },
            { supply_id: 2, name: 'Printer Paper', brand: null, category_name: 'Office', low_stock_threshold: 10, total_in: 50, total_out: 10, stock: 40 },
            { supply_id: 3, name: 'Soap', brand: null, category_name: 'Cleaning', low_stock_threshold: null, total_in: 5, total_out: 5, stock: 0 },
        ]));

        const res = await request(app).get('/api/supply-movements/stock');

        expect(res.status).toBe(200);
        const byId = Object.fromEntries(res.body.stock.map((r: any) => [r.supply_id, r]));
        expect(byId[1].is_low).toBe(true);   // 3 <= 5
        expect(byId[2].is_low).toBe(false);  // 40 > 10
        expect(byId[3].is_low).toBe(false);  // pas de seuil configuré, même à 0
    });

    it('filters to only low-stock rows when low_stock=1', async () => {
        mockedExecute.mockResolvedValueOnce(mockRows([
            { supply_id: 1, name: 'Toilet Roll', brand: null, category_name: 'Tissue', low_stock_threshold: 5, total_in: 20, total_out: 17, stock: 3 },
            { supply_id: 2, name: 'Printer Paper', brand: null, category_name: 'Office', low_stock_threshold: 10, total_in: 50, total_out: 10, stock: 40 },
        ]));

        const res = await request(app).get('/api/supply-movements/stock?low_stock=1');

        expect(res.status).toBe(200);
        expect(res.body.stock).toHaveLength(1);
        expect(res.body.stock[0].supply_id).toBe(1);
    });
});
