import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import "./styles/theme.css";
import HomePage from "./pages/HomePage";
import AssetDetailPage from "./pages/AssetDetailPage";
import AuthGateWrapper from "./AuthGateWrapper";
import { ConfirmProvider } from "./components/ConfirmProvider";

// ✅ Une SEULE route pour /asset/:id
// AssetDetail.tsx gère la logique:
// - Si pas auth → affiche PublicAssetCard
// - Si auth → affiche AssetDetail complet
const router = createBrowserRouter([
  {
    element: <AuthGateWrapper />,
    children: [
      { path: "/", element: <HomePage /> },
      { path: "/asset/:id", element: <AssetDetailPage /> }, // ← UNE SEULE route
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
