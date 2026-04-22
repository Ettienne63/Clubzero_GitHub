#!/bin/sh
set -eu

LOCKFILE="package-lock.json"
HASH_FILE="node_modules/.package-lock.hash"

current_hash=""
stored_hash=""

if [ -f "$LOCKFILE" ]; then
  current_hash="$(sha256sum "$LOCKFILE" | awk '{print $1}')"
fi

if [ -f "$HASH_FILE" ]; then
  stored_hash="$(cat "$HASH_FILE")"
fi

if [ ! -d node_modules ] || [ ! -f node_modules/archiver/package.json ] || [ "$current_hash" != "$stored_hash" ]; then
  echo "Refreshing container dependencies..."
  npm ci

  if [ -n "$current_hash" ]; then
    printf '%s' "$current_hash" > "$HASH_FILE"
  fi
fi

echo "Generating Prisma client..."
npx prisma generate

npx prisma migrate deploy
exec npm run dev
