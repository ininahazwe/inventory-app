// src/pages/IncidentsPage.tsx
import React from "react";
import Layout from "../Layout";
import { IncidentsList } from "../screens/IncidentsList";

export default function IncidentsPage() {
  return (
    <Layout>
      <IncidentsList />
    </Layout>
  );
}
