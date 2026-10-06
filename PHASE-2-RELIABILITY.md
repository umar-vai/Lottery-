# Phase 2 — Production Reliability

## 2.1 Browser session recovery

Production logs showed persisted Supabase access tokens continuing to hit `/auth/v1/user` after their JWT expiry.

The global site shell now:

- checks JWT/session expiry before protected user/profile reads,
- refreshes using the stored refresh token before expiry,
- retries once after a 401/403 with a forced token refresh,
- clears locally persisted auth only when the Auth server rejects refresh credentials,
- revalidates on tab focus / visibility restore,
- reduces background user/profile polling from 12 seconds to 60 seconds.

The admin dashboard routes protected requests through the same recovery layer so a long-lived admin tab does not continue using a stale access token.

## 2.2 Draw exactly-once protection

The event row remains the serialization boundary: `private.run_lottery_event_internal(...)` locks the event with `FOR UPDATE`.

After the lock is acquired, an event that has already become `completed` is now treated as an idempotent successful no-op. This prevents a cron/admin overlap or retry from being reported as a failed draw.

A partial unique index also guarantees at most one `prize_credit` ledger row for the same `(event_id, ticket_id)`. If future code accidentally attempts to credit the same winning ticket twice, the transaction fails and rolls back instead of double-crediting the player.

`supabase/tests/phase2_draw_exactly_once.sql` executes the completed-event draw path twice inside a rollback-only test and verifies ledger totals, draw seed, winner summary, and completion timestamp remain unchanged.


## 2.3 Ticket purchase concurrency probe

A controlled production probe ran the real `purchase_event_ticket(...)` RPC from two independent cron workers against the same published event. Both started together. One completed in roughly 1.535 seconds and the other in roughly 3.043 seconds while each held the event lock for 1.5 seconds.

That timing demonstrates the second worker queued behind the event-row `FOR UPDATE` lock rather than racing through ticket-capacity/accounting checks. Each worker restored its ticket, ledger and balance state before commit, self-unscheduled, and the temporary helper was removed. Detailed evidence is in `PHASE-2-STRESS-RESULTS.md`.

## 2.4 Automated Draw Credit reconciliation

The backend now exposes an admin-only integrity report and runs the same reconciliation automatically every hour.

The report verifies:

- every profile Draw Credit balance equals the cumulative Draw Credit ledger,
- no profile balance is negative,
- every event ticket has exactly one matching purchase ledger row,
- ticket purchase user/event/amount values match,
- every winning ticket has exactly one matching prize-credit ledger row,
- non-winning tickets do not carry prize credits,
- Slot and Plinko bet/payout ledger rows match their source game records,
- malformed game ledger references are absent,
- Support/Love Points functions remain separated from Draw Credit balance writes.

Database guards now also prevent more than one ticket-purchase ledger row for the same event ticket.

The admin Overview page shows the current reconciliation state and provides a manual “Check now” action. A private hourly cron job records an audit event only if an integrity issue is detected.


## 2.5 Draw crash recovery and operational monitoring

Scheduled draws now keep private per-event runtime state for consecutive failures, total failures, last SQLSTATE/error, alert timing and last successful attempt.

The minute runner still retries every due draw on every cron pass. A failed draw remains transaction-safe: winner changes, profile credits, prize-ledger writes and event completion all roll back together. The failure is then recorded outside the failed subtransaction, and an identical recurring failure is audit-alerted at most once every 15 minutes. When the draw later succeeds, the incident is cleared and a recovery audit event is emitted.

A separate `lottery-operational-health` job runs every five minutes. Its report detects a missing/stale draw cron, cron-run failures, scheduled draws overdue by more than two minutes, and open draw incidents.

The admin Overview now shows Recovery & cron health, with manual health refresh and a guarded Retry due draws action.

The rollback-only runtime test `supabase/tests/phase2_draw_failure_recovery.sql` injects an interruption before prize-ledger insertion, proves the entire draw rolled back, removes the failpoint, retries, and proves the draw completes with exactly one prize credit.


## 2.6 Admin audit hardening and Incident Center

Sensitive admin mutations now produce a private canonical row-change audit independent of the broader public activity feed. The canonical audit stores actor, action, affected row, human reason, request context, and exact before/after JSON.

The Admin UI sends the human reason through the PostgREST `x-admin-reason` request header for high-impact operations including balance changes, role changes, lottery configuration/status/delete/draw/retry actions and platform availability switches. Love Point adjustments retain their existing actor and note and are mirrored into the same canonical trail.

The Operations Incident Center combines current draw health, Draw Credit reconciliation, all cron failures, failed/error Support claims, failed/error Binance Pay orders, failed/error credit requests and recent database/application failure audit events. HTTP-level Supabase Auth, REST and Edge Function logs remain platform-log sources and are not duplicated into application tables.


## 2.7 Supabase performance and RLS cleanup

The current advisor-reported foreign-key and RLS performance issues are addressed without changing product authorization semantics.

- 11 foreign-key columns receive covering indexes.
- 5 SELECT policies use statement-cached `(select auth.uid())` / `(select public.is_admin())` helpers.
- 4 duplicate permissive SELECT-policy groups are consolidated.
- Draw visibility remains public for non-draft rows, while admins retain full read access.
- Player-owned profile/ticket/ticket-result access and admin-wide access remain unchanged.


## 2.8 Public API privacy minimization

The public winner API no longer exposes raw Auth/profile UUIDs or event-ticket UUIDs. Public winner grouping uses stable pseudonymous `winner_key` values and opaque `ticket_ref` references instead.

Stored `lottery_events.winner_summary` data is sanitized by a database trigger, including historical backfill, so browser-readable event rows no longer carry raw ticket/user identifiers.

Browser SELECT access to `lottery_events` is column-whitelisted and excludes `created_by`. Public pages use explicit event columns rather than `SELECT *`.

The public feature-state RPC now exposes only effective availability booleans. Internal configured sub-switch state and update timestamps are not public.

Payment providers marked hidden or disabled are no longer visible through browser RLS.
