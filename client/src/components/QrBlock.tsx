import React from "react";
export function QrBlock({ qrImg, qrDataUrl, onDownload }: { qrImg: string; qrDataUrl: string; onDownload: () => void }) {
    return (
        <section style={{ borderTop: "1px solid var(--line)", paddingTop: 12, marginBottom: 15 }}>
            <h3 style={{ margin: "8px 0" }}>QR Code</h3>
            <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
                <img src={qrImg} alt="QR" width={180} height={180} />
                <div>
                    <div style={{ color: "#666", fontSize: 12, wordBreak: "break-all" }}>
                        Encoded link : <code>{qrDataUrl}</code>
                    </div>
                    <div style={{ marginTop: 8 }}>
                        <button className="pill" onClick={onDownload} style={{ textDecoration: "none", border: "none", cursor: "pointer" }}>
                            📥 Download QR
                        </button>
                    </div>
                </div>
            </div>
            <p style={{ color: "#666", fontSize: 12, marginTop: 8 }}>
                (Public access without login is possible via a signed link/token.)
            </p>
        </section>
    );
}
