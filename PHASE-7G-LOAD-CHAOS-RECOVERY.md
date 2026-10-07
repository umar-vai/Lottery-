# Phase 7G — Load, Chaos & Recovery Evidence

Date: 2026-10-07  
Product: **Lootera**  
Domain: **lootera.win**

## Result

Phase 7G completed a bounded production load/chaos exercise without leaving ticket, balance-ledger or event-state residue.

The test intentionally used rollback-contained financial mutations and an internal-token/service-role-only temporary probe path. After evidence capture, the temporary Edge action was removed, public probe RPCs were moved into the private schema, and all external execution grants were revoked.

Run ID:

`429d08d0-d992-4d8d-892b-71dc0f784eda`

## Test envelope

The production ticket path was exercised against one existing non-active lottery event and an admin test identity.

Each ticket worker:

1. captured the original event/profile/ticket/ledger baseline;
2. temporarily made the isolated event purchasable inside a PostgreSQL subtransaction;
3. executed the real `purchase_event_ticket(...)` transaction boundary;
4. held the transaction briefly to create contention;
5. intentionally raised a rollback sentinel;
6. verified the event, balance, tickets and ledger returned exactly to baseline;
7. recorded only timing/outcome evidence outside the rolled-back subtransaction.

No test ticket or purchase-ledger row was retained.

## Ticket contention results

| Concurrent workers | Requests | Avg | p95 | Max | Failures | Residue |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1 | 93.56 ms | 93.56 ms | 93.56 ms | 0 | 0 |
| 4 | 4 | 156.62 ms | 240.46 ms | 248.96 ms | 0 | 0 |
| 8 | 8 | 307.28 ms | 514.02 ms | 537.88 ms | 0 | 0 |
| 12 | 12 | 455.58 ms | 793.56 ms | 801.94 ms | 0 | 0 |

Edge wall time for the 12-worker wave was approximately **1.0 second**.

This is a same-user/same-event high-contention test, so row locking is deliberately concentrated rather than distributed across many users.

## Mutation-rate contention

A 12-way concurrent wave targeted one atomic rate-limit bucket with limit 5.

Observed:

- allowed: **5**
- rate-limited: **7**
- failures: **0**
- p95: **609.31 ms**
- max: **609.45 ms**

The atomic upsert budget therefore preserved the configured cap under concurrent contention.

Synthetic `phase7g-*` rate-limit buckets were deleted after evidence capture.

## Lock chaos

A holder transaction intentionally acquired the Phase 7G advisory lock for ~900 ms.

A competing waiter used a 250 ms lock timeout.

Observed:

- holder: released normally in **901.71 ms**
- waiter: expected SQLSTATE `55P03` lock timeout in **250.75 ms**
- no stuck blocker remained afterward.

This confirms the tested lock-timeout path fails boundedly rather than waiting indefinitely.

## Aggregate evidence

Retained private summary:

- total probe requests: **39**
- expected successful ticket probes: **25**
- rate allowed: **5**
- rate limited: **7**
- lock holder released: **1**
- lock timeout: **1**
- probe failures: **0**
- mutation residue: **0**

## Connection pressure

Before the suite, the observed database connection count was 15.

Immediately after the suite:

- total connections observed: 24
- client connections in SLO report: 16 / 60
- connection usage: **26.67%**
- blocked sessions over 30s: 0
- idle-in-transaction over 60s: 0

Later recovery observation:

- client connections: 12 / 60
- usage: **20%**
- blocked sessions over 30s: 0
- idle-in-transaction over 60s: 0
- table cache hit: 100%
- index cache hit: 99.99%

The bounded 12-way contention wave stayed far below the existing 75% connection-warning threshold.

## Data integrity after load

Post-test production totals remained:

- event tickets: 24
- balance-ledger rows: 2,175
- Draw Credit issue total: 0
- negative profile balances: 0
- ticket purchase mismatches: 0
- tickets without exact purchase ledger: 0
- orphan purchase ledgers: 0

Mutation guardrails were still fully enabled.

Telegram alert delivery remained enabled/ready with no dead letters.

## Pre-existing SLO warning

The production SLO was already in **warning** before Phase 7G because two cron runs earlier in the 24-hour window had status `failed` with message `job canceled`:

- 2026-10-07 08:01:15 UTC
- 2026-10-07 08:04:23 UTC

Those job IDs no longer map to active cron jobs.

Important post-test facts:

- cron failures in the last 15 minutes: **0**
- required cron jobs missing: **0**
- current lottery operational cron: healthy
- no Phase 7G probe failure was added to the current critical window.

Therefore Phase 7G does not classify the historical 24-hour warning as a new load-test regression.

## Temporary probe security

During the load test, probe calls required:

1. service-role REST access; and
2. the independent production alert dispatch token.

Browser roles never received probe execution permission.

After the run:

- temporary `phase7g_suite` action was removed from `production-alert-dispatch`;
- production-alert-dispatch returned to normal source and is ACTIVE as version 7;
- public `service_phase7g_*` RPC count: 0;
- retired probe helpers reside only in the private schema;
- anon execute grants: 0;
- authenticated execute grants: 0;
- service_role execute grants: 0;
- authenticated direct private SECURITY DEFINER exposure: 0;
- retained result table has no direct anon/authenticated/service_role SELECT.

Supabase Security Advisor returned to the established Phase 7F baseline:

- anonymous SECURITY DEFINER warnings: 2 intentional;
- authenticated SECURITY DEFINER warnings: 50 intentional;
- leaked-password warning unchanged;
- pg_net schema warning unchanged.

## Launch thresholds derived from this run

For the currently tested same-user/same-event ticket contention envelope:

- **healthy target:** p95 < 1,000 ms at <=12 concurrent ticket workers;
- **investigate:** p95 >=1,000 ms at <=12 concurrent workers;
- **stop/rollback:** any financial residue, duplicate debit/ticket, integrity mismatch or unbounded lock wait;
- **connection warning:** existing SLO >=75%;
- **connection critical:** existing SLO >=90%;
- **blocked-session critical:** >30 seconds;
- **lock wait used by chaos probe:** 250 ms bounded timeout.

These are launch guardrails from the measured environment, not a claim that 12 users is the system's maximum capacity.

## Important scope boundary

Phase 7G deliberately did **not** perform a live global mutation-kill-switch outage while real users could be active, because that would intentionally reject legitimate production writes.

The kill switch itself was already transactionally verified in Phase 7F.

Phase 7G also did not intentionally execute real third-party payment orders or irreversible external-provider traffic.

Those paths should be load-tested only in an isolated provider sandbox/staging environment.

## Conclusion

Within the bounded production test envelope:

- ticket financial transactions remained rollback-safe;
- contention latency stayed below the 1-second measured p95 launch target at 12 concurrent same-row workers;
- the rate limiter enforced its cap under concurrency;
- lock timeout behavior was bounded and recovered;
- database connection pressure stayed below warning thresholds;
- no application residue or Draw Credit corruption occurred;
- production security surfaces were restored after the test.
