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
            margin: 0;
        }
        
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        html, body {
            width: 60mm;
            height: 40mm;
            margin: 0;
            padding: 0;
            background: #fff;
        }
        
        .label {
            width: 60mm;
            height: 40mm;
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 2mm;
            margin-left: -5mm;
        }
        
        .label img {
            width: 34mm;
            height: 34mm;
            object-fit: contain;
            margin: 0 auto;
        }
        
        @media print {
            html, body {
            width: 60mm;
            height: 40mm;
            margin: 0 !important;
            padding: 0 !important;
            }
            
            .label {
            margin: 0 auto;
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