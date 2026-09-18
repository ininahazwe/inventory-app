-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE 5 (2/2) — SUPPRESSION DÉFINITIVE DES TABLES LEGACY
--
-- ⚠️ NE PAS EXÉCUTER AVANT LE 25/09/2026, et seulement après confirmation
-- explicite : ce script est IRRÉVERSIBLE (DROP TABLE), sans filet autre
-- qu'une sauvegarde externe. Le délai d'une semaine depuis le renommage
-- (2026-09-18-phase5-rename-legacy.sql) sert à repérer, via les logs
-- d'erreur applicatifs, un éventuel accès oublié aux tables _legacy_* —
-- aucune erreur en 7 jours = plus aucun code ne les lit.
--
-- Pré-requis avant de lancer ce script :
--   1. Confirmer avec Claude/l'équipe qu'aucune erreur "table doesn't exist"
--      mentionnant _legacy_supplies / _legacy_supply_assignments /
--      _legacy_supply_movements n'est apparue dans les logs depuis le renommage.
--   2. Prendre une sauvegarde fraîche (les tables sont déjà inertes, mais
--      autant garder un export avant suppression définitive) :
--        mysqldump -u <user> -p assetmngt _legacy_supplies _legacy_supply_assignments _legacy_supply_movements > backup-legacy-final-$(date +%Y%m%d).sql
--
-- ⚠️ DROP TABLE est un DDL : COMMIT implicite, comme pour le renommage —
-- le bloc transactionnel ci-dessous ne protège pas cette étape.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Contrôle final avant suppression ───────────────────────────────────────
SELECT '_legacy_supplies' AS tbl, COUNT(*) AS n FROM _legacy_supplies
UNION ALL
SELECT '_legacy_supply_assignments', COUNT(*) FROM _legacy_supply_assignments
UNION ALL
SELECT '_legacy_supply_movements', COUNT(*) FROM _legacy_supply_movements;

-- ─── Suppression ────────────────────────────────────────────────────────────
-- Ordre sans importance : les FK suivent les tables renommées, MySQL gère
-- l'ordre de suppression des contraintes lui-même dans un DROP multi-tables.
DROP TABLE _legacy_supply_assignments, _legacy_supply_movements, _legacy_supplies;

-- ─── Contrôle après suppression ─────────────────────────────────────────────
-- Doit renvoyer 0 ligne : plus aucune des 3 tables ne doit exister.
SELECT TABLE_NAME FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('supplies', 'supply_assignments', 'supply_movements',
                      '_legacy_supplies', '_legacy_supply_assignments', '_legacy_supply_movements');
