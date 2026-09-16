-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE 2 — SCHÉMA + BACKFILL — Le ledger fournitures
--
-- À exécuter sur une copie de RECETTE, jamais directement en production.
-- Idempotent : relançable après un DROP des tables créées ici (voir section 0).
--
-- Hypothèses de valorisation historique (à relire avant de garder les
-- résultats) :
--   - Les sorties et ajustements historiques sont valorisés au coût unitaire
--     moyen des réceptions de l'article (SUM(line_total)/SUM(quantity_base)),
--     pas au coût réellement en vigueur au jour du mouvement. Reconstituer un
--     vrai coût moyen pondéré glissant demanderait de rejouer tout
--     l'historique jour par jour — hors de proportion pour un backfill.
--     À partir de la Phase 3, tout nouveau mouvement utilisera le vrai coût
--     moyen courant.
--   - Les 15 ajustements historiques sont bloqués sous
--     source='count', reason='error' (motif non tracé avant migration),
--     conformément à la décision de la Phase 1.
--
-- Prérequis : Phase 1 tranchée (voir supply-item-correspondence.csv),
-- reprise des coûts déjà en production (`supplies.unit_cost` peuplé).
-- ═══════════════════════════════════════════════════════════════════════════

START TRANSACTION;

-- ─── 0. Nettoyage (relance en recette) ─────────────────────────────────────
DROP TABLE IF EXISTS supply_stock_ledger;
DROP TABLE IF EXISTS supply_adjustment_lines;
DROP TABLE IF EXISTS supply_adjustments;
DROP TABLE IF EXISTS supply_issue_lines;
DROP TABLE IF EXISTS supply_issues;
DROP TABLE IF EXISTS supply_receipt_lines;
DROP TABLE IF EXISTS supply_receipts;
DROP TABLE IF EXISTS supply_batches;
DROP TABLE IF EXISTS supply_items;
DROP TABLE IF EXISTS supply_suppliers;
DROP TABLE IF EXISTS _migration_item_map;

-- ─── 1. Schéma cible ────────────────────────────────────────────────────────

CREATE TABLE supply_items (
  id                INT NOT NULL AUTO_INCREMENT,
  code              VARCHAR(80) NOT NULL,
  name              VARCHAR(255) NOT NULL,
  category_id       INT NULL,
  base_unit         VARCHAR(50) NOT NULL DEFAULT 'unit',
  is_batch_tracked  TINYINT(1) NOT NULL DEFAULT 0,
  reorder_point     INT NULL,
  target_level      INT NULL,
  is_active         TINYINT(1) NOT NULL DEFAULT 1,
  created_at        TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_supply_items_code (code),
  KEY idx_supply_items_category (category_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE supply_suppliers (
  id          INT NOT NULL AUTO_INCREMENT,
  name        VARCHAR(255) NOT NULL,
  contact     VARCHAR(255) NULL,
  is_active   TINYINT(1) NOT NULL DEFAULT 1,
  created_at  TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE supply_batches (
  id                INT NOT NULL AUTO_INCREMENT,
  item_id           INT NOT NULL,
  batch_code        VARCHAR(100) NULL,
  expiry_date       DATE NULL,
  receipt_line_id   INT NULL,
  created_at        TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_supply_batches_item (item_id),
  CONSTRAINT fk_supply_batches_item FOREIGN KEY (item_id) REFERENCES supply_items(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE supply_receipts (
  id                INT NOT NULL AUTO_INCREMENT,
  reference         VARCHAR(100) NULL,
  supplier_id       INT NULL,
  received_date     DATE NOT NULL,
  invoice_ref       VARCHAR(100) NULL,
  received_by_uid   VARCHAR(36) NULL,
  created_at        TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_supply_receipts_date (received_date),
  CONSTRAINT fk_supply_receipts_supplier FOREIGN KEY (supplier_id) REFERENCES supply_suppliers(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE supply_receipt_lines (
  id                INT NOT NULL AUTO_INCREMENT,
  receipt_id        INT NOT NULL,
  item_id           INT NOT NULL,
  pack_size         INT NOT NULL DEFAULT 1,
  packs_received    INT NOT NULL,
  quantity_base     INT NOT NULL,
  line_total        DECIMAL(12,2) NOT NULL,
  unit_cost_base    DECIMAL(12,4) NOT NULL,
  batch_code        VARCHAR(100) NULL,
  expiry_date       DATE NULL,
  legacy_supply_id  INT NULL COMMENT 'traçabilité vers l''ancien supplies.id, à retirer en fin de grâce',
  PRIMARY KEY (id),
  KEY idx_supply_receipt_lines_item (item_id),
  KEY idx_supply_receipt_lines_receipt (receipt_id),
  CONSTRAINT fk_supply_receipt_lines_receipt FOREIGN KEY (receipt_id) REFERENCES supply_receipts(id),
  CONSTRAINT fk_supply_receipt_lines_item FOREIGN KEY (item_id) REFERENCES supply_items(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE supply_issues (
  id                        INT NOT NULL AUTO_INCREMENT,
  reference                 VARCHAR(100) NULL,
  issue_date                DATE NOT NULL,
  destination_location_id   INT NULL,
  recipient_uid             VARCHAR(36) NULL,
  issued_by_uid             VARCHAR(36) NULL,
  purpose                   VARCHAR(255) NULL,
  created_at                TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_supply_issues_date (issue_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE supply_issue_lines (
  id                      INT NOT NULL AUTO_INCREMENT,
  issue_id                INT NOT NULL,
  item_id                 INT NOT NULL,
  quantity_base           INT NOT NULL,
  batch_id                INT NULL,
  legacy_assignment_id    INT NULL COMMENT 'traçabilité vers l''ancien supply_assignments.id',
  PRIMARY KEY (id),
  KEY idx_supply_issue_lines_item (item_id),
  KEY idx_supply_issue_lines_issue (issue_id),
  CONSTRAINT fk_supply_issue_lines_issue FOREIGN KEY (issue_id) REFERENCES supply_issues(id),
  CONSTRAINT fk_supply_issue_lines_item FOREIGN KEY (item_id) REFERENCES supply_items(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE supply_adjustments (
  id                INT NOT NULL AUTO_INCREMENT,
  adjustment_date   DATE NOT NULL,
  source            ENUM('count','event') NOT NULL,
  recorded_by_uid   VARCHAR(36) NULL,
  status            ENUM('draft','posted') NOT NULL DEFAULT 'posted',
  reason            ENUM('loss','breakage','expiry','error','found') NOT NULL,
  created_at        TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE supply_adjustment_lines (
  id                    INT NOT NULL AUTO_INCREMENT,
  adjustment_id         INT NOT NULL,
  item_id               INT NOT NULL,
  system_quantity       INT NOT NULL,
  counted_quantity      INT NOT NULL,
  variance              INT NOT NULL,
  legacy_movement_id    INT NULL COMMENT 'traçabilité vers l''ancien supply_movements.id',
  PRIMARY KEY (id),
  KEY idx_supply_adjustment_lines_item (item_id),
  KEY idx_supply_adjustment_lines_adj (adjustment_id),
  CONSTRAINT fk_supply_adjustment_lines_adj FOREIGN KEY (adjustment_id) REFERENCES supply_adjustments(id),
  CONSTRAINT fk_supply_adjustment_lines_item FOREIGN KEY (item_id) REFERENCES supply_items(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE supply_stock_ledger (
  id                INT NOT NULL AUTO_INCREMENT,
  item_id           INT NOT NULL,
  movement_date     DATE NOT NULL,
  reason            ENUM('receipt','issue','return','count_variance','write_off') NOT NULL,
  quantity_base     INT NOT NULL COMMENT 'signée : + entrée, - sortie',
  unit_cost_base    DECIMAL(12,4) NOT NULL,
  value             DECIMAL(12,2) NOT NULL COMMENT 'signée = quantity_base * unit_cost_base',
  location_id       INT NULL,
  batch_id          INT NULL,
  source_table      VARCHAR(50) NOT NULL,
  source_line_id    INT NOT NULL,
  reverses_id       INT NULL,
  created_at        TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ledger_item_date (item_id, movement_date),
  KEY idx_ledger_source (source_table, source_line_id),
  CONSTRAINT fk_ledger_item FOREIGN KEY (item_id) REFERENCES supply_items(id),
  CONSTRAINT fk_ledger_reverses FOREIGN KEY (reverses_id) REFERENCES supply_stock_ledger(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Immuable — REVOKE UPDATE, DELETE au compte applicatif en Phase 3.';

-- ─── 2. Table de correspondance (résultat de la Phase 1) ──────────────────
-- 37 lots -> 20 articles distincts. Voir supply-item-correspondence.csv.

CREATE TABLE _migration_item_map (
  supply_id           INT NOT NULL PRIMARY KEY,
  item_code           VARCHAR(80) NOT NULL,
  item_name           VARCHAR(255) NOT NULL,
  item_category_name  VARCHAR(255) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO _migration_item_map (supply_id, item_code, item_name, item_category_name) VALUES
(7,  'toilet-roll-daisy',          'Toilet Roll',                'Tissue'),
(27, 'toilet-roll-daisy',          'Toilet Roll',                'Tissue'),
(8,  'liquid-soap-morning-fresh',  'Liquid Soap (Morning Fresh)','Soap'),
(28, 'liquid-soap-morning-fresh',  'Liquid Soap (Morning Fresh)','Soap'),
(9,  'liquid-soap-fres',           'Liquid Soap (Fres)',         'Soap'),
(29, 'liquid-soap-fres',           'Liquid Soap (Fres)',         'Soap'),
(10, 'tissue-box-akwaaba',         'Tissue Box (Akwaaba)',       'Tissue'),
(30, 'tissue-box-akwaaba',         'Tissue Box (Akwaaba)',       'Tissue'),
(11, 'bleach-madar',               'Bleach (Madar)',             'Bleach'),
(31, 'bleach-madar',               'Bleach (Madar)',             'Bleach'),
(13, 'nescafe',                    'Nescafe',                    'Coffee'),
(33, 'nescafe',                    'Nescafe',                    'Coffee'),
(15, 'lipton-tea',                 'Lipton Tea',                 'Tea'),
(34, 'lipton-tea',                 'Lipton Tea',                 'Tea'),
(16, 'granulated-sugar',           'Granulated Sugar',           'Sugar'),
(35, 'granulated-sugar',           'Granulated Sugar',           'Sugar'),
(18, 'air-refresher-glade',        'Air Refresher (Glade)',      'Spray'),
(37, 'air-refresher-glade',        'Air Refresher (Glade)',      'Spray'),
(19, 'washing-powder-kleesoft',    'Washing Powder (Kleesoft)',  'Soap'),
(38, 'washing-powder-kleesoft',    'Washing Powder (Kleesoft)',  'Soap'),
(20, 'mosquito-spray-heaven',      'Mosquito Spray (Heaven)',    'Spray'),
(40, 'mosquito-spray-heaven',      'Mosquito Spray (Heaven)',    'Spray'),
(21, 'mosquito-coil-heaven',       'Mosquito Coil (Heaven)',     'Repellant'),
(41, 'mosquito-coil-heaven',       'Mosquito Coil (Heaven)',     'Repellant'),
(22, 'sanitizer-kleanz',           'Sanitizer (Kleanz)',         'Sanitizer'),
(42, 'sanitizer-kleanz',           'Sanitizer (Kleanz)',         'Sanitizer'),
(23, 'floor-cleaner-kas',          'Floor Cleaner (Kas)',        'Bleach'),
(43, 'floor-cleaner-kas',          'Floor Cleaner (Kas)',        'Bleach'),
(24, 'sponge',                     'Sponge',                     'Sponge'),
(44, 'sponge',                     'Sponge',                     'Sponge'),
(25, 'trash-bags',                 'Trash Bags',                 'Trash Bag'),
(45, 'trash-bags',                 'Trash Bags',                 'Trash Bag'),
(26, 'paper-towel-belpak',         'Paper Towel (Belpak)',       'Tissue'),
(32, 'paper-towel-belpak',         'Paper Towel (Belpak)',       'Tissue'),
(36, 'vim-washing-soda',           'Vim Washing Soda',           'Bleach'),
(39, 'toilet-brush-acqua',         'Toilet Brush (Acqua)',       'brush'),
(46, 'glass-cleaner-mcgali',       'Glass Cleaner (McGali)',     'Cleaning');

-- Contrôle : la table de correspondance doit couvrir exactement les mêmes
-- 37 id que `supplies` — sinon le backfill ci-dessous ignorerait ou
-- inventerait des lots.
-- (à exécuter manuellement si besoin)
-- SELECT s.id FROM supplies s LEFT JOIN _migration_item_map m ON m.supply_id = s.id WHERE m.supply_id IS NULL;
-- SELECT m.supply_id FROM _migration_item_map m LEFT JOIN supplies s ON s.id = m.supply_id WHERE s.id IS NULL;

-- Nouvelle catégorie décidée en Phase 1 (Glass Cleaner quitte "Sanitizer")
INSERT INTO categories (name, type, description)
SELECT 'Cleaning', 'supply', 'Produits de nettoyage de surface (créée à la migration, Phase 1)'
WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Cleaning' AND type = 'supply');

-- ─── 3. Référentiel ─────────────────────────────────────────────────────────

INSERT INTO supply_suppliers (name, is_active)
VALUES ('Fournisseur non précisé (historique)', 1);

INSERT INTO supply_items (code, name, category_id, base_unit, is_batch_tracked, reorder_point, is_active)
SELECT
  m.item_code,
  MIN(m.item_name),
  (SELECT c.id FROM categories c WHERE c.name = MIN(m.item_category_name) AND c.type = 'supply' LIMIT 1),
  'unit',
  0,
  MAX(s.low_stock_threshold),
  1
FROM _migration_item_map m
JOIN supplies s ON s.id = m.supply_id
GROUP BY m.item_code;

-- ─── 4. Réceptions (ex-`supplies`) ──────────────────────────────────────────
-- Un en-tête par (date d'achat, receveur) réellement observé dans les données
-- — pas un par date seule, pour ne pas fusionner deux livraisons distinctes
-- reçues par deux personnes le même jour.

INSERT INTO supply_receipts (received_date, supplier_id, received_by_uid)
SELECT DISTINCT
  s.purchase_date,
  (SELECT id FROM supply_suppliers ORDER BY id LIMIT 1),
  s.receiver_uid
FROM supplies s;

INSERT INTO supply_receipt_lines
  (receipt_id, item_id, pack_size, packs_received, quantity_base, line_total, unit_cost_base, legacy_supply_id)
SELECT
  r.id,
  i.id,
  1,
  s.quantity,
  s.quantity,
  s.cost,
  s.unit_cost,
  s.id
FROM supplies s
JOIN _migration_item_map m ON m.supply_id = s.id
JOIN supply_items i ON i.code = m.item_code
JOIN supply_receipts r ON r.received_date = s.purchase_date AND r.received_by_uid = s.receiver_uid;

-- ─── 5. Sorties (ex-`supply_assignments`) ──────────────────────────────────
-- Un en-tête par (date, lieu, destinataire) réellement observé — une
-- "tournée" au sens propre : même jour, même lieu, même personne.

INSERT INTO supply_issues (issue_date, destination_location_id, recipient_uid)
SELECT DISTINCT
  a.assigned_at,
  a.location_id,
  COALESCE(a.assigned_user_id, a.assignee_email, a.assignee_name, 'inconnu')
FROM supply_assignments a;

INSERT INTO supply_issue_lines (issue_id, item_id, quantity_base, legacy_assignment_id)
SELECT
  q.id,
  i.id,
  a.quantity_assigned,
  a.id
FROM supply_assignments a
JOIN _migration_item_map m ON m.supply_id = a.supply_id
JOIN supply_items i ON i.code = m.item_code
JOIN supply_issues q
  ON q.issue_date = a.assigned_at
 AND q.destination_location_id <=> a.location_id
 AND q.recipient_uid = COALESCE(a.assigned_user_id, a.assignee_email, a.assignee_name, 'inconnu');

-- ─── 6. Ajustements (ex-`supply_movements` type='adjustment') ──────────────
-- Regroupés par date : dans les données réelles, les 15 lignes historiques
-- viennent toutes du recomptage du 27 août (source='count'). `reason='error'`
-- car le motif précis (perte/casse/comptage) n'a jamais été tracé avant la
-- migration — décision actée en Phase 1, pas une invention de ce script.

INSERT INTO supply_adjustments (adjustment_date, source, status, reason)
SELECT DISTINCT movement_date, 'count', 'posted', 'error'
FROM supply_movements
WHERE type = 'adjustment';

INSERT INTO supply_adjustment_lines
  (adjustment_id, item_id, system_quantity, counted_quantity, variance, legacy_movement_id)
SELECT
  adj.id,
  i.id,
  COALESCE((
    SELECT SUM(l.quantity_base)
    FROM supply_stock_ledger l
    WHERE l.item_id = i.id AND l.movement_date < mv.movement_date
  ), 0) AS system_quantity,
  COALESCE((
    SELECT SUM(l.quantity_base)
    FROM supply_stock_ledger l
    WHERE l.item_id = i.id AND l.movement_date < mv.movement_date
  ), 0) + mv.qty AS counted_quantity,
  mv.qty,
  mv.id
FROM supply_movements mv
JOIN _migration_item_map m ON m.supply_id = mv.supply_id
JOIN supply_items i ON i.code = m.item_code
JOIN supply_adjustments adj ON adj.adjustment_date = mv.movement_date
WHERE mv.type = 'adjustment';

-- ─── 7. Le ledger — recopie les trois couches de documents ────────────────
-- unit_cost_base des sorties et ajustements : coût moyen des réceptions de
-- l'article (voir note de valorisation en tête de fichier).

INSERT INTO supply_stock_ledger
  (item_id, movement_date, reason, quantity_base, unit_cost_base, value, location_id, source_table, source_line_id)
SELECT
  rl.item_id, r.received_date, 'receipt', rl.quantity_base, rl.unit_cost_base,
  ROUND(rl.quantity_base * rl.unit_cost_base, 2), NULL, 'supply_receipt_lines', rl.id
FROM supply_receipt_lines rl
JOIN supply_receipts r ON r.id = rl.receipt_id;

INSERT INTO supply_stock_ledger
  (item_id, movement_date, reason, quantity_base, unit_cost_base, value, location_id, source_table, source_line_id)
SELECT
  il.item_id, q.issue_date, 'issue', -il.quantity_base,
  wac.unit_cost_base, ROUND(-il.quantity_base * wac.unit_cost_base, 2),
  q.destination_location_id, 'supply_issue_lines', il.id
FROM supply_issue_lines il
JOIN supply_issues q ON q.id = il.issue_id
JOIN (
  SELECT item_id, SUM(line_total) / SUM(quantity_base) AS unit_cost_base
  FROM supply_receipt_lines GROUP BY item_id
) wac ON wac.item_id = il.item_id;

INSERT INTO supply_stock_ledger
  (item_id, movement_date, reason, quantity_base, unit_cost_base, value, location_id, source_table, source_line_id)
SELECT
  al.item_id, adj.adjustment_date, 'count_variance', al.variance,
  wac.unit_cost_base, ROUND(al.variance * wac.unit_cost_base, 2),
  NULL, 'supply_adjustment_lines', al.id
FROM supply_adjustment_lines al
JOIN supply_adjustments adj ON adj.id = al.adjustment_id
JOIN (
  SELECT item_id, SUM(line_total) / SUM(quantity_base) AS unit_cost_base
  FROM supply_receipt_lines GROUP BY item_id
) wac ON wac.item_id = al.item_id;

-- ─── 8. Vues dérivées ───────────────────────────────────────────────────────

CREATE OR REPLACE VIEW v_supply_stock AS
SELECT
  item_id,
  SUM(quantity_base) AS qty_on_hand,
  SUM(value) AS value_on_hand,
  CASE WHEN SUM(quantity_base) = 0 THEN NULL ELSE SUM(value) / SUM(quantity_base) END AS avg_unit_cost
FROM supply_stock_ledger
GROUP BY item_id;

CREATE OR REPLACE VIEW v_supply_consumption AS
SELECT
  item_id,
  location_id,
  DATE_FORMAT(movement_date, '%Y-%m-01') AS month,
  SUM(-quantity_base) AS qty_out,
  SUM(-value) AS value_out
FROM supply_stock_ledger
WHERE reason = 'issue'
GROUP BY item_id, location_id, DATE_FORMAT(movement_date, '%Y-%m-01');

CREATE OR REPLACE VIEW v_supply_cover AS
SELECT
  st.item_id,
  st.qty_on_hand,
  cons.avg_daily_qty_out,
  CASE WHEN cons.avg_daily_qty_out > 0 THEN st.qty_on_hand / cons.avg_daily_qty_out ELSE NULL END AS cover_days
FROM v_supply_stock st
LEFT JOIN (
  SELECT item_id, SUM(-quantity_base) / 90 AS avg_daily_qty_out
  FROM supply_stock_ledger
  WHERE reason = 'issue' AND movement_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
  GROUP BY item_id
) cons ON cons.item_id = st.item_id;

-- ─── 9. Contrôle de parité ──────────────────────────────────────────────────
-- Doit renvoyer zéro ligne : le stock par article du nouveau ledger doit
-- égaler, à l'unité près, celui recalculé sur l'ancien `supply_movements`
-- regroupé selon la table de correspondance de la Phase 1.

SELECT
  new_stock.item_id,
  new_stock.qty_new,
  old_stock.qty_old,
  new_stock.qty_new - old_stock.qty_old AS ecart
FROM (
  SELECT i.id AS item_id, SUM(l.quantity_base) AS qty_new
  FROM supply_stock_ledger l JOIN supply_items i ON i.id = l.item_id
  GROUP BY i.id
) new_stock
JOIN (
  SELECT i.id AS item_id, SUM(mv.qty) AS qty_old
  FROM supply_movements mv
  JOIN _migration_item_map m ON m.supply_id = mv.supply_id
  JOIN supply_items i ON i.code = m.item_code
  GROUP BY i.id
) old_stock ON old_stock.item_id = new_stock.item_id
HAVING ecart <> 0;

-- mouvements_source doit égaler le total: réceptions (37) + sorties + ajustements
SELECT
  (SELECT COUNT(*) FROM supply_receipt_lines)    AS n_receipt_lines,
  (SELECT COUNT(*) FROM supply_issue_lines)      AS n_issue_lines,
  (SELECT COUNT(*) FROM supply_adjustment_lines) AS n_adjustment_lines,
  (SELECT COUNT(*) FROM supply_stock_ledger)     AS n_ledger_rows,
  (SELECT COUNT(*) FROM supply_movements)        AS n_old_movements;

-- ─── Validation ────────────────────────────────────────────────────────────
-- Décommenter COMMIT et commenter ROLLBACK une fois les deux contrôles
-- ci-dessus vérifiés à l'œil (zéro ligne d'écart, comptages cohérents).
-- COMMIT;
ROLLBACK;
