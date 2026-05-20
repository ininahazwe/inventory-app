// src/screens/PublicAssetCard.tsx
import React from "react";
import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { api, auth, token } from "../lib/apiClient";
import Modal from "../components/Modal";

type PublicAsset = {
  id: number;
  label: string;
  category_name: string | null;
  serial_no: string | null;
  funder: string | null;
  status: "in_stock" | "assigned" | "repair" | "retired";
  created_at: string | null;
  assignee_name: string | null;
};

export default function PublicAssetCard() {
  const { id } = useParams();
  const navigate = useNavigate();
  const assetId = Number(id);

  const [asset, setAsset]                     = useState<PublicAsset | null>(null);
  const [loading, setLoading]                 = useState(true);
  const [error, setError]                     = useState<string | null>(null);
  const [authModalOpen, setAuthModalOpen]     = useState(false);
  const [authLoading, setAuthLoading]         = useState(false);

  useEffect(() => {
    api.get<PublicAsset>(`/assets/${assetId}/overview`, false).then(({ data, error }) => {
      if (error) setError("Asset introuvable");
      else setAsset(data);
      setLoading(false);
    });
  }, [assetId]);

  const handleReportIncident = async () => {
    try {
      setAuthLoading(true);
      if (token.get()) {
        navigate(`/asset/${assetId}/report-incident`);
        return;
      }
      setAuthModalOpen(true);
    } catch (error) {
      console.error("Error checking session:", error);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleGoogleAuth = () => {
    setAuthLoading(true);
    auth.signInWithGoogle();
  };

  const getStatusLabel = (status: string) => ({
    in_stock: "In stock", assigned: "Assigned", repair: "Under repair", retired: "Retired",
  }[status] || status);

  const getStatusStyle = (status: string) => ({
    assigned: { background: "var(--brand)", color: "#fff" },
    repair:   { background: "#b98b46",       color: "#fff" },
    retired:  { background: "#eee",          color: "#888" },
  }[status] || { background: "#f4f1ee", color: "var(--ink)" });

  if (loading) return (
    <div className="public-asset-shell">
      <div className="public-asset-card">
        <p style={{ textAlign: "center", padding: 40, color: "var(--muted)" }}>Chargement…</p>
      </div>
    </div>
  );

  if (error || !asset) return (
    <div className="public-asset-shell">
      <div className="public-asset-card">
        <p style={{ textAlign: "center", padding: 40, color: "crimson" }}>{error || "Asset not found"}</p>
      </div>
    </div>
  );

  return (
    <>
      <div className="public-asset-shell">
        <motion.div className="public-asset-card" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          <div className="public-header">
            <h1 className="public-title">{asset.label}</h1>
            <span className="public-status" style={{ ...getStatusStyle(asset.status), padding: "6px 12px", borderRadius: 999, fontSize: 12, fontWeight: 600 }}>
              {getStatusLabel(asset.status)}
            </span>
          </div>

          <div className="public-infos">
            <InfoRow label="Category"      value={asset.category_name || "—"} />
            <InfoRow label="Serial number" value={asset.serial_no || "—"} />
            <InfoRow label="Creation date" value={asset.created_at ? new Date(asset.created_at).toLocaleDateString() : "—"} />
            {asset.status === "assigned" && asset.assignee_name && <InfoRow label="Assigned to" value={asset.assignee_name} />}
            <InfoRow label="Funder" value={asset.funder || "—"} />
          </div>

          <div className="public-footer">
            <button onClick={handleReportIncident} disabled={authLoading} className="pill" style={{ width: "100%", padding: "12px 20px", marginBottom: 12 }}>
              {authLoading ? "…" : "📋 Report an incident"}
            </button>
            <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>Login to report an incident</p>
          </div>
        </motion.div>
      </div>

      <Modal open={authModalOpen} onClose={() => setAuthModalOpen(false)} title="Se connecter" closeOnBackdrop={!authLoading}>
        <div style={{ textAlign: "center", padding: "20px 0" }}>
          <p style={{ color: "var(--muted)", marginBottom: 20 }}>Login to report an incident for this asset.</p>
          <button onClick={handleGoogleAuth} disabled={authLoading} className="pill" style={{ width: "100%", padding: "12px 20px", background: "#1f2937", color: "#fff", marginBottom: 12 }}>
            {authLoading ? "Connexion…" : "Continuer avec Google"}
          </button>
          <button onClick={() => setAuthModalOpen(false)} disabled={authLoading} className="pill" style={{ width: "100%", padding: "12px 20px", background: "#bbb" }}>
            Cancel
          </button>
        </div>
      </Modal>

      <style>{`
        .public-asset-shell { min-height: auto; background: #E5E2DA; display: flex; justify-content: center; align-items: center; padding: 20px; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; }
        .public-asset-card { background: #fff; border-radius: 24px; padding: 32px; max-width: 400px; width: 100%; box-shadow: 0 10px 40px rgba(0,0,0,0.1); }
        .public-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; gap: 12px; flex-wrap: wrap; }
        .public-title { margin: 0; font-size: 24px; font-weight: 700; color: #242038; }
        .public-infos { display: flex; flex-direction: column; gap: 16px; padding: 20px; background: #f9f8f6; border-radius: 16px; }
        .public-info-row { display: flex; justify-content: space-between; align-items: center; }
        .public-info-label { font-size: 14px; color: #6c5f5a; }
        .public-info-value { font-size: 14px; font-weight: 600; color: #242038; }
        .public-footer { margin-top: 24px; text-align: center; }
        .public-footer p { margin: 0; font-size: 12px; color: #6c5f5a; }
      `}</style>
    </>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="public-info-row">
      <span className="public-info-label">{label}</span>
      <span className="public-info-value">{value}</span>
    </div>
  );
}
