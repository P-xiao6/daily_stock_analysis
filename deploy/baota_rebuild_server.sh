#!/usr/bin/env bash
set -Eeuo pipefail

log() {
  printf '[stock-ai-rebuild] %s\n' "$*"
}

ROOT_DIR="${STOCK_AI_ROOT:-/www/wwwroot/stock-ai}"
APP_DIR="${STOCK_AI_APP_DIR:-$ROOT_DIR/app}"
COMPOSE_FILE="${STOCK_AI_COMPOSE_FILE:-$ROOT_DIR/deploy/docker-compose.yml}"

log "root: $ROOT_DIR"
log "app: $APP_DIR"
log "compose: $COMPOSE_FILE"

if [[ ! -d "$APP_DIR" ]]; then
  log "ERROR: app dir not found: $APP_DIR"
  exit 1
fi

if [[ ! -f "$COMPOSE_FILE" ]]; then
  log "ERROR: compose file not found: $COMPOSE_FILE"
  exit 1
fi

if [[ ! -f "$APP_DIR/.env" && ! -f "$ROOT_DIR/.env" ]]; then
  log "ERROR: .env not found in app or root dir"
  exit 1
fi

log "checking compose config"
docker compose -f "$COMPOSE_FILE" config >/dev/null
log "compose config ok"

log "building server image"
docker compose -f "$COMPOSE_FILE" build server

log "starting server"
docker compose -f "$COMPOSE_FILE" up -d server

docker compose -f "$COMPOSE_FILE" ps

if curl -fsS http://127.0.0.1:8002/api/health >/dev/null; then
  log "local health ok on 127.0.0.1:8002"
elif curl -fsS http://127.0.0.1:8000/api/health >/dev/null; then
  log "local health ok on 127.0.0.1:8000"
else
  log "WARN: local health check failed on 127.0.0.1:8002 and 127.0.0.1:8000"
fi

log "done"
