// src/services/emailService.ts
import nodemailer from 'nodemailer';
import {logger} from "../middleware/logger";


// Configuration Gmail
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_PASSWORD, // App Password, not regular password
    },
});

interface EmailPayload {
    to: string | string[];
    subject: string;
    html: string;
}

/**
 * Send email via Gmail
 */
export async function sendEmail(payload: EmailPayload): Promise<boolean> {
    try {
        const info = await transporter.sendMail({
            from: process.env.GMAIL_USER,
            to: payload.to,
            subject: payload.subject,
            html: payload.html,
        });

        logger.info(`Email sent: ${info.messageId}`, 'EMAIL');
        return true;
    } catch (err) {
        logger.error(`Failed to send email:`, err as Error);
        return false;
    }
}

/**
 * Email à l'enchérisseur pour confirmer la mise
 */
export function getBidderConfirmationEmail(
    bidderName: string,
    auctionLabel: string,
    bidAmount: number,
    auctionUrl: string
): EmailPayload {
    return {
        to: bidderName,
        subject: `Bid Confirmation - ${auctionLabel}`,
        html: `
      <h2>Bid Confirmation</h2>
      <p>Dear Bidder,</p>
      <p>Your bid has been successfully placed on the auction:</p>
      <p><strong>${auctionLabel}</strong></p>
      <p><strong>Your Bid Amount:</strong> ${bidAmount}</p>
      <p><a href="${auctionUrl}" style="
        display: inline-block;
        padding: 12px 24px;
        background-color: #8D86C9;
        color: white;
        text-decoration: none;
        border-radius: 4px;
        font-weight: bold;
      ">View Auction</a></p>
      <p>Best regards,<br/>The Auction Team</p>
    `,
    };
}

/**
 * Email à l'créateur de l'enchère pour l'informer d'une nouvelle mise
 */
export function getCreatorNotificationEmail(
    creatorName: string,
    auctionLabel: string,
    bidderEmail: string,
    bidAmount: number,
    auctionUrl: string
): EmailPayload {
    return {
        to: creatorName,
        subject: `New Bid on Your Auction - ${auctionLabel}`,
        html: `
      <h2>New Bid Notification</h2>
      <p>Dear Creator,</p>
      <p>A new bid has been placed on your auction:</p>
      <p><strong>${auctionLabel}</strong></p>
      <p><strong>Bidder:</strong> ${bidderEmail}</p>
      <p><strong>Bid Amount:</strong> ${bidAmount}</p>
      <p><a href="${auctionUrl}" style="
        display: inline-block;
        padding: 12px 24px;
        background-color: #8D86C9;
        color: white;
        text-decoration: none;
        border-radius: 4px;
        font-weight: bold;
      ">View Auction</a></p>
      <p>Best regards,<br/>The Auction Team</p>
    `,
    };
}

/**
 * Email aux autres enchérisseurs pour les informer d'une surenchère
 */
export function getOutbidNotificationEmail(
    bidderName: string,
    auctionLabel: string,
    newBidAmount: number,
    auctionUrl: string
): EmailPayload {
    return {
        to: bidderName,
        subject: `You Have Been Outbid - ${auctionLabel}`,
        html: `
      <h2>Outbid Notification</h2>
      <p>Dear Bidder,</p>
      <p>Your bid on the following auction has been outbid:</p>
      <p><strong>${auctionLabel}</strong></p>
      <p><strong>New Highest Bid:</strong> ${newBidAmount}</p>
      <p>Please place a new bid if you wish to continue.</p>
      <p><a href="${auctionUrl}" style="
        display: inline-block;
        padding: 12px 24px;
        background-color: #8D86C9;
        color: white;
        text-decoration: none;
        border-radius: 4px;
        font-weight: bold;
      ">Place New Bid</a></p>
      <p>Best regards,<br/>The Auction Team</p>
    `,
    };
}