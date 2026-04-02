const { Resend } = require('resend');

// Initialiser Resend avec la clé API
const resend = new Resend(process.env.RESEND_API_KEY);

const SENDER_EMAIL = 'onboarding@resend.dev';

console.log(
    process.env.RESEND_API_KEY
        ? '✅ Email service ready (Resend configured)'
        : '⚠️  Email service: RESEND_API_KEY not set (emails will be logged only)'
);

async function sendOutbidNotification(auctionId, previousBidderEmail, newBidAmount) {
    // Si pas de clé API, juste logger
    if (!process.env.RESEND_API_KEY) {
        console.log(`📧 [MOCK] Outbid email would be sent to ${previousBidderEmail}`);
        console.log(`   Auction #${auctionId}: New bid ${newBidAmount} FCFA`);
        return;
    }

    try {
        const response = await resend.emails.send({
            from: SENDER_EMAIL,
            to: previousBidderEmail,
            subject: `Vous avez été surenchéri sur l'enchère #${auctionId}`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #d9534f;">Surenchère détectée</h2>
                    <p>Quelqu'un a placé une enchère plus élevée de <strong>${newBidAmount} FCFA</strong> que la vôtre.</p>
                    <p>
                        <a href="https://assets.mfwa.org/auctions/${auctionId}" 
                           style="background-color: #5cb85c; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">
                            Voir l'enchère
                        </a>
                    </p>
                    <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
                    <p style="font-size: 12px; color: #999;">
                        MFWA Assets Management - ${new Date().getFullYear()}
                    </p>
                </div>
            `,
        });

        if (response.error) {
            console.error(`❌ Outbid email error: ${response.error.message}`);
        } else {
            console.log(`✅ Outbid email sent to ${previousBidderEmail} (ID: ${response.data.id})`);
        }
    } catch (error) {
        console.error('❌ Email service error:', error.message);
    }
}

async function sendWinnerNotification(auctionId, winnerEmail, creatorEmail, finalAmount) {
    // Si pas de clé API, juste logger
    if (!process.env.RESEND_API_KEY) {
        console.log(`📧 [MOCK] Winner email would be sent to ${winnerEmail}`);
        console.log(`   Auction #${auctionId}: Final amount ${finalAmount} FCFA`);
        console.log(`   CC to: ${creatorEmail}`);
        return;
    }

    try {
        const response = await resend.emails.send({
            from: SENDER_EMAIL,
            to: winnerEmail,
            cc: [creatorEmail],
            subject: `🏆 Vous avez remporté l'enchère #${auctionId}`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #28a745;">🏆 Félicitations !</h2>
                    <p>Vous avez remporté l'enchère pour <strong style="font-size: 18px; color: #28a745;">${finalAmount} FCFA</strong>.</p>
                    
                    <div style="background-color: #f0f8ff; padding: 15px; border-left: 4px solid #0066cc; margin: 20px 0;">
                        <p style="margin: 0;">
                            <strong>Prochaine étape :</strong> Contactez l'administrateur pour organiser la collecte.
                        </p>
                        <p style="margin: 10px 0 0 0;">
                            Email : <strong>${creatorEmail}</strong>
                        </p>
                    </div>
                    
                    <p>
                        <a href="https://assets.mfwa.org/auctions/${auctionId}" 
                           style="background-color: #0066cc; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">
                            Voir les détails de l'enchère
                        </a>
                    </p>
                    
                    <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
                    <p style="font-size: 12px; color: #999;">
                        MFWA Assets Management - ${new Date().getFullYear()}
                    </p>
                </div>
            `,
        });

        if (response.error) {
            console.error(`❌ Winner email error: ${response.error.message}`);
        } else {
            console.log(`✅ Winner email sent to ${winnerEmail} (ID: ${response.data.id})`);
        }
    } catch (error) {
        console.error('❌ Email service error:', error.message);
    }
}

module.exports = {
    sendOutbidNotification,
    sendWinnerNotification,
};