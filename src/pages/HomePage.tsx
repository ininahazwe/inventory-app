// src/pages/HomePage.tsx
import Layout from "../Layout";
import Home from "../screens/Home";
import NewAsset from "../screens/NewAsset";
import Modal from "../components/Modal";
import { useState } from "react";

export default function HomePage(){
    const [showNew, setShowNew] = useState(false);
    return (
        <Layout>
            <Home onNew={()=>setShowNew(true)} />
            <Modal open={showNew} onClose={()=>setShowNew(false)} title="New asset">
                <NewAsset onCreated={()=>{ setShowNew(false); location.reload(); }} onCancel={()=>setShowNew(false)} />
            </Modal>
        </Layout>
    );
}
