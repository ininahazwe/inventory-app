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
          <th className="actives">Actives</th>
          <th className="total">Total</th>
          <th>Dernière attribution</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {rows.map(a => (
          <tr key={a.key}>
            <td>{a.full_name ?? "—"}</td>
            <td className="email">{a.email ?? "—"}</td>
            <td className="actives">{a.active_count}</td>
            <td className="total">{a.total_count}</td>
            <td>{a.last_assigned ? new Date(a.last_assigned).toLocaleString() : "—"}</td>
            <td style={{ width:200 }}>
              <div className="actions">
                <button className="pill" onClick={()=>onEdit(a)}>Edit</button>
                <button className="pill" style={{ background:"#f3d0d0" }} onClick={()=>onDelete(a)}>Delete</button>
              </div>
            </td>
          </tr>
        ))}
        {rows.length === 0 && (
          <tr><td colSpan={6} style={{ padding:16, color:"var(--muted)" }}>
            {busy ? "Chargement…" : "Aucun résultat"}
          </td></tr>
        )}
      </tbody>
    </table>
  );
}
