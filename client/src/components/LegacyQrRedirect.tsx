import React from "react";
import { Navigate, useParams } from "react-router-dom";

export default function LegacyQrRedirect() {
  const { id } = useParams();
  return <Navigate to={`/public/asset/${id}`} replace />;
}
