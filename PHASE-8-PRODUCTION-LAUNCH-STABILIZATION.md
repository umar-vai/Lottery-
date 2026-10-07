# Phase 8 — Production Launch & Post-Launch Stabilization

Date: 2026-10-07  
Product: **Lootera**  
Primary product domain: **lootera.win**

## Status

Phase 8 establishes a server-authoritative launch-readiness model and a **72-hour production stabilization window**.

The engineering state at activation is:

- technical state: **READY**
- launch decision: **technical_go_operator_signoff_required**
- production SLO: **OK**
- Draw Credit integrity: **0 issues**
- Support duplicate/orphan invariants: **0**
- mutation guardrails: **all enabled**
- Telegram production alerts: **enabled + ready**
- privileged-surface baseline: unchanged
- first Phase 8 snapshot: **READY**

The 72-hour observation period itself is not considered complete until the window expires and the final evidence is reviewed.

## Stabilization window

Baseline Git commit:

`a04a30d7d3841a778382a0e43893d31c3421f131`

Production window:

- start: **2026-10-07 10:32:08 UTC**
- end: **2026-10-10 10:32:08 UTC**
- duration: **72 hours**

Private cron:

`production-launch-stability-15m`

Schedule:

`*/15 * * * *`

The job captures launch-readiness evidence every 15 minutes during the active window. After the window expires, the capture function stops creating snapshots and marks the launch window completed.

## Phase 8 SLO correction

Phase 8 found a stabilization bug in the existing SLO logic.

The 24-hour cron-failure count used every row in `cron.job_run_details`, including historical rows for jobs that had already been deleted. Two old one-off jobs had been canceled at approximately 08:01 and 08:04 UTC and no longer existed in `cron.job`, but they kept current production in a warning state.

Phase 8 changes both:

- `private.production_slo_report()`
- `private.operations_incident_report()`

so cron failure counts only include **currently active cron jobs**.

Required-job disappearance is still detected independently by the existing required-cron inventory, so deleting a required live job remains a critical SLO breach.

After this correction:

- active cron failures · 15m: **0**
- active cron failures · 24h: **0**
- required cron missing: **0**
- SLO severity: **OK**
- current open application/database incidents: **0**

Historical audit rows remain available as history; they are not mislabeled as current open incidents.

## Launch readiness inputs

`private.production_launch_readiness_report()` combines:

1. production SLO severity;
2. Draw Credit integrity;
3. Support duplicate/orphan/expired-pending checks through the SLO;
4. all Phase 7F mutation guardrails;
5. Telegram dispatcher readiness and dead-letter state;
6. anonymous privileged function allowlist;
7. private authenticated privileged-function exposure;
8. presence of at least one published lottery.

State model:

- `ready` — no technical blocker/warning;
- `warning` — no critical blocker, but a launch warning exists;
- `blocked` — technical launch blocker exists.

Decision model:

- `technical_go_operator_signoff_required`
- `hold_for_warning`
- `no_go`

## Private launch evidence

New private tables:

- `private.production_launch_stability_config`
- `private.production_launch_stability_snapshots`

Both are RLS-enabled and direct `anon`, `authenticated`, and `service_role` table access is revoked.

New private functions:

- `private.production_launch_readiness_report()`
- `private.capture_production_launch_stability_snapshot()`
- `private.production_launch_stability_report()`

All direct execution is revoked from browser/API roles and service_role.

Launch snapshots are retained for 30 days through the existing operational-history retention function.

## Incident Center

The existing admin-only `admin_get_operations_incident_center()` now includes:

`launch_stability`

The Admin → Incidents UI displays a new **Phase 8 · Launch Stabilization** panel showing:

- technical readiness;
- launch decision;
- window status/end;
- snapshot counts;
- ready/warning/blocked counts;
- maximum observed connection usage;
- maximum blocked-session count;
- published lottery count;
- operator exceptions.

No new browser-callable privileged RPC was added.

## Initial 24-hour HTTP baseline

Supabase unified edge logs at Phase 8 activation:

- total HTTP requests: **2,586**
- HTTP 4xx: **12**
- HTTP 5xx: **0**
- 5xx rate: **0%**
- p95 origin latency: **378 ms**
- max observed origin latency: **1,192 ms**

This remains comfortably inside the existing release rollback thresholds.

Phase 7G's measured high-contention ticket guardrail remains:

- <=12 same-user/same-event concurrent workers
- launch target p95 < **1,000 ms**
- observed Phase 7G 12-worker p95: **793.56 ms**

## Telegram recovery verification

Correcting the stale cron warning caused `run_production_slo_check()` to emit a production recovery event.

The durable external-alert outbox created one recovery delivery.

Verified result:

- status: delivered
- attempt: 1
- last error: none
- Telegram pending: 0
- Telegram in-flight: 0
- dead letters: 0
- delivered count in rolling 24h increased to 6

This validates the recovery notification path during launch activation.

## Security baseline after Phase 8

No new browser privileged RPC was added.

Expected advisor state:

- anonymous SECURITY DEFINER warnings: **2** intentional;
- authenticated SECURITY DEFINER warnings: **50** intentional;
- authenticated direct private SECURITY DEFINER exposure: **0**;
- `rls_enabled_no_policy` INFO: **8** because the two new private launch tables intentionally use deny-by-default RLS;
- `extension_in_public`: 1 existing pg_net warning;
- leaked-password protection warning: 1 existing conditional warning;
- unused-index INFO findings remain evidence-dependent and are not blindly removed.

## Operator sign-off exceptions

Technical readiness is green, but Phase 8 intentionally does not hide operator-owned recovery/security tasks.

### Issue #61 — real encrypted off-site backup + isolated restore rehearsal

Status: **outstanding**

The backup/restore tooling is ready, but a real production export, encrypted off-site transfer, and isolated restore rehearsal require operator-controlled credentials, age keys, storage and a separate restore destination.

This is represented as:

`operator_signoff_required`

It must not be falsely marked complete.

### Issue #59 — physical deletion of retired Edge stubs

Status: **outstanding**

The legacy inert functions still need a deletion-capable Supabase Dashboard/CLI surface:

- `phone-bridge`
- `bridge-device-admin`
- `claim-demo-credit`

The connected Supabase surface available during Phase 8 exposes list/get/deploy but not function deletion.

Current replacements remain active and must not be deleted.

### Issue #59 — leaked-password protection

Status: **conditional**

Current production authentication is Google-only and the project is on the Free plan. There are no email/password users in the recorded Phase 7E inventory.

Revisit immediately if:

- email/password authentication is enabled; or
- the project moves to a plan where the control is available/required.

## Domain verification note

Repository/source inspection confirms Lootera branding, but no `CNAME` file was found in the repository.

Current Supabase traffic samples showed browser referers from the GitHub Pages origin.

External probes to both the custom domain and Pages URL were inconclusive from the available web environment, so Phase 8 does **not** claim that the custom-domain DNS/HTTPS mapping has been independently verified here.

Before a public campaign that explicitly sends users to `lootera.win`, verify:

- DNS records;
- GitHub Pages custom-domain configuration;
- HTTPS certificate state;
- redirect/canonical behavior;
- OAuth redirect URLs for the final public origin.

## 72-hour exit criteria

The stabilization window can be signed off only after the end time if:

- no critical launch snapshot exists;
- technical readiness remains READY at exit;
- Draw Credit issue total remains 0;
- Support duplicate/orphan counts remain 0;
- required cron missing remains 0;
- no new active-cron failure remains unresolved;
- connection pressure remains below critical thresholds;
- no blocker remains >30 seconds;
- Telegram remains ready with zero dead letters;
- mutation guardrails remain fully enabled unless intentionally paused for a documented incident;
- any warning snapshot has a documented cause and disposition;
- operator exceptions are explicitly accepted, completed, or deferred with an owner.

## Scope

Phase 8 is technical launch stabilization, not a claim that every business/legal/operator dependency is complete.

The product remains the current virtual-credit simulation/testing system described in the public terms. Any move toward regulated real-money lottery activity requires a separate legal, licensing, age/identity, payment and jurisdiction readiness program.


## Phase 8B continuation

Phase 8B adds the explicit operator-decision registry, warning-disposition queue, and final stabilization exit gate described in `PHASE-8B-OPERATOR-SIGNOFF.md`.

The Phase 8 technical evidence remains the source for launch health. Phase 8B does not rewrite historical snapshots or falsely mark manual dependencies complete. After Phase 8B the expected authenticated public SECURITY DEFINER baseline is **53**, anonymous public allowlist remains **2**, and authenticated direct private SECURITY DEFINER exposure remains **0**.
