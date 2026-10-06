# Phase 2 Draw Recovery & Operations

## Recovery model

Lottery draws stay transactional. A draw either completes all winner, balance, ledger and event-status writes or PostgreSQL rolls the transaction back.

The scheduled runner executes every minute. If a due draw throws, the event remains published and unchanged, the failure is recorded, and the next cron run retries it automatically.

## Runtime incident state

`private.lottery_draw_runtime_state` tracks:

- consecutive and total failures per event,
- first/last failure time,
- SQLSTATE and last error,
- last successful attempt,
- alert de-duplication state.

Repeated identical failures are still retried each minute, but audit alerts are de-duplicated to at most once every 15 minutes unless the error changes.

When a previously failing draw succeeds, a recovery audit entry is written and the open failure state is cleared.

## Operational health

`private.lottery_operational_health_report()` checks:

- the minute draw cron exists and is active,
- its last run succeeded and is not stale,
- cron failures in the last 24 hours,
- scheduled events overdue by more than two minutes,
- currently open draw-failure incidents,
- recent completed draws.

A separate `lottery-operational-health` cron runs every five minutes. It writes a health-failure audit entry when the control plane becomes unhealthy and a recovery entry when it returns to healthy state.

Admins can use:

- `admin_get_lottery_operational_health()`
- `admin_retry_due_lottery_events()`

The Admin Overview surfaces the same report and exposes a guarded manual retry action for due scheduled draws.

## Crash/retry proof

`supabase/tests/phase2_draw_failure_recovery.sql` injects a rollback-only failure immediately before prize-ledger insertion. It verifies that:

1. event status stays published,
2. the ticket does not remain a winner,
3. prize amount stays zero,
4. player balance returns to the pre-draw value,
5. no prize ledger row survives,
6. retrying after removing the injected failure completes the event,
7. exactly one prize credit is created.

This validates the production recovery assumption directly against PostgreSQL transaction behavior.
