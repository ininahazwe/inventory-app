import { useEffect } from "react";

export default function Modal({ title, open, onClose, children }:{
    title?: string; open: boolean; onClose: () => void; children: React.ReactNode;
}) {
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
        if (open) document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [open, onClose]);

    if (!open) return null;
    return (
        <div className="modal-backdrop" onMouseDown={onClose}>
            <div className="modal" onMouseDown={(e)=>e.stopPropagation()}>
                <div className="modal-head">
                    <h3 style={{ margin:0 }}>{title}</h3>
                    <button className="modal-close" onClick={onClose} aria-label="Fermer">×</button>
                </div>
                {children}
            </div>
        </div>
    );
}
