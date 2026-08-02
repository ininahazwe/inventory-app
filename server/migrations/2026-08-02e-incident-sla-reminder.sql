-- ═══════════════════════════════════════════════════════════════════════════
-- SLA INCIDENTS — relance mail quand un incident reste ouvert trop longtemps
-- À exécuter APRÈS 2026-08-02d-lifecycle-cost-column.sql :
--   mysql -u <user> -p <database> < 2026-08-02e-incident-sla-reminder.sql
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE `incidents`
    ADD COLUMN `sla_reminder_sent_at` timestamp NULL DEFAULT NULL
        COMMENT 'Horodatage de la relance SLA envoyée (NULL = pas encore envoyée pour cette ouverture)'
    AFTER `resolved_at`;
