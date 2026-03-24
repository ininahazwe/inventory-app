import React from "react";
import type { Assignee } from "./type";

export default function AssigneesTable({
                                         rows, busy, onEdit, onDelete
                                       }: {
  rows: Assignee[];
  busy: boolean;
  onEdit: (a: Assignee) => void;
  onDelete: (a: Assignee) => void;
}) {
  return (
    <table className="table">
      <thead>
      <tr style={{ background:"#8D86C9" }}>
        <th>Nom</th>
        <th className="email">Email</th>
        <th className="actives">Total</th>
        <th></th>
      </tr>
      </thead>
      <tbody>
      {rows.map(a => (
        <tr key={a.assignee_email}>
          <td>{a.assignee_name ?? "—"}</td>
          <td className="email">{a.assignee_email ?? "—"}</td>
          <td className="actives">{a.asset_count}</td>
          <td style={{ width:200 }}>
            <div className="actions">
              <button className="pill" onClick={()=>onEdit(a)}>Edit</button>
              <button className="pill" style={{ background:"#f3d0d0" }} onClick={()=>onDelete(a)}>Delete</button>
            </div>
          </td>
        </tr>
      ))}
      {rows.length === 0 && (
        <tr><td colSpan={4} style={{ padding:16, color:"var(--muted)" }}>
          {busy ? "Chargement…" : "Aucun résultat"}
        </td></tr>
      )}
      </tbody>
    </table>
  );
}
