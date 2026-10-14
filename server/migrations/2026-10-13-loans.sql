-- ============================================================================
-- Module « Prêts de matériel » (loans) — 13/10/2026
--
-- Le prêt est une entité distincte de l'affectation (`assignments`) :
--   * une affectation est une attribution durable, sans date de fin ;
--   * un prêt est borné dans le temps (start_date → due_date), passe par une
--     demande + approbation, et se clôt par un retour avec constat d'état.
-- Un asset peut donc être affecté à quelqu'un ET prêté temporairement à un
-- autre sans que les deux notions se marchent dessus.
--
-- Deux tables :
--   `loans`        — l'état courant du prêt (une ligne par prêt) ;
--   `loan_events`  — le journal du cycle (une ligne par transition), qui est
--                    la source de vérité de l'historique : `loans` ne garde
--                    que la dernière valeur de chaque champ.
--
-- Invariants (tenus par le code, dans server/src/services/loanService.ts) :
--   1. Un asset ne peut avoir qu'un seul prêt au statut `checked_out`.
--   2. Deux prêts non clos (requested/approved/checked_out) du même asset ne
--      peuvent pas se chevaucher sur [start_date, due_date].
--   3. Toute transition de statut écrit une ligne dans `loan_events`.
--   4. `assets.status` passe à 'on_loan' à la sortie et retrouve son statut
--      précédent au retour (mémorisé dans `asset_status_before`).
-- ============================================================================

START TRANSACTION;

-- ─── 1. Nouveau statut d'asset ──────────────────────────────────────────────
-- Additif : aucune ligne existante n'est modifiée.
ALTER TABLE `assets`
    MODIFY `status` enum('in_stock','assigned','repair','retired','auctioned','on_loan')
        COLLATE utf8mb4_unicode_ci DEFAULT 'in_stock';

-- ─── 2. Les prêts ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `loans` (
    `id`                       int NOT NULL AUTO_INCREMENT,
    `asset_id`                 int NOT NULL,
    `borrower_uid`             varchar(36)  COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'FK users.id — emprunteur',
    `borrower_email`           varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Copie de l''email au moment du prêt (survit à la suppression du compte)',
    `purpose`                  text         COLLATE utf8mb4_unicode_ci COMMENT 'Motif du prêt (déclaré à la demande)',
    `start_date`               date NOT NULL COMMENT 'Début de la réservation',
    `due_date`                 date NOT NULL COMMENT 'Retour prévu — base du calcul de retard',
    `status`                   enum('requested','approved','rejected','cancelled','checked_out','returned')
                                   COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'requested',
    `requested_by_email`       varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
    `requested_at`             timestamp NULL DEFAULT CURRENT_TIMESTAMP,
    `decided_by_email`         varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Qui a approuvé ou refusé',
    `decided_at`               timestamp NULL DEFAULT NULL,
    `decision_notes`           text         COLLATE utf8mb4_unicode_ci COMMENT 'Motif du refus, ou conditions posées à l''approbation',
    `checked_out_at`           timestamp NULL DEFAULT NULL,
    `checked_out_by_email`     varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `condition_out`            enum('good','fair','damaged') COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'État constaté à la sortie',
    `asset_status_before`      varchar(20)  COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Statut de l''asset avant la sortie, restitué au retour',
    `returned_at`              timestamp NULL DEFAULT NULL,
    `received_by_email`        varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `condition_in`             enum('good','fair','damaged','lost') COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'État constaté au retour',
    `return_location_id`       int DEFAULT NULL COMMENT 'Où le matériel a été remis',
    `incident_id`              int DEFAULT NULL COMMENT 'Incident ouvert automatiquement si retour damaged/lost',
    `extended_count`           int NOT NULL DEFAULT 0 COMMENT 'Nombre de prolongations accordées',
    `overdue_reminder_sent_at` timestamp NULL DEFAULT NULL COMMENT 'Dernière relance de retard envoyée (verrou anti-spam, 1/jour max)',
    `notes`                    text COLLATE utf8mb4_unicode_ci,
    `created_at`               timestamp NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`               timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_loan_asset_status` (`asset_id`,`status`),
    KEY `idx_loan_window`       (`asset_id`,`start_date`,`due_date`),
    KEY `idx_loan_borrower`     (`borrower_uid`),
    KEY `idx_loan_due`          (`status`,`due_date`),
    KEY `fk_loan_return_location` (`return_location_id`),
    KEY `fk_loan_incident`      (`incident_id`),
    CONSTRAINT `fk_loan_asset`           FOREIGN KEY (`asset_id`)           REFERENCES `assets` (`id`)     ON DELETE CASCADE,
    CONSTRAINT `fk_loan_borrower`        FOREIGN KEY (`borrower_uid`)       REFERENCES `users` (`id`)      ON DELETE SET NULL,
    CONSTRAINT `fk_loan_return_location` FOREIGN KEY (`return_location_id`) REFERENCES `locations` (`id`)  ON DELETE SET NULL,
    CONSTRAINT `fk_loan_incident`        FOREIGN KEY (`incident_id`)        REFERENCES `incidents` (`id`)  ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Prêts de matériel — un cycle demande → approbation → sortie → retour';

-- ─── 3. Le journal du cycle ─────────────────────────────────────────────────
-- Table en append-only : on n'y fait jamais d'UPDATE ni de DELETE (le ON DELETE
-- CASCADE ci-dessous n'existe que pour le cas où l'asset lui-même disparaît).
CREATE TABLE IF NOT EXISTS `loan_events` (
    `id`          int NOT NULL AUTO_INCREMENT,
    `loan_id`     int NOT NULL,
    `event_type`  varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'requested|approved|rejected|cancelled|checked_out|extended|returned|overdue_reminder',
    `from_status` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `to_status`   varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `actor_email` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `event_at`    timestamp NULL DEFAULT CURRENT_TIMESTAMP,
    `payload`     json DEFAULT NULL COMMENT 'Détails propres à l''événement (état constaté, nouvelle échéance, ...)',
    `notes`       text COLLATE utf8mb4_unicode_ci,
    PRIMARY KEY (`id`),
    KEY `idx_loan_event` (`loan_id`,`event_at`),
    CONSTRAINT `fk_loan_event_loan` FOREIGN KEY (`loan_id`) REFERENCES `loans` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Journal des transitions de prêt — historique complet du cycle';

COMMIT;

-- ⚠️ Rappel (leçon de la Phase 2 fournitures) : en MySQL/MariaDB, un CREATE TABLE
-- ou un ALTER TABLE déclenche un commit implicite. Le START TRANSACTION ci-dessus
-- ne constitue donc PAS un filet de sécurité : faire un dump avant exécution.
