// src/screens/AssetDetail.tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion, type Variants } from "framer-motion";
import { supabase } from "../lib/supabaseClient";
import { usePermissions } from "../hooks/usePermissions";
import Modal from "../components/Modal";
import Autocomplete from "../components/Autocomplete";
import AssignAsset from "./AssignAsset";
import LifecycleModal from "../components/LifecycleModal";
import AuditLog from "../components/AuditLog";
import PublicAssetCard from "./PublicAssetCard";

type Asset = {
  id: number;
  label: string;
  category_id: number | null;
  category_name: string | null;
  serial_no: string | null;
  status: "in_stock" | "assigned" | "repair" | "retired";
  purchased_at: string | null;
  purchase_price: number | null;
  supplier: string | null;
  warranty_end: string | null;
  qr_slug: string | null;
  notes: string | null;
  created_at: string;
};

type LastAssignment = {
  asset_id: number;
  assignment_id: number | null;
  assignee_name: string | null;
  assignee_email: string | null;
  assigned_at: string | null;
  returned_at: string | null;
  status: "active" | "returned" | null;
};

type LifeEvent = {
  event_id: number;
  event_type: "created" | "assigned" | "returned" | "repair" | "retired" | "maintenance";
  event_at: string;
  notes: string | null;
  actor_uid: string | null;
  repair_cost?: number | null;
};

type LifecycleAction = "repair" | "exit_repair" | "retire";

export default function AssetDetail() {
  const { id } = useParams();
  const assetId = Number(id);
  const navigate = useNavigate();
  const { isAdmin } = usePermissions();

  // États pour détecter l'authentification
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);

  const [asset, setAsset] = useState<Asset | null>(null);
  const [last, setLast] = useState<LastAssignment | null>(null);
  const [timeline, setTimeline] = useState<LifeEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // États pour les modals
  const [lifecycleModalOpen, setLifecycleModalOpen] = useState(false);
  const [currentLifecycleAction, setCurrentLifecycleAction] = useState<LifecycleAction | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  // États pour édition
  const [edLabel, setEdLabel] = useState("");  // ← NOUVEAU
  const [edSerial, setEdSerial] = useState("");
  const [edCategoryName, setEdCategoryName] = useState("");
  const [edPurchasedAt, setEdPurchasedAt] = useState("");
  const [edPrice, setEdPrice] = useState<string>("");
  const [edSupplier, setEdSupplier] = useState("");
  const [edWarrantyEnd, setEdWarrantyEnd] = useState("");
  const [edNotes, setEdNotes] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [errEdit, setErrEdit] = useState<string | null>(null);

  // Animation fiche
  const sweep: Variants = {
    initial: { y: 40, opacity: 0 },
    animate: { y: 0, opacity: 1, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] } },
    exit: { y: 20, opacity: 0, transition: { duration: 0.24, ease: "easeInOut" } },
  };

  // ESC = retour
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") navigate(-1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [navigate]);

  // Vérifier l'authentification au montage
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        setIsAuthenticated(!!sessionData?.session);
      } catch (error) {
        console.error("Error checking auth:", error);
        setIsAuthenticated(false);
      } finally {
        setAuthChecked(true);
      }
    };

    checkAuth();

    // S'abonner aux changements d'authentification
    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setIsAuthenticated(!!session);
      }
    );

    return () => {
      subscription?.subscription.unsubscribe();
    };
  }, []);

  const siteUrl = import.meta.env.VITE_SITE_URL || window.location.origin;
  const qrDataUrl = useMemo(() => {
    if (!asset) return "";
    const slug = asset.qr_slug || `asset/${asset.id}`;
    return `${siteUrl}/${slug}`;
  }, [asset, siteUrl]);

  const qrImg = useMemo(() => {
    if (!qrDataUrl) return "";
    return `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qrDataUrl)}`;
  }, [qrDataUrl]);

  const warrantyDaysLeft = useMemo(() => {
    if (!asset?.warranty_end) return null;
    const end = new Date(asset.warranty_end + "T00:00:00");
    const today = new Date();
    const ms = end.getTime() - new Date(today.toDateString()).getTime();
    return Math.floor(ms / (1000 * 60 * 60 * 24));
  }, [asset?.warranty_end]);

  const load = async (): Promise<void> => {
    setErr(null);
    try {
      // asset
      const { data: a, error: ea } = await supabase
        .from("assets")
        .select("*, category:categories(name)")
        .eq("id", assetId)
        .single();

      if (ea) {
        setErr(ea.message);
        return;
      }

      type AssetWithCategory = Asset & {
        category?: {
          name: string;
        };
      };

      const row = a as AssetWithCategory;
      setAsset({
        ...row,
        category_name: row?.category?.name ?? null,
      });

      // last assignment
      const { data: la } = await supabase
        .from("v_asset_last_assignment")
        .select("*")
        .eq("asset_id", assetId)
        .maybeSingle();
      setLast((la as LastAssignment) ?? null);

      // timeline
      const { data: tl } = await supabase
        .from("v_asset_timeline")
        .select("*")
        .eq("asset_id", assetId)
        .order("event_at", { ascending: false });
      setTimeline((tl as LifeEvent[]) ?? []);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Error loading asset";
      setErr(errorMessage);
    }
  };

  useEffect(() => {
    (async (): Promise<void> => {
      setLoading(true);
      try {
        await load();
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Initialization error";
        setErr(errorMessage);
      } finally {
        setLoading(false);
      }
    })();
  }, [assetId]);

  // Lifecycle modal handlers
  const openLifecycleModal = (action: LifecycleAction) => {
    setCurrentLifecycleAction(action);
    setLifecycleModalOpen(true);
  };

  const closeLifecycleModal = () => {
    setLifecycleModalOpen(false);
    setCurrentLifecycleAction(null);
  };

  const handleLifecycleAction = async (data: { notes?: string; cost?: number }): Promise<void> => {
    if (!currentLifecycleAction) return;

    setBusy(true);
    setErr(null);

    try {
      let result;

      switch (currentLifecycleAction) {
        case "repair":
          result = await supabase.rpc("send_to_repair", {
            p_asset_id: assetId,
            p_notes: data.notes || null,
          });
          break;

        case "exit_repair":
          result = await supabase.rpc("exit_repair", {
            p_asset_id: assetId,
            p_notes: data.notes || null,
            p_cost: data.cost || null,
          });
          break;

        case "retire":
          result = await supabase.rpc("retire_asset", {
            p_asset_id: assetId,
            p_notes: data.notes || null,
          });
          break;

        default:
          throw new Error("Unknown action");
      }

      if (result?.error) {
        console.error(`Error ${currentLifecycleAction}:`, result.error);
        throw new Error(result.error.message || "Operation failed");
      }

      closeLifecycleModal();
      await load();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      console.error(`Error ${currentLifecycleAction}:`, errorMessage);
      throw error;
    } finally {
      setBusy(false);
    }
  };

  // Return asset
  const returnAsset = async (): Promise<void> => {
    try {
      setBusy(true);
      const { error } = await supabase.rpc("return_asset", { p_asset_id: assetId });

      if (error) {
        setErr(`Error: ${error.message}`);
        return;
      }

      await load();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "An error occurred";
      console.error("Error returning asset:", errorMessage);
      setErr(errorMessage);
    } finally {
      setBusy(false);
    }
  };

  // Delete asset
  const deleteAsset = async (): Promise<void> => {
    try {
      setBusy(true);
      setErr(null);

      const { error } = await supabase.from("assets").delete().eq("id", assetId);

      if (error) {
        setErr(`Error: ${error.message}`);
        return;
      }

      setDeleteConfirmOpen(false);
      navigate("/");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "An error occurred";
      console.error("Error deleting asset:", errorMessage);
      setErr(errorMessage);
    } finally {
      setBusy(false);
    }
  };

  // Edit asset
  const openEdit = async (): Promise<void> => {
    if (!asset) return;
    setEdLabel(asset.label);
    setEdSerial(asset.serial_no ?? "");
    setEdCategoryName(asset.category_name ?? "");
    setEdPurchasedAt(asset.purchased_at ?? "");
    setEdPrice(asset.purchase_price != null ? String(asset.purchase_price) : "");
    setEdSupplier(asset.supplier ?? "");
    setEdWarrantyEnd(asset.warranty_end ?? "");
    setEdNotes(asset.notes ?? "");
    setErrEdit(null);
    setEditOpen(true);
  };

  async function fetchCategoryOptions(q: string): Promise<string[]> {
    const base = supabase.from("categories").select("name").order("name").limit(10);
    const { data, error } = q ? await base.ilike("name", `%${q}%`) : await base;
    if (error) return [];
    return (data ?? []).map((d: { name: string }): string => d.name);
  }

  async function getOrCreateCategoryId(name: string): Promise<number | null> {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const { data: found } = await supabase.from("categories").select("id").eq("name", trimmed).maybeSingle();
    if (found?.id) return found.id as number;

    const { data: created, error } = await supabase.from("categories").insert({ name: trimmed }).select("id").single();
    if (error) {
      const { data: retry } = await supabase.from("categories").select("id").eq("name", trimmed).maybeSingle();
      if (retry?.id) return retry.id as number;
      throw new Error(error.message || "Unable to create category");
    }
    return created?.id ?? null;
  }

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!asset) return;
    setSavingEdit(true);
    setErrEdit(null);
    try {
      if (!edLabel.trim()) {
        setErrEdit("Label is required");
        setSavingEdit(false);
        return;
      }
      const category_id = await getOrCreateCategoryId(edCategoryName);
      const priceNum =
        edPrice.trim() === ""
          ? null
          : Number.isNaN(Number(edPrice.replace(",", ".")))
            ? (() => {
              throw new Error("Invalid price");
            })()
            : Number((+edPrice.replace(",", ".")).toFixed(2));

      const { error } = await supabase
        .from("assets")
        .update({
          label: edLabel.trim(),
          serial_no: edSerial.trim() || null,
          category_id,
          purchased_at: edPurchasedAt || null,
          purchase_price: priceNum,
          supplier: edSupplier.trim() || null,
          warranty_end: edWarrantyEnd || null,
          notes: edNotes.trim() || null,
        })
        .eq("id", asset.id);

      if (error) throw new Error(error.message);
      setEditOpen(false);
      await load();
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "Error saving changes";
      setErrEdit(errorMessage);
    } finally {
      setSavingEdit(false);
    }
  };


  // Si on est en train de vérifier l'auth
  if (!authChecked) {
    return (
      <main className="shell">
        <div className="shell-inner">
          <p style={{ padding: 24 }}>Vérification…</p>
        </div>
      </main>
    );
  }

  // Si pas authentifié, afficher la version publique
  if (!isAuthenticated) {
    return <PublicAssetCard />;
  }

  if (loading) {
    return (
      <main className="shell">
        <div className="shell-inner">
          <p style={{ padding: 24 }}>Loading…</p>
        </div>
      </main>
    );
  }

  if (!asset) {
    return (
      <main className="shell">
        <div className="shell-inner">
          <p style={{ padding: 24 }}>Asset not found</p>
          {err && <p style={{ padding: 24, color: "crimson" }}>{err}</p>}
        </div>
      </main>
    );
  }

  return (
    <motion.main
      className="shell"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8 }}
    >
      <div className="shell-inner">
        {/* Close button */}
        <button
          aria-label="Close"
          onClick={() => navigate(-1)}
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            width: 36,
            height: 36,
            borderRadius: 999,
            border: "1px solid var(--line)",
            background: "#fff",
            color: "var(--brand)",
            fontSize: 24,
            lineHeight: 1,
            display: "grid",
            placeItems: "center",
            cursor: "pointer",
            boxShadow: "0 4px 12px rgba(0,0,0,.06)",
            zIndex: 3,
          }}
          onMouseDown={(e) => (e.currentTarget.style.transform = "translateY(1px)")}
          onMouseUp={(e) => (e.currentTarget.style.transform = "translateY(0)")}
        >
          ×
        </button>

        {/* Animated body */}
        <motion.div className="shell-body" variants={sweep} initial="initial" animate="animate" exit="exit">
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingRight: 48 }}>
            <h2 style={{ margin: 0 }}>{asset.label}</h2>
            <span
              style={{
                padding: "6px 10px",
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 600,
                border: "1px solid var(--line)",
                color: asset.status === "assigned" || asset.status === "repair" ? "#fff" : "var(--ink)",
                background:
                  asset.status === "assigned"
                    ? "var(--brand)"
                    : asset.status === "repair"
                      ? "#b98b46"
                      : asset.status === "retired"
                        ? "#eee"
                        : "#f4f1ee",
              }}
            >
              {asset.status}
            </span>
          </div>

          {/* Info section */}
          <section className="infos">
            <div className="presentation">
              <Info label="Serial number" value={asset.serial_no || "—"} />
              <Info label="Category" value={asset.category_name || "—"} />
              <Info label="Purchase date" value={asset.purchased_at || "—"} />
              <Info
                label="Purchase price"
                value={asset.purchase_price != null ? asset.purchase_price.toFixed(2) : "—"}
              />
              <Info label="Supplier" value={asset.supplier || "—"} />
              <Info
                label="Warranty end"
                value={
                  asset.warranty_end
                    ? `${asset.warranty_end}${
                      typeof warrantyDaysLeft === "number"
                        ? ` — ${warrantyDaysLeft >= 0 ? `${warrantyDaysLeft} days left` : `${Math.abs(warrantyDaysLeft)} days overdue`}`
                        : ""
                    }`
                    : "—"
                }
              />
              {asset.notes && <Info className="span-2" label="Notes" value={asset.notes} />}
            </div>

            {/* QR Code Section */}
            <div>
              <div className="qr-section">
                <img src={qrImg} alt="QR" width={180} height={180} />
                <div>
                  <div style={{ marginTop: 8 }}>
                    <a href={qrImg} download={`asset-${asset.id}-qr.png`} className="pill" style={{ textDecoration: "none" }}>
                      Download QR
                    </a>
                  </div>
                </div>
              </div>
            </div>

            {/* Assignment Section */}
            <div>
              {last?.assignment_id ? (
                <div style={{ display: "grid", gap: 4 }}>
                  <div>
                    {last.status === "active" ? "Assigned to " : "Last assignee"} : <strong>{last.assignee_name ?? "—"}</strong>
                    {last.assignee_email ? ` (${last.assignee_email})` : ""}
                  </div>
                  <small style={{ color: "var(--muted)" }}>
                    {last.assigned_at ? `since ${last.assigned_at}` : ""}
                    {last.returned_at ? ` — returned on ${last.returned_at}` : ""}
                  </small>
                </div>
              ) : (
                <div>No assignments</div>
              )}

              {/* Action buttons */}
              <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                {asset.status !== "assigned" ? (
                  <button className="pill" onClick={() => setAssignOpen(true)} disabled={busy}>
                    {busy ? "…" : "Assign"}
                  </button>
                ) : (
                  <button className="pill" onClick={() => setReturnOpen(true)} disabled={busy}>
                    {busy ? "…" : "Mark as Returned"}
                  </button>
                )}
              </div>
            </div>
          </section>

          {/* Lifecycle Section */}
          {asset.status !== "retired" && (
            <section style={{ borderTop: "1px solid var(--line)", margin: "20px 6px" }}>
              <h3 style={{ margin: "8px 0" }}>Lifecycle</h3>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {asset.status !== "repair" && (
                  <button
                    className="pill"
                    onClick={() => openLifecycleModal("repair")}
                    disabled={busy}
                    style={{ cursor: busy ? "not-allowed" : "pointer" }}
                  >
                    {busy ? "…" : "Send for repair"}
                  </button>
                )}
                {asset.status === "repair" && (
                  <button
                    className="pill"
                    onClick={() => openLifecycleModal("exit_repair")}
                    disabled={busy}
                    style={{ cursor: busy ? "not-allowed" : "pointer" }}
                  >
                    {busy ? "…" : "Return from repair"}
                  </button>
                )}

                  <button
                    className="pill"
                    onClick={() => openLifecycleModal("retire")}
                    disabled={busy}
                    style={{
                      cursor: busy ? "not-allowed" : "pointer",
                      backgroundColor: "#dc3545",
                      color: "white",
                    }}
                  >
                    {busy ? "…" : "Retire permanently"}
                  </button>

              </div>
            </section>
          )}

          {/* Activity Log Section */}
          <section style={{ borderTop: "1px solid var(--line)", margin: "20px 6px" }}>
            <h3 style={{ margin: "8px 0" }}>Activity log</h3>
            {timeline.length === 0 ? (
              <p style={{ color: "var(--muted)" }}>No events</p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 16 }} className="journal">
                {timeline.map((ev) => (
                  <li key={ev.event_id}>
                    <code>{new Date(ev.event_at).toLocaleString()}</code> — <strong>{ev.event_type}</strong>
                    {ev.notes ? ` — ${ev.notes}` : ""}
                    {ev.event_type === "maintenance" && ev.repair_cost != null ? ` — cost: ${ev.repair_cost.toFixed(2)}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Action buttons */}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
            <button className="pill" onClick={openEdit} disabled={busy}>
              {busy ? "…" : "Edit"}
            </button>
            {isAdmin && (
              <button
                className="pill"
                style={{
                  background: "#dc3545",
                  color: "white",
                  cursor: busy ? "not-allowed" : "pointer",
                }}
                onClick={() => setDeleteConfirmOpen(true)}
                disabled={busy}
              >
                {busy ? "…" : "Delete"}
              </button>
            )}
          </div>

          {err && <p style={{ color: "crimson", marginTop: 16 }}>{err}</p>}
        </motion.div>

        {/* Modals */}

        {/* Lifecycle Modal */}
        <LifecycleModal
          open={lifecycleModalOpen}
          onClose={closeLifecycleModal}
          action={currentLifecycleAction}
          assetLabel={asset.label}
          onConfirm={handleLifecycleAction}
          busy={busy}
        />

        {/* Assign Modal */}
        <Modal open={assignOpen} onClose={() => setAssignOpen(false)} title={`Assign: ${asset.label}`}>
          <AssignAsset
            assetId={asset.id}
            onDone={async () => {
              setAssignOpen(false);
              await load();
            }}
          />
        </Modal>

        {/* Return Confirmation Modal */}
        <Modal open={returnOpen} onClose={() => setReturnOpen(false)} title={`Return: ${asset.label}`}>
          <p>Confirm return of this asset to stock?</p>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button className="pill" style={{ background: "#bbb" }} onClick={() => setReturnOpen(false)} type="button" disabled={busy}>
              Cancel
            </button>
            <button
              className="pill"
              onClick={async () => {
                await returnAsset();
                setReturnOpen(false);
              }}
              type="button"
              disabled={busy}
            >
              {busy ? "…" : "Confirm"}
            </button>
          </div>
        </Modal>

        {/* Delete Confirmation Modal */}
        <Modal
          open={deleteConfirmOpen}
          onClose={() => setDeleteConfirmOpen(false)}
          title={`Delete: ${asset.label}`}
        >
          <div style={{ paddingBottom: 16 }}>
            <p style={{ color: "#c00", fontWeight: 600, marginBottom: 12 }}>
              ⚠️ This action cannot be undone.
            </p>
            <p>Are you sure you want to permanently delete this asset?</p>
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button className="pill" style={{ background: "#bbb" }} onClick={() => setDeleteConfirmOpen(false)} type="button" disabled={busy}>
              Cancel
            </button>
            <button
              className="pill"
              style={{ background: "#dc3545", color: "white" }}
              onClick={() => deleteAsset()}
              type="button"
              disabled={busy}
            >
              {busy ? "…" : "Delete Permanently"}
            </button>
          </div>
        </Modal>

        {/* Edit Modal */}
        <Modal open={editOpen} onClose={() => setEditOpen(false)} title={`Edit: ${asset.label}`}>
          <form onSubmit={saveEdit} className="form-grid">
            <div className="span-2">
              <label className="label">Label *</label>
              <input
                className="field"
                value={edLabel}
                onChange={(e) => setEdLabel(e.target.value)}
                placeholder="Asset label…"
                required
              />
            </div>
            <div className="span-2">
              <label className="label">Category</label>
              <Autocomplete
                className="field"
                value={edCategoryName}
                onChange={setEdCategoryName}
                fetchOptions={fetchCategoryOptions}
                placeholder="Search/add…"
              />
            </div>

            <div>
              <label className="label">Serial Number</label>
              <input className="field" value={edSerial} onChange={(e) => setEdSerial(e.target.value)} placeholder="SN…" />
            </div>

            <div>
              <label className="label">Purchase Price</label>
              <input
                className="field"
                type="text"
                inputMode="decimal"
                value={edPrice}
                onChange={(e) => setEdPrice(e.target.value)}
                placeholder="0.00"
              />
            </div>

            <div>
              <label className="label">Purchase Date</label>
              <input className="field" type="date" value={edPurchasedAt} onChange={(e) => setEdPurchasedAt(e.target.value)} />
            </div>

            <div>
              <label className="label">Warranty End</label>
              <input className="field" type="date" value={edWarrantyEnd} onChange={(e) => setEdWarrantyEnd(e.target.value)} />
            </div>

            <div className="span-2">
              <label className="label">Supplier</label>
              <input className="field" value={edSupplier} onChange={(e) => setEdSupplier(e.target.value)} placeholder="Ex: ABC Ltd." />
            </div>

            <div className="span-2">
              <label className="label">Notes</label>
              <textarea className="field" rows={3} value={edNotes} onChange={(e) => setEdNotes(e.target.value)} />
            </div>

            {errEdit && <p className="span-2" style={{ color: "crimson" }}>{errEdit}</p>}

            <div className="span-2 modal-actions">
              <button type="button" className="pill pill--muted" onClick={() => setEditOpen(false)} disabled={savingEdit}>
                Cancel
              </button>
              <button className="pill" disabled={savingEdit}>
                {savingEdit ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        </Modal>
      </div>

      <section style={{ borderTop: "1px solid var(--line)", margin: "20px 6px" }}>
        <h3 style={{ margin: "8px 0" }}>📋 Complete Audit History</h3>
        <AuditLog entityType="asset" entityId={asset.id.toString()} limit={20} />
      </section>
    </motion.main>
  );
}

function Info({ label, value, className }: { label: string; value: string; className?: string }): React.ReactElement {
  return (
    <div className={className} style={{ display: "grid", gap: 4 }}>
      <span style={{ fontWeight: 600 }}>{label}</span>
      <span style={{ color: "var(--ink)" }}>{value}</span>
    </div>
  );
}
