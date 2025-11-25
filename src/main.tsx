import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import AuthGate from "./AuthGate";
import "./styles/theme.css";
import HomePage from "./pages/HomePage";
import AssetDetailPage from "./pages/AssetDetailPage";
import PublicAssetPage from "./pages/PublicAssetPage";
import { ConfirmProvider } from "./components/ConfirmProvider"; 

const router = createBrowserRouter([
    { path: "/", element: <AuthGate><HomePage /></AuthGate> },
    { path: "/asset/:id", element: <AuthGate><AssetDetailPage /></AuthGate> },
    { path: "/p/:id", element: <PublicAssetPage /> },  // ← SANS AuthGate
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConfirmProvider>
      <RouterProvider router={router} />
    </ConfirmProvider>
  </React.StrictMode>
);