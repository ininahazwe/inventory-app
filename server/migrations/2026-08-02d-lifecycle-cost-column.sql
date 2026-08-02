-- ═══════════════════════════════════════════════════════════════════════════
-- COÛT DE RÉPARATION STRUCTURÉ — colonne dédiée sur lifecycle_events
-- Avant: le coût était concaténé dans `notes` ("| Repair cost: $X"), impossible
-- à agréger en SQL. À exécuter APRÈS 2026-08-02c-low-stock-threshold.sql :
--   mysql -u <user> -p <database> < 2026-08-02d-lifecycle-cost-column.sql
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE `lifecycle_events`
    ADD COLUMN `cost` decimal(10,2) DEFAULT NULL
        COMMENT 'Coût de la réparation (event_type=maintenance). NULL si non applicable/non renseigné.'
    AFTER `notes`;

-- Pas de backfill nécessaire: aucune entrée existante ne contient
-- "Repair cost: $" dans ses notes au moment de cette migration (vérifié).
