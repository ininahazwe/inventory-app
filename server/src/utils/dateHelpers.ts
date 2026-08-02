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
