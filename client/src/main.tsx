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
import {ConfirmProvider} from "./components/ConfirmProvider.tsx";
import AuctionsPage from './pages/AuctionsPage';
import CreateAuctionPage from "./pages/CreateAuctionPage.tsx";
import AuctionDetailPage from "./pages/Auctiondetailpage.tsx";
import {SuppliesPage} from "./pages/SuppliesPage.tsx";


const router = createBrowserRouter([
  {
    element: <AuthGateWrapper />,
    children: [
      { path: "/", element: <HomePage /> },

      // Routes spécifiques d'abord
      { path: "/auctions/create", element: <CreateAuctionPage /> },
      { path: "/asset/:id/report-incident", element: <IncidentReportPage /> },

      // Routes paramétrées après
      { path: "/asset/:id", element: <AssetDetailPage /> },
      { path: "/auctions", element: <AuctionsPage /> },
      { path: "/auctions/:auctionId", element: <AuctionDetailPage /> },
      { path: "/incidents/:id", element: <IncidentDetailPage /> },
      { path: "/incidents", element: <IncidentsPage /> },
      { path: "/supplies", element: <SuppliesPage  /> },
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
