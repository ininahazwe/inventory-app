// src/lib/exportXlsx.ts
// Export générique de tableaux (inventaire, achats, mouvements) en .xlsx.
// Génération 100% côté client (SheetJS déjà en dépendance) — pas de nouvel
// endpoint serveur nécessaire, on exporte les données déjà chargées/filtrées.
import * as XLSX from 'xlsx';

export function exportToXlsx(
  filename: string,
  sheetName: string,
  rows: Record<string, unknown>[]
): void {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31)); // Excel: 31 chars max
  XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
}
