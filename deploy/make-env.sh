#!/usr/bin/env bash
# Create .env for production with strong random passwords.
# Usage: bash deploy/make-env.sh <domain> <email>
#   e.g. bash deploy/make-env.sh origami.example.com me@example.com
#   For a first test by IP address: bash deploy/make-env.sh :80 me@example.com
set -euo pipefail
cd "$(dirname "$0")/.."

if [ $# -ne 2 ]; then
  echo "Usage: bash deploy/make-env.sh <domain> <email>" >&2
  exit 1
fi
if [ -e .env ]; then
  echo ".env already exists; not overwriting it (MongoDB keeps the password from its first start)." >&2
  exit 1
fi

domain="$1"
email="$2"
# URL-safe passwords: no characters that break the MongoDB/Redis connection URLs.
gen() { python3 -c "import secrets; print(secrets.token_urlsafe(24))"; }
mongo_pw="$(gen)"
redis_pw="$(gen)"
if [ "$domain" = ":80" ]; then origin="http://$(hostname -I | awk '{print $1}')"; else origin="https://$domain"; fi

sed \
  -e "s|^DOMAIN=.*|DOMAIN=$domain|" \
  -e "s|^ACME_EMAIL=.*|ACME_EMAIL=$email|" \
  -e "s|^MONGO_ROOT_PASSWORD=.*|MONGO_ROOT_PASSWORD=$mongo_pw|" \
  -e "s|^REDIS_PASSWORD=.*|REDIS_PASSWORD=$redis_pw|" \
  -e "s|^ORIGAMI_MONGO_URI=.*|ORIGAMI_MONGO_URI=mongodb://origami:$mongo_pw@localhost:27017/?authSource=admin|" \
  -e "s|^ORIGAMI_REDIS_URL=.*|ORIGAMI_REDIS_URL=redis://:$redis_pw@localhost:6379/0|" \
  -e "s|^ORIGAMI_CORS_ORIGINS=.*|ORIGAMI_CORS_ORIGINS=$origin|" \
  .env.production.example > .env
chmod 600 .env
echo "Created .env for $domain (passwords generated; file readable only by you)."
