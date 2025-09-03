// src/screens/AssetDetail.tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion, type Variants } from "framer-motion";
import { supabase } from "../lib/supabaseClient";
import Modal from "../components/Modal";
import Autocomplete from "../components/Autocomplete";
import AssignAsset from "./AssignAsset";
import LifecycleModal from "../components/LifecycleModal";
import { useConfirm } from "../components/ConfirmProvider";

type Asset = {
  id: number;
  label: string;
  category_id: number | null;
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

  const [asset, setAsset] = useState<Asset | null>(null);
  const [last, setLast] = useState<LastAssignment | null>(null);
  const [timeline, setTimeline] = useState<LifeEvent[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // États pour les modals
  const [lifecycleModalOpen, setLifecycleModalOpen] = useState(false);
  const [currentLifecycleAction, setCurrentLifecycleAction] = useState<LifecycleAction | null>(null);

  // Hook de confirmation
  const confirm = useConfirm();

  // Animation fiche (balayage bas -> haut)
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

  const load = async () => {
    setErr(null);
    try {
      // asset
      const { data: a, error: ea } = await supabase.from("assets").select("*").eq("id", assetId).single();
      if (ea) {
        setErr(ea.message);
        return;
      }
      setAsset(a as Asset);

      // last assignment
      const { data: la } = await supabase
        .from("v_asset_last_assignment")
        .select("*")
        .eq("asset_id", assetId)
        .maybeSingle();
      setLast((la ?? null) as any);

      // timeline
      const { data: tl } = await supabase
        .from("v_asset_timeline")
        .select("*")
        .eq("asset_id", assetId)
        .order("event_at", { ascending: false });
      setTimeline((tl as LifeEvent[]) ?? []);
    } catch (error: any) {
      setErr(error.message || "Erreur lors du chargement");
    }
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { data: adminData } = await supabase.rpc("is_current_admin");
        setIsAdmin(!!adminData);
        await load();
      } catch (error: any) {
        setErr(error.message || "Erreur lors de l'initialisation");
      } finally {
        setLoading(false);
      }
    })();
  }, [assetId]);

  // Ouverture des modals de cycle de vie
  const openLifecycleModal = (action: LifecycleAction) => {
    setCurrentLifecycleAction(action);
    setLifecycleModalOpen(true);
  };

  const closeLifecycleModal = () => {
    setLifecycleModalOpen(false);
    setCurrentLifecycleAction(null);
  };

  // Gestionnaire pour les actions de cycle de vie
  const handleLifecycleAction = async (data: { notes?: string; cost?: number }) => {
    if (!currentLifecycleAction) return;

    setBusy(true);
    try {
      let error;

      switch (currentLifecycleAction) {
        case "repair":
          ({ error } = await supabase.rpc("send_to_repair", {
            p_asset_id: assetId,
            p_notes: data.notes || null,
          }));
          break;

        case "exit_repair":
          ({ error } = await supabase.rpc("exit_repair", {
            p_asset_id: assetId,
            p_notes: data.notes || null,
            p_cost: data.cost || null,
          }));
          break;

        case "retire":
          ({ error } = await supabase.rpc("retire_asset", {
            p_asset_id: assetId,
            p_notes: data.notes || null,
          }));
          break;
      }

      if (error) {
        throw new Error(error.message);
      }

      closeLifecycleModal();
      await load();
    } catch (error: any) {
      console.error(`Erreur ${currentLifecycleAction}:`, error);
      throw error; // Re-throw pour que le modal gère l'affichage de l'erreur
    } finally {
      setBusy(false);
    }
  };

  const returnAsset = async () => {
    try {
      setBusy(true);
      const { error } = await supabase.rpc("return_asset", { p_asset_id: assetId });

      if (error) {
        alert(`Erreur: ${error.message}`);
        return;
      }

      await load();
    } catch (error: any) {
      console.error("Erreur returnAsset:", error);
      alert(`Erreur: ${error.message || "Une erreur est survenue"}`);
    } finally {
      setBusy(false);
    }
  };

  // Modals existants
  const [assignOpen, setAssignOpen] = useState(false);
  const openAssign = () => setAssignOpen(true);
  const closeAssign = () => setAssignOpen(false);

  const [returnOpen, setReturnOpen] = useState(false);
  const openReturn = () => setReturnOpen(true);
  const closeReturn = () => setReturnOpen(false);

  // Modal "Modifier"
  const [editOpen, setEditOpen] = useState(false);
  const [edSerial, setEdSerial] = useState("");
  const [edCategoryName, setEdCategoryName] = useState("");
  const [edPurchasedAt, setEdPurchasedAt] = useState("");
  const [edPrice, setEdPrice] = useState<string>("");
  const [edSupplier, setEdSupplier] = useState("");
  const [edWarrantyEnd, setEdWarrantyEnd] = useState("");
  const [edNotes, setEdNotes] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [errEdit, setErrEdit] = useState<string | null>(null);

  const openEdit = async () => {
    if (!asset) return;
    setEdSerial(asset.serial_no ?? "");

    // Nom de catégorie depuis ta vue overview (si dispo)
    const { data: row } = await supabase
      .from("v_asset_overview")
      .select("category_name")
      .eq("id", assetId)
      .maybeSingle();
    setEdCategoryName((row as any)?.category_name ?? "");

    setEdPurchasedAt(asset.purchased_at ?? "");
    setEdPrice(asset.purchase_price != null ? String(asset.purchase_price) : "");
    setEdSupplier(asset.supplier ?? "");
    setEdWarrantyEnd(asset.warranty_end ?? "");
    setEdNotes(asset.notes ?? "");
    setErrEdit(null);
    setEditOpen(true);
  };

  async function fetchCategoryOptions(q: string) {
    const base = supabase.from("categories").select("name").order("name").limit(10);
    const { data, error } = q ? await base.ilike("name", `%${q}%`) : await base;
    if (error) return [];
    return (data ?? []).map((d: any) => d.name as string);
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
      throw new Error(error.message || "Impossible de créer la catégorie.");
    }
    return created?.id ?? null;
  }

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!asset) return;
    setSavingEdit(true);
    setErrEdit(null);
    try {
      const category_id = await getOrCreateCategoryId(edCategoryName);
      const priceNum =
        edPrice.trim() === ""
          ? null
          : Number.isNaN(Number(edPrice.replace(",", ".")))
          ? (() => {
              throw new Error("Prix invalide");
            })()
          : Number((+edPrice.replace(",", ".")).toFixed(2));

      const { error } = await supabase
        .from("assets")
        .update({
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
    } catch (e: any) {
      setErrEdit(e.message || "Erreur lors de l'enregistrement.");
    } finally {
      setSavingEdit(false);
    }
  };

  if (loading) {
    return (
      <main className="shell">
        <div className="shell-inner">
          <p style={{ padding: 24 }}>Chargement…</p>
        </div>
      </main>
    );
  }

  if (!asset) {
    return (
      <main className="shell">
        <div className="shell-inner">
          <p style={{ padding: 24 }}>Matériel introuvable</p>
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
      transition={{ duration: 0.35 }}
      style={{border: "1px solid #8D86C9"}}
    >
      <div className="shell-inner">
        {/* X retour */}
        <button
          aria-label="Fermer"
          onClick={() => navigate(-1)}
          style={{
            position: "absolute",
            top: 12,
            right: 12,
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

        {/* Corps animé */}
        <motion.div className="shell-body" variants={sweep} initial="initial" animate="animate" exit="exit">
          {/* En-tête */}
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

  
          {/* Infos principales */}
          <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, margin: "20px 6px" }}>
            <div className="presentation">
                <Info label="Numéro de série" value={asset.serial_no || "—"} />
                <Info label="Catégorie" value={asset.category_id ? String(asset.category_id) : "—"} />
                <Info label="Date d'achat" value={asset.purchased_at || "—"} />
                <Info
                    label="Prix d'achat"
                    value={asset.purchase_price != null ? asset.purchase_price.toFixed(2) : "—"}
                />
                <Info label="Fournisseur" value={asset.supplier || "—"} />
                <Info
                    label="Fin de garantie"
                    value={
                        asset.warranty_end
                        ? `${asset.warranty_end}${
                            typeof warrantyDaysLeft === "number"
                                ? ` — ${warrantyDaysLeft >= 0 ? `${warrantyDaysLeft} j restants` : `${Math.abs(warrantyDaysLeft)} j dépassés`}`
                                : ""
                            }`
                        : "—"
                }
                />
                {asset.notes && <Info className="span-2" label="Notes" value={asset.notes} />}
            </div>
            <div>
                {/* QR code
                <h3 style={{ margin: "8px 0" }}>QR Code</h3>*/}
                <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", flexDirection: "column" }}>
                    <img src={qrImg} alt="QR" width={180} height={180} />
                    <div>
                        <div style={{ color: "#666", fontSize: 12, wordBreak: "break-all" }}>
                        {/* Lien encodé : <code>{qrDataUrl}</code> */}
                        </div>
                        <div style={{ marginTop: 8 }}>
                        <a href={qrImg} download={`asset-${asset.id}-qr.png`} className="pill" style={{ textDecoration: "none" }}>
                            Télécharger le QR
                        </a>
                        </div>
                    </div>
                </div>
            </div>
            <div>
                {/* Attribution */}
                {last?.assignment_id ? (
              <div style={{ display: "grid", gap: 4 }}>
                <div>
                  {last.status === "active" ? "Attribué à " : "Dernier attributaire"} : <strong>{last.assignee_name ?? "—"}</strong>
                  {last.assignee_email ? ` (${last.assignee_email})` : ""}
                </div>
                <small style={{ color: "var(--muted)" }}>
                  {last.assigned_at ? `depuis ${last.assigned_at}` : ""}
                  {last.returned_at ? ` — retourné le ${last.returned_at}` : ""}
                </small>
              </div>
            ) : (
              <div>Aucune attribution</div>
            )}


            {isAdmin && (
              <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                {asset.status !== "assigned" ? (
                  <>
                    <button className="pill" onClick={openAssign} disabled={busy}>
                      {busy ? "…" : "Attribuer"}
                    </button>
                  </>
                ) : (
                  <button className="pill" onClick={openReturn} disabled={busy}>
                    {busy ? "…" : "Marquer comme retourné"}
                  </button>
                )}
              </div>
            )}
            </div>
          </section>


          {/* Attribution */}
          <section style={{ borderTop: "1px solid var(--line)", margin: "20px 6px" }}>
            <h3 style={{ margin: "8px 0" }}>Attribution</h3>
            {last?.assignment_id ? (
              <div style={{ display: "grid", gap: 4 }}>
                <div>
                  {last.status === "active" ? "Attribué à " : "Dernier attributaire"} :{" "}
                  <strong>{last.assignee_name ?? "—"}</strong>
                  {last.assignee_email ? ` (${last.assignee_email})` : ""}
                </div>
                <small style={{ color: "var(--muted)" }}>
                  {last.assigned_at ? `depuis ${last.assigned_at}` : ""}
                  {last.returned_at ? ` — retourné le ${last.returned_at}` : ""}
                </small>
              </div>
            ) : (
              <div>Aucune attribution</div>
            )}

            {isAdmin && (
              <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                {asset.status !== "assigned" ? (
                  <>
                    <button className="pill" onClick={openAssign} disabled={busy}>
                      {busy ? "…" : "Attribuer"}
                    </button>
                  </>
                ) : (
                  <button className="pill" onClick={openReturn} disabled={busy}>
                    {busy ? "…" : "Marquer comme retourné"}
                  </button>
                )}
              </div>
            )}
          </section>

          {/* Cycle de vie avec nouveaux modals */}
          {isAdmin && (
            <section style={{ borderTop: "1px solid var(--line)", margin: "20px 6px" }}>
              <h3 style={{ margin: "8px 0" }}>Cycle de vie</h3>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {asset.status !== "repair" && (
                  <button 
                    className="pill" 
                    onClick={() => openLifecycleModal("repair")} 
                    disabled={busy}
                  >
                    {busy ? "…" : "Mettre en réparation"}
                  </button>
                )}
                {asset.status === "repair" && (
                  <button 
                    className="pill" 
                    onClick={() => openLifecycleModal("exit_repair")} 
                    disabled={busy}
                  >
                    {busy ? "…" : "Sortie de réparation"}
                  </button>
                )}
                {asset.status !== "retired" && (
                  <button 
                    className="pill" 
                    onClick={() => openLifecycleModal("retire")} 
                    disabled={busy}
                  >
                    {busy ? "…" : "Retirer définitivement"}
                  </button>
                )}
              </div>
            </section>
          )}

          {/* Journal */}
          <section style={{ borderTop: "1px solid var(--line)", margin: "20px 6px" }}>
            <h3 style={{ margin: "8px 0" }}>Journal</h3>
            {timeline.length === 0 ? (
              <p style={{ color: "var(--muted)" }}>Aucun événement</p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 16 }} className="journal">
                {timeline.map((ev) => (
                  <li key={ev.event_id}>
                    <code>{new Date(ev.event_at).toLocaleString()}</code> — <strong>{ev.event_type}</strong>
                    {ev.notes ? ` — ${ev.notes}` : ""}
                    {ev.event_type === "maintenance" && ev.repair_cost != null ? ` — coût: ${ev.repair_cost.toFixed(2)}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </section>


          {/* Bouton Modifier */}
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
            {isAdmin && (
              <button className="pill" onClick={openEdit} disabled={busy}>
                {busy ? "…" : "Modifier"}
              </button>
            )}
          </div>

          {err && <p style={{ color: "crimson" }}>{err}</p>}
        </motion.div>

        {/* === Modal Cycle de vie === */}
        <LifecycleModal
          open={lifecycleModalOpen}
          onClose={closeLifecycleModal}
          action={currentLifecycleAction}
          assetLabel={asset.label}
          onConfirm={handleLifecycleAction}
          busy={busy}
        />

        {/* === Modal Attribuer === */}
        <Modal open={assignOpen} onClose={closeAssign} title={`Attribuer : ${asset.label}`}>
          <AssignAsset
            assetId={asset.id}
            onDone={async () => {
              closeAssign();
              await load();
            }}
          />
        </Modal>

        {/* === Modal Retourner (confirmation) === */}
        <Modal open={returnOpen} onClose={closeReturn} title={`Retourner : ${asset.label}`}>
          <p>Confirmer le retour de ce matériel au stock ?</p>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button className="pill" style={{ background: "#bbb" }} onClick={closeReturn} type="button" disabled={busy}>
              Annuler
            </button>
            <button
              className="pill"
              onClick={async () => {
                await returnAsset();
                closeReturn();
              }}
              type="button"
              disabled={busy}
            >
              {busy ? "…" : "Confirmer"}
            </button>
          </div>
        </Modal>

        {/* === Modal Modifier === */}
        <Modal open={editOpen} onClose={() => setEditOpen(false)} title={`Modifier : ${asset.label}`}>
          <form onSubmit={saveEdit} className="form-grid">
            <div className="span-2">
              <label className="label">Catégorie</label>
              <Autocomplete
                className="field"
                value={edCategoryName}
                onChange={setEdCategoryName}
                fetchOptions={fetchCategoryOptions}
                placeholder="Rechercher/ajouter…"
              />
            </div>

            <div>
              <label className="label">Numéro de série</label>
              <input className="field" value={edSerial} onChange={(e) => setEdSerial(e.target.value)} placeholder="SN…" />
            </div>

            <div>
              <label className="label">Prix d'achat</label>
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
              <label className="label">Date d'achat</label>
              <input className="field" type="date" value={edPurchasedAt} onChange={(e) => setEdPurchasedAt(e.target.value)} />
            </div>

            <div>
              <label className="label">Fin de garantie</label>
              <input className="field" type="date" value={edWarrantyEnd} onChange={(e) => setEdWarrantyEnd(e.target.value)} />
            </div>

            <div className="span-2">
              <label className="label">Fournisseur</label>
              <input className="field" value={edSupplier} onChange={(e) => setEdSupplier(e.target.value)} placeholder="Ex : ABC Ltd." />
            </div>

            <div className="span-2">
              <label className="label">Notes</label>
              <textarea className="field" rows={3} value={edNotes} onChange={(e) => setEdNotes(e.target.value)} />
            </div>

            {errEdit && <p className="span-2" style={{ color: "crimson" }}>{errEdit}</p>}

            <div className="span-2 modal-actions">
              <button type="button" className="pill pill--muted" onClick={() => setEditOpen(false)} disabled={savingEdit}>
                Annuler
              </button>
              <button className="pill" disabled={savingEdit}>
                {savingEdit ? "Enregistrement…" : "Enregistrer"}
              </button>
            </div>
          </form>
        </Modal>
      </div>
    </motion.main>
  );
}

function Info({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={className} style={{ display: "grid", gap: 4 }}>
      <div style={{ fontWeight: 600 }}>{label}</div>
      <div style={{ color: "var(--ink)" }}>{value}</div>
    </div>
  );
}