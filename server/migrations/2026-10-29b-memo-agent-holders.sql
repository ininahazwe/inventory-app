-- Accès au module Mémos réservé aux admins et aux personnes déclarées dans /memos/admin.
-- Le niveau « agent » devient déclaratif (les auteurs de mémos y sont listés).
-- Cette reprise déclare comme agents tous ceux qui ont déjà rédigé un mémo, pour qu'ils
-- ne perdent pas l'accès. Rejouable (INSERT IGNORE sur la clé unique position + e-mail).
INSERT IGNORE INTO `memo_position_holders` (`position_id`, `user_email`, `holder_role`, `is_active`, `created_by`)
SELECT DISTINCT p.id, LOWER(m.author_email), 'holder', 1, 'migration 2026-10-29b'
FROM `memos` m
JOIN `memo_positions` p ON p.code = 'agent';
