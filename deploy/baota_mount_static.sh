#!/usr/bin/env bash
set -Eeuo pipefail

log() {
  printf '[stock-ai-static] %s\n' "$*"
}

ROOT_DIR="${STOCK_AI_ROOT:-/www/wwwroot/stock-ai}"
APP_DIR="${STOCK_AI_APP_DIR:-$ROOT_DIR/app}"
COMPOSE_FILE="${STOCK_AI_COMPOSE_FILE:-$ROOT_DIR/deploy/docker-compose.yml}"
STATIC_DIR="$APP_DIR/static"
BACKUP_DIR="$ROOT_DIR/backups"
STAMP="$(date +%Y%m%d-%H%M%S)"
COMPOSE_BACKUP="$BACKUP_DIR/docker-compose.yml.static-$STAMP.bak"

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

if [[ ! -f "$STATIC_DIR/index.html" ]]; then
  log "ERROR: static bundle missing: $STATIC_DIR/index.html"
  log "Run git pull from the fork that contains the built static bundle first."
  exit 1
fi

if ! grep -R "模型策略" "$STATIC_DIR" >/dev/null 2>&1; then
  log "ERROR: static bundle does not contain model strategy UI text"
  exit 1
fi

mkdir -p "$BACKUP_DIR"
cp "$COMPOSE_FILE" "$COMPOSE_BACKUP"
log "compose backup: $COMPOSE_BACKUP"

python3 - "$COMPOSE_FILE" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text(encoding="utf-8")
mount = "    - ../app/static:/app/static:ro\n"
if mount in text:
    sys.exit(0)

anchor = "    - ../app/strategies:/app/strategies:ro\n"
if anchor not in text:
    raise SystemExit("strategies volume anchor not found; refusing to edit compose")

path.write_text(text.replace(anchor, anchor + mount, 1), encoding="utf-8")
PY

log "compose static mount ensured"
docker compose -f "$COMPOSE_FILE" config >/dev/null
log "compose config ok"

docker compose -f "$COMPOSE_FILE" up -d --no-build server
log "server container updated without rebuild"

docker compose -f "$COMPOSE_FILE" ps

if curl -fsS http://127.0.0.1:8002/api/health >/dev/null; then
  log "local health ok on 127.0.0.1:8002"
else
  log "WARN: local health check on 127.0.0.1:8002 failed; check compose port mapping"
fi

log "done"
