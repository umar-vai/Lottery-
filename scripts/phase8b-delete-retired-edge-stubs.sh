#!/usr/bin/env bash
set -euo pipefail

# Phase 8B operator helper: physically delete only the three retired Lootera
# Edge Function stubs after replacement functions are confirmed present.
#
# Required:
#   - Supabase CLI authenticated with an account that can manage the project
#   - EDGE_DELETE_CONFIRM=LOOTERA_DELETE_RETIRED_EDGE_STUBS
#
# Optional:
#   - SUPABASE_PROJECT_REF (defaults to Lootera production ref)
#
# This script discovers current CLI flags from --help and refuses to proceed
# unless the installed CLI supports targeting the expected project explicitly.

PROJECT_REF="${SUPABASE_PROJECT_REF:-mwtlsnneooxmryondrex}"
CONFIRM="${EDGE_DELETE_CONFIRM:-}"

RETIRED=(
  "phone-bridge"
  "bridge-device-admin"
  "claim-demo-credit"
)

REPLACEMENTS=(
  "support-phone-bridge"
  "support-device-admin"
  "claim-support-points"
)

if [[ "$CONFIRM" != "LOOTERA_DELETE_RETIRED_EDGE_STUBS" ]]; then
  echo "ERROR: explicit confirmation is required." >&2
  echo "Set EDGE_DELETE_CONFIRM=LOOTERA_DELETE_RETIRED_EDGE_STUBS after reviewing Phase 8B evidence." >&2
  exit 2
fi

command -v supabase >/dev/null 2>&1 || {
  echo "ERROR: Supabase CLI is required." >&2
  exit 2
}

echo "Supabase CLI: $(supabase --version)"

LIST_HELP="$(supabase functions list --help 2>&1 || true)"
DELETE_HELP="$(supabase functions delete --help 2>&1 || true)"

if ! grep -q -- '--project-ref' <<<"$LIST_HELP"; then
  echo "ERROR: installed CLI does not expose --project-ref for functions list." >&2
  echo "Upgrade the CLI; refusing to rely on an implicit linked project." >&2
  exit 2
fi

if ! grep -q -- '--project-ref' <<<"$DELETE_HELP"; then
  echo "ERROR: installed CLI does not expose --project-ref for functions delete." >&2
  echo "Upgrade the CLI; refusing to rely on an implicit linked project." >&2
  exit 2
fi

echo "Reading Edge Function inventory from project $PROJECT_REF..."
BEFORE="$(supabase functions list --project-ref "$PROJECT_REF")"
printf '%s\n' "$BEFORE"

for fn in "${REPLACEMENTS[@]}"; do
  if ! grep -Fq "$fn" <<<"$BEFORE"; then
    echo "ERROR: replacement function is missing: $fn" >&2
    echo "No retired function was deleted." >&2
    exit 3
  fi
done

present_retired=()
for fn in "${RETIRED[@]}"; do
  if grep -Fq "$fn" <<<"$BEFORE"; then
    present_retired+=("$fn")
  fi
done

if [[ "${#present_retired[@]}" -eq 0 ]]; then
  echo "All retired Lootera Edge Function stubs are already absent."
  exit 0
fi

echo
echo "Deleting retired stubs only:"
printf '  - %s\n' "${present_retired[@]}"
echo

for fn in "${present_retired[@]}"; do
  echo "Deleting $fn..."
  supabase functions delete "$fn" --project-ref "$PROJECT_REF"
done

echo
echo "Verifying post-delete inventory..."
AFTER="$(supabase functions list --project-ref "$PROJECT_REF")"
printf '%s\n' "$AFTER"

for fn in "${REPLACEMENTS[@]}"; do
  if ! grep -Fq "$fn" <<<"$AFTER"; then
    echo "CRITICAL: replacement function missing after cleanup: $fn" >&2
    exit 4
  fi
done

for fn in "${RETIRED[@]}"; do
  if grep -Fq "$fn" <<<"$AFTER"; then
    echo "ERROR: retired function still present after delete attempt: $fn" >&2
    exit 5
  fi
done

echo
echo "PASS: all three retired Lootera Edge Function stubs are physically absent and replacements remain present."
echo "Next: record Issue #59 as Completed in Admin -> Incidents -> Phase 8B Operator Sign-Off with this command output as evidence."
