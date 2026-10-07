#!/usr/bin/env bash
set -euo pipefail

# Phase 8B operator helper: create a real encrypted off-site logical backup,
# include event-covers Storage object bytes, and run the database restore
# rehearsal against an operator-supplied isolated destination.
#
# Required environment:
#   SUPABASE_DB_URL
#   BACKUP_AGE_RECIPIENT
#   AGE_IDENTITY_FILE
#   RESTORE_DB_URL
#   BACKUP_DESTINATION
#   SUPABASE_S3_ACCESS_KEY_ID
#   SUPABASE_S3_SECRET_ACCESS_KEY
#
# Optional:
#   SUPABASE_PROJECT_REF (default: Lootera production)
#   SUPABASE_STORAGE_REGION (default: ap-south-1)
#   BACKUP_OPERATOR
#
# The destination must be outside the Git repository. The restore helper
# independently refuses the production project ref.

umask 077

PROJECT_REF="${SUPABASE_PROJECT_REF:-mwtlsnneooxmryondrex}"
REGION="${SUPABASE_STORAGE_REGION:-ap-south-1}"
DEST_ROOT="${BACKUP_DESTINATION:-}"
OPERATOR="${BACKUP_OPERATOR:-unspecified}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_ROOT=""

required_env=(
  SUPABASE_DB_URL
  BACKUP_AGE_RECIPIENT
  AGE_IDENTITY_FILE
  RESTORE_DB_URL
  BACKUP_DESTINATION
  SUPABASE_S3_ACCESS_KEY_ID
  SUPABASE_S3_SECRET_ACCESS_KEY
)

for name in "${required_env[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "ERROR: required environment variable is missing: $name" >&2
    exit 2
  fi
done

for cmd in supabase docker psql rclone age tar jq; do
  command -v "$cmd" >/dev/null 2>&1 || {
    echo "ERROR: required command not found: $cmd" >&2
    exit 2
  }
done

if [[ ! -f "$AGE_IDENTITY_FILE" ]]; then
  echo "ERROR: AGE_IDENTITY_FILE does not exist." >&2
  exit 2
fi

if command -v git >/dev/null 2>&1; then
  REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
  if [[ -n "$REPO_ROOT" ]]; then
    RESOLVED_DEST="$(mkdir -p "$DEST_ROOT" && cd "$DEST_ROOT" && pwd)"
    case "$RESOLVED_DEST" in
      "$REPO_ROOT"|"$REPO_ROOT"/*)
        echo "ERROR: refusing to place backup evidence inside the Git repository." >&2
        exit 2
        ;;
    esac
  fi
fi

RUN_ROOT="$DEST_ROOT/lootera-phase8b-$RUN_ID"
mkdir -p "$RUN_ROOT"

cleanup_sensitive() {
  if [[ -n "${RCLONE_CONFIG_FILE:-}" && -f "$RCLONE_CONFIG_FILE" ]]; then
    rm -f "$RCLONE_CONFIG_FILE"
  fi
}
trap cleanup_sensitive EXIT

echo "Phase 8B complete backup + restore rehearsal"
echo "Run: $RUN_ID"
echo "Project: $PROJECT_REF"
echo "Operator: $OPERATOR"
echo

echo "[1/5] Creating encrypted database backup..."
BACKUP_DESTINATION="$RUN_ROOT/database" \
BACKUP_OPERATOR="$OPERATOR" \
BACKUP_AGE_RECIPIENT="$BACKUP_AGE_RECIPIENT" \
SUPABASE_PROJECT_REF="$PROJECT_REF" \
"$SCRIPT_DIR/export-offsite-backup.sh"

DB_ARCHIVE="$(find "$RUN_ROOT/database/$PROJECT_REF" -type f -name 'lootera-db-*.tar.gz.age' -print | head -n 1)"
if [[ -z "$DB_ARCHIVE" || ! -s "$DB_ARCHIVE" ]]; then
  echo "ERROR: encrypted database archive was not created." >&2
  exit 3
fi

echo "[2/5] Capturing source Storage metadata..."
read -r EXPECTED_OBJECTS EXPECTED_BYTES < <(
  psql "$SUPABASE_DB_URL" -At -F ' ' -c "
    select count(*), coalesce(sum((metadata->>'size')::bigint),0)
    from storage.objects
    where bucket_id='event-covers';
  "
)

if [[ -z "$EXPECTED_OBJECTS" || -z "$EXPECTED_BYTES" ]]; then
  echo "ERROR: could not read event-covers Storage metadata." >&2
  exit 3
fi

echo "Expected event-covers objects: $EXPECTED_OBJECTS"
echo "Expected event-covers bytes:   $EXPECTED_BYTES"

echo "[3/5] Downloading event-covers object bytes through the Supabase S3 endpoint..."
RCLONE_CONFIG_FILE="$(mktemp)"
chmod 600 "$RCLONE_CONFIG_FILE"
cat >"$RCLONE_CONFIG_FILE" <<EOF
[lootera]
type = s3
provider = Other
access_key_id = $SUPABASE_S3_ACCESS_KEY_ID
secret_access_key = $SUPABASE_S3_SECRET_ACCESS_KEY
endpoint = https://$PROJECT_REF.supabase.co/storage/v1/s3
region = $REGION
EOF

STORAGE_DIR="$RUN_ROOT/event-covers"
mkdir -p "$STORAGE_DIR"
rclone copy "lootera:event-covers" "$STORAGE_DIR" \
  --config "$RCLONE_CONFIG_FILE" \
  --checksum

REMOTE_SIZE="$(rclone size "lootera:event-covers" --config "$RCLONE_CONFIG_FILE" --json)"
LOCAL_SIZE="$(rclone size "$STORAGE_DIR" --json)"

REMOTE_OBJECTS="$(jq -r '.count' <<<"$REMOTE_SIZE")"
REMOTE_BYTES="$(jq -r '.bytes' <<<"$REMOTE_SIZE")"
LOCAL_OBJECTS="$(jq -r '.count' <<<"$LOCAL_SIZE")"
LOCAL_BYTES="$(jq -r '.bytes' <<<"$LOCAL_SIZE")"

if [[ "$REMOTE_OBJECTS" != "$EXPECTED_OBJECTS" || "$REMOTE_BYTES" != "$EXPECTED_BYTES" ]]; then
  echo "ERROR: S3 source inventory disagrees with database Storage metadata." >&2
  echo "DB metadata: $EXPECTED_OBJECTS objects / $EXPECTED_BYTES bytes" >&2
  echo "S3 source:   $REMOTE_OBJECTS objects / $REMOTE_BYTES bytes" >&2
  exit 4
fi

if [[ "$LOCAL_OBJECTS" != "$EXPECTED_OBJECTS" || "$LOCAL_BYTES" != "$EXPECTED_BYTES" ]]; then
  echo "ERROR: downloaded Storage object inventory does not match source." >&2
  echo "Source: $EXPECTED_OBJECTS objects / $EXPECTED_BYTES bytes" >&2
  echo "Local:  $LOCAL_OBJECTS objects / $LOCAL_BYTES bytes" >&2
  exit 4
fi

STORAGE_TAR="$RUN_ROOT/lootera-event-covers-$RUN_ID.tar.gz"
STORAGE_ARCHIVE="$STORAGE_TAR.age"
tar -C "$STORAGE_DIR" -czf "$STORAGE_TAR" .
age -r "$BACKUP_AGE_RECIPIENT" -o "$STORAGE_ARCHIVE" "$STORAGE_TAR"
rm -f "$STORAGE_TAR"
rm -rf "$STORAGE_DIR"
rm -f "$RCLONE_CONFIG_FILE"
RCLONE_CONFIG_FILE=""

echo "[4/5] Running isolated database restore rehearsal..."
BACKUP_ARCHIVE="$DB_ARCHIVE" \
RESTORE_DB_URL="$RESTORE_DB_URL" \
RESTORE_CONFIRM="LOOTERA_RESTORE_REHEARSAL" \
AGE_IDENTITY_FILE="$AGE_IDENTITY_FILE" \
"$SCRIPT_DIR/restore-offsite-backup.sh"

echo "[5/5] Writing evidence manifest and checksums..."
sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

DB_SHA="$(sha256_file "$DB_ARCHIVE")"
STORAGE_SHA="$(sha256_file "$STORAGE_ARCHIVE")"

EVIDENCE="$RUN_ROOT/phase8b-rehearsal-evidence.txt"
cat >"$EVIDENCE" <<EOF
product=Lootera
domain=lootera.win
phase=8B
run_id=$RUN_ID
operator=$OPERATOR
source_project_ref=$PROJECT_REF
source_storage_bucket=event-covers
source_storage_objects=$EXPECTED_OBJECTS
source_storage_bytes=$EXPECTED_BYTES
database_archive=$(basename "$DB_ARCHIVE")
database_archive_sha256=$DB_SHA
storage_archive=$(basename "$STORAGE_ARCHIVE")
storage_archive_sha256=$STORAGE_SHA
database_restore_rehearsal=passed
restore_destination=isolated_operator_supplied
production_restore_guard=enabled
restored_cron_disabled_before_verification=true
restored_external_alert_delivery_disabled_before_verification=true
completed_at_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF
chmod 600 "$EVIDENCE"

echo
echo "PASS: real encrypted DB backup, event-covers byte backup, and isolated DB restore rehearsal completed."
echo "Evidence: $EVIDENCE"
echo
echo "IMPORTANT:"
echo "1. Transfer the encrypted DB archive, encrypted Storage archive, and evidence file to off-site storage."
echo "2. Verify off-site checksums after transfer."
echo "3. Keep the isolated restore destination disconnected from production credentials/outbound integrations."
echo "4. Record Issue #61 as Completed in Admin -> Incidents -> Phase 8B Operator Sign-Off only after off-site transfer checksum verification."
