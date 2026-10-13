// src/scheduler.ts
// Scheduler interne (node-schedule) — remplace la dépendance à un cron externe
// qui devait appeler POST /api/auctions/auto-close sur l'URL publique du serveur.
// Toute la logique tourne désormais dans le process du serveur.
import schedule from 'node-schedule';
import { logger } from './middleware/logger';
import { runAutoCloseAuctions } from './routes/auctions';
import { checkIncidentSLA } from './routes/incidents';
import { checkLoansOverdue } from './routes/loans';

let started = false;

export function startScheduler(): void {
    if (started) return; // évite un double enregistrement (ex: hot-reload en dev)
    started = true;

    // Toutes les heures à :00 — clôture des enchères expirées
    schedule.scheduleJob('auctions-auto-close', '0 * * * *', async () => {
        try {
            const { closedCount } = await runAutoCloseAuctions();
            if (closedCount > 0) {
                logger.info(`[scheduler] auto-close: ${closedCount} auction(s) closed`, 'SCHEDULER');
            }
        } catch (err) {
            logger.error('[scheduler] auto-close failed:', err as Error);
        }
    });

    // Une fois par jour à 08:00 — relance SLA incidents ouverts trop longtemps
    schedule.scheduleJob('incidents-sla-check', '0 8 * * *', async () => {
        try {
            const { overdue, notified } = await checkIncidentSLA();
            if (overdue > 0) {
                logger.info(`[scheduler] SLA check: ${overdue} overdue, ${notified} notified`, 'SCHEDULER');
            }
        } catch (err) {
            logger.error('[scheduler] SLA check failed:', err as Error);
        }
    });

    // Une fois par jour à 08:30 — relance des prêts non rendus à l'échéance.
    // Décalé de 30 min par rapport au SLA incidents pour ne pas envoyer deux
    // vagues de mails en même temps.
    schedule.scheduleJob('loans-overdue-check', '30 8 * * *', async () => {
        try {
            const { overdue, notified } = await checkLoansOverdue();
            if (overdue > 0) {
                logger.info(`[scheduler] loans overdue: ${overdue} overdue, ${notified} notified`, 'SCHEDULER');
            }
        } catch (err) {
            logger.error('[scheduler] loans overdue check failed:', err as Error);
        }
    });

    logger.info('Internal scheduler started (auctions auto-close hourly, incident SLA check daily 08:00, loan overdue check daily 08:30)', 'SCHEDULER');
}
