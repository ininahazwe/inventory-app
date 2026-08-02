-- Correctif pour les bases ayant déjà exécuté 2026-08-02-supply-movements.sql :
-- le backfill avait stocké des uid dans created_by, on les convertit en emails.
-- Sans effet si déjà propre. À exécuter une seule fois :
--   mysql -u <user> -p <database> < 2026-08-02b-fix-movements-created-by.sql

UPDATE supply_movements m
    JOIN users u ON m.created_by = u.id
SET m.created_by = u.email;

-- Vérification: plus aucun uid (36 chars avec tirets) sans '@'
SELECT COUNT(*) AS remaining_uids
FROM supply_movements
WHERE created_by IS NOT NULL AND created_by NOT LIKE '%@%' AND LENGTH(created_by) = 36;
