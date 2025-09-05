import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import type { Assignee } from "./type";
import AssigneesTable from "./AssigneesTable";
import AssigneeForm from "./AssigneeForm";

const PAGE_SIZE = 10;

export default function AssigneesManager({ onClose }: { onClose?: () => void }) {
  const [rows, setRows] = useState<Assignee[]>([]);
  const [count, setCount] = useState(0);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);

  const [editing, setEditing] = useState<Assignee | null>(null);

  const load = useMemo(() => async () => {
    setBusy(true);
    try {
      let req = supabase
        .from("v_assignees")
        .select("*", { count: "exact" })
        .order("last_assigned", { ascending: false })
        .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

      if (q.trim()) {
        const esc = q.trim().replace(/%/g, "\\%").replace(/_/g, "\\_");
        req = req.or(
          [
            `full_name.ilike.%${esc}%`,
            `email.ilike.%${esc}%`,
          ].join(",")
        );
      }

      const { data, count: c, error } = await req;
      if (error) throw error;
      setRows((data ?? []) as Assignee[]);
      setCount(c ?? 0);
    } catch (e: any) {
      alert(e?.message ?? "Erreur de chargement");
      setRows([]);
      setCount(0);
    } finally {
      setBusy(false);
    }
  }, [q, page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [q]);

  const onEdit = (a: Assignee) => setEditing(a);

  const onDelete = async (a: Assignee) => {
    const confirm1 = confirm(
      `Supprimer toutes les attributions de:\n\n${a.full_name ?? "—"} <${a.email ?? "—"}> ?`
    );
    if (!confirm1) return;
    const confirm2 = confirm("Confirmer la suppression DEFINITIVE (assignments) ?");
    if (!confirm2) return;

    const { data, error } = await supabase.rpc("assignees_delete", {
      p_email: a.email,
      p_name: a.full_name,
    });
    if (error) return alert(error.message);
    alert(`${data ?? 0} attribution(s) supprimée(s).`);
    await load();
  };

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));

  return (
    <div>
      <div style={{ display:"flex", gap:8, marginBottom:12 }}>
        <input
          className="input"
          style={{ marginTop:"12px"}}
          placeholder="Search by name or email…"
          value={q}
          onChange={(e)=>setQ(e.target.value)}
        />
        <div style={{ flex:1 }} />
        <button className="pill" onClick={() => onClose?.()}>Close</button>
      </div>

      <AssigneesTable
        rows={rows}
        busy={busy}
        onEdit={onEdit}
        onDelete={onDelete}
      />

      {totalPages > 1 && (
        <div style={{ display:"flex", gap:8, alignItems:"center", justifyContent:"flex-end", marginTop:12 }}>
          <button className="pill" disabled={page<=1} onClick={()=>setPage(p=>p-1)}>←</button>
          <span style={{ color:"var(--muted)" }}>{page} / {totalPages}</span>
          <button className="pill" disabled={page>=totalPages} onClick={()=>setPage(p=>p+1)}>→</button>
        </div>
      )}

      {editing && (
        <div style={{ marginTop:16, padding:12, border:"1px solid var(--line)", borderRadius:8 }}>
          <AssigneeForm
            assignee={editing}
            onCancel={()=>setEditing(null)}
            onSaved={async ()=>{
              setEditing(null);
              await load();
            }}
          />
        </div>
      )}
    </div>
  );
}
