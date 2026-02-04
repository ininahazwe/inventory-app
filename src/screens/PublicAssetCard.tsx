// src/screens/PublicAssetCard.tsx
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { supabase } from "../lib/supabaseClient";
import Modal from "../components/Modal";

type PublicAsset = {
  id: number;
  label: string;
  category_name: string | null;
  serial_no: string | null;
  status: "in_stock" | "assigned" | "repair" | "retired";
  created_at: string | null;
  assignee_name: string | null;
};

export default function PublicAssetCard() {
  const { id } = useParams();
  const assetId = Number(id);

  const [asset, setAsset] = useState<PublicAsset | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ✅ NOUVEAU: États pour l'authentification
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);

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

  // ✅ NOUVEAU: Gestionnaire pour le bouton "Do more"
  const handleDoMore = async () => {
    try {
      setAuthLoading(true);
      // Vérifier si utilisateur est déjà authentifié
      const { data: sessionData } = await supabase.auth.getSession();

      if (sessionData?.session) {
        // Déjà authentifié → recharger la page (affichera AssetDetail)
        window.location.reload();
        return;
      }

      // Sinon afficher le modal d'authentification
      setAuthModalOpen(true);
    } catch (error) {
      console.error("Error checking session:", error);
    } finally {
      setAuthLoading(false);
    }
  };

  // ✅ NOUVEAU: Gestionnaire pour OAuth Google
  const handleGoogleAuth = async () => {
    try {
      setAuthLoading(true);
      await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/asset/${assetId}`
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Erreur d'authentification";
      setError(errorMessage);
    } finally {
      setAuthLoading(false);
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case "in_stock":
        return "En stock";
      case "assigned":
        return "Assigné";
      case "repair":
        return "En réparation";
      case "retired":
        return "Retiré";
      default:
        return status;
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
            Loading…
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
            {error || "Asset not found"}
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="public-asset-shell">
        <motion.div
          className="public-asset-card"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
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
            <InfoRow label="Category" value={asset.category_name || "—"} />
            <InfoRow label="Serial number" value={asset.serial_no || "—"} />
            <InfoRow
              label="Creation date"
              value={
                asset.created_at
                  ? new Date(asset.created_at).toLocaleDateString()
                  : "—"
              }
            />
            {asset.status === "assigned" && asset.assignee_name && (
              <InfoRow label="Assigned to" value={asset.assignee_name} />
            )}
          </div>

          {/* Footer - Bouton "Do more" */}
          <div className="public-footer">
            <button
              onClick={handleDoMore}
              disabled={authLoading}
              className="pill"
              style={{
                width: "100%",
                padding: "12px 20px",
                marginBottom: 12,
              }}
            >
              {authLoading ? "…" : "See more →"}
            </button>
            <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>
              Login to access more infos
            </p>
          </div>
        </motion.div>
      </div>

      {/* Modal d'authentification */}
      <Modal
        open={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        title="Se connecter"
        closeOnBackdrop={!authLoading}
      >
        <div style={{ textAlign: "center", padding: "20px 0" }}>
          <p style={{ color: "var(--muted)", marginBottom: 20 }}>
            Login to access more infos.
          </p>
          <button
            onClick={handleGoogleAuth}
            disabled={authLoading}
            className="pill"
            style={{
              width: "100%",
              padding: "12px 20px",
              background: "#1f2937",
              color: "#fff",
              marginBottom: 12,
            }}
          >
            {authLoading ? "Connexion…" : "Continuer avec Google"}
          </button>
          <button
            onClick={() => setAuthModalOpen(false)}
            disabled={authLoading}
            className="pill"
            style={{
              width: "100%",
              padding: "12px 20px",
              background: "#bbb",
            }}
          >
            Annuler
          </button>
        </div>
      </Modal>

      <style>{`
        .public-asset-shell {
          min-height: auto;
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
