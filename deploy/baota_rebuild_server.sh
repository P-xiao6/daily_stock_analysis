#!/usr/bin/env bash
set -Eeuo pipefail

log() {
  printf '[stock-ai-rebuild] %s\n' "$*"
}

ROOT_DIR="${STOCK_AI_ROOT:-/www/wwwroot/stock-ai}"
APP_DIR="${STOCK_AI_APP_DIR:-$ROOT_DIR/app}"
COMPOSE_FILE="${STOCK_AI_COMPOSE_FILE:-$ROOT_DIR/deploy/docker-compose.yml}"
BACKUP_DIR="$ROOT_DIR/backups"
STAMP="$(date +%Y%m%d-%H%M%S)"
COMPOSE_BACKUP="$BACKUP_DIR/docker-compose.yml.backend-$STAMP.bak"
IMAGE_BUILD_MODE="${BAOTA_IMAGE_BUILD_MODE:-source-mount}"

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

if [[ "$IMAGE_BUILD_MODE" != "source-mount" && "$IMAGE_BUILD_MODE" != "full" ]]; then
  log "ERROR: unsupported BAOTA_IMAGE_BUILD_MODE: $IMAGE_BUILD_MODE"
  log "Use source-mount (default) or full."
  exit 1
fi

log "checking compose config"
docker compose -f "$COMPOSE_FILE" config >/dev/null
log "compose config ok"

if [[ "$IMAGE_BUILD_MODE" == "full" ]]; then
  log "building server image"
  docker compose -f "$COMPOSE_FILE" build server

  log "starting server"
  docker compose -f "$COMPOSE_FILE" up -d server
else
  if [[ ! -d "$APP_DIR/src" ]]; then
    log "ERROR: backend source dir not found: $APP_DIR/src"
    exit 1
  fi

  mkdir -p "$BACKUP_DIR"
  cp "$COMPOSE_FILE" "$COMPOSE_BACKUP"
  log "compose backup: $COMPOSE_BACKUP"

  python3 - "$COMPOSE_FILE" <<'PY'
from pathlib import Path
import re
import sys

path = Path(sys.argv[1])
text = path.read_text(encoding="utf-8")
mount_value = "../app/src:/app/src:ro"
if mount_value in text:
    sys.exit(0)

lines = text.splitlines(keepends=True)

def indent_of(line: str) -> int:
    return len(line) - len(line.lstrip(" "))

server_index = None
server_indent = None
for index, line in enumerate(lines):
    if re.match(r"^\s*server:\s*(#.*)?$", line):
        server_index = index
        server_indent = indent_of(line)
        break

if server_index is None:
    raise SystemExit("server service not found; refusing to edit compose")

server_end = len(lines)
for index in range(server_index + 1, len(lines)):
    stripped = lines[index].strip()
    if stripped and not stripped.startswith("#") and indent_of(lines[index]) <= server_indent:
        server_end = index
        break

volumes_index = None
for index in range(server_index + 1, server_end):
    if re.match(rf"^ {{{server_indent + 2}}}volumes:\s*(#.*)?$", lines[index]):
        volumes_index = index
        break

item_indent = server_indent + 4
mount_line = f"{' ' * item_indent}- {mount_value}\n"

if volumes_index is None:
    insert_at = server_end
    lines.insert(insert_at, f"{' ' * (server_indent + 2)}volumes:\n")
    lines.insert(insert_at + 1, mount_line)
else:
    insert_at = volumes_index + 1
    while insert_at < server_end:
        stripped = lines[insert_at].strip()
        if stripped and not stripped.startswith("#") and indent_of(lines[insert_at]) <= server_indent + 2:
            break
        insert_at += 1
    lines.insert(insert_at, mount_line)

path.write_text("".join(lines), encoding="utf-8")
PY

  log "compose backend source mount ensured"
  docker compose -f "$COMPOSE_FILE" config >/dev/null
  log "compose config ok after backend mount"

  log "starting server without image rebuild"
  docker compose -f "$COMPOSE_FILE" up -d --no-build server
fi

docker compose -f "$COMPOSE_FILE" ps

if curl -fsS http://127.0.0.1:8002/api/health >/dev/null; then
  log "local health ok on 127.0.0.1:8002"
elif curl -fsS http://127.0.0.1:8000/api/health >/dev/null; then
  log "local health ok on 127.0.0.1:8000"
else
  log "WARN: local health check failed on 127.0.0.1:8002 and 127.0.0.1:8000"
fi

log "done"
