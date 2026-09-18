-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE 5 (1/2) — RENOMMAGE DES TABLES LEGACY
--
-- À exécuter en production APRÈS avoir déployé le commit qui :
--   - corrige les 3 dernières lectures serveur sur supplies/supply_assignments
--     (rpc.ts, categories.ts, locations.ts)
--   - fait pointer les jointures d'historique (supplyAssignments.ts,
--     supplyMovements.ts) vers _legacy_supply_assignments / _legacy_supply_movements
--
-- Si ce script est exécuté avant ce déploiement, l'application casse
-- immédiatement (tables introuvables). Vérifier `git log -1` côté prod avant.
--
-- ⚠️ RENAME TABLE est un DDL : comme CREATE/ALTER/DROP TABLE, il provoque un
-- COMMIT implicite sur MySQL/MariaDB, quoi qu'il arrive (le bloc
-- START TRANSACTION / ROLLBACK ci-dessous NE PROTÈGE PAS cette étape — même
-- surprise que celle rencontrée en Phase 2 avec un CREATE TABLE). Un vrai
-- filet de sécurité, c'est une sauvegarde prise juste avant (voir Phase 0).
--
-- Ce script NE SUPPRIME AUCUNE DONNÉE : les 3 tables legacy restent
-- intactes, seulement renommées et invisibles pour l'application. Elles
-- seront supprimées définitivement une semaine plus tard par le script
-- phase5-drop-legacy.sql, après vérification qu'aucune erreur ne remonte
-- côté application.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 0. Sauvegarde de sécurité (recommandé avant tout DDL sur cet hôte) ────
-- mysqldump -u <user> -p assetmngt supplies supply_assignments supply_movements > backup-phase5-$(date +%Y%m%d).sql

-- ─── 1. Contrôle avant renommage ────────────────────────────────────────────
-- Ces 3 tables ne doivent plus avoir reçu aucune ligne depuis le 16/09/2026
-- (date du verrouillage Phase 3) — un MAX(id)/COUNT(*) inchangé par rapport
-- au relevé de la Phase 3 confirme qu'elles sont bien mortes.
SELECT 'supplies' AS tbl, COUNT(*) AS n, MAX(id) AS max_id FROM supplies
UNION ALL
SELECT 'supply_assignments', COUNT(*), MAX(id) FROM supply_assignments
UNION ALL
SELECT 'supply_movements', COUNT(*), MAX(id) FROM supply_movements;

-- ─── 2. Renommage atomique ──────────────────────────────────────────────────
-- Un seul RENAME TABLE multi-tables : MySQL met à jour au passage les
-- contraintes FK de supply_assignments/supply_movements vers supplies
-- (elles suivent le nom, pas besoin de les recréer).
RENAME TABLE
    supplies            TO _legacy_supplies,
    supply_assignments  TO _legacy_supply_assignments,
    supply_movements    TO _legacy_supply_movements;

-- ─── 3. Contrôle après renommage ────────────────────────────────────────────
-- Les FK doivent toujours exister, juste repointées sur les nouveaux noms.
SELECT
    kcu.TABLE_NAME, kcu.COLUMN_NAME, kcu.CONSTRAINT_NAME,
    kcu.REFERENCED_TABLE_NAME, kcu.REFERENCED_COLUMN_NAME
FROM information_schema.KEY_COLUMN_USAGE kcu
WHERE kcu.TABLE_SCHEMA = DATABASE()
  AND kcu.REFERENCED_TABLE_NAME IN ('_legacy_supplies', '_legacy_supply_assignments', '_legacy_supply_movements');

-- Puis vérifier côté application (à faire manuellement juste après) :
--   - GET /api/categories répond toujours avec des supplies_count cohérents
--   - GET /api/rpc/get_dashboard_kpis répond toujours avec un supplies_cost_month cohérent
--   - DELETE d'une localisation SANS fourniture en cours bloque toujours correctement
--     si des unités sont en cours de sortie ailleurs (tester sur une localisation neutre)
--   - GET /api/supply-assignments et GET /api/supply-movements répondent toujours
--     (pas d'erreur 500 sur les lignes historiques pré-Phase-3)
