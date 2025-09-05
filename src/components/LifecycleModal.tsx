// src/components/LifecycleModal.tsx
import { useState, useEffect } from "react";
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
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reset form when modal opens/closes or action changes
  useEffect(() => {
    if (!open) {
      setNotes("");
      setCost("");
      setError("");
      setIsSubmitting(false);
    }
  }, [open, action]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isSubmitting || busy) return;

    setError("");
    setIsSubmitting(true);

    try {
      let costValue: number | undefined;
      if (action === "exit_repair" && cost.trim()) {
        const parsed = Number(cost.replace(",", "."));
        if (Number.isNaN(parsed) || parsed < 0) {
          setError("Le coût doit être un nombre positif");
          return;
        }
        costValue = Math.round(parsed * 100) / 100;
      }

      await onConfirm({
        notes: notes.trim() || undefined,
        cost: costValue
      });

      // Le modal sera fermé par le parent après succès

    } catch (err: any) {
      console.error("Erreur dans LifecycleModal:", err);
      setError(err.message || "Une erreur est survenue");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!busy && !isSubmitting) {
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
      case "repair":
        return "Envoyé en réparation";
      case "exit_repair":
        return "Réparation terminée";
      case "retire":
        return "Retiré du service";
      default:
        return "";
    }
  };

  const getConfirmButtonText = () => {
    if (isSubmitting) return "...";

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
    let baseClass = "pill";
    if (action === "retire") {
      baseClass += " pill--danger";
    }
    return baseClass;
  };

  // Ne pas rendre le modal si pas d'action
  if (!action) return null;

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={getTitle()}
      closeOnBackdrop={!busy && !isSubmitting}
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
              disabled={busy || isSubmitting}
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
            disabled={busy || isSubmitting}
          />
        </div>

        {error && (
          <div className="span-2">
            <p style={{ color: "crimson", margin: "0", padding: "8px", backgroundColor: "#fee", borderRadius: "4px" }}>
              {error}
            </p>
          </div>
        )}

        <div className="span-2 modal-actions">
          <button
            type="button"
            className="pill pill--muted"
            onClick={handleClose}
            disabled={busy || isSubmitting}
          >
            Annuler
          </button>
          <button
            type="submit"
            className={getConfirmButtonClass()}
            disabled={busy || isSubmitting}
          >
            {getConfirmButtonText()}
          </button>
        </div>
      </form>
    </Modal>
  );
}
