// src/main.tsx - COMPLET AVEC ROUTE PUBLIQUE

import './env.ts';
import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import "./styles/theme.css";
import "./styles/incidents.css";
import AuthGateWrapper from "./AuthGateWrapper.tsx";
import HomePage from "./pages/HomePage.tsx";
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
import CreateSupplyPage from "./pages/CreateSupplyPage.tsx";
import EditSupplyPage from "./pages/EditSupplyPage.tsx";
import LegacyQrRedirect from "./components/LegacyQrRedirect.tsx";
//import PublicAssetDetail from "./pages/PublicAssetDetail.tsx";

const router = createBrowserRouter([
  // ✅ ROUTE PUBLIQUE - Accessible sans authentification
  {
    path: "/:id/public",
    element: <LegacyQrRedirect />,
  },

  // ✅ ROUTES AUTHENTIFIÉES - Nécessitent AuthGateWrapper
  {
    element: <AuthGateWrapper />,
    children: [
      { path: "/", element: <HomePage /> },

      // Routes spécifiques d'abord
      { path: "/auctions/create", element: <CreateAuctionPage /> },
      { path: "/asset/:id/report-incident", element: <IncidentReportPage /> },

      // Routes paramétrées après
      { path: "/asset/:id", element: <AssetDetailPage /> },
      { path: "/auctions/:auctionId", element: <AuctionDetailPage /> },
      { path: "/auctions", element: <AuctionsPage /> },
      { path: "/incidents/:id", element: <IncidentDetailPage /> },
      { path: "/incidents", element: <IncidentsPage /> },
      { path: "/supplies/create", element: <CreateSupplyPage /> },
      { path: "/supplies/:id/edit", element: <EditSupplyPage /> },
      { path: "/supplies", element: <SuppliesPage /> },
      { path: "/assignees", element: <AssigneesPage /> },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConfirmProvider>
      <RouterProvider router={router} />
    </ConfirmProvider>
  </React.StrictMode>
);
