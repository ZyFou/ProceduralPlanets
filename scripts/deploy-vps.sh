#!/usr/bin/env bash
set -Eeuo pipefail

DEPLOY_ROOT="${1:?Usage: bash deploy-vps.sh /home/ProceduralPlanets}"
[[ "$DEPLOY_ROOT" =~ ^/(home|srv|var/www)/[a-zA-Z0-9_./-]+$ ]]
[[ "$DEPLOY_ROOT" != *'/../'* && "$DEPLOY_ROOT" != */.. && "$DEPLOY_ROOT" != */ ]]
cd "$DEPLOY_ROOT"

# Serialize migrations/restarts with any manually launched copy of this script.
exec 9> .deploy.lock
flock -n 9 || { echo 'Another deployment is running'; exit 1; }
test -f web/index.html
test -f api/.env
test -f api/package-lock.json

cd api
export NODE_ENV=production
npm ci --omit=dev
npm run migrate
pm2 startOrRestart ecosystem.config.cjs --env production --update-env

if pm2 describe procedural-planets-web >/dev/null 2>&1; then
  pm2 restart procedural-planets-web
else
  pm2 serve "$DEPLOY_ROOT/web" 7071 --name procedural-planets-web --spa
fi

check_health() {
  local url="$1"
  for attempt in {1..15}; do
    if curl --fail --silent --show-error --connect-timeout 2 --max-time 5 "$url" >/dev/null; then
      return 0
    fi
    sleep 2
  done
  echo "Health check failed: $url"
  return 1
}

check_health http://127.0.0.1:7070/api/v1/health
check_health http://127.0.0.1:7071/
pm2 save
echo 'Deployment successful'
