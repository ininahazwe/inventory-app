// tests/integration/rpcExitRepair.test.ts
// Vraie app Express, DB mockée. Couvre POST /api/rpc/exit_repair: le coût de
// réparation va dans la colonne dédiée `lifecycle_events.cost`, plus concaténé
// dans `notes` ("| Repair cost: $X") — auparavant impossible à agréger en SQL.
import request from 'supertest';
import { createTestApp } from '../helpers/testApp';
import { mockRows, mockOk } from '../helpers/testApp';
import { db } from '../../src/database/connection';

const mockedExecute = db.execute as jest.Mock;
const mockedQuery = db.query as jest.Mock;

describe('POST /api/rpc/exit_repair', () => {
    const app = createTestApp();

    beforeEach(() => {
        mockedExecute.mockReset();
        mockedQuery.mockReset();
        mockedQuery.mockResolvedValue(mockRows([])); // auditLog insert
    });

    it('rejects a negative repair cost', async () => {
        const res = await request(app)
            .post('/api/rpc/exit_repair')
            .send({ p_asset_id: 1, p_cost: -5 });

        expect(res.status).toBe(400);
        expect(mockedExecute).not.toHaveBeenCalled();
    });

    it('stores the cost in a dedicated column, not concatenated into notes', async () => {
        mockedExecute
            .mockResolvedValueOnce(mockRows([{ id: 1, status: 'repair' }])) // SELECT ... FOR UPDATE (tx)
            .mockResolvedValueOnce(mockOk())                                 // UPDATE assets SET status (tx)
            .mockResolvedValueOnce(mockRows([{ id: 1, status: 'in_stock' }])) // SELECT asset après update (tx)
            .mockResolvedValueOnce(mockOk({ insertId: 99 }));                 // INSERT lifecycle_events (tx)

        const res = await request(app)
            .post('/api/rpc/exit_repair')
            .send({ p_asset_id: 1, p_notes: 'Screen replaced', p_cost: 42.5 });

        expect(res.status).toBe(200);
        expect(res.body.repair_cost).toBe(42.5);

        const insertCall = mockedExecute.mock.calls[3];
        expect(insertCall[0]).toMatch(/INSERT INTO lifecycle_events/);
        expect(insertCall[0]).not.toMatch(/Repair cost/);
        // params: [asset_id, event_type, notes, cost, created_by, status]
        expect(insertCall[1]).toEqual([1, 'maintenance', 'Screen replaced', 42.5, expect.any(String), 'resolved']);
        expect(insertCall[1][2]).toBe('Screen replaced'); // notes intactes, pas de "| Repair cost" ajouté
    });
});
