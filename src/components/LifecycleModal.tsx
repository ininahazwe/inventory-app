// src/components/LifecycleModal.tsx
import { useState } from "react";
import Modal from "./Modal";

type LifecycleAction = "repair" | "exit_repair" | "retire";

type LifecycleModalProps = {
  open: boolean;
  onClose: () => void;
  action: LifecycleAction | null;
  assetLabel: string;
  onConfirm: (data: { notes?: string; cost?: number }) => Promise<void>;
  busy: boolean;
};

export default function LifecycleModal({
  open,
  onClose,
  action,
  assetLabel,
  onConfirm,
  busy
}: LifecycleModalProps) {
  const [notes, setNotes] = useState("");
  const [cost, setCost] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    
    let costValue: number | undefined;
    if (action === "exit_repair" && cost.trim()) {
      const parsed = Number(cost.replace(",", "."));
      if (Number.isNaN(parsed) || parsed < 0) {
        setError("Le coût doit être un nombre positif");
        return;
      }
      costValue = Math.round(parsed * 100) / 100;
    }

    try {
      await onConfirm({
        notes: notes.trim() || undefined,
        cost: costValue
      });
      // Reset form
      setNotes("");
      setCost("");
      setError("");
    } catch (err: any) {
      setError(err.message || "Une erreur est survenue");
    }
  };

  const handleClose = () => {
    if (!busy) {
      setNotes("");
      setCost("");
      setError("");
      onClose();
    }
  };

  const getTitle = () => {
    switch (action) {
      case "repair":
        return "Mettre en réparation";
      case "exit_repair":
        return "Sortie de réparation";
      case "retire":
        return "Retrait définitif";
      default:
        return "";
    }
  };

  const getMessage = () => {
    switch (action) {
      case "repair":
        return `Confirmer l'envoi de "${assetLabel}" en réparation ?`;
      case "exit_repair":
        return `Confirmer la sortie de réparation de "${assetLabel}" ?`;
      case "retire":
        return `Confirmer le retrait définitif de "${assetLabel}" ? Cette action est irréversible.`;
      default:
        return "";
    }
  };

  const getDefaultNotes = () => {
    switch (action) {
      case "exit_repair":
        return "Réparation terminée";
      case "retire":
        return "Retiré du service";
      default:
        return "";
    }
  };

  const getConfirmButtonText = () => {
    switch (action) {
      case "repair":
        return "Envoyer en réparation";
      case "exit_repair":
        return "Terminer la réparation";
      case "retire":
        return "Retirer définitivement";
      default:
        return "Confirmer";
    }
  };

  const getConfirmButtonClass = () => {
    return `pill ${action === "retire" ? "pill--danger" : ""}`;
  };

  return (
    <Modal 
      open={open} 
      onClose={handleClose} 
      title={getTitle()}
      closeOnBackdrop={!busy}
    >
      <form onSubmit={handleSubmit} className="form-grid">
        <div className="span-2">
          <p style={{ margin: "0 0 16px 0", color: "var(--muted)" }}>
            {getMessage()}
          </p>
        </div>

        {action === "exit_repair" && (
          <div className="span-2">
            <label className="label">Coût de la réparation (optionnel)</label>
            <input
              className="field"
              type="text"
              inputMode="decimal"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              placeholder="0.00"
              disabled={busy}
            />
          </div>
        )}

        <div className="span-2">
          <label className="label">Notes (optionnel)</label>
          <textarea
            className="field"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={getDefaultNotes()}
            disabled={busy}
          />
        </div>

        {error && (
          <div className="span-2">
            <p style={{ color: "crimson", margin: "0" }}>{error}</p>
          </div>
        )}

        <div className="span-2 modal-actions">
          <button 
            type="button" 
            className="pill pill--muted" 
            onClick={handleClose}
            disabled={busy}
          >
            Annuler
          </button>
          <button 
            type="submit" 
            className={getConfirmButtonClass()}
            disabled={busy}
          >
            {busy ? "…" : getConfirmButtonText()}
          </button>
        </div>
      </form>
    </Modal>
  );
}