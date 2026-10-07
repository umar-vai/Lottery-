# Phase 5 — Production Readiness

Date: 2026-10-07  
Scope: production E2E validation, lifecycle hardening, SECURITY DEFINER review, operational integrity, observability follow-up, and legacy Powerball retirement controls.

## Result

Phase 5 establishes a production-safety contract around the current `lottery_events` / `event_tickets` platform without deleting historical legacy data.

Production checks completed in this phase:

- rollback-only end-to-end lottery flow passed;
- direct lifecycle bypasses were closed at the database boundary;
- winner prize tiers are immutable after the first ticket sale;
- Draw Credit accounting integrity reports zero issues;
- scheduled lottery operations are healthy;
- Support settlement has no pending, unclaimed, orphan, or duplicate-settlement gap;
- all privileged functions have explicit `search_path`;
- browser-callable admin SECURITY DEFINER RPCs retain server-side `is_admin()` guards;
- the retired Powerball ticket system is now browser read-only;
- legacy Powerball tables were retained for history rather than destructively dropped.

## 1. Rollback-only production E2E

A real production-schema test was executed inside `BEGIN ... ROLLBACK`.

The test exercised:

1. admin authorization;
2. temporary Draw Credit setup;
3. lottery draft creation;
4. publish-readiness review;
5. guarded publication;
6. player ticket purchase;
7. rejection of invalid duplicate-number selection;
8. draw-readiness review;
9. draw execution;
10. repeated draw call / idempotent completion;
11. exactly one ticket-purchase ledger debit;
12. exactly one prize ledger credit;
13. final balance reconciliation;
14. post-draw lifecycle integrity.

The transaction rolled back all fixture mutations.

Result: **passed**.

The executable contract lives in:

`supabase/tests/phase5_production_readiness.sql`

## 2. Lifecycle state-machine hardening

The browser UI was already using the guided publish path, but the underlying RPCs still allowed direct state bypasses.

### Fixed

`admin_create_lottery_event_v3(...)`

- keeps its existing signature for compatibility;
- rejects `p_publish=true`;
- always creates a draft;
- publication must go through `admin_publish_lottery_event(uuid)`.

`admin_update_lottery_event_v3(...)`

- rejects draft -> published;
- rejects published -> draft;
- rejects cancelled -> draft/published;
- completed events remain immutable through this RPC;
- once a ticket exists, configured winner prize tiers cannot be changed.

This makes the database state machine match the guarded admin UI instead of relying on browser behavior for safety.

Migration:

`supabase/migrations/202610070345_phase5_lifecycle_state_machine.sql`

## 3. SECURITY DEFINER audit

Observed privileged-function inventory:

- 83 SECURITY DEFINER functions in `public` + `private`;
- 0 missing explicit `search_path`;
- 2 intentionally anonymous public read RPCs:
  - `get_platform_features()`
  - `get_public_event_winners(uuid)`
- 35 authenticated admin SECURITY DEFINER RPCs;
- 8 authenticated user-facing SECURITY DEFINER RPCs in public API scope;
- 1 authenticated private helper exception:
  - `private.review_credit_request(uuid,boolean,text)`

Every authenticated public admin SECURITY DEFINER RPC checked in this phase contains a server-side `is_admin()` authorization guard.

The private credit-review helper is intentionally retained because the current public SQL wrapper delegates to it and the helper itself performs `auth.uid()` + `is_admin()` validation. Blindly revoking it would break the supported review path without reducing the public API advisor count.

The goal is not to force advisor warnings to zero. The goal is to keep only intentional callable privileged entry points and make their authorization contract testable.

## 4. Production integrity / operational health

Post-change production checks reported:

### Draw Credits

- integrity `ok=true`;
- issue total: 0;
- profile balance mismatches: 0;
- negative balances: 0;
- ticket purchase ledger mismatches: 0;
- orphan ticket-purchase ledger rows: 0;
- winner prize-credit mismatches: 0;
- non-winner prize credits: 0;
- malformed Slot/Plinko ledger references: 0.

### Lottery operations

- `lottery-events-every-minute` cron active;
- last observed cron execution succeeded;
- failed runs in the observed 24-hour window: 0;
- overdue scheduled draws: 0;
- open draw failure incidents: 0.

### Incident center

- open application/database incidents: 0;
- observed 24-hour cron failures: 0;
- payment failures: 0;
- Support failures: 0;
- credit-request failures: 0.

### Support Points

- pending claims: 0;
- unclaimed Support transactions: 0;
- duplicate transaction settlements: 0;
- orphan Support claims: 0.

## 5. Observability follow-up

In the mixed 24-hour window reviewed during Phase 5, `/rest/v1/support_wallets` recorded 1,183 requests.

The largest hourly bursts were from the earlier deployment window:

- 563 requests in one hour;
- 282 requests in the following hour.

Later observed hours were substantially lower, including a most-recent mixed hour with 81 requests.

The current source is already hardened to:

- event-driven refresh after Support mutations;
- focus/visibility refresh;
- 60-second fallback polling;
- in-flight request deduplication;
- cached user identity.

Because the 24-hour window still overlaps the old high-frequency deployment period, this phase does **not** claim a clean 24-hour before/after reduction yet.

No fake Support claim/device mutation was generated solely to manufacture telemetry. Natural post-deploy Edge invocations should be used for the next clean telemetry sample.

## 6. Legacy Powerball subsystem retirement

Historical production data still exists:

- `draws`: 105 rows;
- `tickets`: 20 rows;
- `ticket_results`: 20 rows;
- `draw_events`: 289 rows;
- `draw_secrets`: 103 rows.

The old subsystem is operationally inactive:

- `game_settings.system_paused=true`;
- `auto_create_next_draw=false`;
- no old `run_draw_engine` cron is active;
- current `index.html` does not load legacy `app.js`;
- no HTML entry point in the repository should load `app.js`;
- the checked 24-hour production log window showed zero REST traffic to:
  - `/rest/v1/draws`
  - `/rest/v1/tickets`
  - `/rest/v1/ticket_results`
  - `/rest/v1/draw_events`
  - `/rest/v1/draw_secrets`.

### Phase 5 retirement action

Historical tables were **not dropped**.

Instead, browser writes to legacy `public.tickets` were frozen:

- authenticated INSERT revoked;
- authenticated UPDATE revoked;
- DELETE remains unavailable;
- legacy INSERT/UPDATE RLS policies removed;
- authenticated historical SELECT remains available under the existing ownership/admin read policy.

Migration:

`supabase/migrations/202610070400_phase5_freeze_legacy_powerball_writes.sql`

This converts the remaining legacy browser mutation surface into read-only historical state while avoiding destructive archival work.

## 7. CI contract

`scripts/phase5-production-readiness.mjs` guards:

- lifecycle migration markers;
- legacy freeze migration markers;
- rollback E2E contract markers;
- SECURITY DEFINER search-path/admin-guard checks;
- guarded publish use in `ops-v4.js`;
- no HTML loading retired `app.js`;
- no later migration re-granting browser writes or write policies on legacy `public.tickets`.

The Pages workflow runs this gate after Phase 4.

## 8. Remaining manual / evidence-dependent work

GitHub issue #59 remains the tracker for actions not available through the connected Supabase management surface:

1. enable Auth leaked-password protection;
2. physically delete retired Edge Function stubs after confirming the deletion-capable surface:
   - `phone-bridge`
   - `bridge-device-admin`
   - `claim-demo-credit`.

Also still evidence-dependent:

- collect a clean post-change 24-hour Support polling comparison;
- capture natural post-deploy structured Support Edge telemetry;
- observe the remaining unused-index advisor set over representative production traffic before dropping indexes.

## Production readiness status

The current multi-event lottery path is now covered by rollback E2E validation, lifecycle state enforcement, accounting integrity checks, operational health checks, privileged-function guard checks, and a CI-enforced legacy retirement boundary.
