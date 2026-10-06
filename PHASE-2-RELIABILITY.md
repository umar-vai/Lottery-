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
