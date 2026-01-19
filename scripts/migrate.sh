#!/bin/bash
# Run database migrations for Claude Code Wrapper

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS_DIR="$SCRIPT_DIR/../migrations"

# Load environment variables if .env exists
if [ -f "$SCRIPT_DIR/../.env" ]; then
    export $(cat "$SCRIPT_DIR/../.env" | grep -v '^#' | xargs)
fi

# Default values
POSTGRES_HOST="${POSTGRES_HOST:-localhost}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_USER="${POSTGRES_USER:-capitala_admin}"
POSTGRES_DATABASE="${POSTGRES_DATABASE:-postgres}"

echo "Running Claude Code migrations..."
echo "Host: $POSTGRES_HOST"
echo "Port: $POSTGRES_PORT"
echo "Database: $POSTGRES_DATABASE"
echo "User: $POSTGRES_USER"
echo ""

# Run migrations
for migration in "$MIGRATIONS_DIR"/*.sql; do
    if [ -f "$migration" ]; then
        echo "Running: $(basename "$migration")"
        PGPASSWORD="$POSTGRES_PASSWORD" psql \
            -h "$POSTGRES_HOST" \
            -p "$POSTGRES_PORT" \
            -U "$POSTGRES_USER" \
            -d "$POSTGRES_DATABASE" \
            -f "$migration"
        echo "Done: $(basename "$migration")"
        echo ""
    fi
done

echo "All migrations completed!"
