// server/src/services/memoAccess.ts
// Qui peut ouvrir le module Mémos : les admins, et toute personne déclarée dans
// « Memo administration » (titulaire ou suppléant ACTIF d'un niveau : agent, manager,
// director ou finance). Le niveau « agent » sert à déclarer les auteurs de mémos.
import { db } from '../database/connection';
import { isAdminUser } from '../middleware/auth';

export async function hasMemoAccess(user?: { email?: string; role?: string } | null): Promise<boolean> {
    if (isAdminUser(user)) return true;
    if (!user?.email) return false;
    const [rows] = await db.query(
        'SELECT 1 FROM memo_position_holders WHERE user_email = ? AND is_active = 1 LIMIT 1',
        [user.email]
    );
    return ((rows as any[]) || []).length > 0;
}
