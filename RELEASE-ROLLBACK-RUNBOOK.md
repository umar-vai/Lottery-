# Release & Rollback Runbook

Date: 2026-10-07

This runbook is the production release policy for DRAW//01 / Lootera.

## 1. Before every release

Record:

- current production/main commit SHA;
- target release commit SHA;
- database migrations included;
- Edge Function versions/source changes included;
- frontend/static changes included.

The current main SHA before the release is the primary frontend rollback reference.

Run/check:

1. GitHub Phase 0–7A validation.
2. `private.production_slo_report()`.
3. Draw Credit integrity report.
4. lottery operational health.
5. Support duplicate/orphan/pending integrity.
6. Supabase security and performance advisors.
7. rolling platform-log 5xx/p95 baseline.
8. migration dry-run for risky database changes.

Do not deploy a known critical SLO breach.

## 2. Deployment order

When a release contains dependent backend + frontend changes:

1. backward-compatible database migration;
2. Edge Functions, when required;
3. runtime/database verification;
4. frontend/static deployment;
5. post-release smoke verification;
6. observe the rolling error/latency window.

Prefer expand -> migrate -> contract over destructive schema changes.

## 3. Immediate rollback candidates

Treat these as strong rollback/feature-disable signals:

- Draw Credit integrity issue > 0;
- duplicate Support settlement > 0;
- orphan Support claim > 0;
- overdue draw or open draw failure caused by the release;
- required cron unexpectedly disabled/missing;
- database connections >= 90% because of the release;
- a blocker lasting over 30 seconds because of the release;
- repeated 5xx on a critical mutation path;
- rolling 15-minute HTTP 5xx >= 5% with at least 20 requests;
- p95 >= 2 seconds for 15 minutes with confirmed user-visible degradation;
- authorization regression exposing protected data or admin mutation capability.

For data/security integrity problems, prefer disabling the affected write path before attempting broad rollback.

## 4. Frontend rollback

The static site is deployed from GitHub `main`.

Preferred rollback:

1. identify the last known-good production commit;
2. create a normal revert/fix PR rather than force-pushing `main`;
3. run all CI gates;
4. merge;
5. allow the Pages workflow to redeploy;
6. verify production SLOs.

Emergency branch/ref rewriting should only be used when a normal revert cannot restore service safely.

## 5. Database rollback

Database migrations are normally forward-only.

Do **not** blindly run the inverse of a migration that changed or deleted data.

Preferred recovery order:

1. stop/disable the affected write path;
2. inspect the migration and current data;
3. create a compensating forward migration;
4. preserve audit/history rows;
5. verify inside a transaction where possible;
6. apply;
7. rerun integrity/SLO checks.

For destructive data loss, follow `PHASE-6-RESILIENCE-DR.md` and the off-site backup/restore procedure.

## 6. Edge Function rollback

For an Edge regression:

1. identify the previously deployed known-good source/version from Git/repository snapshots;
2. redeploy that source under the same current function slug;
3. preserve the intended JWT/custom-token policy;
4. verify function logs and HTTP status;
5. verify downstream DB invariants.

Never roll back to the retired 410 Support stubs:

- `phone-bridge`
- `bridge-device-admin`
- `claim-demo-credit`.

## 7. Emergency feature disable

When the code path is healthy enough to use the admin feature controls, prefer disabling the affected product feature rather than mutating tables manually.

Current platform feature controls include:

- master platform
- events
- game zone
- slot
- plinko

Use the protected admin RPC/UI path; do not directly edit feature tables from a browser client.

For a single lottery incident, stop the narrow event/write path instead of globally disabling unrelated products where possible.

## 8. Incident severity

### SEV-1

- financial/accounting integrity violation;
- authorization/privacy breach;
- duplicate credit/settlement;
- broad production outage;
- critical mutation paths consistently failing.

Action: stop affected writes, preserve evidence, rollback/repair immediately.

### SEV-2

- scheduled draw overdue/failing;
- sustained elevated 5xx;
- severe latency;
- database saturation/locks;
- one major feature unavailable.

Action: mitigate quickly, rollback if tied to release.

### SEV-3

- elevated but non-critical 4xx;
- isolated client/browser issue;
- cache/connection warning below critical;
- low-impact operational degradation.

Action: investigate without unnecessary broad rollback.

## 9. Post-release verification

After deployment:

- confirm all Phase 7A required cron jobs are active;
- run/read `private.production_slo_report()`;
- verify no new `production_slo_breached` event;
- inspect REST/RPC 5xx and p95;
- verify current critical mutation flow appropriate to the release;
- confirm GitHub Pages/CI deployment success;
- record any follow-up issue.

## 10. Recovery completion

An incident is closed only when:

- the affected feature is working;
- integrity reports pass;
- SLO severity returns to `ok` or the warning is explicitly understood;
- recovery event/notes are recorded;
- root cause and prevention work are tracked.
