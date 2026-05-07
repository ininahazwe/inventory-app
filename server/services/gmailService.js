const nodemailer = require('nodemailer');

// Créer un transporteur Gmail
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD, // Utiliser un mot de passe d'application Gmail
    },
});

/**
 * Envoyer un email de remerciement au nouvel enchérisseur
 * @param {string} bidderEmail - Email de l'enchérisseur
 * @param {object} auction - Détails de l'enchère
 * @param {number} bidAmount - Montant de la mise
 */
async function sendBidConfirmationEmail(bidderEmail, auction, bidAmount) {
    const mailOptions = {
        from: process.env.GMAIL_USER,
        to: bidderEmail,
        subject: `Bid Confirmation - ${auction.label}`,
        html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">✅ Your Bid Has Been Placed</h2>
        <p>Thank you for bidding! Here are your bid details:</p>
        
        <div style="background: #f5f5f5; padding: 16px; border-radius: 4px; margin: 16px 0;">
          <h3 style="margin-top: 0; color: #333;">${auction.label}</h3>
          <p><strong>Serial Number:</strong> ${auction.serial_no || 'N/A'}</p>
          <p><strong>Category:</strong> ${auction.category || 'N/A'}</p>
          <p><strong>Your Bid Amount:</strong> <span style="color: #8D86C9; font-weight: bold;">$${bidAmount.toFixed(2)}</span></p>
          <p><strong>Auction Ends:</strong> ${new Date(auction.end_date).toLocaleString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        })}</p>
        </div>
        
        <p>If your bid is the highest when the auction ends, you will be notified as the winner.</p>
        
        <p style="color: #666; font-size: 12px; margin-top: 24px;">
          This is an automated email from MFWA Auction Platform. Please do not reply to this email.
        </p>
      </div>
    `,
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`✅ Bid confirmation email sent to ${bidderEmail}`);
    } catch (error) {
        console.error(`❌ Error sending bid confirmation email to ${bidderEmail}:`, error);
        throw error;
    }
}

/**
 * Envoyer un email de notification aux autres enchérisseurs
 * @param {array} otherBidderEmails - Liste des emails des autres enchérisseurs
 * @param {object} auction - Détails de l'enchère
 * @param {number} newBidAmount - Montant de la nouvelle mise
 * @param {string} newBidderEmail - Email de celui qui a fait la nouvelle mise
 */
async function sendOutbidNotificationEmails(otherBidderEmails, auction, newBidAmount, newBidderEmail) {
    if (!otherBidderEmails || otherBidderEmails.length === 0) {
        return;
    }

    const mailOptions = {
        from: process.env.GMAIL_USER,
        subject: `You've Been Outbid - ${auction.label}`,
        html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #d32f2f;">⚠️ You've Been Outbid</h2>
        <p>Someone has placed a higher bid on the item you're interested in.</p>
        
        <div style="background: #fff3cd; padding: 16px; border-radius: 4px; margin: 16px 0; border-left: 4px solid #d32f2f;">
          <h3 style="margin-top: 0; color: #333;">${auction.label}</h3>
          <p><strong>Category:</strong> ${auction.category || 'N/A'}</p>
          <p><strong>Current Highest Bid:</strong> <span style="color: #d32f2f; font-weight: bold;">$${newBidAmount.toFixed(2)}</span></p>
          <p><strong>Auction Ends:</strong> ${new Date(auction.end_date).toLocaleString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        })}</p>
        </div>
        
        <p>You can place a new bid to stay in the auction. Visit the auction page to increase your bid.</p>
        
        <p style="color: #666; font-size: 12px; margin-top: 24px;">
          This is an automated email from MFWA Auction Platform. Please do not reply to this email.
        </p>
      </div>
    `,
    };

    try {
        // Envoyer un email à chaque enchérisseur (sauf celui qui vient de faire la nouvelle mise)
        const emailsToSend = otherBidderEmails.filter((email) => email !== newBidderEmail);

        if (emailsToSend.length > 0) {
            // Envoyer individuellement pour éviter les fuites d'email
            for (const email of emailsToSend) {
                await transporter.sendMail({
                    ...mailOptions,
                    to: email,
                });
            }
            console.log(`✅ Outbid notifications sent to ${emailsToSend.length} bidders`);
        }
    } catch (error) {
        console.error('❌ Error sending outbid notification emails:', error);
        throw error;
    }
}

module.exports = {
    sendBidConfirmationEmail,
    sendOutbidNotificationEmails,
};