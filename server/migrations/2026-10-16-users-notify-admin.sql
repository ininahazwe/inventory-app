-- ============================================================================
-- Users — destinataires des notifications admin (16/10/2026)
-- notify_admin = 1 : cet admin / super_admin reçoit les mails destinés aux admins
-- (nouvelle demande de prêt, incident créé, rappels de retard / SLA...).
-- Modifiable par un super_admin depuis /assignees.
-- DEFAULT 1 : aucun changement de comportement pour les admins existants.
-- Additif (ALTER = commit implicite → dump avant). Le code reste fonctionnel
-- si la colonne n'existe pas encore (repli : tous les admins reçoivent).
-- ============================================================================
ALTER TABLE `users`
    ADD COLUMN `notify_admin` tinyint(1) NOT NULL DEFAULT 1
        COMMENT '1 = reçoit les notifications mail destinées aux admins';
