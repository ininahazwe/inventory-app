import { useState } from "react";
import {supabase} from "../lib/supabaseClient.ts";
import Modal from "./Modal.tsx";
import Autocomplete from "./Autocomplete.tsx";
export function AssignmentModal({
                                    open,
                                    onClose,
                                    assetId,
                                    onDone,
                                }: {
    open: boolean;
    onClose: () => void;
    assetId: number;
    onDone: () => Promise<void> | void;
}) {
    const [assignTarget, setAssignTarget] = useState("");
    const [assignNotes, setAssignNotes] = useState("");
    const [assigning, setAssigning] = useState(false);


    async function fetchPeopleOptions(q: string) {
        const base = supabase.from("people").select("name,email").order("name").limit(10);
        const { data, error } = q ? await base.ilike("name", `%${q}%`) : await base;
        if (error) return [];
        return (data ?? []).map((d: any) => (d.email ? `${d.name} <${d.email}>` : d.name as string));
    }


    const onSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const emailMatch = assignTarget.match(/<([^>]+)>/);
        const email = emailMatch ? emailMatch[1] : assignTarget.trim();
        if (!email) return;


        setAssigning(true);
        try {
            const { error } = await supabase.rpc("assign_asset", {
                p_asset_id: assetId,
                p_assignee_email: email,
                p_notes: assignNotes || null,
            });
            if (error) throw new Error(error.message);
            onClose();
            setAssignTarget("");
            setAssignNotes("");
            await onDone();
        } catch (e: any) {
            alert(e.message || "Erreur assignation");
        } finally {
            setAssigning(false);
        }
    };


    return (
        <Modal open={open} onClose={onClose} title="Attribuer cet équipement">
            <form onSubmit={onSubmit} className="form-grid">
                <div className="span-2">
                    <label className="label">Utilisateur</label>
                    <Autocomplete
                        className="field"
                        value={assignTarget}
                        onChange={setAssignTarget}
                        fetchOptions={fetchPeopleOptions}
                        placeholder="Nom ou email…"
                    />
                </div>
                <div className="span-2">
                    <label className="label">Notes (optionnel)</label>
                    <textarea className="field" rows={2} value={assignNotes} onChange={(e) => setAssignNotes(e.target.value)} />
                </div>
                <div className="span-2 modal-actions">
                    <button type="button" className="pill pill--muted" onClick={onClose}>
                        Annuler
                    </button>
                    <button className="pill" disabled={assigning}>
                        {assigning ? "Attribution…" : "Attribuer"}
                    </button>
                </div>
            </form>
        </Modal>
    );
}