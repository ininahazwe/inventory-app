// src/pages/IncidentsPage.tsx
import React from "react";
import Layout from "../Layout";
import { IncidentsList } from "../screens/IncidentsList";
import { SectionRevealCover } from "../components/SectionRevealCover";

export default function IncidentsPage() {
  return (
    <Layout>
      <SectionRevealCover sectionKey="incidents" />
      <IncidentsList />
    </Layout>
  );
}
