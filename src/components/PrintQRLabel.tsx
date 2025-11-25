// src/components/PrintQRLabel.tsx

type PrintQRLabelProps = {
  assetId: number;
  assetLabel: string;
};

export default function PrintQRLabel({ assetId, assetLabel }: PrintQRLabelProps) {
  const siteUrl = import.meta.env.VITE_SITE_URL || window.location.origin;
  const qrUrl = `${siteUrl}/p/${assetId}`;
  const qrImg = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qrUrl)}`;

  const handlePrint = () => {
    const printWindow = window.open("", "_blank", "width=400,height=300");
    if (!printWindow) {
      alert("Impossible d'ouvrir la fenêtre d'impression. Vérifiez les popups.");
      return;
    }

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>QR - ${assetLabel}</title>
        <style>
          @page {
            size: 60mm 40mm;
            margin: 0 !important;
            padding: 0 !important;
          }
          
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          
          html, body {
            width: 60mm;
            height: 40mm;
            margin: 0 !important;
            padding: 0 !important;
            background: #fff;
            overflow: hidden;
          }
          
          .label {
            position: absolute;
            top: 3mm;
            left: 30mm;  /* Décalage vers la droite - AJUSTE ICI */
            width: 34mm;
            height: 34mm;
          }
          
          .label img {
            width: 100%;
            height: 100%;
            object-fit: contain;
          }
          
          @media print {
            @page {
              size: 60mm 40mm;
              margin: 0 !important;
            }
            
            html, body {
              width: 60mm;
              height: 40mm;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
          }
        </style>
      </head>
      <body>
        <div class="label">
          <img src="${qrImg}" alt="QR Code" />
        </div>
        <script>
          window.onload = function() {
            setTimeout(function() {
              window.print();
              window.onafterprint = function() { window.close(); };
            }, 500);
          };
        </script>
      </body>
      </html>
    `);
    
    printWindow.document.close();
  };

  return (
    <button 
      className="pill" 
      onClick={handlePrint}
      style={{ display: "flex", alignItems: "center", gap: 6 }}
    >
      🏷️ Print QR
    </button>
  );
}