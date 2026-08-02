// src/lib/dateHelpers.ts

/**
 * ✅ Date du jour au format YYYY-MM-DD, en heure locale du navigateur.
 *
 * Remplace l'idiome `new Date().toISOString().split('T')[0]`, utilisé pour
 * pré-remplir des champs <input type="date">. Cet idiome convertit d'abord
 * l'instant courant en UTC : pour un fuseau à offset positif (ex: UTC+1 à
 * +2 après minuit local), il reste "hier" jusqu'à ce que l'heure UTC change
 * de jour — le champ se pré-remplit alors avec la mauvaise date. Ici on lit
 * directement année/mois/jour en heure locale.
 */
export function todayDateString(d: Date = new Date()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
