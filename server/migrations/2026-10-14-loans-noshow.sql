-- ============================================================================
-- Module prêts — gestion des no-show (14/10/2026)
-- Un prêt approuvé mais jamais retiré ne doit pas bloquer l'asset indéfiniment :
--   * le lendemain de start_date, une relance part (une seule fois) ;
--   * après LOAN_NOSHOW_GRACE_DAYS jours (3 par défaut), le prêt est annulé
--     automatiquement par le job quotidien (événement 'cancelled', acteur 'system').
-- `pickup_reminder_sent_at` est le verrou anti-doublon de la relance.
-- Additif : aucune ligne existante modifiée. (ALTER = commit implicite → dump avant.)
-- ============================================================================
ALTER TABLE `loans`
    ADD COLUMN `pickup_reminder_sent_at` timestamp NULL DEFAULT NULL
        COMMENT 'Relance « matériel non retiré » envoyée (NULL = pas encore)'
        AFTER `overdue_reminder_sent_at`;
