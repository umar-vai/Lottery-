#!/usr/bin/env bash
set -euo pipefail

# Phase 6 off-site logical backup helper for the Free-plan Supabase project.
# This script intentionally writes outside the repository by default.
# Required: Supabase CLI, Docker, and SUPABASE_DB_URL from Supabase Dashboard > Connect.

umask 077

PROJECT_REF="${SUPABASE_PROJECT_REF:-mwtlsnneooxmryondrex}"
DEST_ROOT="${BACKUP_DESTINATION:-${HOME}/lootera-offsite-backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_DIR="${DEST_ROOT}/${PROJECT_REF}/${STAMP}"

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  echo "ERROR: SUPABASE_DB_URL is required." >&2
  echo "Get a Session Pooler or direct connection string from Supabase Dashboard > Connect." >&2
  exit 2
fi

for cmd in supabase docker; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "ERROR: required command not found: $cmd" >&2
    exit 2
  fi
done

if command -v git >/dev/null 2>&1; then
  REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
  if [[ -n "$REPO_ROOT" ]]; then
    case "$(cd "$DEST_ROOT" 2>/dev/null && pwd || printf '%s' "$DEST_ROOT")" in
      "$REPO_ROOT"|"$REPO_ROOT"/*)
        echo "ERROR: refusing to write production database backups inside the Git repository." >&2
        exit 2
        ;;
    esac
  fi
fi

mkdir -p "$OUT_DIR"

cleanup_partial() {
  if [[ "${1:-}" != "0" ]]; then
    echo "Backup failed; removing partial output: $OUT_DIR" >&2
    rm -rf "$OUT_DIR"
  fi
}
trap 'cleanup_partial $?' EXIT

echo "Creating roles dump..."
supabase db dump --db-url "$SUPABASE_DB_URL" -f "$OUT_DIR/roles.sql" --role-only

echo "Creating schema dump..."
supabase db dump --db-url "$SUPABASE_DB_URL" -f "$OUT_DIR/schema.sql"

echo "Creating data dump..."
supabase db dump --db-url "$SUPABASE_DB_URL" -f "$OUT_DIR/data.sql" --use-copy --data-only   -x "storage.buckets_vectors"   -x "storage.vector_indexes"

for f in roles.sql schema.sql data.sql; do
  if [[ ! -s "$OUT_DIR/$f" ]]; then
    echo "ERROR: backup file is missing or empty: $f" >&2
    exit 3
  fi
done

{
  echo "project_ref=$PROJECT_REF"
  echo "created_at_utc=$STAMP"
  echo "postgres_source=Supabase logical export"
  echo "storage_objects_included=false"
  echo "edge_functions_included=false"
  echo "auth_provider_configuration_included=false"
} > "$OUT_DIR/manifest.txt"

if command -v sha256sum >/dev/null 2>&1; then
  (cd "$OUT_DIR" && sha256sum roles.sql schema.sql data.sql manifest.txt > SHA256SUMS)
elif command -v shasum >/dev/null 2>&1; then
  (cd "$OUT_DIR" && shasum -a 256 roles.sql schema.sql data.sql manifest.txt > SHA256SUMS)
else
  echo "ERROR: sha256sum or shasum is required for backup verification." >&2
  exit 2
fi

chmod 600 "$OUT_DIR"/*

echo
echo "Backup created: $OUT_DIR"
echo "IMPORTANT: copy this directory to encrypted off-site storage."
echo "IMPORTANT: Storage bucket objects are NOT contained in this database backup."
echo "Verify checksums before and after transfer using SHA256SUMS."
