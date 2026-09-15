-- ═══════════════════════════════════════════════════════════════════════════
-- REPRISE DES COÛTS FOURNITURES — phase 1b
--
-- Contexte : la colonne `cost` a été saisie tantôt comme prix unitaire
-- (achats du 14/05), tantôt comme total de ligne (achats du 06/07) — le
-- formulaire, étiqueté « Cost (GH₵) », ne distinguait pas les deux. Cette
-- migration sépare les notions : `unit_cost` devient la source de vérité et
-- `cost` devient partout le total de ligne, conformément à son commentaire.
--
-- 37/37 lignes validées (Gyan, 15/09/2026) — dont les 3 lignes arbitrées
-- manuellement : #16 Sugar (35,00/u), #22 Sanitizer (50,00/u), #46 Glass
-- Cleaner (20,00/u). Feuille de revue :
--   https://claude.ai/code/artifact/1bd8ae76-866f-407d-93b7-35061f80dc35
--
-- Aucun mouvement de stock n'est touché : supply_movements et
-- supply_assignments restent intacts. Seuls des montants changent.
-- ═══════════════════════════════════════════════════════════════════════════

START TRANSACTION;

-- ─── Contrôle avant ────────────────────────────────────────────────────────
-- Doit renvoyer 5813.50 sur 37 lignes. Si le total diffère, la base a bougé
-- depuis l'analyse : refaire la revue avant d'aller plus loin.
SELECT ROUND(SUM(cost), 2) AS cost_avant, COUNT(*) AS lignes FROM supplies;

-- ─── 1. Nouvelle colonne ───────────────────────────────────────────────────
-- 4 décimales : un unitaire déduit d'un total qui ne divise pas juste
-- (600 / 140 = 4,2857) doit rester capable de reconstituer ce total.
ALTER TABLE `supplies`
    ADD COLUMN `unit_cost` DECIMAL(12,4) NULL
    COMMENT 'Prix unitaire — source de vérité' AFTER `cost`;

-- ─── 2. Reprise ligne à ligne ──────────────────────────────────────────────

-- Achats du 14 mai — cost saisi comme prix unitaire
UPDATE `supplies` SET `unit_cost` = 4.2857, `cost` = 600.00 WHERE `id` = 7;  -- Toilet Roll
UPDATE `supplies` SET `unit_cost` = 40.0000, `cost` = 240.00 WHERE `id` = 8;  -- Liquid soap
UPDATE `supplies` SET `unit_cost` = 15.0000, `cost` = 150.00 WHERE `id` = 9;  -- Fres Hand washing liquid soap
UPDATE `supplies` SET `unit_cost` = 12.0000, `cost` = 240.00 WHERE `id` = 10;  -- Box Tissue
UPDATE `supplies` SET `unit_cost` = 20.0000, `cost` = 80.00 WHERE `id` = 11;  -- Bleach
UPDATE `supplies` SET `unit_cost` = 150.0000, `cost` = 150.00 WHERE `id` = 13;  -- Nescafe
UPDATE `supplies` SET `unit_cost` = 20.0000, `cost` = 160.00 WHERE `id` = 15;  -- Lipton Tea
UPDATE `supplies` SET `unit_cost` = 35.0000, `cost` = 70.00 WHERE `id` = 16;  -- Sugar (arbitré : saisie de mai 55,00 erronée, corrigée à 35,00/u)
UPDATE `supplies` SET `unit_cost` = 35.0000, `cost` = 175.00 WHERE `id` = 18;  -- air refresher
UPDATE `supplies` SET `unit_cost` = 50.0000, `cost` = 100.00 WHERE `id` = 19;  -- washing Powder
UPDATE `supplies` SET `unit_cost` = 60.0000, `cost` = 180.00 WHERE `id` = 20;  -- Mosquito Spray
UPDATE `supplies` SET `unit_cost` = 18.0000, `cost` = 72.00 WHERE `id` = 21;  -- Mosquito Coil
UPDATE `supplies` SET `unit_cost` = 50.0000, `cost` = 2500.00 WHERE `id` = 22;  -- Sanitizer (arbitré : 50,00/u confirmé)
UPDATE `supplies` SET `unit_cost` = 75.0000, `cost` = 75.00 WHERE `id` = 23;  -- Floor Cleaner
UPDATE `supplies` SET `unit_cost` = 25.0000, `cost` = 25.00 WHERE `id` = 24;  -- Sponge (1Pack)
UPDATE `supplies` SET `unit_cost` = 20.0000, `cost` = 20.00 WHERE `id` = 25;  -- Trash Bags
UPDATE `supplies` SET `unit_cost` = 27.5000, `cost` = 1650.00 WHERE `id` = 26;  -- Paper Towel

-- Achats du 6 juillet — cost saisi comme total de ligne
UPDATE `supplies` SET `unit_cost` = 3.7500, `cost` = 600.00 WHERE `id` = 27;  -- Toilet Roll
UPDATE `supplies` SET `unit_cost` = 40.0000, `cost` = 200.00 WHERE `id` = 28;  -- Liquid soap
UPDATE `supplies` SET `unit_cost` = 15.0000, `cost` = 180.00 WHERE `id` = 29;  -- Liquid soap
UPDATE `supplies` SET `unit_cost` = 12.0000, `cost` = 180.00 WHERE `id` = 30;  -- Tissue Box
UPDATE `supplies` SET `unit_cost` = 20.0000, `cost` = 80.00 WHERE `id` = 31;  -- Bleach
UPDATE `supplies` SET `unit_cost` = 26.6667, `cost` = 1920.00 WHERE `id` = 32;  -- Paper Towel
UPDATE `supplies` SET `unit_cost` = 150.0000, `cost` = 150.00 WHERE `id` = 33;  -- Nescafe
UPDATE `supplies` SET `unit_cost` = 20.0000, `cost` = 200.00 WHERE `id` = 34;  -- Lipton tea
UPDATE `supplies` SET `unit_cost` = 35.0000, `cost` = 105.00 WHERE `id` = 35;  -- Granulated sugar
UPDATE `supplies` SET `unit_cost` = 55.0000, `cost` = 110.00 WHERE `id` = 36;  -- Vim washing soda
UPDATE `supplies` SET `unit_cost` = 35.0000, `cost` = 70.00 WHERE `id` = 37;  -- Air refresher
UPDATE `supplies` SET `unit_cost` = 50.0000, `cost` = 100.00 WHERE `id` = 38;  -- washing powder
UPDATE `supplies` SET `unit_cost` = 50.0000, `cost` = 150.00 WHERE `id` = 39;  -- Toilet brush
UPDATE `supplies` SET `unit_cost` = 60.0000, `cost` = 180.00 WHERE `id` = 40;  -- Mosquito spray
UPDATE `supplies` SET `unit_cost` = 18.0000, `cost` = 36.00 WHERE `id` = 41;  -- Mosquito coil
UPDATE `supplies` SET `unit_cost` = 50.0000, `cost` = 100.00 WHERE `id` = 42;  -- Sanitizer
UPDATE `supplies` SET `unit_cost` = 95.0000, `cost` = 95.00 WHERE `id` = 43;  -- Floor cleaner
UPDATE `supplies` SET `unit_cost` = 2.5000, `cost` = 25.00 WHERE `id` = 44;  -- Kitchen Sponge
UPDATE `supplies` SET `unit_cost` = 0.6667, `cost` = 40.00 WHERE `id` = 45;  -- Trash bags

-- Achat du 27 août
UPDATE `supplies` SET `unit_cost` = 20.0000, `cost` = 40.00 WHERE `id` = 46;  -- Glass Cleaner (arbitré : 20,00/u confirmé)

-- ─── 3. Verrouillage ───────────────────────────────────────────────────────
ALTER TABLE `supplies`
    MODIFY `unit_cost` DECIMAL(12,4) NOT NULL
    COMMENT 'Prix unitaire — source de vérité',
    MODIFY `cost` DECIMAL(10,2) NOT NULL
    COMMENT 'Total de ligne = unit_cost * quantity';

-- ─── Contrôles après ───────────────────────────────────────────────────────
-- cost_apres doit renvoyer 11048.00 (contre 5813.50 avant).
SELECT ROUND(SUM(cost), 2) AS cost_apres FROM supplies;

-- incoherences doit renvoyer 0. Tolérance au centime : l'arrondi du prix
-- unitaire ne doit pas faire dériver le total de plus d'un centime.
SELECT COUNT(*) AS incoherences FROM supplies
WHERE ABS(unit_cost * quantity - cost) > 0.01;

-- mouvements_intacts doit renvoyer 482, comme avant la migration.
SELECT COUNT(*) AS mouvements_intacts FROM supply_movements;

-- ─── Validation ────────────────────────────────────────────────────────────
-- Les 37 lignes sont validées (voir en-tête). COMMIT activé — vérifier les
-- trois contrôles ci-dessus à l'œil avant d'exécuter ce script en base.
COMMIT;
-- ROLLBACK;
