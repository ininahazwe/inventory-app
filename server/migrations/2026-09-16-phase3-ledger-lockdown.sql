-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE 3 — VERROUILLAGE DU LEDGER + PRÉPARATION DES ADAPTATEURS
--
-- À exécuter en production, une seule fois, juste avant de déployer le code
-- serveur de la Phase 3 (supplyLedger.ts + routes adaptées).
--
-- Ce script ne touche à aucune donnée métier existante : il ajoute deux
-- colonnes, décale des compteurs auto_increment, et retire un privilège.
-- ═══════════════════════════════════════════════════════════════════════════

START TRANSACTION;

-- ─── 1. Colonne `brand` sur supply_receipt_lines ───────────────────────────
-- Le nouveau modèle n'a pas de colonne "marque" séparée (les variantes de
-- marque ont été absorbées dans le nom de l'article — ex. "Liquid Soap
-- (Morning Fresh)" / "Liquid Soap (Fres)"). Mais le front actuel (jusqu'à la
-- Phase 4) affiche et édite encore un champ "Brand" indépendant sur chaque
-- achat : on le reprend tel quel plutôt que de dépendre indéfiniment de
-- l'ancienne table `supplies` (qui sera renommée/supprimée en Phase 5).
ALTER TABLE supply_receipt_lines
    ADD COLUMN brand VARCHAR(255) NULL COMMENT 'Repris du front existant (pas de notion de marque dans le modèle cible) — colonne à retirer en Phase 4/5' AFTER unit_cost_base;

UPDATE supply_receipt_lines rl
JOIN supplies s ON s.id = rl.legacy_supply_id
SET rl.brand = s.brand
WHERE rl.legacy_supply_id IS NOT NULL;

-- ─── 2. Colonne `notes` sur supply_adjustment_lines ────────────────────────
-- Le formulaire d'ajustement manuel existant (POST /api/supply-movements)
-- laisse l'admin taper un commentaire libre — le nouveau schéma n'a pas
-- d'équivalent (reason est un ENUM fermé). On rajoute une colonne dédiée
-- plutôt que de perdre cette info pendant la transition.
ALTER TABLE supply_adjustment_lines
    ADD COLUMN notes VARCHAR(255) NULL AFTER legacy_movement_id;

UPDATE supply_adjustment_lines al
JOIN supply_movements m ON m.id = al.legacy_movement_id
SET al.notes = m.notes
WHERE al.legacy_movement_id IS NOT NULL;

-- Contrôle : doit renvoyer 37 et 18 (une ligne par lot / ajustement historique).
SELECT COUNT(*) AS lots_avec_legacy_id FROM supply_receipt_lines WHERE legacy_supply_id IS NOT NULL;
SELECT COUNT(*) AS ajustements_avec_legacy_id FROM supply_adjustment_lines WHERE legacy_movement_id IS NOT NULL;

-- ─── 3. Séparation des espaces d'id (legacy vs nouveau) ────────────────────
-- Les routes adaptées (Phase 3) exposent `id = COALESCE(legacy_xxx_id, id)`
-- pour que les URLs/écrans existants continuent de pointer vers la bonne
-- ligne. Il faut que les nouveaux id générés après la Phase 3 ne puissent
-- jamais tomber dans la plage des anciens id (supplies: 1-46,
-- supply_assignments: jusqu'à ~430, supply_movements: vu jusqu'à ~512) —
-- 100000 laisse une marge large, sans avoir à connaître le max exact.
ALTER TABLE supply_receipt_lines AUTO_INCREMENT = 100000;
ALTER TABLE supply_issue_lines AUTO_INCREMENT = 100000;
ALTER TABLE supply_adjustment_lines AUTO_INCREMENT = 100000;

-- ─── 4. Verrouillage du ledger (invariant 2) ───────────────────────────────
-- Après cette étape, plus aucune route ne peut UPDATE/DELETE une ligne du
-- ledger, même par erreur de code future — seules les INSERT (écritures
-- correctives comprises, via reverses_id) restent possibles.
--
-- ⚠️ Vérifier d'abord le user@host réellement utilisé par la connexion
-- applicative (peut différer de 'techsupport'@'%' selon la conf cPanel) :
SELECT CURRENT_USER() AS user_a_verifier;

REVOKE UPDATE, DELETE ON assetmngt.supply_stock_ledger FROM 'techsupport'@'%';

-- Contrôle : ne doit plus lister ni UPDATE ni DELETE sur supply_stock_ledger.
SHOW GRANTS FOR 'techsupport'@'%';

COMMIT;
-- ROLLBACK;
