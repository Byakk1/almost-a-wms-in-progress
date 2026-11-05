#!/usr/bin/env bash
# Cherry WMS — logical backup of the shared Postgres (pg_dump custom format).
#
# Why this exists: the deployment DB is a self-hosted Supabase with NO managed
# PITR and, until 2026-10-30, no backup of any kind. It holds the only copy of the
# imported commercial rate cards (8k items / 15k zones) and customer data.
#
# Usage:   bash scripts/backup-db.sh                 # dump to E:/wms-backups
#          BACKUP_DIR=/path bash scripts/backup-db.sh
# Restore: see docs/runbooks/backup-and-restore.md
#
# Reads DATABASE_URL from wms-backend/.env (never from the repo).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
env_file="$here/../.env"
backup_dir="${BACKUP_DIR:-/e/wms-backups}"
pg_dump_bin="${PG_DUMP:-/d/Postgres/bin/pg_dump.exe}"
keep_days="${KEEP_DAYS:-30}"

[ -f "$env_file" ] || { echo "no .env at $env_file" >&2; exit 1; }
conn="$(grep -E '^DATABASE_URL=' "$env_file" | sed 's/^DATABASE_URL=//; s/^"//; s/"$//')"
[ -n "$conn" ] || { echo "DATABASE_URL missing in .env" >&2; exit 1; }
[ -x "$pg_dump_bin" ] || { echo "pg_dump not found at $pg_dump_bin (set PG_DUMP)" >&2; exit 1; }

mkdir -p "$backup_dir"
stamp="$(date +%Y%m%d-%H%M%S)"
out="$backup_dir/wms-$stamp.dump"

# --format=custom: compressed, selectively restorable with pg_restore.
# --no-owner/--no-privileges: the target may not have the Supabase roles.
"$pg_dump_bin" --format=custom --compress=6 --no-owner --no-privileges \
  --file="$out" "$conn"

# Integrity: the TOC must list the two largest business tables.
"$pg_dump_bin" --version >/dev/null
toc="$("${pg_dump_bin%pg_dump.exe}pg_restore.exe" --list "$out")"
for t in RateCardItem ShippingZone OutboundOrder User; do
  grep -q "TABLE DATA public $t " <<<"$toc" || { echo "dump missing table $t" >&2; exit 1; }
done

sha256sum "$out" > "$out.sha256"
size="$(stat -c %s "$out")"
echo "OK $out ($size bytes)"

# Retention: delete dumps older than KEEP_DAYS (keep the sidecar in sync).
find "$backup_dir" -name 'wms-*.dump' -mtime +"$keep_days" -print -delete
find "$backup_dir" -name 'wms-*.dump.sha256' -mtime +"$keep_days" -delete
