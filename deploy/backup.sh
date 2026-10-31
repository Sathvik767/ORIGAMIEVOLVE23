#!/usr/bin/env bash
# Back up MongoDB and the file storage (uploads, reports, GA results) into ./backups/<timestamp>/.
# Usage (on the server, in the project folder): bash deploy/backup.sh
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a

stamp="$(date +%Y%m%d-%H%M%S)"
out="backups/$stamp"
mkdir -p "$out"
compose="docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile full"

echo "==> MongoDB dump"
$compose exec -T mongo mongodump --quiet --archive --gzip \
  --username "$MONGO_ROOT_USER" --password "$MONGO_ROOT_PASSWORD" --authenticationDatabase admin \
  > "$out/mongo.archive.gz"

echo "==> File storage"
$compose exec -T api tar czf - -C /data . > "$out/storage.tar.gz"

ls -lh "$out"
echo "Backup written to $out. Copy it off the server, e.g.: scp -r <user>@<server>:$(pwd)/$out ."
