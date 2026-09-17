#!/bin/bash
#
# Deploiement "pull" de l'application Assets Management.
#
# Ce script tourne SUR LE SERVEUR, lance par un cron cPanel. Il verifie s'il
# existe un nouveau commit sur main et, le cas echeant, construit puis publie
# la nouvelle version.
#
# Pourquoi ce modele : le pipeline precedent ouvrait une session SSH depuis
# GitHub Actions vers cet hebergement mutualise. Cette session se faisait tuer
# (SIGTERM) en 4 a 5 secondes quelle que soit la commande en cours — trois
# executions, trois echecs, deux mises hors ligne du site les 16 et 17/09/2026.
# Ici plus aucune session SSH entrante : le serveur va chercher le code.
#
# Principes de securite, appris de ces incidents :
#   1. La prod n'est JAMAIS touchee tant que les deux builds ne sont pas
#      termines et verifies. Un echec de build laisse le site intact.
#   2. On ne fait jamais "pm2 delete" + "pm2 start" : cette combinaison se fait
#      tuer par l'hebergement, meme en session interactive. Uniquement
#      "pm2 restart" sur un process deja enregistre.
#   3. Le retour arriere consiste a remettre en place deux repertoires
#      conserves (dist.prev / public.prev). Quelques secondes, pas de
#      reinstallation, pas de copie de node_modules.
#   4. .env et .htaccess ne sont jamais ni effaces ni ecrases.
#   5. Un commit qui a echoue est marque comme tel : le cron ne le rejoue pas
#      en boucle toutes les 5 minutes.
#
# Silence en fonctionnement normal : tout va dans le journal. Ce qui sort sur
# la sortie standard est envoye par mail par cron — donc uniquement les alertes.
#
# Voir deploy/README.md pour l'installation.

set -uo pipefail

# ------------------------------------------------- recopie de soi-meme
#
# Ce script est versionne dans le depot, et le depot est remis a jour par
# "git reset --hard" au milieu du deploiement. Or bash lit un script au fur et
# a mesure de son execution : si le fichier change sous ses pieds, la suite est
# interpretee n'importe comment. On se recopie donc dans un fichier temporaire
# et on relance l'execution depuis cette copie, que rien ne viendra modifier.

if [ "${DEPLOY_SELF_COPY:-0}" != "1" ]; then
  SELF_COPY=$(mktemp "${TMPDIR:-/tmp}/deploy-assets-XXXXXX.sh") || exit 1
  cat "$0" > "$SELF_COPY" || { rm -f "$SELF_COPY"; exit 1; }
  chmod +x "$SELF_COPY"
  DEPLOY_SELF_COPY=1 "$SELF_COPY" "$@"
  rc=$?
  rm -f "$SELF_COPY"
  exit $rc
fi

# ------------------------------------------------------------------ config

USER_HOME="${HOME:-/home/dxtrmfwa}"
REPO_PATH="$USER_HOME/repositories/inventory-app"
PROD_PATH="$USER_HOME/public_html/assets.mfwa.org"
CONFIG_FILE="$USER_HOME/deploy-config/build.env"
STATE_DIR="$USER_HOME/deploy-state"
LOG_DIR="$USER_HOME/deploy-logs"

BRANCH="main"
PM2_APP="assets-tool"
HEALTH_URL="http://127.0.0.1:3003/api/health"

LOCK_DIR="$STATE_DIR/deploy.lock"
LOCK_MAX_AGE_MIN=30
LOG_RETENTION_DAYS=30

# ------------------------------------------------------------ garde-fous

# Sans ces deux verifications, une variable vide transformerait les "rm -rf"
# plus bas en suppression de la racine. On refuse de demarrer.
if [ -z "$PROD_PATH" ] || [ ! -d "$PROD_PATH" ]; then
  echo "deploy.sh: PROD_PATH introuvable ou vide ($PROD_PATH) — abandon" >&2
  exit 1
fi
if [ -z "$REPO_PATH" ] || [ ! -d "$REPO_PATH/.git" ]; then
  echo "deploy.sh: depot git introuvable ($REPO_PATH) — abandon" >&2
  exit 1
fi

mkdir -p "$STATE_DIR" "$LOG_DIR"
LOG_FILE="$LOG_DIR/deploy-$(date +%Y%m%d).log"

TARGET_COMMIT=""
TARGET_SHORT=""
SWAPPED=0        # passe a 1 des que la prod a ete modifiee

log()   { printf '%s  %s\n' "$(date +'%H:%M:%S')" "$*" >> "$LOG_FILE"; }
alert() { log "ALERTE  $*"; printf '%s\n' "$*" >&3 2>/dev/null || printf '%s\n' "$*"; }

write_status() {
  local state="$1" message="$2"
  message=${message//\"/}
  cat > "$STATE_DIR/status.json" << EOF
{
  "state": "$state",
  "message": "$message",
  "commit": "$TARGET_COMMIT",
  "commit_short": "$TARGET_SHORT",
  "at": "$(date -Iseconds)",
  "log": "$LOG_FILE"
}
EOF
}

# --------------------------------------------------------------- verrou

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  if [ -n "$(find "$LOCK_DIR" -maxdepth 0 -mmin "+$LOCK_MAX_AGE_MIN" 2>/dev/null)" ]; then
    log "verrou perime (plus de $LOCK_MAX_AGE_MIN min) — on le casse"
    rm -rf "$LOCK_DIR"
    mkdir "$LOCK_DIR" 2>/dev/null || exit 0
  else
    # Un deploiement est deja en cours. Rien a signaler.
    exit 0
  fi
fi
trap 'rm -rf "$LOCK_DIR"' EXIT

# ------------------------------------------------- y a-t-il du nouveau ?

cd "$REPO_PATH" || exit 1

if ! git fetch origin "$BRANCH" --quiet 2>>"$LOG_FILE"; then
  log "git fetch a echoue — on reessaiera au prochain passage"
  exit 0
fi

TARGET_COMMIT=$(git rev-parse "origin/$BRANCH" 2>/dev/null)
TARGET_SHORT=${TARGET_COMMIT:0:7}
DEPLOYED_COMMIT=$(cat "$STATE_DIR/deployed-commit" 2>/dev/null || echo "")
FAILED_COMMIT=$(cat "$STATE_DIR/failed-commit" 2>/dev/null || echo "")

# Deja en ligne : sortie silencieuse, c'est le cas de tres loin le plus frequent.
[ "$TARGET_COMMIT" = "$DEPLOYED_COMMIT" ] && exit 0

# Ce commit a deja echoue. On ne le rejoue pas toutes les 5 minutes : cela
# ferait clignoter le site. Il faut corriger, puis supprimer le marqueur :
#   rm ~/deploy-state/failed-commit
if [ "$TARGET_COMMIT" = "$FAILED_COMMIT" ]; then
  exit 0
fi

# ------------------------------------------- a partir d'ici, on deploie

exec 3>&1                       # fd 3 = sortie cron, reservee aux alertes
exec >> "$LOG_FILE" 2>&1

echo ""
log "================================================================"
log "Deploiement demande : $DEPLOYED_COMMIT -> $TARGET_SHORT"
write_status "running" "deploiement en cours"

fail() {
  local msg="$1"
  if [ "$SWAPPED" = "1" ]; then
    rollback "$msg"
  else
    log "ECHEC  $msg (la prod n'a pas ete touchee, le site tourne toujours)"
    alert "Deploiement $TARGET_SHORT echoue : $msg. Le site n'a pas ete modifie. Journal : $LOG_FILE"
    echo "$TARGET_COMMIT" > "$STATE_DIR/failed-commit"
    write_status "failed" "$msg"
  fi
  exit 1
}

rollback() {
  local msg="$1"
  log "ECHEC  $msg — retour a la version precedente"
  if [ -d "$PROD_PATH/dist.prev" ]; then
    rm -rf "$PROD_PATH/dist"
    mv "$PROD_PATH/dist.prev" "$PROD_PATH/dist"
  fi
  if [ -d "$PROD_PATH/public.prev" ]; then
    rm -rf "$PROD_PATH/public"
    mv "$PROD_PATH/public.prev" "$PROD_PATH/public"
  fi
  pm2 restart "$PM2_APP" --update-env
  sleep 3
  if check_health; then
    alert "Deploiement $TARGET_SHORT echoue : $msg. Retour a la version precedente reussi, le site repond. Journal : $LOG_FILE"
    write_status "rolled_back" "$msg"
  else
    alert "URGENT : deploiement $TARGET_SHORT echoue ($msg) ET le retour arriere n'a pas retabli le service. Intervention manuelle necessaire. Journal : $LOG_FILE"
    write_status "broken" "$msg — retour arriere infructueux"
  fi
  echo "$TARGET_COMMIT" > "$STATE_DIR/failed-commit"
}

check_health() {
  local code i
  for i in $(seq 1 15); do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$HEALTH_URL" 2>/dev/null || true)
    [ "$code" = "200" ] && { log "sante : 200 apres $((i*2))s"; return 0; }
    sleep 2
  done
  log "sante : pas de 200 apres 30s (dernier code : ${code:-aucun})"
  return 1
}

# --- 1. configuration de build -------------------------------------------

[ -f "$CONFIG_FILE" ] || fail "fichier de configuration absent : $CONFIG_FILE"
set -a; . "$CONFIG_FILE"; set +a

for v in VITE_GOOGLE_CLIENT_ID VITE_API_URL; do
  if [ -z "${!v:-}" ]; then
    fail "$v est vide dans $CONFIG_FILE — un build avec cette variable vide casserait la connexion Google sans erreur visible"
  fi
done
log "configuration de build chargee"

# --- 2. recuperation du code ---------------------------------------------

cd "$REPO_PATH" || fail "acces impossible a $REPO_PATH"
git reset --hard "origin/$BRANCH" || fail "git reset a echoue"
log "code a jour sur $TARGET_SHORT"

# --- 3. builds (la prod n'est toujours pas touchee) -----------------------

log "build du frontend..."
cd "$REPO_PATH/client" || fail "repertoire client introuvable"
npm ci             || fail "npm ci a echoue cote client"
npm run build      || fail "le build du frontend a echoue"

node "$REPO_PATH/deploy/inject-env.js" "$REPO_PATH/client/dist/index.html" \
                   || fail "injection des variables d'environnement impossible"

log "build du backend..."
cd "$REPO_PATH/server" || fail "repertoire server introuvable"
npm ci             || fail "npm ci a echoue cote serveur"
npm run build      || fail "le build du backend a echoue"

# Verifications : mieux vaut s'arreter ici que publier une version vide.
[ -s "$REPO_PATH/server/dist/server.js" ]   || fail "server/dist/server.js absent ou vide apres le build"
[ -s "$REPO_PATH/client/dist/index.html" ]  || fail "client/dist/index.html absent ou vide apres le build"
grep -q "window.__ENV__" "$REPO_PATH/client/dist/index.html" \
                                            || fail "window.__ENV__ absent de index.html — l'injection n'a pas fonctionne"
log "builds verifies"

# --- 4. bascule ----------------------------------------------------------

log "bascule..."
rm -rf "$PROD_PATH/dist.prev" "$PROD_PATH/public.prev"
[ -d "$PROD_PATH/dist" ]   && mv "$PROD_PATH/dist"   "$PROD_PATH/dist.prev"
[ -d "$PROD_PATH/public" ] && mv "$PROD_PATH/public" "$PROD_PATH/public.prev"
SWAPPED=1

cp -r "$REPO_PATH/server/dist" "$PROD_PATH/dist"    || fail "copie de dist impossible"
cp -r "$REPO_PATH/client/dist" "$PROD_PATH/public"  || fail "copie de public impossible"
cp "$REPO_PATH/server/package.json"      "$PROD_PATH/package.json"
cp "$REPO_PATH/server/package-lock.json" "$PROD_PATH/package-lock.json"
mkdir -p "$PROD_PATH/logs"

if [ ! -f "$PROD_PATH/.htaccess" ]; then
  printf 'RewriteEngine On\nRewriteRule ^(.*)$ http://127.0.0.1:3003/$1 [P,L]\n' > "$PROD_PATH/.htaccess"
  log ".htaccess (re)cree"
fi

# --- 5. dependances, seulement si le verrou a change ---------------------

DEPS_HASH=$(md5sum "$PROD_PATH/package-lock.json" | cut -d' ' -f1)
DEPS_KNOWN=$(cat "$STATE_DIR/deps-hash" 2>/dev/null || echo "")

if [ "$DEPS_HASH" != "$DEPS_KNOWN" ] || [ ! -d "$PROD_PATH/node_modules" ]; then
  log "dependances : installation (le verrou a change)"
  cd "$PROD_PATH" || fail "acces impossible a $PROD_PATH"
  npm install --omit=dev || fail "npm install a echoue en production"
  echo "$DEPS_HASH" > "$STATE_DIR/deps-hash"
else
  log "dependances : inchangees, installation sautee"
fi

# --- 6. redemarrage ------------------------------------------------------

log "redemarrage de $PM2_APP..."
if ! pm2 restart "$PM2_APP" --update-env; then
  fail "pm2 restart a echoue. Le process n'est peut-etre plus enregistre ; voir la section Depannage du README"
fi

check_health || fail "le service ne repond pas apres le redemarrage"

# --- 7. succes -----------------------------------------------------------

echo "$TARGET_COMMIT" > "$STATE_DIR/deployed-commit"
rm -f "$STATE_DIR/failed-commit"
write_status "success" "deploiement reussi"
log "OK  $TARGET_SHORT est en ligne"

find "$LOG_DIR" -name 'deploy-*.log' -mtime "+$LOG_RETENTION_DAYS" -delete 2>/dev/null
exit 0
