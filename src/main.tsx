import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import AuthGate from "./AuthGate";
import "./styles/theme.css";
import HomePage from "./pages/HomePage";
import AssetDetailPage from "./pages/AssetDetailPage";

const router = createBrowserRouter([
    { path: "/", element: <HomePage /> },
    { path: "/asset/:id", element: <AssetDetailPage /> },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <AuthGate>
            <RouterProvider router={router} />
        </AuthGate>
    </React.StrictMode>
);
