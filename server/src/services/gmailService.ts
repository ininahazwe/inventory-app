// src/services/emailService.ts
import { google } from 'googleapis';
import { logger } from "../middleware/logger";

const SENDER_EMAIL = process.env.EMAIL_USER || '';
const FRONTEND_URL = process.env.FRONTEND_URL || '';

const oAuth2Client = new google.auth.OAuth2(
    (process.env.CLIENT_ID || '').trim(),
    (process.env.CLIENT_SECRET || '').trim(),
    'https://developers.google.com/oauthplayground'
);

oAuth2Client.setCredentials({
    refresh_token: (process.env.REFRESH_TOKEN || '').trim()
});

const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });

logger.info('Gmail REST API client initialized successfully', 'EMAIL');

interface EmailPayload {
    to: string | string[];
    subject: string;
    html: string;
}

export async function sendEmail(payload: EmailPayload): Promise<boolean> {
    try {
        const formattedTo = Array.isArray(payload.to) ? payload.to.join(', ') : payload.to;

        const messageParts = [
            `From: "The Auction Team" <${SENDER_EMAIL}>`,
            `To: ${formattedTo}`,
            `Subject: ${payload.subject}`,
            `MIME-Version: 1.0`,
            `Content-Type: text/html; charset=utf-8`,
            ``,
            `<html>
                <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
                    ${payload.html}
                </body>
            </html>`
        ];

        const message = messageParts.join('\r\n');

        const encodedMessage = Buffer.from(message)
            .toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');

        const response = await gmail.users.messages.send({
            userId: 'me',
            requestBody: {
                raw: encodedMessage,
            },
        });

        logger.info(`Email sent via Google API. Message ID: ${response.data.id} to [${formattedTo}]`, 'EMAIL');
        return true;
    } catch (err: any) {
        logger.error(`Failed to send email via Google API: ${err.message || err}`, 'EMAIL');
        return false;
    }
}

export function getBidderConfirmationEmail(
    bidderEmail: string,
    bidderName: string,
    auctionLabel: string,
    bidAmount: number,
    auctionUrl: string
): EmailPayload {
    return {
        to: bidderEmail,
        subject: `Bid Confirmation - ${auctionLabel}`,
        html: `
          <div style="max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px;">
              <h2 style="color: #8D86C9;">Bid Confirmation</h2>
              <p>Dear ${bidderName},</p>
              <p>Your bid has been successfully placed on the auction:</p>
              <p><strong>${auctionLabel}</strong></p>
              <p><strong>Your Bid Amount:</strong> ${bidAmount}</p>
              <div style="margin: 30px 0; text-align: center;">
                  <a href="${auctionUrl}" style="
                    display: inline-block;
                    padding: 12px 24px;
                    background-color: #8D86C9;
                    color: white;
                    text-decoration: none;
                    border-radius: 4px;
                    font-weight: bold;
                  ">View Auction</a>
              </div>
              <p>Best regards,<br/>The Auction Team</p>
          </div>
        `,
    };
}

export function getCreatorNotificationEmail(
    creatorEmail: string,
    creatorName: string,
    auctionLabel: string,
    bidderEmail: string,
    bidAmount: number,
    auctionUrl: string
): EmailPayload {
    return {
        to: creatorEmail,
        subject: `New Bid on Your Auction - ${auctionLabel}`,
        html: `
          <div style="max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px;">
              <h2 style="color: #8D86C9;">New Bid Notification</h2>
              <p>Dear ${creatorName},</p>
              <p>A new bid has been placed on your auction:</p>
              <p><strong>${auctionLabel}</strong></p>
              <p><strong>Bidder:</strong> ${bidderEmail}</p>
              <p><strong>Bid Amount:</strong> ${bidAmount}</p>
              <div style="margin: 30px 0; text-align: center;">
                  <a href="${auctionUrl}" style="
                    display: inline-block;
                    padding: 12px 24px;
                    background-color: #8D86C9;
                    color: white;
                    text-decoration: none;
                    border-radius: 4px;
                    font-weight: bold;
                  ">View Auction</a>
              </div>
              <p>Best regards,<br/>The Auction Team</p>
          </div>
        `,
    };
}

export function getOutbidNotificationEmail(
    emails: string | string[],
    auctionLabel: string,
    newBidAmount: number,
    auctionUrl: string
): EmailPayload {
    return {
        to: emails,
        subject: `You Have Been Outbid - ${auctionLabel}`,
        html: `
          <div style="max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px;">
              <h2 style="color: #EF4444;">Outbid Notification</h2>
              <p>Dear Bidder,</p>
              <p>Your bid on the following auction has been outbid:</p>
              <p><strong>${auctionLabel}</strong></p>
              <p><strong>New Highest Bid:</strong> ${newBidAmount}</p>
              <p>Please place a new bid if you wish to continue.</p>
              <div style="margin: 30px 0; text-align: center;">
                  <a href="${auctionUrl}" style="
                    display: inline-block;
                    padding: 12px 24px;
                    background-color: #8D86C9;
                    color: white;
                    text-decoration: none;
                    border-radius: 4px;
                    font-weight: bold;
                  ">Place New Bid</a>
              </div>
              <p>Best regards,<br/>The Auction Team</p>
          </div>
        `,
    };
}

export function getWinnerNotificationEmail(
    winnerEmail: string,
    winnerName: string,
    auctionLabel: string,
    finalAmount: number,
    auctionUrl: string
): EmailPayload {
    return {
        to: winnerEmail,
        subject: `🎉 Congratulations! You won the auction: ${auctionLabel}`,
        html: `
          <div style="max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px; font-family: Arial, sans-serif;">
              <h2 style="color: #4CAF50; text-align: center; margin-bottom: 24px;">🏆 Congratulations, ${winnerName}!</h2>
              <p>Dear Bidder,</p>
              <p>Great news! The auction has successfully ended, and <strong>you are the winning bidder</strong> for the following item:</p>
              
              <div style="background-color: #f3f4f6; padding: 15px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #8D86C9;">
                  <p style="margin: 0 0 8px 0;"><strong>Item:</strong> ${auctionLabel}</p>
                  <p style="margin: 0;"><strong>Your Winning Bid:</strong> ${finalAmount} GHS</p>
              </div>
              
              <p>Please note that <strong>our team will contact you very shortly to finalize the transaction</strong> and arrange the next steps.</p>
              <p>In the meantime, you can review the details of your won item by clicking the button below:</p>
              
              <div style="margin: 30px 0; text-align: center;">
                  <a href="${auctionUrl}" style="
                    display: inline-block;
                    padding: 12px 24px;
                    background-color: #8D86C9;
                    color: white;
                    text-decoration: none;
                    border-radius: 6px;
                    font-weight: bold;
                  ">View My Won Item</a>
              </div>
              
              <p style="font-size: 13px; color: #6b7280; margin-top: 32px;">Thank you for your participation and happy bidding!</p>
          </div>
        `,
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// INCIDENT EMAILS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Email aux super_admins lors de la création d'un incident
 */
export function getIncidentCreatedAdminEmail(
    adminEmails: string[],
    reporterEmail: string,
    assetLabel: string,
    incidentType: string,
    severity: string,
    incidentUrl: string
): EmailPayload {
    const severityColor: Record<string, string> = {
        low: '#22c55e',
        medium: '#f59e0b',
        high: '#ef4444',
        critical: '#7f1d1d',
    };
    const color = severityColor[severity] || '#6b7280';

    return {
        to: adminEmails,
        subject: `[Incident] New incident reported — ${assetLabel}`,
        html: `
          <div style="max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px; font-family: Arial, sans-serif;">
              <h2 style="color: #DC2626;">🚨 New Incident Reported</h2>
              <p>A new incident has been declared and requires your attention.</p>

              <div style="background-color: #f9fafb; padding: 15px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #DC2626;">
                  <p style="margin: 0 0 8px 0;"><strong>Asset:</strong> ${assetLabel}</p>
                  <p style="margin: 0 0 8px 0;"><strong>Type:</strong> ${incidentType}</p>
                  <p style="margin: 0 0 8px 0;">
                      <strong>Severity:</strong>
                      <span style="color: ${color}; font-weight: bold; text-transform: uppercase;">${severity}</span>
                  </p>
                  <p style="margin: 0;"><strong>Reported by:</strong> ${reporterEmail}</p>
              </div>

              <div style="margin: 30px 0; text-align: center;">
                  <a href="${incidentUrl}" style="
                    display: inline-block;
                    padding: 12px 24px;
                    background-color: #DC2626;
                    color: white;
                    text-decoration: none;
                    border-radius: 6px;
                    font-weight: bold;
                  ">View Incident</a>
              </div>

              <p style="font-size: 13px; color: #6b7280;">Assets Management System</p>
          </div>
        `,
    };
}

/**
 * Email au déclarant quand son incident est marqué comme résolu
 */
export function getIncidentResolvedEmail(
    reporterEmail: string,
    assetLabel: string,
    resolvedAt: Date,
    incidentUrl: string
): EmailPayload {
    const formattedDate = resolvedAt.toLocaleString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });

    return {
        to: reporterEmail,
        subject: `[Incident] Resolved — ${assetLabel}`,
        html: `
          <div style="max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px; font-family: Arial, sans-serif;">
              <h2 style="color: #16a34a;">✅ Incident Resolved</h2>
              <p>The incident you reported has been marked as <strong>resolved</strong>.</p>

              <div style="background-color: #f0fdf4; padding: 15px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #16a34a;">
                  <p style="margin: 0 0 8px 0;"><strong>Asset:</strong> ${assetLabel}</p>
                  <p style="margin: 0;"><strong>Resolved at:</strong> ${formattedDate}</p>
              </div>

              <p>You can review the full incident details using the button below.</p>

              <div style="margin: 30px 0; text-align: center;">
                  <a href="${incidentUrl}" style="
                    display: inline-block;
                    padding: 12px 24px;
                    background-color: #16a34a;
                    color: white;
                    text-decoration: none;
                    border-radius: 6px;
                    font-weight: bold;
                  ">View Incident</a>
              </div>

              <p style="font-size: 13px; color: #6b7280;">Assets Management System</p>
          </div>
        `,
    };
}