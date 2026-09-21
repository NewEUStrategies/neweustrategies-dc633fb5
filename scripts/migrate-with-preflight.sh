#!/usr/bin/env bash
set -euo pipefail
: "${NES_MIGRATION_DATABASE_URL:?Set the explicit target database URL}"
# Compatibility repair must precede historical CHECK validation on an upgrade.
# The caller selects and reviews the target; this script has no production default.
psql "$NES_MIGRATION_DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
  -f supabase/tests/support/chat-wallpaper-preflight.sql.inc
supabase db push --db-url "$NES_MIGRATION_DATABASE_URL" "$@"
