// src/screens/Home.tsx
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { usePermissions } from "../hooks/usePermissions";
import { Link } from "react-router-dom";
import Autocomplete from "../components/Autocomplete";
import AssignAsset from "./AssignAsset";
import Modal from "../components/Modal";
import AssigneesManager from "../components/assignees/AssigneesManager";
import UserManagementPanel from "../components/UserManagementPanel";
import InventoryStats from "../components/InventoryStats";
import AuditDashboard from "../components/AuditDashboard";

type Row = {
  id: number;
  label: string;
  status: "in_stock" | "assigned" | "repair" | "retired";
  serial_no: string | null;
  category_name: string | null;
  assignee_name: string | null;
  assignee_email: string | null;
};

const ITEMS_PER_PAGE = 10;

export default function Home({ onNew }: { onNew: () => void }) {
  const { isSuperAdmin } = usePermissions();
  const [rows, setRows] = useState<Row[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [qLabel, setQLabel] = useState("");
  const [qCategory, setQCategory] = useState("");

  const [statsRefreshTrigger, setStatsRefreshTrigger] = useState(0);

  const [assigneesOpen, setAssigneesOpen] = useState(false);
  const [userManagementOpen, setUserManagementOpen] = useState(false);

  const [auditOpen, setAuditOpen] = useState(false);

  const [assignOpen, setAssignOpen] = useState(false);
  const [assignAssetId, setAssignAssetId] = useState<number | null>(null);
  const [assignAssetLabel, setAssignAssetLabel] = useState<string>("");

  const [returnOpen, setReturnOpen] = useState(false);
  const [returnAssetId, setReturnAssetId] = useState<number | null>(null);
  const [returnAssetLabel, setReturnAssetLabel] = useState<string>("");

  // Pagination info
  const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, totalCount);

  const load = useMemo(
    () => async () => {
      // Construction de la requête
      let q = supabase
        .from("v_asset_overview")
        .select("*", { count: "exact" })
        .neq("status", "retired")
        .order("created_at", { ascending: false });

      // Filtre catégorie
      if (qCategory) q = q.eq("category_name", qCategory);

      // Filtre recherche
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

      // Pagination
      q = q.range(startIndex, startIndex + ITEMS_PER_PAGE - 1);

      const { data, count, error } = await q;
      if (error) {
        console.error("Error loading assets:", error);
        setRows([]);
        setTotalCount(0);
        return;
      }

      setRows((data as Row[]) ?? []);
      setTotalCount(count ?? 0);
    },
    [qLabel, qCategory, startIndex]
  );

  useEffect(() => {
    load();
  }, [load]);

  // Reset pagination on filter change
  useEffect(() => {
    setCurrentPage(1);
  }, [qLabel, qCategory]);

  async function fetchCategoryOptions(q: string) {
    const base = supabase.from("categories").select("name").order("name").limit(10);
    const { data } = q ? await base.ilike("name", `%${q}%`) : await base;
    return (data ?? []).map((d) => d.name as string);
  }

  const openAssign = (id: number, label: string) => {
    setAssignAssetId(id);
    setAssignAssetLabel(label);
    setAssignOpen(true);
  };
  const closeAssign = () => {
    setAssignOpen(false);
    setAssignAssetId(null);
    setAssignAssetLabel("");
  };

  const openReturn = (id: number, label: string) => {
    setReturnAssetId(id);
    setReturnAssetLabel(label);
    setReturnOpen(true);
  };
  const closeReturn = () => {
    setReturnOpen(false);
    setReturnAssetId(null);
    setReturnAssetLabel("");
  };

  const confirmReturn = async () => {
    if (returnAssetId == null) return;
    const { error } = await supabase.rpc("return_asset", { p_asset_id: returnAssetId });
    if (!error) {
      closeReturn();
      await load();
    } else {
      alert(error.message);
    }
  };

  // Pagination functions
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

  // Generate page numbers
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
        if (start > 2) pages.push("...");
      }
      for (let i = start; i <= end; i++) pages.push(i);
      if (end < totalPages) {
        if (end < totalPages - 1) pages.push("...");
        pages.push(totalPages);
      }
    }
    return pages;
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, padding: "12px" }}>
        <h2 style={{ margin: 0, letterSpacing: 0.2 }}>Inventory</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="pill" onClick={() => setAssigneesOpen(true)}>
            Manage assignees
          </button>
          {isSuperAdmin && (
            <>
              <button className="pill" onClick={() => setUserManagementOpen(true)}>
                👥 User Management
              </button>
              <button className="pill" onClick={() => setAuditOpen(true)}>
                📋 Audit Log
              </button>
            </>
          )}
          <button className="pill" onClick={onNew}>
            + New asset
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="filters">
        <input
          className="input"
          placeholder="Search by label, serial number, name, or email…"
          value={qLabel}
          onChange={(e) => setQLabel(e.target.value)}
        />
        <Autocomplete
          className="input"
          value={qCategory}
          onChange={setQCategory}
          fetchOptions={fetchCategoryOptions}
          placeholder="Category…"
        />
      </div>

      {/* Assets Table */}
      <table className="table">
        <thead>
        <tr style={{ background: "#8D86C9" }}>
          <th>Name</th>
          <th>Category</th>
          <th className="status">Status</th>
          <th>Assigned to</th>
          <th></th>
        </tr>
        </thead>
        <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td>
              <Link className="asset-link" to={`/asset/${r.id}`}>
                {r.label}
              </Link>
              {r.serial_no && <div style={{ color: "var(--muted)", fontSize: 12 }}>SN: {r.serial_no}</div>}
            </td>
            <td>{r.category_name ?? "—"}</td>
            <td style={{ textTransform: "capitalize" }} className="status">
              {r.status}
            </td>
            <td>
              {r.assignee_name ? (
                <>
                  {r.assignee_name}
                  {r.assignee_email && <div style={{ color: "var(--muted)", fontSize: 12 }}>{r.assignee_email}</div>}
                </>
              ) : (
                "—"
              )}
            </td>
            <td>
              <div className="actions">
                {r.status !== "assigned" ? (
                  <button className="pill green-light" onClick={() => openAssign(r.id, r.label)}>
                    Assign
                  </button>
                ) : (
                  <button className="pill" onClick={() => openReturn(r.id, r.label)}>
                    Return
                  </button>
                )}
              </div>
            </td>
          </tr>
        ))}
        {rows.length === 0 && (
          <tr>
            <td colSpan={5} style={{ padding: 16, color: "var(--muted)" }}>
              No result
            </td>
          </tr>
        )}
        </tbody>
      </table>

      {/* Pagination */}
      {totalPages > 1 && (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: 8,
            marginTop: 20,
            padding: "16px 0",
          }}
        >
          <button
            className="pill"
            onClick={goToPreviousPage}
            disabled={currentPage === 1}
            style={{
              opacity: currentPage === 1 ? 0.5 : 1,
              cursor: currentPage === 1 ? "not-allowed" : "pointer",
            }}
          >
            ← Previous
          </button>

          {getPageNumbers().map((page, index) =>
            page === "..." ? (
              <span key={index} style={{ padding: "0 8px", color: "var(--muted)" }}>
                …
              </span>
            ) : (
              <button
                key={page}
                className="pill"
                onClick={() => goToPage(page as number)}
                style={{
                  background: currentPage === page ? "var(--brand)" : "#f4f1ee",
                  color: currentPage === page ? "white" : "var(--ink)",
                  minWidth: 36,
                  textAlign: "center",
                }}
              >
                {page}
              </button>
            )
          )}

          <button
            className="pill"
            onClick={goToNextPage}
            disabled={currentPage === totalPages}
            style={{
              opacity: currentPage === totalPages ? 0.5 : 1,
              cursor: currentPage === totalPages ? "not-allowed" : "pointer",
            }}
          >
            Next →
          </button>

          {/* Pagination info */}
          {totalCount > 0 && (
            <div style={{ marginLeft: 16, color: "var(--muted)", fontSize: 14 }}>
              Showing {startIndex + 1}-{endIndex} of {totalCount}
            </div>
          )}
        </div>
      )}

      {/* Assign Modal */}
      <Modal open={assignOpen} onClose={closeAssign} title={`Assign: ${assignAssetLabel}`}>
        {assignAssetId != null && (
          <AssignAsset
            assetId={assignAssetId}
            onDone={async () => {
              closeAssign();
              await load();
              setStatsRefreshTrigger((prev) => prev + 1);
            }}
          />
        )}
      </Modal>

      {/* Return Modal */}
      <Modal open={returnOpen} onClose={closeReturn} title={`Return: ${returnAssetLabel}`}>
        <p>Confirm return of this asset to stock?</p>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="pill" style={{ background: "#bbb" }} onClick={closeReturn} type="button">
            Cancel
          </button>
          <button className="pill" onClick={confirmReturn} type="button">
            Confirm
          </button>
        </div>
      </Modal>

      {/* Assignees Modal */}
      <Modal open={assigneesOpen} onClose={() => setAssigneesOpen(false)} title="Manage assignees">
        <AssigneesManager onClose={() => setAssigneesOpen(false)} />
      </Modal>

      {/* User Management Modal (Super Admin Only) */}
      {isSuperAdmin && (
        <>
          <Modal open={userManagementOpen} onClose={() => setUserManagementOpen(false)} title="User Management">
            <UserManagementPanel onClose={() => setUserManagementOpen(false)} />
          </Modal>

          <Modal open={auditOpen} onClose={() => setAuditOpen(false)} title="📋 Audit Log">
            <AuditDashboard />
          </Modal>
        </>
      )}

      {/* Stats */}
      <InventoryStats refreshTrigger={statsRefreshTrigger} onCategoryFilter={setQCategory} selectedCategory={qCategory} />
    </div>
  );
}
