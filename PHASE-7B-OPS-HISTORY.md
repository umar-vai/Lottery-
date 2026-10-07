# Phase 7B — Durable Operations History & Evidence-Based Cleanup

Date: 2026-10-07

## Result

Phase 7B makes the Phase 7A SLO signal durable enough for trend analysis and keeps operational history bounded.

Production now has:

- private 15-minute SLO snapshots;
- a private 1–720 hour SLO history report;
- 30-day SLO snapshot retention;
- 30-day pg_cron run-history retention;
- daily automatic operational-history pruning;
- one proven duplicate public index removed;
- a runtime contract and CI gate protecting the new controls.

No new browser-callable RPC or public table was added.

## 1. Why durable SLO history was needed

Phase 7A evaluates the current state and writes breach/recovery events. That is enough for immediate alerting, but it does not provide a regular time series when the system is healthy.

Phase 7B stores the full private SLO JSON report every 15 minutes.

At four snapshots per hour:

- 96 snapshots/day;
- about 2,880 snapshots across 30 days.

This is intentionally small and bounded.

## 2. Private snapshot storage

Table:

`private.production_slo_snapshots`

Columns:

- identity ID;
- `captured_at`;
- severity: `ok | warning | critical`;
- full Phase 7A SLO JSON report.

The table and identity sequence are revoked from:

- `PUBLIC`;
- `anon`;
- `authenticated`;
- `service_role`.

It is an operational/internal table, not a Data API surface.

## 3. Snapshot and history functions

### Capture

`private.capture_production_slo_snapshot()`

- calls `private.production_slo_report()`;
- stores severity + full report;
- returns the captured report.

### History

`private.production_slo_history_report(p_hours)`

- minimum: 1 hour;
- maximum: 720 hours / 30 days;
- default: 24 hours;
- returns snapshot count;
- returns OK/warning/critical counts;
- returns the latest snapshot;
- returns up to 50 recent non-OK snapshots with breach details.

Both functions remain private and are not executable by browser/service API roles.

## 4. Snapshot cron

Job:

`production-slo-snapshot-15m`

Schedule:

`*/15 * * * *`

Command:

`select private.capture_production_slo_snapshot();`

A first production snapshot was created immediately when the migration was applied, and additional manual verification snapshots were successfully captured.

## 5. Bounded operational retention

Supabase documentation notes that `pg_cron` does not automatically clean `cron.job_run_details` and recommends pruning unnecessary history.

At Phase 7B start:

- `cron.job_run_details`: 4,790 rows;
- oldest observed run: 2026-10-04;
- rows older than 30 days: 0.

Private function:

`private.prune_operational_history()`

deletes:

- SLO snapshots older than 30 days;
- `cron.job_run_details` rows older than 30 days.

Retention cron:

`operational-history-retention-daily`

Schedule:

`23 3 * * *` UTC.

The retention is deliberately 30 days so normal incident investigations and weekly trend review keep enough history while preventing unbounded cron-log growth.

## 6. Evidence-based index cleanup

The performance advisor currently reports 21 INFO-level unused-index findings.

Phase 7B does **not** blindly drop them.

Reasons:

- statistics were reset on 2026-09-29;
- current representative traffic window is still short;
- several indexes enforce uniqueness/partial uniqueness even when scan count is zero;
- some protect low-frequency admin/payment/support paths;
- some belong to frozen legacy history and should be handled with the subsystem retention decision rather than isolated index removal.

### One proven duplicate removed

Production contained both:

- `lottery_events_slug_key` — UNIQUE constraint index on `slug`;
- `lottery_events_slug_idx` — non-unique btree index on the same `slug` key.

The non-unique duplicate had 1,038 recorded scans, while the unique constraint index had zero, because the planner was choosing the duplicate.

A rollback-only proof dropped `lottery_events_slug_idx`, disabled sequential scan for the probe, and confirmed the exact slug lookup plan switched to:

`Index Scan using lottery_events_slug_key`

The duplicate was then removed in production. The unique constraint remains intact, and the post-apply query plan again confirmed `lottery_events_slug_key` serves the slug lookup.

No other public unused index was removed.

## 7. Query-performance review

Current cumulative app-oriented `pg_stat_statements` observations are healthy:

- `private.run_due_lottery_events()`: ~5.85 ms mean over 3,507 calls;
- Support wallet user lookup: ~0.13 ms mean over 5,082 calls;
- event-ticket read path: ~1.13 ms mean over 543 calls;
- lottery slug lookup: ~0.43 ms mean over 889 calls;
- lottery events listing: ~0.39 ms mean over 533 calls;
- Draw Credit integrity check: ~102.89 ms mean over 16 low-frequency calls;
- Phase 7A SLO checker: ~89.68 ms mean in the early sample.

No sustained production query hotspot currently justifies another index or query rewrite.

The cumulative appearance of the retired `private.run_draw_engine()` in `pg_stat_statements` is historical since the statistics reset; it is not evidence that a legacy draw cron is currently active. Current `cron.job` inventory contains only the active current jobs.

## 8. Current production privacy/integrity state

After Phase 7B apply:

- private SLO snapshot table browser-readable: no;
- private snapshot/history/prune functions browser/service executable: no;
- authenticated-executable private SECURITY DEFINER surface remains zero;
- duplicate public lottery slug index: removed;
- unique lottery slug constraint: preserved;
- Phase 7A SLO remains healthy.

## 9. Follow-up rule

Re-evaluate the remaining 21 INFO-level unused-index findings only after representative traffic evidence is available, especially the clean 7-day Phase 7A observation tracked in issue #63.

Do not remove primary keys, uniqueness guards, partial uniqueness guards, foreign-key-supporting indexes, payment/support indexes, or low-frequency operational indexes solely because `idx_scan=0` in a short statistics window.
