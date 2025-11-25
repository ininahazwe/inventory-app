import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { Link } from "react-router-dom";
import Autocomplete from "../components/Autocomplete";
import AssignAsset from "./AssignAsset";
import Modal from "../components/Modal";
import AssigneesManager from "../components/assignees/AssigneesManager";
import AllowedEmailsManager from "../components/AllowedEmailsManager";
import InventoryStats from "../components/InventoryStats";

type Row = {
  id: number; label: string; status: "in_stock"|"assigned"|"repair"|"retired";
  serial_no: string | null; category_name: string | null;
  assignee_name: string | null; assignee_email: string | null;
};

const ITEMS_PER_PAGE = 10;

export default function Home({ onNew }: { onNew: () => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [qLabel, setQLabel] = useState("");
  const [qCategory, setQCategory] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  const [statsRefreshTrigger, setStatsRefreshTrigger] = useState(0);

  const [assigneesOpen, setAssigneesOpen] = useState(false);
  const [allowedEmailsOpen, setAllowedEmailsOpen] = useState(false);

  const [assignOpen, setAssignOpen] = useState(false);
  const [assignAssetId, setAssignAssetId] = useState<number | null>(null);
  const [assignAssetLabel, setAssignAssetLabel] = useState<string>("");

  const [returnOpen, setReturnOpen] = useState(false);
  const [returnAssetId, setReturnAssetId] = useState<number | null>(null);
  const [returnAssetLabel, setReturnAssetLabel] = useState<string>("");

  // Calculer les informations de pagination
  const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, totalCount);

  const load = useMemo(() => async () => {
    // Construction de la requête avec filtres
    let q = supabase
      .from("v_asset_overview")
      .select("*", { count: 'exact' })
      .neq("status", "retired") // ✅ AJOUT : Exclure les assets retirés
      .order("created_at", { ascending: false });

    // Filtre catégorie
    if (qCategory) q = q.eq("category_name", qCategory);

    // Filtre recherche élargi (label, serial_no, assignee_name, assignee_email)
    if (qLabel && qLabel.trim()) {
      const esc = qLabel.trim().replace(/%/g, "\\%").replace(/_/g, "\\_");
      q = q.or(
        [
          `label.ilike.%${esc}%`,
          `serial_no.ilike.%${esc}%`,
          `assignee_name.ilike.%${esc}%`,
          `assignee_email.ilike.%${esc}%`,
        ].join(",")
      );
    }

    // Ajouter la pagination
    q = q.range(startIndex, startIndex + ITEMS_PER_PAGE - 1);

    const { data, count, error } = await q;
    if (error) {
      console.error("Erreur lors du chargement:", error);
      setRows([]);
      setTotalCount(0);
      return;
    }

    setRows((data as Row[]) ?? []);
    setTotalCount(count ?? 0);
  }, [qLabel, qCategory, startIndex]);

  useEffect(() => {
    (async () => {
      await load();
      const { data } = await supabase.rpc("is_current_admin");
      setIsAdmin(!!data);
      const { data: superData } = await supabase.rpc("is_current_super_admin");
      setIsSuperAdmin(!!superData);
    })();
  }, [load]);

  // Réinitialiser à la première page lors d'un changement de filtre
  useEffect(() => {
    setCurrentPage(1);
  }, [qLabel, qCategory]);

  async function fetchCategoryOptions(q: string) {
    const base = supabase.from("categories").select("name").order("name").limit(10);
    const { data } = q ? await base.ilike("name", `%${q}%`) : await base;
    return (data ?? []).map(d => d.name as string);
  }

  const openAssign = (id: number, label: string) => { setAssignAssetId(id); setAssignAssetLabel(label); setAssignOpen(true); };
  const closeAssign = () => { setAssignOpen(false); setAssignAssetId(null); setAssignAssetLabel(""); };

  const openReturn = (id: number, label: string) => { setReturnAssetId(id); setReturnAssetLabel(label); setReturnOpen(true); };
  const closeReturn = () => { setReturnOpen(false); setReturnAssetId(null); setReturnAssetLabel(""); };

  const confirmReturn = async () => {
    if (returnAssetId == null) return;
    const { error } = await supabase.rpc("return_asset", { p_asset_id: returnAssetId });
    if (!error) { closeReturn(); await load(); } else alert(error.message);
  };

  // Fonctions de navigation
  const goToPage = (page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    }
  };

  const goToPreviousPage = () => {
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1);
    }
  };

  const goToNextPage = () => {
    if (currentPage < totalPages) {
      setCurrentPage(currentPage + 1);
    }
  };

  // Générer les numéros de pages à afficher
  const getPageNumbers = () => {
    const pages = [];
    const maxVisible = 5;

    if (totalPages <= maxVisible) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      const start = Math.max(1, currentPage - Math.floor(maxVisible / 2));
      const end = Math.min(totalPages, start + maxVisible - 1);

      if (start > 1) {
        pages.push(1);
        if (start > 2) pages.push('...');
      }
      for (let i = start; i <= end; i++) pages.push(i);
      if (end < totalPages) {
        if (end < totalPages - 1) pages.push('...');
        pages.push(totalPages);
      }
    }
    return pages;
  };

  return (
    <div>
      {/* top row: titre + bouton nouveau */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom: 12, padding: "12px" }}>
        <h2 style={{ margin:0, letterSpacing:.2 }}>Inventory</h2>
        <div style={{ display:"flex", gap:8, flexWrap: "wrap" }}>
          {isSuperAdmin && (
            <button className="pill" onClick={() => setAllowedEmailsOpen(true)}>
              Allowed users
            </button>
          )}
          <button className="pill" onClick={() => setAssigneesOpen(true)}>Manage assignees</button>
          <button className="pill" onClick={onNew}>+ New asset</button>
        </div>
      </div>
      {/* filtres */}
      <div className="filters">
        <input
          className="input"
          placeholder="Search by label, serial number, name, or email…"
          value={qLabel}
          onChange={e=>setQLabel(e.target.value)}
        />
        <Autocomplete
          className="input"
          value={qCategory}
          onChange={setQCategory}
          fetchOptions={fetchCategoryOptions}
          placeholder="Category…"
        />
      </div>

      {/* tableau */}
      <table className="table">
        <thead>
        <tr style={{ background:"#8D86C9" }}>
          <th>Name</th><th>Category</th><th className="status">Status</th><th>Assigned to</th><th></th>
        </tr>
        </thead>
        <tbody>
        {rows.map(r => (
          <tr key={r.id}>
            <td>
              <Link className="asset-link" to={`/asset/${r.id}`}>{r.label}</Link>
              {r.serial_no && <div style={{ color:"var(--muted)", fontSize:12 }}>SN: {r.serial_no}</div>}
            </td>
            <td>{r.category_name ?? "—"}</td>
            <td style={{ textTransform:"capitalize" }} className="status">{r.status}</td>
            <td>
              {r.assignee_name ? (
                <>
                  {r.assignee_name}
                  {r.assignee_email && <div style={{ color:"var(--muted)", fontSize:12 }}>{r.assignee_email}</div>}
                </>
              ) : "—"}
            </td>
            <td>
              {isAdmin && (
                <div className="actions">
                  {r.status !== "assigned" ? (
                    <button className="pill green-light" onClick={() => openAssign(r.id, r.label)}>Assign</button>
                  ) : (
                    <button className="pill" onClick={() => openReturn(r.id, r.label)}>Return</button>
                  )}
                </div>
              )}
            </td>
          </tr>
        ))}
        {rows.length === 0 && (
          <tr><td colSpan={5} style={{ padding:16, color:"var(--muted)" }}>No result</td></tr>
        )}
        </tbody>
      </table>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          gap: 8,
          marginTop: 20,
          padding: "16px 0"
        }}>
          <button
            className="pill"
            onClick={goToPreviousPage}
            disabled={currentPage === 1}
            style={{
              opacity: currentPage === 1 ? 0.5 : 1,
              cursor: currentPage === 1 ? "not-allowed" : "pointer"
            }}
          >
            ← Précédent
          </button>

          {getPageNumbers().map((page, index) => (
            page === '...' ? (
              <span key={index} style={{ padding: "0 8px", color: "var(--muted)" }}>…</span>
            ) : (
              <button
                key={page}
                className="pill"
                onClick={() => goToPage(page as number)}
                style={{
                  background: currentPage === page ? "var(--brand)" : "#f4f1ee",
                  color: currentPage === page ? "white" : "var(--ink)",
                  minWidth: 36,
                  textAlign: "center"
                }}
              >
                {page}
              </button>
            )
          ))}

          <button
            className="pill"
            onClick={goToNextPage}
            disabled={currentPage === totalPages}
            style={{
              opacity: currentPage === totalPages ? 0.5 : 1,
              cursor: currentPage === totalPages ? "not-allowed" : "pointer"
            }}
          >
            Next →
          </button>
          {/* Info de pagination */}
          {totalCount > 0 && (
            <div style={{ marginBottom: 12, color: "var(--muted)", fontSize: 14 }}>
              Affichage de {startIndex + 1}-{endIndex} sur {totalCount} résultats
            </div>
          )}
        </div>
      )}

      {/* modal d'attribution */}
      <Modal open={assignOpen} onClose={closeAssign} title={`Assign : ${assignAssetLabel}`}>
        {assignAssetId != null && (
          <AssignAsset assetId={assignAssetId} onDone={async ()=>{
            closeAssign();
            await load();
            setStatsRefreshTrigger(prev => prev + 1); // Déclencher le rechargement des stats
          }} />
        )}
      </Modal>

      {/* modal de confirmation retour */}
      <Modal open={returnOpen} onClose={closeReturn} title={`Retourner : ${returnAssetLabel}`}>
        <p>Confirm return of this asset to stock ?</p>
        <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
          <button className="pill" style={{ background:"#bbb" }} onClick={closeReturn} type="button">Cancel</button>
          <button className="pill" onClick={confirmReturn} type="button">Confirm</button>
        </div>
      </Modal>

      <Modal open={assigneesOpen} onClose={() => setAssigneesOpen(false)} title="Manage assignees">
        <AssigneesManager onClose={() => setAssigneesOpen(false)} />
      </Modal>

      {/* Modal gestion des emails autorisés */}
      <Modal open={allowedEmailsOpen} onClose={() => setAllowedEmailsOpen(false)} title="Utilisateurs autorisés">
        <AllowedEmailsManager onClose={() => setAllowedEmailsOpen(false)} />
      </Modal>

      <InventoryStats
        refreshTrigger={statsRefreshTrigger}
        onCategoryFilter={setQCategory}
        selectedCategory={qCategory}
      />

    </div>
  );
}