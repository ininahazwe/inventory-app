const nodemailer = require('nodemailer');

// Créer le transporteur SMTP (cPanel)
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'mail.mfwa.org', // ou IP cPanel
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true', // true si port 465, false si 587
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
});

// Test connexion au démarrage
transporter.verify((error, success) => {
    if (error) {
        console.error('❌ Email service config error:', error);
    } else {
        console.log('✅ Email service ready');
    }
});

async function sendOutbidNotification(auctionId, previousBidderEmail, newBidAmount) {
    const mailOptions = {
        from: process.env.SMTP_FROM || 'noreply@mfwa.org',
        to: previousBidderEmail,
        subject: `Vous avez été surenchéri sur l'enchère #${auctionId}`,
        html: `
      <h2>Surenchère détectée</h2>
      <p>Quelqu'un a placé une enchère plus élevée (${newBidAmount} FCFA) que la vôtre.</p>
      <p><a href="https://assets.mfwa.org/auctions/${auctionId}">Voir l'enchère</a></p>
    `,
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`✅ Outbid email sent to ${previousBidderEmail}`);
    } catch (error) {
        console.error('❌ Email error:', error);
    }
}

async function sendWinnerNotification(auctionId, winnerEmail, creatorEmail, finalAmount) {
    const mailOptions = {
        from: process.env.SMTP_FROM || 'noreply@mfwa.org',
        to: winnerEmail,
        cc: creatorEmail,
        subject: `🏆 Vous avez remporté l'enchère #${auctionId}`,
        html: `
      <h2>Félicitations !</h2>
      <p>Vous avez remporté l'enchère pour <strong>${finalAmount} FCFA</strong>.</p>
      <p>Contactez l'administrateur pour la collecte : <strong>${creatorEmail}</strong></p>
      <p><a href="https://assets.mfwa.org/auctions/${auctionId}">Voir les détails</a></p>
    `,
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`✅ Winner email sent to ${winnerEmail}`);
    } catch (error) {
        console.error('❌ Email error:', error);
    }
}

module.exports = {
    sendOutbidNotification,
    sendWinnerNotification,
};