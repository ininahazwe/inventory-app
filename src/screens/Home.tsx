import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { Link } from "react-router-dom";
import * as XLSX from "xlsx";
import Autocomplete from "../components/Autocomplete";
import AssignAsset from "./AssignAsset";
import Modal from "../components/Modal";
import AssigneesManager from "../components/assignees/AssigneesManager";
import AllowedEmailsManager from "../components/AllowedEmailsManager";
import InventoryStats from "../components/InventoryStats";
import { usePermissions } from "../hooks/usePermissions";

type Row = {
  id: number;
  label: string;
  status: "in_stock" | "assigned" | "repair" | "retired";
  serial_no: string | null;
  category_name: string | null;
  assignee_name: string | null;
  assignee_email: string | null;
  purchased_at: string | null;
  warranty_end: string | null;
  purchase_price: number | null;
  supplier: string | null;
  notes: string | null;
};

type SortField = "label" | "category_name" | "status" | "assignee_name" | "purchased_at";
type SortOrder = "asc" | "desc";

const ITEMS_PER_PAGE = 10;

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "in_stock", label: "In stock" },
  { value: "assigned", label: "Assigned" },
  { value: "repair", label: "In repair" },
];

const WARRANTY_OPTIONS = [
  { value: "", label: "All warranties" },
  { value: "active", label: "Warranty active" },
  { value: "expired", label: "Warranty expired" },
  { value: "expiring_soon", label: "Expiring soon (30 days)" },
];

export default function Home({ onNew }: { onNew: () => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);

  // Filtres de base
  const [qLabel, setQLabel] = useState("");
  const [qCategory, setQCategory] = useState("");

  // Nouveaux filtres
  const [qStatus, setQStatus] = useState("");
  const [qAssignee, setQAssignee] = useState("");
  const [qWarranty, setQWarranty] = useState("");
  const [qPurchasedFrom, setQPurchasedFrom] = useState("");
  const [qPurchasedTo, setQPurchasedTo] = useState("");

  // Mode recherche avancée
  const [advancedMode, setAdvancedMode] = useState(false);
  const [qSerialNo, setQSerialNo] = useState("");

  // Tri
  const [sortField, setSortField] = useState<SortField>("label");
  const [sortOrder, setSortOrder] = useState<SortOrder>("asc");

  const [isAdmin, setIsAdmin] = useState(false);
  
  // Hook pour vérifier les permissions
  const permissions = usePermissions();

  const [statsRefreshTrigger, setStatsRefreshTrigger] = useState(0);

  const [assigneesOpen, setAssigneesOpen] = useState(false);
  const [allowedEmailsOpen, setAllowedEmailsOpen] = useState(false);

  const [assignOpen, setAssignOpen] = useState(false);
  const [assignAssetId, setAssignAssetId] = useState<number | null>(null);
  const [assignAssetLabel, setAssignAssetLabel] = useState<string>("");

  const [returnOpen, setReturnOpen] = useState(false);
  const [returnAssetId, setReturnAssetId] = useState<number | null>(null);
  const [returnAssetLabel, setReturnAssetLabel] = useState<string>("");

  // Export Excel
  const [exporting, setExporting] = useState(false);

  // Calculer les informations de pagination
  const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, totalCount);

  // Vérifier si des filtres sont actifs
  const hasActiveFilters =
    qLabel || qCategory || qStatus || qAssignee || qWarranty || qPurchasedFrom || qPurchasedTo || qSerialNo;

  const load = useMemo(
    () => async () => {
      // Construction de la requête avec filtres
      let q = supabase
        .from("v_asset_overview")
        .select("*", { count: "exact" })
        .neq("status", "retired");

      // Filtre catégorie
      if (qCategory) q = q.eq("category_name", qCategory);

      // Filtre statut
      if (qStatus) q = q.eq("status", qStatus);

      // Filtre assignee
      if (qAssignee && qAssignee.trim()) {
        const esc = qAssignee.trim().replace(/%/g, "\\%").replace(/_/g, "\\_");
        q = q.or(`assignee_name.ilike.%${esc}%,assignee_email.ilike.%${esc}%`);
      }

      // Filtre date d'achat
      if (qPurchasedFrom) {
        q = q.gte("purchased_at", qPurchasedFrom);
      }
      if (qPurchasedTo) {
        q = q.lte("purchased_at", qPurchasedTo);
      }

      // Filtre garantie
      if (qWarranty) {
        const today = new Date().toISOString().split("T")[0];
        const in30Days = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

        if (qWarranty === "active") {
          q = q.gte("warranty_end", today);
        } else if (qWarranty === "expired") {
          q = q.lt("warranty_end", today);
        } else if (qWarranty === "expiring_soon") {
          q = q.gte("warranty_end", today).lte("warranty_end", in30Days);
        }
      }

      // Mode avancé : recherche séparée
      if (advancedMode) {
        if (qLabel && qLabel.trim()) {
          const esc = qLabel.trim().replace(/%/g, "\\%").replace(/_/g, "\\_");
          q = q.ilike("label", `%${esc}%`);
        }
        if (qSerialNo && qSerialNo.trim()) {
          const esc = qSerialNo.trim().replace(/%/g, "\\%").replace(/_/g, "\\_");
          q = q.ilike("serial_no", `%${esc}%`);
        }
      } else {
        // Mode simple : recherche globale
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
      }

      // Tri
      const ascending = sortOrder === "asc";
      q = q.order(sortField, { ascending, nullsFirst: false });

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
    },
    [
      qLabel,
      qCategory,
      qStatus,
      qAssignee,
      qWarranty,
      qPurchasedFrom,
      qPurchasedTo,
      qSerialNo,
      advancedMode,
      sortField,
      sortOrder,
      startIndex,
    ]
  );

  useEffect(() => {
    (async () => {
      await load();
      const { data } = await supabase.rpc("is_current_admin");
      setIsAdmin(!!data);
    })();
  }, [load]);

  // Réinitialiser à la première page lors d'un changement de filtre
  useEffect(() => {
    setCurrentPage(1);
  }, [qLabel, qCategory, qStatus, qAssignee, qWarranty, qPurchasedFrom, qPurchasedTo, qSerialNo, advancedMode]);

  async function fetchCategoryOptions(q: string) {
    const base = supabase.from("categories").select("name").order("name").limit(10);
    const { data } = q ? await base.ilike("name", `%${q}%`) : await base;
    return (data ?? []).map((d) => d.name as string);
  }

  async function fetchAssigneeOptions(q: string) {
    const base = supabase
      .from("assignments")
      .select("assignee_name, assignee_email")
      .not("assignee_name", "is", null);

    const { data, error } = q
      ? await base.or(`assignee_name.ilike.%${q}%,assignee_email.ilike.%${q}%`).limit(10)
      : await base.limit(10);

    if (error) return [];

    // Créer une liste unique de noms/emails
    const uniqueAssignees = new Map<string, string>();
    (data ?? []).forEach((d) => {
      const key = d.assignee_email || d.assignee_name;
      if (key && !uniqueAssignees.has(key)) {
        uniqueAssignees.set(key, d.assignee_name || d.assignee_email || "");
      }
    });

    return Array.from(uniqueAssignees.values());
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
    } else alert(error.message);
  };

  // Gestion du tri
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortOrder("asc");
    }
  };

  const getSortIcon = (field: SortField) => {
    if (sortField !== field) return "↕";
    return sortOrder === "asc" ? "↑" : "↓";
  };

  // Reset tous les filtres
  const resetFilters = () => {
    setQLabel("");
    setQCategory("");
    setQStatus("");
    setQAssignee("");
    setQWarranty("");
    setQPurchasedFrom("");
    setQPurchasedTo("");
    setQSerialNo("");
  };

  // Export Excel
  const exportToExcel = async () => {
    setExporting(true);
    try {
      // Construire la requête SANS pagination pour récupérer tous les résultats
      let q = supabase.from("v_asset_overview").select("*").neq("status", "retired");

      // Appliquer les mêmes filtres
      if (qCategory) q = q.eq("category_name", qCategory);
      if (qStatus) q = q.eq("status", qStatus);

      if (qAssignee && qAssignee.trim()) {
        const esc = qAssignee.trim().replace(/%/g, "\\%").replace(/_/g, "\\_");
        q = q.or(`assignee_name.ilike.%${esc}%,assignee_email.ilike.%${esc}%`);
      }

      if (qPurchasedFrom) q = q.gte("purchased_at", qPurchasedFrom);
      if (qPurchasedTo) q = q.lte("purchased_at", qPurchasedTo);

      if (qWarranty) {
        const today = new Date().toISOString().split("T")[0];
        const in30Days = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
        if (qWarranty === "active") q = q.gte("warranty_end", today);
        else if (qWarranty === "expired") q = q.lt("warranty_end", today);
        else if (qWarranty === "expiring_soon") q = q.gte("warranty_end", today).lte("warranty_end", in30Days);
      }

      if (advancedMode) {
        if (qLabel && qLabel.trim()) {
          const esc = qLabel.trim().replace(/%/g, "\\%").replace(/_/g, "\\_");
          q = q.ilike("label", `%${esc}%`);
        }
        if (qSerialNo && qSerialNo.trim()) {
          const esc = qSerialNo.trim().replace(/%/g, "\\%").replace(/_/g, "\\_");
          q = q.ilike("serial_no", `%${esc}%`);
        }
      } else {
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
      }

      // Tri
      const ascending = sortOrder === "asc";
      q = q.order(sortField, { ascending, nullsFirst: false });

      const { data, error } = await q;

      if (error) {
        alert("Export error: " + error.message);
        return;
      }

      if (!data || data.length === 0) {
        alert("No data to export");
        return;
      }

      // Formater les données pour Excel
      const excelData = data.map((row: Row) => ({
        Name: row.label || "",
        "Serial Number": row.serial_no || "",
        Category: row.category_name || "",
        Status: row.status || "",
        "Assigned To": row.assignee_name || "",
        "Assignee Email": row.assignee_email || "",
        "Purchase Date": row.purchased_at || "",
        "Purchase Price": row.purchase_price ?? "",
        "Warranty End": row.warranty_end || "",
        Supplier: row.supplier || "",
        Notes: row.notes || "",
      }));

      // Créer le workbook
      const ws = XLSX.utils.json_to_sheet(excelData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Inventory");

      // Ajuster la largeur des colonnes
      const colWidths = [
        { wch: 25 }, // Name
        { wch: 20 }, // Serial Number
        { wch: 15 }, // Category
        { wch: 12 }, // Status
        { wch: 20 }, // Assigned To
        { wch: 25 }, // Assignee Email
        { wch: 12 }, // Purchase Date
        { wch: 12 }, // Purchase Price
        { wch: 12 }, // Warranty End
        { wch: 20 }, // Supplier
        { wch: 30 }, // Notes
      ];
      ws["!cols"] = colWidths;

      // Générer le nom du fichier avec la date
      const now = new Date();
      const dateStr = now.toISOString().split("T")[0];
      const filename = `inventory_${dateStr}${hasActiveFilters ? "_filtered" : ""}.xlsx`;

      // Télécharger
      XLSX.writeFile(wb, filename);
    } catch (err: any) {
      alert("Export error: " + (err.message || "Unknown error"));
    } finally {
      setExporting(false);
    }
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
    const pages: (number | string)[] = [];
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
      {/* top row: titre + bouton nouveau */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
          padding: "12px",
        }}
      >
        <h2 style={{ margin: 0, letterSpacing: 0.2 }}>Inventory</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {permissions.canManageUsers && (
            <button className="pill" onClick={() => setAllowedEmailsOpen(true)}>
              Allowed users
            </button>
          )}
          <button className="pill" onClick={() => setAssigneesOpen(true)}>
            Manage assignees
          </button>
          <button className="pill" onClick={onNew}>
            + New asset
          </button>
        </div>
      </div>

      {/* Toggle recherche avancée + Export */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 12,
          padding: "0 12px",
          flexWrap: "wrap",
        }}
      >
        <button
          className="pill"
          onClick={() => setAdvancedMode(!advancedMode)}
          style={{
            background: advancedMode ? "var(--brand)" : "#f4f1ee",
            color: advancedMode ? "#fff" : "var(--ink)",
          }}
        >
          {advancedMode ? "◀ Simple search" : "Advanced search ▶"}
        </button>
        {hasActiveFilters && (
          <button
            className="pill"
            onClick={resetFilters}
            style={{ background: "#f3d0d0", color: "var(--ink)" }}
          >
            ✕ Clear filters
          </button>
        )}
        <div style={{ flex: 1 }} />
        <button
          className="pill"
          onClick={exportToExcel}
          disabled={exporting}
          style={{
            background: "#28a745",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          {exporting ? (
            "Exporting..."
          ) : (
            <>
              <span style={{ fontSize: 16 }}>📥</span>
              Export Excel {totalCount > 0 && `(${totalCount})`}
            </>
          )}
        </button>
      </div>

      {/* Filtres */}
      {!advancedMode ? (
        // Mode simple
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
          <select className="select" value={qStatus} onChange={(e) => setQStatus(e.target.value)}>
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <select className="select" value={qWarranty} onChange={(e) => setQWarranty(e.target.value)}>
            {WARRANTY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      ) : (
        // Mode avancé
        <div style={{ padding: "0 12px", marginBottom: 16 }}>
          <div className="filters" style={{ marginBottom: 12 }}>
            <input
              className="input"
              placeholder="Label…"
              value={qLabel}
              onChange={(e) => setQLabel(e.target.value)}
            />
            <input
              className="input"
              placeholder="Serial number…"
              value={qSerialNo}
              onChange={(e) => setQSerialNo(e.target.value)}
            />
            <Autocomplete
              className="input"
              value={qCategory}
              onChange={setQCategory}
              fetchOptions={fetchCategoryOptions}
              placeholder="Category…"
            />
            <select className="select" value={qStatus} onChange={(e) => setQStatus(e.target.value)}>
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div className="filters">
            <Autocomplete
              className="input"
              value={qAssignee}
              onChange={setQAssignee}
              fetchOptions={fetchAssigneeOptions}
              placeholder="Assignee…"
            />
            <select className="select" value={qWarranty} onChange={(e) => setQWarranty(e.target.value)}>
              {WARRANTY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>Purchased:</span>
              <input
                className="input"
                type="date"
                value={qPurchasedFrom}
                onChange={(e) => setQPurchasedFrom(e.target.value)}
                style={{ flex: 1 }}
              />
              <span style={{ color: "var(--muted)" }}>→</span>
              <input
                className="input"
                type="date"
                value={qPurchasedTo}
                onChange={(e) => setQPurchasedTo(e.target.value)}
                style={{ flex: 1 }}
              />
            </div>
          </div>
        </div>
      )}

      {/* tableau */}
      <table className="table">
        <thead>
          <tr style={{ background: "#8D86C9" }}>
            <th onClick={() => handleSort("label")} style={{ cursor: "pointer", userSelect: "none" }}>
              Name {getSortIcon("label")}
            </th>
            <th onClick={() => handleSort("category_name")} style={{ cursor: "pointer", userSelect: "none" }}>
              Category {getSortIcon("category_name")}
            </th>
            <th
              onClick={() => handleSort("status")}
              style={{ cursor: "pointer", userSelect: "none" }}
              className="status"
            >
              Status {getSortIcon("status")}
            </th>
            <th onClick={() => handleSort("assignee_name")} style={{ cursor: "pointer", userSelect: "none" }}>
              Assigned to {getSortIcon("assignee_name")}
            </th>
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
                {r.serial_no && (
                  <div style={{ color: "var(--muted)", fontSize: 12 }}>SN: {r.serial_no}</div>
                )}
              </td>
              <td>{r.category_name ?? "—"}</td>
              <td style={{ textTransform: "capitalize" }} className="status">
                {r.status}
              </td>
              <td>
                {r.assignee_name ? (
                  <>
                    {r.assignee_name}
                    {r.assignee_email && (
                      <div style={{ color: "var(--muted)", fontSize: 12 }}>{r.assignee_email}</div>
                    )}
                  </>
                ) : (
                  "—"
                )}
              </td>
              <td>
                {isAdmin && (
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
                )}
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
            flexWrap: "wrap",
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

          {/* Info de pagination */}
          {totalCount > 0 && (
            <div style={{ color: "var(--muted)", fontSize: 14, marginLeft: 12 }}>
              Showing {startIndex + 1}-{endIndex} of {totalCount} results
            </div>
          )}
        </div>
      )}

      {/* modal d'attribution */}
      <Modal open={assignOpen} onClose={closeAssign} title={`Assign : ${assignAssetLabel}`}>
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

      {/* modal de confirmation retour */}
      <Modal open={returnOpen} onClose={closeReturn} title={`Return : ${returnAssetLabel}`}>
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

      <Modal open={assigneesOpen} onClose={() => setAssigneesOpen(false)} title="Manage assignees">
        <AssigneesManager onClose={() => setAssigneesOpen(false)} />
      </Modal>

      {/* Modal gestion des emails autorisés */}
      <Modal open={allowedEmailsOpen} onClose={() => setAllowedEmailsOpen(false)} title="Authorized users">
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