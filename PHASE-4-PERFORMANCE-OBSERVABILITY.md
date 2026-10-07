# Phase 4 — Database Performance + Observability Hardening

Date: 2026-10-07

## Scope

This block measured the Phase 3 pagination paths in production before changing indexes, reduced Support client polling, hardened Support Edge telemetry in source, and systematically classified the remaining Supabase advisor findings.

## Production query-plan findings

Production dataset at measurement time:

- profiles: 7
- lottery_events: 3
- event_tickets: 24
- balance_ledger: 2,175
- audit_logs: 47
- support_wallets: 4
- support_transactions: 3
- support_bridge_devices: 3

### Balance ledger keyset path

The high-volume pagination path is using the intended composite index:

`balance_ledger_created_id_idx(created_at DESC, id DESC)`

A second-page keyset query using:

`(created_at,id) < (cursor_created_at,cursor_id)`

planned as an **Index Only Scan** and completed in approximately **0.126 ms** execution time with 11 shared-buffer hits.

The user-filtered ledger query also used the same composite cursor index and completed in approximately **0.132 ms**.

Historical `pg_stat_statements` still contained the pre-Phase-3 LIMIT/OFFSET ledger path at roughly 22.9 ms mean / 110 ms max for one normalized statement. Post-deployment Edge logs showed no matching legacy ledger/bulk-Support URL after the Phase 3 cutover.

### Small-table pagination paths

`event_tickets`, `profiles`, `audit_logs`, and `support_transactions` currently use sequential scans plus tiny in-memory sorts for representative first pages. Their tables contain only 3–47 rows and the measured execution times were sub-millisecond to low-single-digit milliseconds.

This is expected PostgreSQL planner behavior. The composite pagination indexes are retained for growth; forcing index scans now would be counterproductive.

## Database health baseline

- index cache hit: ~99.97%
- table cache hit: 100%
- connection sample: 19 / 60
- active connections: 2
- blockers: 0
- idle-in-transaction: 0
- the only >30s active-wait session was the normal Supabase Realtime logical replication sender waiting for WAL

No capacity or lock tuning was justified by the measured baseline.

## Slow-query / request hotspots

### High-frequency but low-latency database work

The highest cumulative `pg_stat_statements` item was Realtime change-list work because of call volume, not high per-call latency.

Lottery scheduler/draw health functions were also high in cumulative time because they run repeatedly, while remaining low-millisecond per execution.

### Support client polling

The concrete network hotspot was browser polling:

- `support-live.js`: Support wallet every 4 seconds
- `love-points-page.js`: wallet + claim history every 8 seconds

In the observed 24-hour log window, `/rest/v1/support_wallets` received about 1,295 successful requests. Most were single-user balance reads; only four were the retired 2,000-row admin bulk path.

Phase 4 changes the browser behavior to:

- immediate initial load
- immediate refresh after known Support mutations
- refresh on focus / returning to a visible tab
- 60-second visible-tab fallback
- in-flight deduplication / short refresh cooldown

This preserves freshness while removing the 4s/8s polling loop.

## Support / Edge telemetry

The three current Support Edge Function source files now emit structured, PII-free operational telemetry with:

- component
- event
- trace_id
- action
- HTTP status
- duration_ms
- safe outcome metadata such as duplicate / settlement status / validation class

Responses expose `x-support-trace-id` for correlation.

No sender number, TrxID, raw SMS body, JWT, bridge token, token hash, or user ID is written to the structured telemetry payload.

Observed baseline before the source change:

- no Edge 5xx responses in the last 24-hour log window
- old `support-device-admin` v3 list invocations were roughly 0.78–0.95 seconds
- deployed v4 had no post-deployment invocation in the measured window, so it had no live latency sample yet

`support-device-admin` v5, `support-phone-bridge` v4, and `claim-support-points` v4 were subsequently deployed to production from the committed Phase 4 source. Live function source verification confirmed `trace_id`, `duration_ms`, and the `x-support-trace-id` response header are present in all three production bundles.

## Advisor cleanup

### Fixed in production

1. Five `rls_enabled_no_policy` findings were removed by adding explicit restrictive deny-all policies for browser roles to service-only tables:
   - draw_secrets
   - platform_controls
   - support_bridge_devices
   - support_point_adjustments
   - support_transactions

   This does not grant browser access; it makes the existing service-only intent explicit.

2. Five obsolete authenticated SECURITY DEFINER exposures were retired:
   - admin_create_lottery_event v1
   - admin_create_lottery_event_v2
   - admin_update_lottery_event v1
   - admin_update_lottery_event_v2
   - admin_get_admin_change_audit(integer)

   Current v3 and keyset-paginated replacements remain active.

Security advisor authenticated SECURITY DEFINER findings dropped from **50 to 45**.

### Intentional exceptions

Two anonymous SECURITY DEFINER functions remain intentionally public:

- `get_platform_features()` — exposes only feature booleans while the underlying control table is direct-deny
- `get_public_event_winners(uuid)` — exposes only the sanitized completed-event winner projection while direct ticket/profile access remains protected

The remaining authenticated SECURITY DEFINER functions are current application entrypoints and are protected by internal authorization / ownership checks. Removing EXECUTE purely to silence the advisor would break the application.

### Auth setting outside this connector

`auth_leaked_password_protection` remains a Supabase Auth project setting. It should be enabled in Auth settings; the connected Supabase MCP surface currently exposes no Auth configuration mutation for this setting.

### Performance advisor: unused indexes

23 unused-index INFO findings remain. No index was dropped blindly.

They fall into three groups:

1. new Phase 3 pagination indexes on tiny tables, expected to become useful as rows grow;
2. foreign-key support indexes added to prevent FK update/delete scans;
3. low-traffic feature indexes for game/payment/support paths.

An index should only be removed after a representative traffic window shows continued zero usage and a dependency/query review confirms it is not preserving FK or future keyset performance.

## Verification

Phase 4 runtime SQL verifies:

- explicit service-only deny policies exist
- legacy RPCs are no longer browser-executable
- canonical v3/paginated RPC grants remain intact
- pagination RPC implementations do not contain OFFSET
- the balance-ledger composite cursor index remains present

The production Phase 4 test completed successfully inside a rollback transaction.
