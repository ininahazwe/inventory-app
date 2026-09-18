# Déploiement

L'application se déploie en « pull » : c'est le serveur qui va chercher le code,
pas GitHub qui le pousse. Un cron cPanel exécute `deploy/deploy.sh` toutes les
cinq minutes ; le script regarde s'il existe un nouveau commit sur `main` et,
le cas échéant, construit puis publie la nouvelle version.

## Pourquoi ce modèle

Le pipeline précédent (GitHub Actions + `appleboy/ssh-action`) ouvrait une
session SSH vers cet hébergement mutualisé. Cette session se faisait tuer
(SIGTERM, code 143) au bout de quatre à cinq secondes, quelle que soit la
commande en cours. Trois exécutions, trois échecs, et deux mises hors ligne du
site les 16 et 17 septembre 2026 — parce que l'étape de rollback, elle aussi
exécutée par SSH, se faisait tuer de la même façon avant d'avoir restauré quoi
que ce soit. La cause exacte du kill n'a jamais été établie ; ce modèle la
contourne en supprimant la session SSH entrante.

Deux contraintes de l'hébergement sont restées, et le script les respecte :
`pm2 delete` suivi de `pm2 start` se fait tuer même depuis un terminal
interactif, alors que `pm2 restart` sur un process déjà enregistré fonctionne
systématiquement. Le script ne fait donc jamais que `pm2 restart`, et c'est
pourquoi l'enregistrement du process est une étape d'installation manuelle,
faite une fois pour toutes.

## Ce que le script garantit

La production n'est pas touchée tant que les deux builds ne sont pas terminés
et vérifiés. Un échec de `npm ci`, de compilation, ou d'injection des variables
d'environnement laisse le site intact et en ligne — c'est le cas de loin le plus
fréquent, et il est désormais sans conséquence.

Une fois la bascule faite, le retour arrière consiste à remettre en place deux
répertoires conservés (`dist.prev` et `public.prev`) puis à redémarrer. Quelques
secondes, aucune réinstallation de dépendances, aucune copie de `node_modules` —
c'est précisément ce qui avait fait échouer les rollbacks précédents.

`.env` et `.htaccess` ne sont jamais effacés ni écrasés.

Un commit qui échoue est enregistré dans `~/deploy-state/failed-commit` et n'est
plus rejoué. Sans ce garde-fou, le cron retenterait le même commit cassé toutes
les cinq minutes et ferait clignoter le site.

En fonctionnement normal le script est silencieux : tout part dans le journal.
Ce qui sort sur la sortie standard est envoyé par mail par cron — donc
uniquement les alertes. Pas de nouvelles, bonnes nouvelles.

## Installation (une seule fois, sur le serveur)

**1. Le fichier de configuration du build.** Les variables `VITE_*` étaient
auparavant des secrets GitHub ; elles doivent maintenant vivre sur le serveur.

```bash
mkdir -p ~/deploy-config
cat > ~/deploy-config/build.env << 'EOF'
VITE_GOOGLE_CLIENT_ID=<...>
VITE_CLOUDINARY_CLOUD_NAME=<...>
VITE_CLOUDINARY_UPLOAD_PRESET=<...>
VITE_API_URL=https://assets.mfwa.org/api
EOF
chmod 600 ~/deploy-config/build.env
```

Les valeurs actuelles sont lisibles dans le site en ligne :

```bash
curl -s https://assets.mfwa.org/ | grep -A 8 "window.__ENV__"
```

Le script refuse de construire si `VITE_GOOGLE_CLIENT_ID` ou `VITE_API_URL` est
vide : un frontend compilé avec ces variables vides casse la connexion Google
sans la moindre erreur visible, ce qui est pire qu'un échec net.

**2. Le dépôt de build.** Il existe déjà en `~/repositories/inventory-app`.
Vérifier qu'il suit bien `main` et qu'il peut récupérer le code :

```bash
cd ~/repositories/inventory-app
git fetch origin main && git rev-parse --short origin/main
```

**3. Le process pm2.** Il doit être enregistré sous le nom `assets-tool` — le
script ne fait que le redémarrer, jamais le créer.

```bash
pm2 list | grep assets-tool
```

**4. L'état initial.** Pour éviter que le premier passage du cron ne redéploie
la version déjà en ligne, on lui indique où on en est :

```bash
mkdir -p ~/deploy-state
cd ~/repositories/inventory-app && git rev-parse origin/main > ~/deploy-state/deployed-commit
```

**5. Le cron.** Dans cPanel → Cron Jobs, toutes les cinq minutes :

```
*/5 * * * * /home/dxtrmfwa/repositories/inventory-app/deploy/deploy.sh
```

Ne pas rediriger la sortie vers `/dev/null` : c'est elle qui sert de
notification d'échec par mail.

## Exploitation

```bash
cat ~/deploy-state/status.json        # état du dernier déploiement
tail -40 ~/deploy-logs/deploy-$(date +%Y%m%d).log
cat ~/deploy-state/deployed-commit    # commit actuellement en ligne
```

Forcer un déploiement immédiat sans attendre le cron :

```bash
~/repositories/inventory-app/deploy/deploy.sh
```

## Dépannage

**Un commit a échoué et n'est plus tenté.** C'est voulu. Corriger le problème,
pousser un nouveau commit (qui sera déployé normalement), ou lever le marqueur
pour rejouer le même :

```bash
rm ~/deploy-state/failed-commit
```

**`pm2 restart` échoue : le process n'est plus enregistré.** À faire à la main,
depuis un terminal interactif — et en gardant à l'esprit que `pm2 start` peut se
faire tuer sur cet hébergement ; si c'est le cas, relancer la commande jusqu'à
ce qu'elle passe, puis `pm2 save`.

```bash
cd ~/public_html/assets.mfwa.org
pm2 start dist/server.js --name assets-tool --watch false \
  --max-memory-restart 500M \
  --error logs/error.log --output logs/out.log \
  --node-args="--require dotenv/config" --update-env
pm2 save
```

**Le déploiement semble bloqué.** Un verrou empêche deux exécutions simultanées.
Il est cassé automatiquement au bout de trente minutes, ou manuellement :

```bash
rm -rf ~/deploy-state/deploy.lock
```

**Revenir à la version précédente immédiatement.** Les répertoires `dist.prev`
et `public.prev` contiennent la génération d'avant :

```bash
cd ~/public_html/assets.mfwa.org
rm -rf dist public && mv dist.prev dist && mv public.prev public
pm2 restart assets-tool
```
