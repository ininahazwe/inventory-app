-- ═══════════════════════════════════════════════════════════════════════════
-- LEDGER DE STOCK FOURNITURES + correctifs de schéma
-- À exécuter une seule fois, APRÈS 2026-08-02-roles-cleanup.sql :
--   mysql -u <user> -p <database> < 2026-08-02-supply-movements.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Correctifs de schéma existant
-- ───────────────────────────────────────────────────────────────────────────

-- Le code écrit des EMAILS dans audit_log.user_id (varchar(36) trop court)
ALTER TABLE `audit_log`
    MODIFY `user_id` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL;

-- Le code n'utilise que 'active'/'returned' — défaut 'assigned' jamais utilisé
ALTER TABLE `assignments`
    MODIFY `status` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'active';

-- cost = coût TOTAL de la ligne (décision produit), pas unitaire
ALTER TABLE `supplies`
    MODIFY `cost` decimal(10,2) NOT NULL COMMENT 'Coût total de la ligne (pas unitaire)';

-- Index pour l'autocomplete anti-doublons (LIKE sur name)
ALTER TABLE `supplies`
    ADD KEY `idx_supplies_name` (`name`);

-- ───────────────────────────────────────────────────────────────────────────
-- 2. Table supply_movements (ledger append-only)
--    qty signée : + entrée en stock, − sortie
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE `supply_movements` (
    `id` int NOT NULL AUTO_INCREMENT,
    `supply_id` int NOT NULL,
    `type` enum('purchase','issue','return','adjustment') COLLATE utf8mb4_unicode_ci NOT NULL,
    `qty` int NOT NULL COMMENT 'Signée: + entrée, - sortie',
    `movement_date` date NOT NULL,
    `ref_type` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'supply | supply_assignment',
    `ref_id` int DEFAULT NULL,
    `notes` text COLLATE utf8mb4_unicode_ci,
    `created_by` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_movement_supply_date` (`supply_id`, `movement_date`),
    KEY `idx_movement_type` (`type`),
    KEY `idx_movement_ref` (`ref_type`, `ref_id`),
    CONSTRAINT `fk_movement_supply` FOREIGN KEY (`supply_id`) REFERENCES `supplies` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Ledger des mouvements de stock fournitures';

-- ───────────────────────────────────────────────────────────────────────────
-- 3. Backfill depuis les données existantes
-- ───────────────────────────────────────────────────────────────────────────

-- Achats -> entrées (created_by = email, résolu depuis le uid)
INSERT INTO supply_movements (supply_id, type, qty, movement_date, ref_type, ref_id, notes, created_by, created_at)
SELECT s.id, 'purchase', s.quantity, s.purchase_date, 'supply', s.id,
       CONCAT('Backfill purchase: ', s.name),
       COALESCE(u.email, s.created_by_uid), s.created_at
FROM supplies s
         LEFT JOIN users u ON s.created_by_uid = u.id;

-- Assignations -> sorties (actives ET retournées: la sortie a eu lieu dans les 2 cas)
INSERT INTO supply_movements (supply_id, type, qty, movement_date, ref_type, ref_id, notes, created_by, created_at)
SELECT sa.supply_id, 'issue', -sa.quantity_assigned,
       COALESCE(sa.assigned_at, DATE(sa.created_at)),
       'supply_assignment', sa.id,
       CONCAT('Backfill issue -> ', COALESCE(sa.assignee_email, CONCAT('location #', sa.location_id))),
       sa.assignee_email, sa.created_at
FROM supply_assignments sa;

-- Retours -> ré-entrées (assignments status='returned')
INSERT INTO supply_movements (supply_id, type, qty, movement_date, ref_type, ref_id, notes, created_by, created_at)
SELECT sa.supply_id, 'return', sa.quantity_assigned,
       COALESCE(sa.returned_at, DATE(sa.created_at)),
       'supply_assignment', sa.id,
       'Backfill return', sa.assignee_email, sa.created_at
FROM supply_assignments sa
WHERE sa.status = 'returned';

-- ───────────────────────────────────────────────────────────────────────────
-- 4. Vérification : stock courant par fourniture (doit matcher quantity - assignés actifs)
-- ───────────────────────────────────────────────────────────────────────────

SELECT s.id, s.name, s.quantity AS purchased,
       COALESCE(SUM(m.qty), 0) AS stock_from_ledger
FROM supplies s
LEFT JOIN supply_movements m ON m.supply_id = s.id
GROUP BY s.id, s.name, s.quantity
ORDER BY s.id;
