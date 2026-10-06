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
