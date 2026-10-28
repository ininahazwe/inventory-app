// src/main.tsx - COMPLET AVEC ROUTE PUBLIQUE

import './env.ts';
import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import "./styles/theme.css";
import "./styles/incidents.css";
import AuthGateWrapper from "./AuthGateWrapper.tsx";
import HomePage from "./pages/HomePage.tsx";
import InventoryPage from "./pages/InventoryPage.tsx";
import AssetDetailPage from "./pages/AssetDetailPage.tsx";
import IncidentReportPage from "./pages/IncidentReportPage.tsx";
import IncidentsPage from "./pages/IncidentsPage.tsx";
import IncidentDetailPage from "./pages/IncidentDetailPage.tsx";
import { ConfirmProvider } from "./components/ConfirmProvider.tsx";
import AuctionsPage from './pages/AuctionsPage';
import CreateAuctionPage from "./pages/CreateAuctionPage.tsx";
import AuctionDetailPage from "./pages/Auctiondetailpage.tsx";
import AssigneesPage from "./pages/AssigneesPage.tsx";
import SuppliesPage from "./pages/SuppliesPage.tsx";
import SupplyItemsPage from "./pages/SupplyItemsPage.tsx";
import SupplyItemDetailPage from "./pages/SupplyItemDetailPage.tsx";
import SupplyReceiptFormPage from "./pages/SupplyReceiptFormPage.tsx";
import SupplyIssueFormPage from "./pages/SupplyIssueFormPage.tsx";
import SupplyAdjustFormPage from "./pages/SupplyAdjustFormPage.tsx";
import LegacyQrRedirect from "./components/LegacyQrRedirect.tsx";
import PublicAssetPage from "./pages/PublicAssetPage.tsx";
import LocationsPage from "./pages/LocationsPage.tsx";
import LocationDetailPage from "./pages/LocationDetailPage.tsx";
import LoansPage from "./pages/LoansPage.tsx";
import LoanRequestFormPage from "./pages/LoanRequestFormPage.tsx";
import LoanDetailPage from "./pages/LoanDetailPage.tsx";
import MemosPage from "./pages/MemosPage.tsx";
import MemoFormPage from "./pages/MemoFormPage.tsx";
import MemoDetailPage from "./pages/MemoDetailPage.tsx";
import MemoAdminPage from "./pages/MemoAdminPage.tsx";
import RequireAdmin from "./components/RequireAdmin.tsx";
import RequireMemoAccess from "./components/RequireMemoAccess.tsx";
import AppShell from "./components/AppShell.tsx";

const router = createBrowserRouter([
  {
    path: "/:id/public",
    element: <LegacyQrRedirect />,
  },
  {
    path: "/public/asset/:id",
    element: <PublicAssetPage />,
  },

  // ✅ ROUTES AUTHENTIFIÉES - Nécessitent AuthGateWrapper
  {
    element: <AuthGateWrapper />,
    children: [{
    element: <AppShell />,
    children: [
      { path: "/", element: <HomePage /> },
      { path: "/inventory", element: <InventoryPage /> },

      // Routes spécifiques d'abord
      { path: "/auctions/create", element: <CreateAuctionPage /> },
      { path: "/asset/:id/report-incident", element: <IncidentReportPage /> },

      // Routes paramétrées après
      { path: "/asset/:id", element: <AssetDetailPage /> },
      { path: "/auctions/:auctionId", element: <AuctionDetailPage /> },
      { path: "/auctions", element: <AuctionsPage /> },
      { path: "/incidents/:id", element: <IncidentDetailPage /> },
      { path: "/incidents", element: <IncidentsPage /> },
      { path: "/loans/new", element: <LoanRequestFormPage /> },
      { path: "/loans/:id", element: <LoanDetailPage /> },
      { path: "/loans", element: <LoansPage /> },
      // Memos: admins and people declared in /memos/admin
      {
        element: <RequireMemoAccess />,
        children: [
          { path: "/memos/new", element: <MemoFormPage /> },
          { path: "/memos/:id/edit", element: <MemoFormPage /> },
          { path: "/memos/:id", element: <MemoDetailPage /> },
          { path: "/memos", element: <MemosPage /> },
        ],
      },
      { path: "/assignees", element: <AssigneesPage /> },

      // Supplies module (and locations): admins only
      {
        element: <RequireAdmin />,
        children: [
        { path: "/memos/admin", element: <MemoAdminPage /> },
        { path: "/supplies/create", element: <SupplyReceiptFormPage /> },
        { path: "/supplies/:id/edit", element: <SupplyReceiptFormPage /> },
        { path: "/supplies/issue", element: <SupplyIssueFormPage /> },
        { path: "/supplies/adjust", element: <SupplyAdjustFormPage /> },
        { path: "/supplies", element: <SuppliesPage /> },
        { path: "/supply-items", element: <SupplyItemsPage /> },
        { path: "/supply-items/:id", element: <SupplyItemDetailPage /> },
        { path: "/locations", element: <LocationsPage /> },
        { path: "/locations/:id", element: <LocationDetailPage /> },
        ],
      },
    ],
    }],
  },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConfirmProvider>
      <RouterProvider router={router} />
    </ConfirmProvider>
  </React.StrictMode>
);
