#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker-compose.yml"
ENV_FILE="$ROOT_DIR/backend/.env.docker"
TS="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$ROOT_DIR/backups/$TS"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed or not on PATH."
  exit 1
fi

mkdir -p "$BACKUP_DIR"

COMPOSE_ARGS=(-f "$COMPOSE_FILE")
if [ -f "$ENV_FILE" ]; then
  COMPOSE_ARGS=(--env-file "$ENV_FILE" -f "$COMPOSE_FILE")
fi

mongodb_id="$(docker compose "${COMPOSE_ARGS[@]}" ps -q mongodb)"
minio_id="$(docker compose "${COMPOSE_ARGS[@]}" ps -q minio)"

if [ -z "$mongodb_id" ] || [ -z "$minio_id" ]; then
  echo "MongoDB or MinIO container is not running. Start the stack first."
  exit 1
fi

printf 'Creating MongoDB backup...\n'
docker compose "${COMPOSE_ARGS[@]}" exec -T mongodb mongodump --archive --gzip > "$BACKUP_DIR/mongodb.archive.gz"

printf 'Creating MinIO data backup...\n'
docker run --rm --volumes-from "$minio_id" -v "$BACKUP_DIR:/backup" alpine sh -c 'tar czf /backup/minio-data.tar.gz -C /data .'

if [ -f "$ENV_FILE" ]; then
  cp "$ENV_FILE" "$BACKUP_DIR/backend.env.docker"
fi

cat <<EOF
Backups created in: $BACKUP_DIR
- MongoDB: $BACKUP_DIR/mongodb.archive.gz
- MinIO data: $BACKUP_DIR/minio-data.tar.gz
- Environment snapshot: $BACKUP_DIR/backend.env.docker (if present)
EOF
