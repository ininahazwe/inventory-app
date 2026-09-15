// src/pages/InventoryPage.tsx
// Was HomePage.tsx / route "/" — the hub now owns that name and that route.
// This is the IT equipment inventory dashboard, mounted at "/inventory".
import React from "react";
import Layout from "../Layout";
import Home from "../screens/Home";
import NewAsset from "../screens/NewAsset";
import Modal from "../components/Modal";
import { useState } from "react";
import { SectionRevealCover } from "../components/SectionRevealCover";

export default function InventoryPage(){
    const [showNew, setShowNew] = useState(false);
    return (
        <Layout>
            <SectionRevealCover sectionKey="inventory" />
            <Home onNew={()=>setShowNew(true)} />
            <Modal open={showNew} onClose={()=>setShowNew(false)} title="New asset">
                <NewAsset onCreated={()=>{ setShowNew(false); location.reload(); }} onCancel={()=>setShowNew(false)} />
            </Modal>
        </Layout>
    );
}
