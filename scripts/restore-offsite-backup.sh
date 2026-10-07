#!/usr/bin/env bash
set -euo pipefail

# Phase 7E restore rehearsal helper.
# This script intentionally refuses to restore into the Lootera production project.
# Use a fresh, isolated Supabase/self-hosted destination.

umask 077

PRODUCTION_REF="mwtlsnneooxmryondrex"
ARCHIVE="${BACKUP_ARCHIVE:-}"
TARGET_URL="${RESTORE_DB_URL:-}"
CONFIRM="${RESTORE_CONFIRM:-}"
IDENTITY="${AGE_IDENTITY_FILE:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERIFY_SQL="$SCRIPT_DIR/verify-restored-database.sql"

if [[ "$CONFIRM" != "LOOTERA_RESTORE_REHEARSAL" ]]; then
  echo "ERROR: set RESTORE_CONFIRM=LOOTERA_RESTORE_REHEARSAL." >&2
  exit 2
fi
if [[ -z "$ARCHIVE" || ! -f "$ARCHIVE" ]]; then
  echo "ERROR: BACKUP_ARCHIVE must point to an existing backup archive." >&2
  exit 2
fi
if [[ -z "$TARGET_URL" ]]; then
  echo "ERROR: RESTORE_DB_URL is required." >&2
  exit 2
fi
if [[ "$TARGET_URL" == *"$PRODUCTION_REF"* ]]; then
  echo "ERROR: refusing to restore into Lootera production ($PRODUCTION_REF)." >&2
  exit 9
fi

for cmd in psql tar; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "ERROR: required command not found: $cmd" >&2; exit 2; }
done

WORK="$(mktemp -d)"
cleanup(){ rm -rf "$WORK"; }
trap cleanup EXIT

PLAIN="$WORK/backup.tar.gz"
case "$ARCHIVE" in
  *.age)
    command -v age >/dev/null 2>&1 || { echo "ERROR: age is required to decrypt this archive." >&2; exit 2; }
    [[ -n "$IDENTITY" && -f "$IDENTITY" ]] || { echo "ERROR: AGE_IDENTITY_FILE is required for .age archives." >&2; exit 2; }
    age -d -i "$IDENTITY" -o "$PLAIN" "$ARCHIVE"
    ;;
  *.tar.gz)
    cp "$ARCHIVE" "$PLAIN"
    ;;
  *)
    echo "ERROR: unsupported archive format; expected .tar.gz.age or .tar.gz." >&2
    exit 2
    ;;
esac

mkdir -p "$WORK/extracted"
tar -C "$WORK/extracted" -xzf "$PLAIN"

for f in roles.sql schema.sql data.sql history_schema.sql history_data.sql manifest.txt SHA256SUMS; do
  [[ -s "$WORK/extracted/$f" ]] || { echo "ERROR: archive is missing $f" >&2; exit 3; }
done

if command -v sha256sum >/dev/null 2>&1; then
  (cd "$WORK/extracted" && sha256sum -c SHA256SUMS)
elif command -v shasum >/dev/null 2>&1; then
  (cd "$WORK/extracted" && shasum -a 256 -c SHA256SUMS)
else
  echo "ERROR: sha256sum or shasum is required." >&2
  exit 2
fi

echo "Restoring database bundle into isolated destination..."
psql \
  --single-transaction \
  --variable ON_ERROR_STOP=1 \
  --file "$WORK/extracted/roles.sql" \
  --file "$WORK/extracted/schema.sql" \
  --command 'SET session_replication_role = replica' \
  --file "$WORK/extracted/data.sql" \
  --dbname "$TARGET_URL"

echo "Restoring migration history..."
psql \
  --single-transaction \
  --variable ON_ERROR_STOP=1 \
  --file "$WORK/extracted/history_schema.sql" \
  --file "$WORK/extracted/history_data.sql" \
  --dbname "$TARGET_URL"

echo "Immediately disabling restored cron/outbound alert delivery for rehearsal safety..."
psql --variable ON_ERROR_STOP=1 --dbname "$TARGET_URL" <<'SQL'
do $
declare
  r record;
begin
  if to_regclass('cron.job') is not null then
    for r in select jobid from cron.job loop
      perform cron.unschedule(r.jobid);
    end loop;
  end if;
  if to_regclass('private.production_alert_delivery_config') is not null then
    update private.production_alert_delivery_config set external_enabled=false, updated_at=now();
  end if;
end
$;
SQL

echo "Running restored-database verification..."
psql --variable ON_ERROR_STOP=1 --file "$VERIFY_SQL" --dbname "$TARGET_URL"

echo
echo "Restore rehearsal verification PASSED."
echo "Keep the rehearsal destination isolated. Reconfigure Auth, Edge secrets/functions, Storage objects and cron before any cutover."
