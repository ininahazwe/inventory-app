-- ============================================================================
-- Module « Mémos » et chaîne de validation — 28/10/2026
--
-- Un mémo (demande de fonds, autorisation, note d'information…) circule dans
-- un circuit de validation : l'auteur (agent) signe et soumet, puis un manager
-- recommande, un director approuve, la finance décaisse. Le circuit est défini
-- par modèle (`memo_chain_templates`) et FIGÉ sur chaque mémo à la soumission
-- (`memo_steps`) : modifier un modèle n'affecte que les futurs mémos.
--
-- Douze tables, toutes nouvelles, en trois couches :
--   Référentiel (admin) : memo_positions, memo_position_holders, memo_types,
--                         memo_chain_templates, memo_chain_steps, memo_projects
--   Documents           : memos, memo_steps, memo_attachments, user_signatures
--   Journal / suites    : memo_events, memo_sequences
--
-- Invariants (tenus par le code, dans server/src/services/memoService.ts) :
--   1. Un seul pas actif à la fois (circuit séquentiel).
--   2. Le circuit est copié dans `memo_steps` à la soumission.
--   3. Le décideur est un titulaire/suppléant ACTIF du niveau du pas actif, et
--      jamais l'auteur du mémo. Une soumission est refusée si un niveau du
--      circuit n'a aucun titulaire actif.
--   4. Contenu immuable après soumission ; une correction passe par « returned »
--      → nouvelle révision (`memos.revision_no`) → circuit redémarré. Les pas et
--      pièces des anciennes révisions restent consultables.
--   5. `released` exige `approved` ; montant et devise figés après approbation.
--      Un refus de la finance donne `release_refused`, sans effacer l'approbation.
--   6. Toute transition écrit son événement dans `memo_events` (append-only).
--   7. Rejet, retour et refus de décaissement exigent un commentaire.
--   8. Aucune action sans signature active ; l'empreinte de la signature utilisée
--      est copiée sur le pas (`memo_steps.signature_sha256`) et ne change plus.
--
-- Rien ici ne touche une table existante. Les titulaires par niveau sont
-- laissés VIDES : un admin les saisit ensuite (le niveau « agent » n'en a pas :
-- tout utilisateur connecté peut rédiger un mémo).
-- ============================================================================

START TRANSACTION;

-- ─── 1. Référentiel ─────────────────────────────────────────────────────────

-- Les quatre niveaux hiérarchiques. Les circuits pointent vers un niveau,
-- jamais vers une personne : changer de titulaire ne touche aucun circuit.
CREATE TABLE IF NOT EXISTS `memo_positions` (
    `id`         int NOT NULL AUTO_INCREMENT,
    `code`       varchar(30)  COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'agent | manager | director | finance',
    `label`      varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
    `sort_order` int NOT NULL DEFAULT 0,
    `is_active`  tinyint(1) NOT NULL DEFAULT 1,
    `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_memo_position_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Niveaux hiérarchiques des circuits de mémos';

-- Qui occupe un niveau : plusieurs titulaires et suppléants possibles.
CREATE TABLE IF NOT EXISTS `memo_position_holders` (
    `id`          int NOT NULL AUTO_INCREMENT,
    `position_id` int NOT NULL,
    `user_email`  varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
    `holder_role` enum('holder','deputy') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'holder',
    `is_active`   tinyint(1) NOT NULL DEFAULT 1 COMMENT '0 = désactivé (on garde la trace plutôt que de supprimer)',
    `created_at`  timestamp NULL DEFAULT CURRENT_TIMESTAMP,
    `created_by`  varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_memo_holder` (`position_id`,`user_email`),
    KEY `idx_memo_holder_user` (`user_email`,`is_active`),
    CONSTRAINT `fk_memo_holder_position` FOREIGN KEY (`position_id`) REFERENCES `memo_positions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Titulaires et suppléants de chaque niveau';

CREATE TABLE IF NOT EXISTS `memo_types` (
    `id`                  int NOT NULL AUTO_INCREMENT,
    `code`                varchar(40)  COLLATE utf8mb4_unicode_ci NOT NULL,
    `name`                varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
    `requires_amount`     tinyint(1) NOT NULL DEFAULT 0 COMMENT 'Montant et devise obligatoires',
    `requires_project`    tinyint(1) NOT NULL DEFAULT 0 COMMENT 'Projet (bailleur) obligatoire',
    `requires_attachment` tinyint(1) NOT NULL DEFAULT 0 COMMENT 'Au moins une pièce jointe à la soumission',
    `is_active`           tinyint(1) NOT NULL DEFAULT 1,
    `created_at`          timestamp NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_memo_type_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Types de mémo ; les champs financiers sont optionnels selon le type';

-- Modèles de circuit. Pas de seuil de montant en v1 : le circuit dépend du type
-- seulement. Plusieurs modèles actifs par type sont possibles ; `is_default`
-- désigne celui proposé à la rédaction.
CREATE TABLE IF NOT EXISTS `memo_chain_templates` (
    `id`         int NOT NULL AUTO_INCREMENT,
    `type_id`    int NOT NULL,
    `name`       varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
    `is_default` tinyint(1) NOT NULL DEFAULT 0,
    `is_active`  tinyint(1) NOT NULL DEFAULT 1,
    `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_memo_template_name` (`type_id`,`name`),
    CONSTRAINT `fk_memo_template_type` FOREIGN KEY (`type_id`) REFERENCES `memo_types` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Modèles de circuit de validation, par type de mémo';

-- Les pas d'un modèle, APRÈS la soumission : la soumission par l'auteur est
-- implicite (pas n° 0 dans `memo_steps`). Une signature est requise à chaque pas.
CREATE TABLE IF NOT EXISTS `memo_chain_steps` (
    `id`          int NOT NULL AUTO_INCREMENT,
    `template_id` int NOT NULL,
    `step_no`     int NOT NULL COMMENT 'Ordre d''exécution, à partir de 1',
    `kind`        enum('recommend','approve','release') COLLATE utf8mb4_unicode_ci NOT NULL,
    `position_id` int NOT NULL,
    `label`       varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Mention affichée et imprimée, ex. « Recommended for approval »',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_memo_chain_step` (`template_id`,`step_no`),
    KEY `fk_memo_chain_step_position` (`position_id`),
    CONSTRAINT `fk_memo_chain_step_template` FOREIGN KEY (`template_id`) REFERENCES `memo_chain_templates` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_memo_chain_step_position` FOREIGN KEY (`position_id`) REFERENCES `memo_positions` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Pas ordonnés d''un modèle de circuit';

-- Projets / bailleurs auxquels une dépense peut être rattachée.
CREATE TABLE IF NOT EXISTS `memo_projects` (
    `id`               int NOT NULL AUTO_INCREMENT,
    `code`             varchar(40)  COLLATE utf8mb4_unicode_ci NOT NULL,
    `title`            varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
    `donor`            varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `default_currency` char(3) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `is_active`        tinyint(1) NOT NULL DEFAULT 1,
    `created_at`       timestamp NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_memo_project_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Projets et bailleurs pour les demandes de fonds';

-- ─── 2. Signatures des utilisateurs ─────────────────────────────────────────
-- Une signature enregistrée est réutilisable ; on en garde l'historique
-- (is_active = 1 pour la version courante) car un pas de mémo y fait référence.
CREATE TABLE IF NOT EXISTS `user_signatures` (
    `id`         int NOT NULL AUTO_INCREMENT,
    `user_uid`   varchar(36)  COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'FK users.id',
    `user_email` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Copie de l''email (survit à la suppression du compte)',
    `image_path` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Chemin disque, HORS dossier public',
    `sha256`     char(64)     COLLATE utf8mb4_unicode_ci NOT NULL,
    `source`     enum('drawn','typed','uploaded') COLLATE utf8mb4_unicode_ci NOT NULL,
    `is_active`  tinyint(1) NOT NULL DEFAULT 1,
    `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_signature_user` (`user_email`,`is_active`),
    KEY `fk_signature_user` (`user_uid`),
    CONSTRAINT `fk_signature_user` FOREIGN KEY (`user_uid`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Signatures enregistrées (dessinées, tapées ou importées)';

-- ─── 3. Les mémos ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `memos` (
    `id`                int NOT NULL AUTO_INCREMENT,
    `reference`         varchar(40)  COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Ex. MFWA/MEMO/2026/0012 ; attribuée à la première soumission (NULL en brouillon)',
    `type_id`           int NOT NULL,
    `template_id`       int NOT NULL COMMENT 'Modèle de circuit choisi à la rédaction',
    `author_uid`        varchar(36)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `author_email`      varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
    `to_label`          varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Ligne TO du mémo',
    `from_label`        varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Ligne FROM du mémo',
    `subject`           varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
    `body`              mediumtext   COLLATE utf8mb4_unicode_ci NOT NULL,
    `memo_date`         date NOT NULL,
    `amount`            decimal(14,2) DEFAULT NULL,
    `currency`          char(3) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'GHS, EUR…',
    `project_id`        int DEFAULT NULL,
    `activity_ref`      varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Ligne budgétaire / activité, ex. 6.2',
    `status`            enum('draft','in_review','approved','released','release_refused','returned','rejected','withdrawn')
                            COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
    `revision_no`       int NOT NULL DEFAULT 1,
    `current_step_no`   int DEFAULT NULL COMMENT 'Pas actif (NULL hors circuit). L''étape en cours n''est pas un statut.',
    `source`            enum('digital','imported_scan') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'digital',
    `submitted_at`      timestamp NULL DEFAULT NULL,
    `approved_at`       timestamp NULL DEFAULT NULL,
    `released_at`       timestamp NULL DEFAULT NULL,
    `release_reference` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Référence de paiement saisie par la finance',
    `pdf_path`          varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `pdf_sha256`        char(64)     COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `created_at`        timestamp NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`        timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_memo_reference` (`reference`),
    KEY `idx_memo_author` (`author_email`,`status`),
    KEY `idx_memo_status_step` (`status`,`current_step_no`),
    KEY `fk_memo_type` (`type_id`),
    KEY `fk_memo_template` (`template_id`),
    KEY `fk_memo_project` (`project_id`),
    KEY `fk_memo_author` (`author_uid`),
    CONSTRAINT `fk_memo_type`     FOREIGN KEY (`type_id`)     REFERENCES `memo_types` (`id`),
    CONSTRAINT `fk_memo_template` FOREIGN KEY (`template_id`) REFERENCES `memo_chain_templates` (`id`),
    CONSTRAINT `fk_memo_project`  FOREIGN KEY (`project_id`)  REFERENCES `memo_projects` (`id`) ON DELETE SET NULL,
    CONSTRAINT `fk_memo_author`   FOREIGN KEY (`author_uid`)  REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Mémos — état courant ; l''historique complet est dans memo_events';

-- Copie figée du circuit pour ce mémo, par révision. Le pas n° 0 est la
-- soumission par l'auteur. Qui peut agir = titulaires/suppléants actifs du
-- niveau `position_id` au moment de la décision (pas d'assigné figé : un
-- titulaire absent peut être remplacé sans toucher aux mémos en cours).
CREATE TABLE IF NOT EXISTS `memo_steps` (
    `id`               int NOT NULL AUTO_INCREMENT,
    `memo_id`          int NOT NULL,
    `revision_no`      int NOT NULL DEFAULT 1,
    `step_no`          int NOT NULL COMMENT '0 = soumission par l''auteur',
    `kind`             enum('submit','recommend','approve','release') COLLATE utf8mb4_unicode_ci NOT NULL,
    `position_id`      int NOT NULL,
    `label`            varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
    `status`           enum('pending','active','done','returned','rejected','refused','skipped')
                           COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
    `acted_by_email`   varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `acted_at`         timestamp NULL DEFAULT NULL,
    `comment`          text COLLATE utf8mb4_unicode_ci,
    `signature_id`     int DEFAULT NULL,
    `signature_sha256` char(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Empreinte de la signature utilisée, figée',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_memo_step` (`memo_id`,`revision_no`,`step_no`),
    KEY `idx_memo_step_active` (`status`,`position_id`),
    KEY `fk_memo_step_position` (`position_id`),
    KEY `fk_memo_step_signature` (`signature_id`),
    CONSTRAINT `fk_memo_step_memo`      FOREIGN KEY (`memo_id`)      REFERENCES `memos` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_memo_step_position`  FOREIGN KEY (`position_id`)  REFERENCES `memo_positions` (`id`),
    CONSTRAINT `fk_memo_step_signature` FOREIGN KEY (`signature_id`) REFERENCES `user_signatures` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Circuit figé d''un mémo : un pas = une signature';

CREATE TABLE IF NOT EXISTS `memo_attachments` (
    `id`                int NOT NULL AUTO_INCREMENT,
    `memo_id`           int NOT NULL,
    `revision_no`       int NOT NULL DEFAULT 1,
    `kind`              enum('budget','invoice','scan','other') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'other',
    `original_name`     varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
    `stored_path`       varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Chemin disque, hors dossier public',
    `mime_type`         varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
    `size_bytes`        int NOT NULL,
    `sha256`            char(64)     COLLATE utf8mb4_unicode_ci NOT NULL,
    `uploaded_by_email` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
    `uploaded_at`       timestamp NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_memo_attachment` (`memo_id`,`revision_no`),
    CONSTRAINT `fk_memo_attachment_memo` FOREIGN KEY (`memo_id`) REFERENCES `memos` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Pièces jointes (budget, facture, scan d''un mémo papier signé)';

-- ─── 4. Journal et compteur ─────────────────────────────────────────────────
-- Append-only : jamais d'UPDATE ni de DELETE (le CASCADE ne sert que si le mémo
-- lui-même disparaît).
CREATE TABLE IF NOT EXISTS `memo_events` (
    `id`          int NOT NULL AUTO_INCREMENT,
    `memo_id`     int NOT NULL,
    `revision_no` int NOT NULL DEFAULT 1,
    `step_no`     int DEFAULT NULL,
    `event_type`  varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'created|submitted|recommended|approved|returned|rejected|released|release_refused|release_reopened|resubmitted|withdrawn|reminder',
    `from_status` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `to_status`   varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `actor_email` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '''system'' pour les relances',
    `event_at`    timestamp NULL DEFAULT CURRENT_TIMESTAMP,
    `payload`     json DEFAULT NULL,
    `notes`       text COLLATE utf8mb4_unicode_ci,
    PRIMARY KEY (`id`),
    KEY `idx_memo_event` (`memo_id`,`event_at`),
    CONSTRAINT `fk_memo_event_memo` FOREIGN KEY (`memo_id`) REFERENCES `memos` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Journal des transitions de mémo — source de vérité de l''historique';

-- Compteur annuel pour la référence ; incrémenté dans la transaction qui
-- attribue la référence (SELECT … FOR UPDATE).
CREATE TABLE IF NOT EXISTS `memo_sequences` (
    `year`        smallint NOT NULL,
    `last_number` int NOT NULL DEFAULT 0,
    PRIMARY KEY (`year`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Compteur annuel des références de mémo';

-- ─── 5. Données de départ (idempotentes) ────────────────────────────────────
-- Les codes étant UNIQUE, INSERT IGNORE permet de rejouer la section sans doublon.

INSERT IGNORE INTO `memo_positions` (`code`,`label`,`sort_order`) VALUES
    ('agent',    'Agent',    1),
    ('manager',  'Manager',  2),
    ('director', 'Director', 3),
    ('finance',  'Finance',  4);

INSERT IGNORE INTO `memo_types` (`code`,`name`,`requires_amount`,`requires_project`,`requires_attachment`) VALUES
    ('funds_request',    'Request for funds',    1, 0, 1),
    ('authorisation',    'Authorisation',        0, 0, 0),
    ('information_note', 'Information note',     0, 0, 0);

-- Modèles : à ajuster par un admin. La recommandation du manager ne peut pas être
-- sautée par l'auteur : un seul modèle « Standard » par type au départ.
INSERT IGNORE INTO `memo_chain_templates` (`type_id`,`name`,`is_default`,`is_active`)
    SELECT id, 'Standard', 1, 1 FROM `memo_types` WHERE `code` = 'funds_request';
INSERT IGNORE INTO `memo_chain_templates` (`type_id`,`name`,`is_default`,`is_active`)
    SELECT id, 'Standard', 1, 1 FROM `memo_types` WHERE `code` IN ('authorisation','information_note');

-- Pas du circuit « Standard » des demandes de fonds : manager → director → finance.
INSERT IGNORE INTO `memo_chain_steps` (`template_id`,`step_no`,`kind`,`position_id`,`label`)
    SELECT t.id, 1, 'recommend', (SELECT id FROM memo_positions WHERE code='manager'),  'Recommended for approval'
      FROM memo_chain_templates t JOIN memo_types ty ON ty.id = t.type_id
     WHERE ty.code = 'funds_request' AND t.name = 'Standard';
INSERT IGNORE INTO `memo_chain_steps` (`template_id`,`step_no`,`kind`,`position_id`,`label`)
    SELECT t.id, 2, 'approve', (SELECT id FROM memo_positions WHERE code='director'), 'Approved'
      FROM memo_chain_templates t JOIN memo_types ty ON ty.id = t.type_id
     WHERE ty.code = 'funds_request' AND t.name = 'Standard';
INSERT IGNORE INTO `memo_chain_steps` (`template_id`,`step_no`,`kind`,`position_id`,`label`)
    SELECT t.id, 3, 'release', (SELECT id FROM memo_positions WHERE code='finance'),  'Funds released'
      FROM memo_chain_templates t JOIN memo_types ty ON ty.id = t.type_id
     WHERE ty.code = 'funds_request' AND t.name = 'Standard';

-- Autorisation et note d'information : manager → director (sans décaissement).
INSERT IGNORE INTO `memo_chain_steps` (`template_id`,`step_no`,`kind`,`position_id`,`label`)
    SELECT t.id, 1, 'recommend', (SELECT id FROM memo_positions WHERE code='manager'),  'Recommended for approval'
      FROM memo_chain_templates t JOIN memo_types ty ON ty.id = t.type_id
     WHERE ty.code IN ('authorisation','information_note') AND t.name = 'Standard';
INSERT IGNORE INTO `memo_chain_steps` (`template_id`,`step_no`,`kind`,`position_id`,`label`)
    SELECT t.id, 2, 'approve', (SELECT id FROM memo_positions WHERE code='director'), 'Approved'
      FROM memo_chain_templates t JOIN memo_types ty ON ty.id = t.type_id
     WHERE ty.code IN ('authorisation','information_note') AND t.name = 'Standard';

COMMIT;

-- ⚠️ Rappel (leçon de la Phase 2 fournitures) : en MySQL/MariaDB, un CREATE TABLE
-- déclenche un commit implicite. Le START TRANSACTION ci-dessus ne constitue donc
-- PAS un filet de sécurité : faire un dump avant exécution. Le script ne crée que
-- des tables nouvelles et peut être rejoué (IF NOT EXISTS / INSERT IGNORE).
--
-- Après exécution : un admin saisit les titulaires par niveau (memo_position_holders).
-- Tant qu'un niveau d'un circuit n'a aucun titulaire actif, la soumission d'un mémo
-- utilisant ce circuit est refusée avec un message explicite.
