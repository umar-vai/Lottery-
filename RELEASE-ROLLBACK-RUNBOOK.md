# Release & Rollback Runbook

Date: 2026-10-07

This runbook is the production release policy for Lootera / lootera.win.

## 1. Before every release

Record:

- current production/main commit SHA;
- target release commit SHA;
- database migrations included;
- Edge Function versions/source changes included;
- frontend/static changes included.

The current main SHA before the release is the primary frontend rollback reference.

Run/check:

1. GitHub Phase 0–7G validation.
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

### Phase 7F emergency write stop

For suspected financial/accounting corruption, replay abuse, runaway clients, or an unsafe mutation release:

1. open **Admin → Incidents → Emergency Mutation Guardrails**;
2. choose **Pause all user mutations**;
3. enter a concrete operational reason;
4. preserve logs/audit/SLO evidence;
5. investigate and repair while reads/observability remain available;
6. verify Draw Credit integrity, Support invariants, SLO state, and the affected critical path;
7. use **Resume user mutations** only after the condition is understood and safe.

The master guard stops protected user inserts for tickets, games, Support claims, credit requests, referrals and payment orders. It does not intentionally stop read-only traffic, monitoring, or unrelated admin remediation.

If the admin UI is unavailable, use the protected admin RPC from a trusted authenticated admin session; do not expose or edit private guardrail tables from browser code.

Browser lottery purchases use nonce-based idempotency. A retry of the same selection must reuse the same client nonce so a lost response cannot create a second debit/ticket.

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

## 10. Phase 7C alert acknowledgement

When the admin production banner is warning or critical:

1. open the **Incidents** tab;
2. inspect the current SLO breach signals and 24-hour history;
3. acknowledge the relevant `production_slo_breached` event with a concrete operator note;
4. mitigate or rollback the underlying problem;
5. wait for server-authoritative `production_slo_recovered`;
6. verify healthy snapshots after recovery.

Acknowledgement means the incident has an operator owner. It **does not** resolve or suppress the underlying SLO condition.

The admin page refreshes incident/SLO state every 60 seconds while visible. External webhook delivery is not currently configured; do not add a destination or secret without an explicit operator-controlled credential and retry policy.

## 11. Phase 7D external alert delivery

The selected production channel is **Telegram** and delivery is currently enabled and verified. If Telegram is deliberately disabled or its token/chat pairing is rotated, repeat the test-and-enable procedure below before relying on the channel.

Telegram activation:

1. create the alert bot with **@BotFather**;
2. store the BotFather token through the trusted operator helper so it goes directly into Supabase Vault;
3. rotate/read the pairing code;
4. from the intended private Telegram account, send `/start <PAIRING_CODE>` to the bot;
5. invoke the dispatcher `telegram_discover` action to discover/store the chat ID;
6. invoke `telegram_test` and confirm the test alert arrived;
7. explicitly enable external delivery only after the test succeeds.

Telegram bot tokens/chat IDs must never be stored in Git, frontend code, audit logs, or GitHub issues.

Generic HTTPS webhook delivery remains available as a fallback path if the channel is later changed back to `webhook`.

Required secret:

- `PRODUCTION_ALERT_WEBHOOK_URL`

Optional secrets:

- `PRODUCTION_ALERT_WEBHOOK_BEARER`
- `PRODUCTION_ALERT_WEBHOOK_SIGNING_SECRET`

Operational rules:

1. never store webhook URLs/tokens/signing secrets in Git, frontend code, SQL migrations, or audit logs;
2. after secret configuration, explicitly enable `private.production_alert_delivery_config.external_enabled`;
3. verify the dispatcher reports configured=true before relying on the external channel;
4. if the webhook URL is missing or invalid, the Edge dispatcher auto-disables external delivery;
5. inspect pending/in-flight/dead-letter counts in the Incident Center;
6. acknowledgement stops future escalation stages but does not mark the SLO recovered;
7. dead-letter rows require operator review; do not repeatedly replay them without understanding the external failure;
8. disabling external delivery does not disable the Phase 7C in-admin alert channel or the ChatGPT SLO watch.

Rollback order for a dispatcher regression:

1. set external delivery disabled;
2. preserve outbox/audit evidence;
3. redeploy the last known-good `production-alert-dispatch` Edge Function;
4. verify internal dispatch-token auth;
5. re-enable only after a successful configuration probe.

## 12. Phase 7E encrypted backup and restore rehearsal

Lootera Free-plan recovery does not rely on a claimed backup that has never been tested.

### Backup

Use `scripts/export-offsite-backup.sh` with:

- a private `SUPABASE_DB_URL`;
- an operator-controlled `BACKUP_AGE_RECIPIENT`;
- a destination outside the Git repository.

The script exports roles/schema/data plus migration history, verifies component checksums, packages the bundle, encrypts it with age, removes raw staging SQL, and writes an outer SHA-256 file.

Database backup does **not** contain Storage object bytes, Edge Function secrets/deployments, Google OAuth configuration, or custom platform settings. Preserve those separately.

### Restore rehearsal

Use `scripts/restore-offsite-backup.sh` only against an isolated destination.

Safety rules:

1. `RESTORE_CONFIRM=LOOTERA_RESTORE_REHEARSAL` is mandatory;
2. the script refuses a destination containing the production project ref;
3. archive checksums must pass;
4. restored cron jobs are unscheduled before verification;
5. external alert delivery is disabled before verification;
6. `scripts/verify-restored-database.sql` must pass before the rehearsal is considered successful;
7. never point restored outbound integrations at production credentials during a rehearsal.

A transaction-only production simulation has validated the verifier/safety logic, but it does **not** count as the required real off-site backup + isolated restore rehearsal.

## 13. Phase 7F go-live abuse controls

Release verification for a mutation-affecting change must include:

- master mutation guard = enabled unless deliberately paused;
- all expected category guardrails enabled;
- ticket idempotent replay test passes;
- Draw Credit integrity remains zero-issue;
- Support duplicate/orphan invariants remain zero;
- Support Edge CORS accepts `lootera.win` and rejects an unrelated hostile Origin;
- private authenticated SECURITY DEFINER exposure remains zero;
- advisor authenticated SECURITY DEFINER count is understood at the current intentional baseline (50 after Phase 7F).

Rate budgets protect successful application writes, not volumetric request floods. Do not treat them as a WAF. Phase 7G load/chaos testing establishes burst and saturation thresholds.

## 14. Phase 7G measured load / chaos thresholds

Measured production run: `429d08d0-d992-4d8d-892b-71dc0f784eda`.

For the tested same-user/same-event ticket contention envelope:

- healthy: p95 < 1,000 ms at <=12 concurrent ticket workers;
- investigate: p95 >=1,000 ms at <=12 concurrent workers;
- immediate stop/rollback: any duplicate debit/ticket, financial residue, Draw Credit mismatch, or unbounded lock wait;
- retain existing database connection warning at 75% and critical at 90%;
- blocked-session critical remains >30 seconds.

The Phase 7G rate-contention probe proved an atomic limit of 5 produced exactly 5 allowed + 7 rejected across 12 simultaneous attempts.

The injected lock waiter timed out at ~250 ms while the holder released at ~900 ms, with no stuck blocker afterward.

Do not interpret these numbers as absolute platform capacity. They are release guardrails for the tested high-contention path.

A live global mutation-kill-switch outage was intentionally not injected into active production. Phase 7F already verifies the kill switch transactionally. Real third-party payment/provider load also belongs in an isolated sandbox.

Historical note: Phase 7G began while the 24-hour SLO window already contained two older `job canceled` cron failures. New Phase 7G acceptance focuses on no failures in the last 15 minutes, all required jobs present, and no new integrity/lock regression.

## 15. Recovery completion

An incident is closed only when:

- the affected feature is working;
- integrity reports pass;
- SLO severity returns to `ok` or the warning is explicitly understood;
- recovery event/notes are recorded;
- root cause and prevention work are tracked.
