// server/src/utils/dateHelpers.ts

/**
 * ✅ Date du jour au format YYYY-MM-DD, en heure locale du serveur.
 *
 * Remplace l'idiome `new Date().toISOString().split('T')[0]`, qui convertit
 * d'abord l'instant courant en UTC avant de couper la partie date : si le
 * serveur tourne dans un fuseau à offset positif, cet idiome peut renvoyer
 * "demain" avant minuit local, et pour un offset négatif "hier" juste après
 * minuit local. Ici on lit directement année/mois/jour en heure locale.
 */
export function todayDateString(d: Date = new Date()): string {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * ✅ Bornes (premier/dernier jour) du mois courant, en heure locale du serveur —
 * mêmes garanties que todayDateString() (pas de détour par UTC).
 */
export function currentMonthBounds(d: Date = new Date()): { from: string; to: string } {
    const year = d.getFullYear();
    const month = d.getMonth(); // 0-indexed
    const lastDay = new Date(year, month + 1, 0).getDate();
    const mm = String(month + 1).padStart(2, '0');
    return {
        from: `${year}-${mm}-01`,
        to: `${year}-${mm}-${String(lastDay).padStart(2, '0')}`,
    };
}

/**
 * ✅ Jours de retard en jours CALENDAIRES entre une échéance (YYYY-MM-DD) et une
 * date réelle (par défaut maintenant) — 0 si on est dans les temps, le jour même
 * inclus. Même définition que DATEDIFF(CURDATE(), due_date) utilisé en SQL pour le
 * badge « Overdue » et les relances : un retour le lendemain de l'échéance compte
 * 1 jour de retard, quelle que soit l'heure. Lecture en heure locale, comme
 * todayDateString() (pas de détour par UTC).
 */
export function calendarDaysLate(dueDate: string | Date, actual: Date = new Date()): number {
    const [y, m, d] = String(dueDate).slice(0, 10).split('-').map(Number);
    if (!y || !m || !d) return 0;
    const due = Date.UTC(y, m - 1, d);
    const act = Date.UTC(actual.getFullYear(), actual.getMonth(), actual.getDate());
    return Math.max(0, Math.round((act - due) / 86400000));
}
