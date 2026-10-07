#!/usr/bin/env bash
set -euo pipefail

# Phase 7E encrypted off-site logical backup helper for Lootera.
# Required: Supabase CLI, Docker, and SUPABASE_DB_URL from Dashboard > Connect.
# Secure default: an age recipient is required; plaintext archives require an
# explicit ALLOW_PLAINTEXT_BACKUP=1 override for exceptional local testing only.

umask 077

PROJECT_REF="${SUPABASE_PROJECT_REF:-mwtlsnneooxmryondrex}"
DEST_ROOT="${BACKUP_DESTINATION:-${HOME}/lootera-offsite-backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_DIR="${DEST_ROOT}/${PROJECT_REF}/${STAMP}"
STAGING="${OUT_DIR}/.staging"
AGE_RECIPIENT="${BACKUP_AGE_RECIPIENT:-}"
ALLOW_PLAINTEXT="${ALLOW_PLAINTEXT_BACKUP:-0}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
OPERATOR="${BACKUP_OPERATOR:-unspecified}"

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  echo "ERROR: SUPABASE_DB_URL is required." >&2
  echo "Use a Session Pooler or direct connection string from Supabase Dashboard > Connect." >&2
  exit 2
fi

for cmd in supabase docker tar; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "ERROR: required command not found: $cmd" >&2
    exit 2
  fi
done

if [[ -n "$AGE_RECIPIENT" ]]; then
  if ! command -v age >/dev/null 2>&1; then
    echo "ERROR: age is required when BACKUP_AGE_RECIPIENT is set." >&2
    exit 2
  fi
elif [[ "$ALLOW_PLAINTEXT" != "1" ]]; then
  echo "ERROR: encrypted backup required." >&2
  echo "Set BACKUP_AGE_RECIPIENT to an age public recipient." >&2
  echo "For disposable local testing only, ALLOW_PLAINTEXT_BACKUP=1 overrides this guard." >&2
  exit 2
fi

if command -v git >/dev/null 2>&1; then
  REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
  if [[ -n "$REPO_ROOT" ]]; then
    RESOLVED_DEST="$(mkdir -p "$DEST_ROOT" && cd "$DEST_ROOT" && pwd)"
    case "$RESOLVED_DEST" in
      "$REPO_ROOT"|"$REPO_ROOT"/*)
        echo "ERROR: refusing to write production backups inside the Git repository." >&2
        exit 2
        ;;
    esac
  fi
fi

mkdir -p "$STAGING"

cleanup_partial() {
  local code="${1:-1}"
  if [[ "$code" != "0" ]]; then
    echo "Backup failed; removing partial output: $OUT_DIR" >&2
    rm -rf "$OUT_DIR"
  fi
}
trap 'cleanup_partial $?' EXIT

echo "Creating roles dump..."
supabase db dump --db-url "$SUPABASE_DB_URL" -f "$STAGING/roles.sql" --role-only

echo "Creating schema dump..."
supabase db dump --db-url "$SUPABASE_DB_URL" -f "$STAGING/schema.sql"

echo "Creating data dump..."
supabase db dump --db-url "$SUPABASE_DB_URL" -f "$STAGING/data.sql" --use-copy --data-only \
  -x "storage.buckets_vectors" \
  -x "storage.vector_indexes"

echo "Creating migration-history schema dump..."
supabase db dump --db-url "$SUPABASE_DB_URL" -f "$STAGING/history_schema.sql" --schema supabase_migrations

echo "Creating migration-history data dump..."
supabase db dump --db-url "$SUPABASE_DB_URL" -f "$STAGING/history_data.sql" --use-copy --data-only --schema supabase_migrations

for f in roles.sql schema.sql data.sql history_schema.sql history_data.sql; do
  if [[ ! -s "$STAGING/$f" ]]; then
    echo "ERROR: backup file is missing or empty: $f" >&2
    exit 3
  fi
done

{
  echo "product=Lootera"
  echo "domain=lootera.win"
  echo "project_ref=$PROJECT_REF"
  echo "created_at_utc=$STAMP"
  echo "operator=$OPERATOR"
  echo "retention_days=$RETENTION_DAYS"
  echo "postgres_source=Supabase logical export"
  echo "migration_history_included=true"
  echo "storage_metadata_in_database_dump=true"
  echo "storage_object_bytes_included=false"
  echo "edge_functions_included=false"
  echo "auth_provider_configuration_included=false"
  echo "edge_function_secrets_included=false"
} > "$STAGING/manifest.txt"

checksum_dir() {
  if command -v sha256sum >/dev/null 2>&1; then
    (cd "$STAGING" && sha256sum roles.sql schema.sql data.sql history_schema.sql history_data.sql manifest.txt > SHA256SUMS)
  elif command -v shasum >/dev/null 2>&1; then
    (cd "$STAGING" && shasum -a 256 roles.sql schema.sql data.sql history_schema.sql history_data.sql manifest.txt > SHA256SUMS)
  else
    echo "ERROR: sha256sum or shasum is required." >&2
    exit 2
  fi
}
checksum_dir

ARCHIVE_BASE="lootera-db-${PROJECT_REF}-${STAMP}.tar.gz"
PLAIN_ARCHIVE="$OUT_DIR/$ARCHIVE_BASE"
tar -C "$STAGING" -czf "$PLAIN_ARCHIVE" .

if [[ -n "$AGE_RECIPIENT" ]]; then
  FINAL_ARCHIVE="${PLAIN_ARCHIVE}.age"
  echo "Encrypting backup archive with age..."
  age -r "$AGE_RECIPIENT" -o "$FINAL_ARCHIVE" "$PLAIN_ARCHIVE"
  rm -f "$PLAIN_ARCHIVE"
  ENCRYPTION="age"
else
  FINAL_ARCHIVE="$PLAIN_ARCHIVE"
  ENCRYPTION="none-explicit-override"
fi

rm -rf "$STAGING"

PUBLIC_MANIFEST="$OUT_DIR/backup-summary.txt"
{
  echo "product=Lootera"
  echo "domain=lootera.win"
  echo "project_ref=$PROJECT_REF"
  echo "created_at_utc=$STAMP"
  echo "encryption=$ENCRYPTION"
  echo "archive=$(basename "$FINAL_ARCHIVE")"
  echo "storage_objects_included=false"
  echo "restore_rehearsal_required=true"
} > "$PUBLIC_MANIFEST"

if command -v sha256sum >/dev/null 2>&1; then
  (cd "$OUT_DIR" && sha256sum "$(basename "$FINAL_ARCHIVE")" backup-summary.txt > ARCHIVE_SHA256SUMS)
else
  (cd "$OUT_DIR" && shasum -a 256 "$(basename "$FINAL_ARCHIVE")" backup-summary.txt > ARCHIVE_SHA256SUMS)
fi

chmod 600 "$OUT_DIR"/*

echo
echo "Backup created: $FINAL_ARCHIVE"
echo "Encryption: $ENCRYPTION"
echo "IMPORTANT: transfer the archive + ARCHIVE_SHA256SUMS to encrypted off-site storage."
echo "IMPORTANT: Storage object bytes are NOT included; back up the event-covers objects separately."
echo "IMPORTANT: Edge Function secrets/Auth provider settings are configuration, not database backup content."
