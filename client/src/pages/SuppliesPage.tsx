import React from "react";
import Layout from "../Layout";
import { SuppliesList } from "../screens/SuppliesList";
import { SectionRevealCover } from "../components/SectionRevealCover";

export default function SuppliesPage() {
  return (
    <Layout>
      <SectionRevealCover sectionKey="supplies" />
      <SuppliesList />
    </Layout>
  );
}
