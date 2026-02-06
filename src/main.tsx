import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import "./styles/theme.css";
import "./styles/incidents.css";
import HomePage from "./pages/HomePage";
import AssetDetailPage from "./pages/AssetDetailPage";
import IncidentsPage from "./pages/IncidentsPage";
import IncidentDetailPage from "./pages/IncidentDetailPage";
import IncidentReportPage from "./pages/IncidentReportPage";
import AuthGateWrapper from "./AuthGateWrapper";
import { ConfirmProvider } from "./components/ConfirmProvider";

const router = createBrowserRouter([
  {
    element: <AuthGateWrapper />,
    children: [
      { path: "/", element: <HomePage /> },
      { path: "/asset/:id", element: <AssetDetailPage /> },
      { path: "/asset/:id/report-incident", element: <IncidentReportPage /> },
      { path: "/incidents", element: <IncidentsPage /> },
      { path: "/incidents/:id", element: <IncidentDetailPage /> },
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
