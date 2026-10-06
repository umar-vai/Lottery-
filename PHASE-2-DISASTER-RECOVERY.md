# Phase 2 — Disaster Recovery & Deprecated Edge Function Retirement

## Deprecated Edge Functions

The deprecated endpoints are:

- `phone-bridge`
- `bridge-device-admin`
- `claim-demo-credit`

They have already been reduced to HTTP `410 Gone` stubs.

A second repository caller audit on 2026-10-06 found no live application callers. A second 24-hour `function_edge_logs` observation found traffic only on the current replacements:

- `support-device-admin` — 317 requests
- `claim-support-points` — 2 requests
- `support-phone-bridge` — 1 request

and zero requests for all three deprecated endpoints.

The connected Supabase toolset exposes list/get/deploy for Edge Functions but no delete action. Therefore this phase does **not** claim physical deletion. The three 410 stubs remain deployed and source-controlled until deletion can be performed through a Supabase surface that supports it. Supabase's CLI documentation provides `supabase functions delete <Function name>`.

## Recovery model

There are two different recovery problems.

### 1. Logical/operator recovery

Examples:

- accidental balance edit,
- bad event metadata edit,
- winner flags or prize values changed,
- prize tiers modified,
- event ledger notes/data damaged by a bad script.

For this class of incident, recover only the affected rows from a known-good snapshot/backup, preserve IDs, then run reconciliation and security tests.

The rollback-only production drill in
`supabase/tests/phase2_disaster_recovery_drill.sql`:

1. snapshots one completed event and its related profiles/tickets/prize tiers/ledger rows,
2. intentionally corrupts representative values across all five critical datasets,
3. restores those values from the snapshot,
4. compares full-row checksums,
5. reruns Draw Credit reconciliation,
6. rolls the entire drill back.

No drill mutation persists.

### 2. Physical database disaster / broad data loss

Use Supabase database backups / Point-in-Time Recovery where available. Supabase documents daily backups and, on eligible paid configurations, restoration to a new project from physical backups/PITR.

A real physical restore is deliberately **not** executed against the production project as a validation exercise. Restoring to a new project can incur additional cost and requires infrastructure reconfiguration.

Supabase's restore-to-new-project documentation states that the database copy includes schema, data, indexes, database roles/permissions and Auth database records, but does not automatically copy all surrounding infrastructure. Reconfigure and verify:

- Storage objects/settings,
- Edge Functions,
- Auth settings/API keys,
- Realtime settings,
- project-specific database/extension settings,
- read replicas and external integrations.

Disable/inspect copied cron, pg_net/webhook or other outbound jobs before allowing a restored clone to perform external actions.

## Critical recovery order

For a row-level reconstruction where inserts are required, restore parent records before dependants:

1. Auth user / `profiles`
2. `lottery_events`
3. `event_prize_tiers`
4. `event_tickets`
5. `balance_ledger`

For existing rows, prefer targeted UPDATE restoration that preserves primary keys.

## Incident procedure

1. Record the incident start time and affected user/event IDs.
2. Stop the specific write path causing damage; do not make broad manual edits.
3. Capture current row counts and affected-row snapshots before repair.
4. Obtain the known-good values from backup/PITR/export/audit evidence.
5. Restore in dependency order.
6. Run Draw Credit reconciliation.
7. Run Phase 1 security/RLS tests.
8. Run Phase 2 draw/recovery/privacy/performance tests.
9. Verify cron health and the Operations Incident Center.
10. Re-enable the write path only after all invariants pass.

## What is proven vs not proven

Proven in production:

- transaction rollback behavior,
- logical snapshot/repair mechanics for critical lottery/accounting rows,
- post-repair Draw Credit integrity,
- current app has no repository caller for deprecated endpoints,
- deprecated endpoints had zero requests in the latest 24-hour log window.

Not proven by this drill:

- availability of a particular historical physical backup timestamp,
- a paid restore-to-new-project/PITR operation,
- Storage/Edge/Auth settings restoration.

Those require the Supabase backup/restore infrastructure and should be tested against a separate restored project, never by overwriting production for a drill.
