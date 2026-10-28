-- Choix du manager par l'auteur (Memos).
-- `memos.manager_email`      : manager choisi à la rédaction (NULL = « n'importe quel manager du niveau »).
-- `memo_steps.assigned_email`: copie figée sur le pas de recommandation à la soumission. Si renseigné, SEUL
--                              ce titulaire peut agir sur le pas et recevoir les mails ; l'auteur (ou un admin)
--                              peut le changer tant que le pas est en attente (évènement `reassigned`).
-- À exécuter UNE fois (ALTER TABLE n'est pas rejouable).
ALTER TABLE `memos`
    ADD COLUMN `manager_email` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL
        COMMENT 'Manager choisi par l''auteur (NULL = tout manager du niveau)' AFTER `activity_ref`;
ALTER TABLE `memo_steps`
    ADD COLUMN `assigned_email` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL
        COMMENT 'Si renseigné, seul ce titulaire agit sur ce pas' AFTER `position_id`;
