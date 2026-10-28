// tests/unit/memoAccess.test.ts
// Qui peut ouvrir Mémos : admin, ou personne déclarée (titulaire / suppléant ACTIF d'un niveau).
import { db } from '../../src/database/connection';
import { hasMemoAccess } from '../../src/services/memoAccess';

const query = db.query as jest.Mock;
beforeEach(() => query.mockReset());

describe('hasMemoAccess', () => {
    it('admins and super admins always have access, without a query', async () => {
        expect(await hasMemoAccess({ email: 'a@mfwa.org', role: 'admin' })).toBe(true);
        expect(await hasMemoAccess({ email: 'b@mfwa.org', role: 'super_admin' })).toBe(true);
        expect(query).not.toHaveBeenCalled();
    });

    it('a declared person (any level, agent included) has access; only ACTIVE declarations count', async () => {
        query.mockResolvedValueOnce([[{ 1: 1 }], []]);
        expect(await hasMemoAccess({ email: 'writer@mfwa.org', role: 'user' })).toBe(true);
        const [sql, params] = query.mock.calls[0];
        expect(sql).toContain('memo_position_holders');
        expect(sql).toContain('is_active = 1');
        expect(params).toEqual(['writer@mfwa.org']);
    });

    it('someone who is not declared has no access; no e-mail means no access', async () => {
        query.mockResolvedValueOnce([[], []]);
        expect(await hasMemoAccess({ email: 'x@mfwa.org', role: 'user' })).toBe(false);
        expect(await hasMemoAccess({ role: 'user' })).toBe(false);
        expect(await hasMemoAccess(null)).toBe(false);
    });
});
