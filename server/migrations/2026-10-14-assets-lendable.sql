-- ============================================================================
-- Assets — drapeau « prêtable » (14/10/2026)
-- Un matériel n'est proposé dans le module Loans (/loans/new) que si is_lendable = 1.
-- Opt-in : DEFAULT 0, donc aucun asset existant n'est prêtable tant qu'un admin ne
-- l'a pas activé depuis /inventory. La règle est aussi imposée côté serveur à la
-- création d'une demande de prêt (pas seulement masquée dans la liste).
-- Additif : aucune ligne existante modifiée. (ALTER = commit implicite → dump avant.)
-- ============================================================================
ALTER TABLE `assets`
    ADD COLUMN `is_lendable` tinyint(1) NOT NULL DEFAULT 0
        COMMENT '1 = proposé dans le module de prêts (activable par un admin)'
        AFTER `photo_url`,
    ADD KEY `idx_assets_lendable` (`is_lendable`);
