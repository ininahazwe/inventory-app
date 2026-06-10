import React from "react";
import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { api, auth, token } from "../lib/apiClient";
import Modal from "../components/Modal";
import { IncidentForm } from "../components/IncidentForm"; // 📋 Import de ton formulaire d'incident

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
  const [showIncidentForm, setShowIncidentForm] = useState(false); // 🌟 État pour le modal de l'incident

  useEffect(() => {
    api.get<PublicAsset>(`/assets/${assetId}/overview`, false).then(({ data, error }) => {
      if (error) setError("Asset introuvable");
      else setAsset(data);
      setLoading(false);
    });
  }, [assetId]);

  // 🌟 Détecte le retour de connexion Google pour ouvrir directement le formulaire d'incident
  useEffect(() => {
    if (token.get() && localStorage.getItem("pending_incident_asset_id") === id) {
      localStorage.removeItem("pending_incident_asset_id"); // Nettoyage du flag
      setShowIncidentForm(true); // Ouvre le modal et bloque le flux ici !
    }
  }, [id]);

  const handleReportIncident = async () => {
    try {
      setAuthLoading(true);
      if (token.get()) {
        setShowIncidentForm(true); // Si déjà connecté, on ouvre directement le modal d'incident
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
    // 🌟 Sauvegarde de l'état actuel avant de partir chez Google
    localStorage.setItem("after_login_redirect", window.location.pathname);
    localStorage.setItem("pending_incident_asset_id", id || "");
    auth.signInWithGoogle();
  };

  // ... (Garder le reste de tes fonctions getStatusLabel / getStatusStyle et les barrières d'affichage loading/error)

  return (
    <>
      {/* ... (Ton JSX de la carte de l'asset reste identique) ... */}

      {/* Modal de connexion Google */}
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

      {/* 🌟 Ton nouveau Modal d'incident qui s'ouvre et s'arrête ici */}
      {asset && (
        <Modal open={showIncidentForm} onClose={() => setShowIncidentForm(false)} title="Signaler un incident">
          <IncidentForm
            assetId={asset.id}
            assetLabel={asset.label}
            onCreated={incidentId => {
              setShowIncidentForm(false);
              navigate(`/incidents/${incidentId}`);
            }}
            onCancel={() => setShowIncidentForm(false)}
          />
        </Modal>
      )}

      {/* ... (Ton bloc <style> reste identique) ... */}
    </>
  );
}
