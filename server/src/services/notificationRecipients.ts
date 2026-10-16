// Who receives the "admin" notification emails.
// An admin / super_admin is a recipient unless notify_admin = 0 (toggle in /assignees).
import { db } from '../database/connection';

/**
 * @param roles roles to consider (default: admin and super_admin)
 */
export async function getAdminNotificationEmails(
    roles: Array<'admin' | 'super_admin'> = ['admin', 'super_admin']
): Promise<string[]> {
    const placeholders = roles.map(() => '?').join(',');
    let rows: any[];
    try {
        [rows] = (await db.query(
            `SELECT email FROM users WHERE role IN (${placeholders}) AND notify_admin = 1`,
            roles
        )) as any;
    } catch (err: any) {
        // Migration 2026-10-16 not applied yet: fall back to every admin so no notification is lost.
        if (err?.code === 'ER_BAD_FIELD_ERROR') {
            [rows] = (await db.query(`SELECT email FROM users WHERE role IN (${placeholders})`, roles)) as any;
        } else {
            throw err;
        }
    }
    return (rows as any[]).map(u => u.email).filter(Boolean);
}
