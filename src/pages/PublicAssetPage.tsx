import PublicAssetCard from "../screens/PublicAssetCard";
import "../styles/theme.css";

export default function PublicAssetPage() {
  return (
    <div style={{ minHeight: "100vh", background: "#E5E2DA" }}>
      {/* Header minimal */}
      <header
        style={{
          padding: "16px 28px",
          borderBottom: "1px solid #ccc",
          background: "#E5E2DA",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 600, color: "var(--brand)" }}>
          🏢 INVENTORY
        </div>
        <button
          onClick={() => window.location.href = "/"}
          style={{
            padding: "8px 14px",
            borderRadius: 6,
            border: "1px solid #ddd",
            background: "#fff",
            cursor: "pointer",
            fontSize: 14,
            fontWeight: 500,
          }}
        >
          Back
        </button>
      </header>

      {/* Contenu public */}
      <PublicAssetCard />
    </div>
  );
}
