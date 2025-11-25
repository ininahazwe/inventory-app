// src/screens/PublicAssetDetail.tsx
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { supabase } from "../lib/supabaseClient";

type PublicAsset = {
  id: number;
  label: string;
  category_name: string | null;
  serial_no: string | null;
  status: "in_stock" | "assigned" | "repair" | "retired";
  created_at: string | null;
  assignee_name: string | null;
};

export default function PublicAssetDetail() {
  const { id } = useParams();
  const assetId = Number(id);

  const [asset, setAsset] = useState<PublicAsset | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const siteUrl = import.meta.env.VITE_SITE_URL || window.location.origin;

  const qrDataUrl = useMemo(() => {
    if (!asset) return "";
    return `${siteUrl}/p/${asset.id}`;
  }, [asset, siteUrl]);

  const qrImg = useMemo(() => {
    if (!qrDataUrl) return "";
    return `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrDataUrl)}`;
  }, [qrDataUrl]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);

      try {
        console.log("Fetching asset ID:", assetId);
        
        const { data, error: fetchError, status } = await supabase
        .from("v_asset_overview")
        .select("id, label, category_name, serial_no, status, assignee_name, created_at")
        .eq("id", assetId)
        .single();

        console.log("Response status:", status);
        console.log("Response data:", data);
        console.log("Response error:", fetchError);

        if (fetchError) {
          setError("Asset introuvable");
          return;
        }

        setAsset(data as PublicAsset);
      } catch (err: any) {
        console.log("Catch error:", err);
        setError(err.message || "Erreur de chargement");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [assetId]);

  const getStatusLabel = (status: string) => {
    switch (status) {
      case "in_stock": return "En stock";
      case "assigned": return "Assigné";
      case "repair": return "En réparation";
      case "retired": return "Retiré";
      default: return status;
    }
  };

  const getStatusStyle = (status: string) => {
    switch (status) {
      case "assigned":
        return { background: "var(--brand)", color: "#fff" };
      case "repair":
        return { background: "#b98b46", color: "#fff" };
      case "retired":
        return { background: "#eee", color: "#888" };
      default:
        return { background: "#f4f1ee", color: "var(--ink)" };
    }
  };

  if (loading) {
    return (
      <div className="public-asset-shell">
        <div className="public-asset-card">
          <p style={{ textAlign: "center", padding: 40, color: "var(--muted)" }}>
            Chargement…
          </p>
        </div>
      </div>
    );
  }

  if (error || !asset) {
    return (
      <div className="public-asset-shell">
        <div className="public-asset-card">
          <p style={{ textAlign: "center", padding: 40, color: "crimson" }}>
            {error || "Asset introuvable"}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="public-asset-shell">
      <motion.div
        className="public-asset-card"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        {/* QR Code */}
        {/* <div className="public-qr-section">
          <img src={qrImg} alt="QR Code" width={120} height={120} />
        </div> */}

        {/* Header */}
        <div className="public-header">
          <h1 className="public-title">{asset.label}</h1>
          <span
            className="public-status"
            style={{
              ...getStatusStyle(asset.status),
              padding: "6px 12px",
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            {getStatusLabel(asset.status)}
          </span>
        </div>

        {/* Infos */}
        <div className="public-infos">
          <InfoRow label="Catégorie" value={asset.category_name || "—"} />
          <InfoRow label="Numéro de série" value={asset.serial_no || "—"} />
          <InfoRow label="Date de création" value={asset.created_at ? new Date(asset.created_at).toLocaleDateString() : "—"} />
          {asset.status === "assigned" && asset.assignee_name && (
            <InfoRow label="Assigné à" value={asset.assignee_name} />
          )}
        </div>

        {/* Footer */}
        <div className="public-footer">
          <button 
            onClick={() => {
              sessionStorage.setItem("redirectAfterLogin", `/asset/${asset.id}`);
              window.location.href = `/asset/${asset.id}`;
            }} 
            className="admin-link"
          >
            Accès administrateur
          </button>
        </div>
      </motion.div>

      <style>{`
        .public-asset-shell {
          min-height: 100vh;
          background: #E5E2DA;
          display: flex;
          justify-content: center;
          align-items: center;
          padding: 20px;
          font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
        }
        
        .public-asset-card {
          background: #fff;
          border-radius: 24px;
          padding: 32px;
          max-width: 400px;
          width: 100%;
          box-shadow: 0 10px 40px rgba(0,0,0,0.1);
        }
        
        .public-qr-section {
          display: flex;
          justify-content: center;
          margin-bottom: 24px;
        }
        
        .public-qr-section img {
          border-radius: 12px;
          border: 1px solid #eee;
        }
        
        .public-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 24px;
          gap: 12px;
          flex-wrap: wrap;
        }
        
        .public-title {
          margin: 0;
          font-size: 24px;
          font-weight: 700;
          color: #242038;
        }
        
        .public-infos {
          display: flex;
          flex-direction: column;
          gap: 16px;
          padding: 20px;
          background: #f9f8f6;
          border-radius: 16px;
        }
        
        .public-info-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        
        .public-info-label {
          font-size: 14px;
          color: #6c5f5a;
        }
        
        .public-info-value {
          font-size: 14px;
          font-weight: 600;
          color: #242038;
        }
        
        .public-footer {
          margin-top: 24px;
          text-align: center;
        }
        
        .public-footer p {
          margin: 0;
          font-size: 12px;
          color: #6c5f5a;
        }

        .admin-link {
          font-size: 12px;
          color: #999;
          text-decoration: none;
          padding: 8px 16px;
          border: 1px solid #e0e0e0;
          border-radius: 8px;
          transition: all 0.2s ease;
          display: inline-block;
        }

        .admin-link:hover {
          color: #666;
          border-color: #ccc;
          background: #f9f9f9;
        }
      `}</style>
    </div>
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