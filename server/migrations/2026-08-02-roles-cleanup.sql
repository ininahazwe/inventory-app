-- Ménage des rôles : on ne garde que user / admin / super_admin.
-- 'assignee' devient un statut dérivé (= avoir au moins un assignment actif).
-- 'accountant' supprimé (seule règle associée : interdiction de créer des enchères — retirée).
--
-- À exécuter une seule fois :
--   mysql -u <user> -p <database> < 2026-08-02-roles-cleanup.sql

UPDATE users SET role = 'user' WHERE role IN ('assignee', 'accountant');

-- Vérification
SELECT role, COUNT(*) AS count FROM users GROUP BY role;
