-- ═══════════════════════════════════════════════════════════════════════════
-- ALERTES STOCK BAS — seuil configurable par ligne de fourniture
-- À exécuter APRÈS 2026-08-02-supply-movements.sql :
--   mysql -u <user> -p <database> < 2026-08-02c-low-stock-threshold.sql
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE `supplies`
    ADD COLUMN `low_stock_threshold` int DEFAULT NULL
        COMMENT 'Seuil alerte stock bas (NULL = pas d''alerte configurée)'
    AFTER `quantity`;
