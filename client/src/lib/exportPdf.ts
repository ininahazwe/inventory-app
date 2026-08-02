// src/lib/exportPdf.ts
// Export générique de tableaux (inventaire, achats, mouvements) en .pdf.
// jsPDF + autotable, génération 100% côté client — même principe que exportXlsx.
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

export function exportToPdf(
  filename: string,
  title: string,
  rows: Record<string, unknown>[]
): void {
  const doc = new jsPDF({ orientation: 'landscape' });

  doc.setFontSize(14);
  doc.text(title, 14, 15);
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(`Generated ${new Date().toLocaleDateString('fr-FR')}`, 14, 21);

  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
  const body = rows.map(r => columns.map(c => {
    const v = r[c];
    return v == null ? '' : String(v);
  }));

  autoTable(doc, {
    startY: 26,
    head: [columns],
    body,
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [141, 134, 201] }, // var(--brand)
    margin: { left: 14, right: 14 },
  });

  doc.save(filename.endsWith('.pdf') ? filename : `${filename}.pdf`);
}
