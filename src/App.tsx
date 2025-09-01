// src/App.tsx
import { useState } from "react";
import Home from "./screens/Home";
import NewAsset from "./screens/NewAsset";
import Modal from "./components/Modal";

export default function App() {
    const [showNew, setShowNew] = useState(false);

    return (
        <main>
            <Home onNew={() => setShowNew(true)} />
            <Modal open={showNew} onClose={() => setShowNew(false)} title="Nouveau matériel">
                <NewAsset
                    onCreated={() => {
                        setShowNew(false);
                        location.reload(); // simple; on peut remplacer par un refetch si tu préfères
                    }}
                    onCancel={() => setShowNew(false)}
                />
            </Modal>
        </main>
    );
}
