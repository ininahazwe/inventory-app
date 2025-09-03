// src/components/Modal.tsx
import { useEffect, useRef } from "react";

export default function Modal({
  title,
  open,
  onClose,
  children,
  closeOnBackdrop = true,
}: {
  title?: string;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  closeOnBackdrop?: boolean;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // ESC = ferme
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    if (open) document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Focus automatique quand le modal s'ouvre
  useEffect(() => {
    if (open) {
      setTimeout(() => dialogRef.current?.focus(), 0);
    }
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      onClick={closeOnBackdrop ? onClose : undefined}
      aria-hidden
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={dialogRef}
        // stopPropagation = évite de fermer quand on clique dans le contenu
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h3 style={{ margin: 0 }}>{title}</h3>
          <button className="modal-close" onClick={onClose} aria-label="Fermer">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}