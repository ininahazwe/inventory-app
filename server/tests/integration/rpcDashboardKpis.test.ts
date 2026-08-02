// tests/integration/rpcDashboardKpis.test.ts
// Vraie app Express, DB mockée. Couvre POST /api/rpc/get_dashboard_kpis: KPIs
// croisés pour la page d'accueil (valeur du parc, coût supplies du mois,
// incidents ouverts, enchères actives), un seul aller-retour DB.
import request from 'supertest';
import { createTestApp } from '../helpers/testApp';
import { mockRows } from '../helpers/testApp';
import { db } from '../../src/database/connection';

const mockedQuery = db.query as jest.Mock;

describe('POST /api/rpc/get_dashboard_kpis', () => {
    const app = createTestApp();

    beforeEach(() => {
        mockedQuery.mockReset();
    });

    it('returns the 4 aggregated KPIs', async () => {
        mockedQuery.mockResolvedValueOnce(mockRows([{
            fleet_value: '125000.00',
            supplies_cost_month: '340.50',
            open_incidents: 3,
            active_auctions: 2,
        }]));

        const res = await request(app).post('/api/rpc/get_dashboard_kpis').send({});

        expect(res.status).toBe(200);
        expect(res.body.fleet_value).toBe(125000);
        expect(res.body.supplies_cost_month).toBe(340.5);
        expect(res.body.open_incidents).toBe(3);
        expect(res.body.active_auctions).toBe(2);
        expect(res.body.period.from).toMatch(/^\d{4}-\d{2}-01$/);
    });
});
