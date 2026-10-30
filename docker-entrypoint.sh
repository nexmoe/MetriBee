#!/bin/sh
set -e

cd "$(dirname "$0")"

echo "Running database migrations..."
node scripts/database.mjs migrate

echo "Starting application..."
exec "$@"
