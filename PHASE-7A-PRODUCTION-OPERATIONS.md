# Phase 7A — Production Operations, SLOs & Monitoring

Date: 2026-10-07

## Result

Phase 7A turns the existing integrity/incident checks into an explicit production operations contract.

The system now has:

- a private database SLO report;
- a five-minute SLO checker;
- debounced breach/recovery events in `audit_logs`;
- explicit warning/critical thresholds;
- a rolling HTTP/REST error and latency baseline;
- a release/rollback decision policy;
- CI protection for the operational contract.

No new browser-callable RPC was added.

## 1. Production baseline

Observed at Phase 7A start:

### Database

- client connections: 5 / 60
- active connections: 1
- connection usage: 8.33%
- idle in transaction over 60s: 0
- blocked sessions over 30s: 0
- table cache hit: 100%
- index cache hit: 99.98%
- cron failures in the observed 24 hours: 0
- current application incident count: 0
- Draw Credit integrity issues: 0
- overdue scheduled draws: 0
- open draw failure incidents: 0
- Support duplicate settlements: 0
- Support orphan claims: 0
- expired Support pending claims: 0

### Rolling 24-hour REST / Function traffic

Observed rolling 24-hour platform-log window:

- total REST/Function requests: 2,754
- HTTP 4xx/5xx responses: 8
- HTTP 5xx responses: 0
- server-error rate: 0%
- overall p95 origin time: 278 ms

High-volume paths included:

- `/rest/v1/profiles`: 1,001 requests, p95 242 ms, 0 5xx
- `/rest/v1/support_wallets`: 689 requests, p95 165 ms, 0 5xx
- `/rest/v1/rpc/get_public_event_winners`: 479 requests, p95 about 440 ms, 0 5xx
- `/rest/v1/event_tickets`: 278 requests, p95 about 157 ms, 0 5xx
- `/rest/v1/lottery_events`: 165 requests, p95 about 238 ms, 0 5xx
- `/rest/v1/rpc/get_platform_features`: 72 requests, p95 about 776 ms, 0 5xx

The Support wallet count still overlaps the earlier high-frequency deployment period. A clean full-day post-change comparison remains evidence-dependent.

The platform log API accepts at most a 24-hour query window. Seven-day trend reporting therefore requires daily snapshot aggregation rather than one single raw log query.

## 2. Database SLO report

Private function:

`private.production_slo_report()`

It combines:

- existing lottery operational health;
- Draw Credit integrity;
- application incident counts;
- database connection pressure;
- blocking sessions;
- long idle-in-transaction sessions;
- table/index cache hit rates;
- recent cron failures;
- presence of required cron jobs;
- Support duplicate/orphan/expired-pending invariants.

The function is not executable by `anon`, `authenticated`, or `service_role`.

### Severity contract

**Critical**

- lottery operational health is unhealthy;
- Draw Credit integrity is unhealthy;
- any duplicate Support settlement;
- any orphan Support claim;
- any cron failure in the most recent 15 minutes;
- any required production cron missing/inactive;
- database connection usage >= 90%;
- any blocked session lasting over 30 seconds.

**Warning**

- connection usage >= 75%;
- any idle-in-transaction session over 60 seconds;
- table cache hit below 99%;
- index cache hit below 99%;
- cron failures in the last 24 hours but not the last 15 minutes;
- expired Support pending claims;
- Support/payment/credit-request failure statuses in the last 24 hours.

Current live result after deployment:

`severity=ok`

with no active breaches.

The JSON threshold contract exposes keys including `connections_warning_pct`, `connections_critical_pct`, `cache_hit_warning_below_pct`, `blocked_session_critical_after_seconds`, and `idle_in_transaction_warning_after_seconds`.

## 3. Automated SLO checker

Private function:

`private.run_production_slo_check()`

Cron:

`production-slo-every-5-minutes`

Schedule:

`*/5 * * * *`

If the SLO severity is warning or critical, the checker writes:

`production_slo_breached`

to `audit_logs`, throttled to at most one breach record every 30 minutes.

When the system returns to `ok` after a breach, it writes:

`production_slo_recovered`.

This is an internal durable alert signal. It is not an external PagerDuty/SMS/email notification system.

## 4. HTTP / Edge release SLO

HTTP/Edge metrics live in Supabase platform logs and therefore are evaluated separately from the database SLO function.

Phase 7A operational thresholds:

### Warning

- rolling 15-minute 5xx rate >= 1% when there are at least 20 requests; or
- REST/RPC p95 origin latency >= 1,000 ms for a sustained 15-minute window.

### Critical / rollback candidate

- rolling 15-minute 5xx rate >= 5% with at least 20 requests;
- repeated 5xx on a critical mutation path, even at low traffic:
  - `purchase_event_ticket`
  - lottery publish/run/admin mutation
  - credit review/balance mutation
  - Support settlement/claim;
- REST/RPC p95 origin latency >= 2,000 ms for a sustained 15-minute window plus user-visible degradation.

4xx responses are not treated as server availability failures by themselves; they must be classified as expected authorization/validation vs. unexpected client regression.

## 5. Slow-query policy

`pg_stat_statements` is used as a diagnostic source, not as an automatic rollback trigger.

During the baseline, the slowest mean/max statements were dominated by:

- rollback/concurrency tests;
- Supabase Studio metadata inspection;
- timezone/extension metadata queries.

Current core production RPCs were not showing a sustained multi-second hotspot.

Investigate a production query when:

- mean execution time remains over 500 ms with meaningful call volume; or
- max execution exceeds 2 seconds repeatedly; or
- the same query consumes a disproportionate share of total execution time.

Use `EXPLAIN (ANALYZE, BUFFERS)` on a safe representative query before adding/removing indexes.

## 6. Required cron jobs

The SLO contract expects all of these active:

1. `lottery-events-every-minute`
2. `draw-credit-integrity-hourly`
3. `lottery-operational-health`
4. `production-slo-every-5-minutes`

A missing/inactive required job is a critical SLO breach.

## 7. Release rule

A production release is green only when:

- Phase 0–7A CI gates pass;
- `private.production_slo_report()` is not critical;
- Draw Credit integrity is clean;
- no overdue/open draw incident exists;
- Support duplicate/orphan invariants are zero;
- no new unexpected security advisor finding was introduced;
- database migration/Edge changes have an explicit rollback path;
- the pre-release commit SHA is recorded.

See `RELEASE-ROLLBACK-RUNBOOK.md`.

## 8. Evidence-dependent follow-up

A clean 24-hour and then 7-day observation should be captured after Phase 7A to validate:

- Support wallet polling after the old deployment window fully ages out;
- HTTP 5xx error budget;
- p95 latency stability;
- new SLO cron reliability;
- natural Support Edge telemetry with `trace_id`.

Do not generate fake financial/support mutations merely to create monitoring data.

This evidence-dependent follow-up is tracked in GitHub issue #63. Phase 6 off-site backup/restore remains tracked in #61, while Auth leaked-password protection and retired Edge stub deletion remain tracked in #59.
