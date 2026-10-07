# Phase 8B — Operator Sign-Off & Stabilization Exit Gate

Date: 2026-10-07  
Product: **Lootera**  
Primary domain: **lootera.win**

## Status

Phase 8B is **active**.

Current production state at implementation:

- Phase 8B exit state: `stabilizing`
- technical state: **READY**
- production SLO: **OK**
- Draw Credit integrity: **0 issues**
- launch snapshots observed at implementation: **5 READY / 0 WARNING / 0 BLOCKED**
- unresolved warning snapshots: **0**
- final operator decision: **pending**
- required operator decisions: **2 outstanding**
- fully signed off: **false**

The stabilization window still ends at:

**2026-10-10 10:32:08 UTC**

Phase 8B cannot become fully signed off before that time.

## What Phase 8B adds

Phase 8B converts the Phase 8 operator-exception notes into a server-authoritative exit workflow.

New private tables:

- `private.production_launch_operator_signoffs`
- `private.production_launch_warning_dispositions`
- `private.production_launch_exit_signoff`

All three tables:

- have RLS enabled;
- have no permissive browser policy;
- revoke direct table access from `anon`, `authenticated`, and `service_role`.

New private reports:

- `private.production_launch_operator_signoff_report()`
- `private.production_launch_exit_report()`

Direct execution is revoked from `anon`, `authenticated`, and `service_role`.

New authenticated admin-only RPCs:

- `public.admin_record_launch_operator_signoff(text,text,text)`
- `public.admin_disposition_launch_warning(bigint,text)`
- `public.admin_finalize_launch_stabilization(text,text)`

Every RPC requires `auth.uid()` plus `public.is_admin()`, and every decision is written to the canonical audit log.

## Exit-state model

`private.production_launch_exit_report()` returns one of:

- `stabilizing` — the 72-hour window is still active;
- `blocked` — the window has ended but one or more exit requirements remain unresolved;
- `ready_for_signoff` — all technical and operator requirements are satisfied and final approval can be recorded;
- `signed_off` — the final operator approval has been recorded;
- `held` — an operator explicitly held the exit.

Final approval is rejected while the real 72-hour window is active.

## Exit criteria

Before `ready_for_signoff`, all of the following must be true:

1. the stabilization window has completed;
2. current technical state is READY;
3. there are zero blocked launch snapshots;
4. every warning snapshot has a documented disposition;
5. every required operator exception has an explicit decision.

A required operator item is considered explicitly decided only when an authenticated admin records one of:

- `completed`
- `accepted_risk`
- `deferred`

with a meaningful note, actor identity, and timestamp.

An `outstanding` item remains blocking.

## Warning-review queue

Every warning snapshot inside the launch window must be reviewed.

The Phase 8B report exposes unresolved warning snapshot IDs, timestamps, and SLO breach signals. The admin can then record a disposition through:

`admin_disposition_launch_warning(...)`

A warning is not silently ignored merely because current health later returns to green.

## Operator exception register

### Issue #61 — encrypted off-site backup + isolated restore rehearsal

Current status: **outstanding**

The repository contains hardened export/restore tooling, but a real rehearsal still requires operator-controlled material:

- private production `SUPABASE_DB_URL`;
- age recipient/private identity;
- encrypted off-site storage;
- actual `event-covers` object-byte backup;
- an isolated non-production restore destination.

Current Storage inventory remains:

- bucket: `event-covers`
- objects: **2**
- object bytes: **128,912**

This requirement cannot be falsely marked complete by a transaction-only test.

### Issue #59 — physical deletion of retired Edge stubs

Current status: **outstanding**

Retired stubs still physically deployed:

- `phone-bridge` v4
- `bridge-device-admin` v4
- `claim-demo-credit` v5

Current replacements remain deployed:

- `support-phone-bridge` v6
- `support-device-admin` v7
- `claim-support-points` v6

The connected Supabase capability exposes list/get/deploy but not Edge Function deletion, so Phase 8B does not pretend these stubs were deleted.

Latest 24-hour `function_edge_logs` evidence:

- retired `phone-bridge`: **0 invocations**
- retired `bridge-device-admin`: **0 invocations**
- retired `claim-demo-credit`: **0 invocations**
- current `support-phone-bridge`: **2 invocations**
- current `support-device-admin`: **5 invocations**
- current `claim-support-points`: **0 invocations**
- current `production-alert-dispatch`: **9 invocations**

The absence of retired traffic supports deletion readiness; it is not proof of physical deletion.

### Issue #59 — leaked-password protection

Current status: **conditional / not required for the current exit**

Production remains Google-only under the recorded auth model. The security advisor still reports one leaked-password-protection warning.

This must be revisited if:

- email/password auth is introduced; or
- plan/auth capabilities change such that the protection becomes applicable.

## Security baseline after Phase 8B

Phase 8B adds exactly three authenticated admin-only SECURITY DEFINER RPCs.

Current expected surface:

- authenticated public SECURITY DEFINER: **53**
- anonymous public SECURITY DEFINER: **2**
- authenticated direct private SECURITY DEFINER: **0**

Current advisor summary:

- `authenticated_security_definer_function_executable`: **53 WARN**
- `anon_security_definer_function_executable`: **2 WARN**
- `rls_enabled_no_policy`: **11 INFO**
- `extension_in_public`: **1 WARN**
- `auth_leaked_password_protection`: **1 WARN**

The new authenticated RPCs are intentional admin entrypoints with explicit admin checks; their private backing tables/reports remain directly inaccessible.

## Runtime contract

`supabase/tests/phase8b_operator_signoff.sql` is rollback-only and passed against production.

It verifies:

- initial real state is `stabilizing`;
- private table/function isolation;
- admin RPC grants;
- SECURITY DEFINER baselines 53 / 2 / 0;
- operator decisions are aggregated correctly;
- a synthetic warning enters the unresolved review queue;
- warning disposition clears that queue;
- approval is rejected while the real window is active;
- after a transaction-local simulated window completion, the gate reaches `ready_for_signoff`;
- final approval reaches `signed_off`;
- operator, warning, and final decisions create audit records;
- all simulated state is rolled back.

## Admin Incident Center

Admin → Incidents now includes **Phase 8B · Operator Sign-Off**.

The panel displays:

- exit state;
- technical state;
- pre-signoff readiness;
- full sign-off state;
- required and outstanding operator decisions;
- warning review counts;
- final operator decision;
- window end time;
- gate reasons.

For each required operator item, the admin can record:

- Complete
- Accept risk
- Defer
- Reset to outstanding

For unresolved warning snapshots, the panel provides a disposition action.

The final **Approve final sign-off** control remains disabled until the server reports `pre_signoff_ready=true`.

## Current go/no-go interpretation

Technical operation is green, but Phase 8B is **not complete**.

Current blockers to final sign-off are:

1. the 72-hour window is still active;
2. Issue #61 remains outstanding;
3. Issue #59 retired-stub deletion remains outstanding.

These operator dependencies may later be completed, explicitly accepted, or deferred by an authenticated admin with a recorded reason. They cannot be silently removed from the exit gate.

## Completion

Phase 8B is complete only when the server reports:

`exit_state = signed_off`

That requires the real window to have ended and the final authenticated operator approval to be recorded after every exit criterion passes.


## Operator completion kit

Phase 8B now includes guarded scripts for both outstanding required operator items:

- `scripts/phase8b-delete-retired-edge-stubs.sh`
- `scripts/phase8b-complete-offsite-rehearsal.sh`

The Edge cleanup helper uses the current documented Supabase CLI `functions delete` flow, requires explicit operator confirmation, verifies all replacement functions before deletion, and verifies the retired stubs are absent afterward.

The off-site rehearsal helper extends the existing Phase 7E database backup/restore tooling with a real `event-covers` object-byte backup through Supabase's S3-compatible Storage endpoint. It compares source S3 count/bytes, database Storage metadata, and downloaded local count/bytes before encrypting the Storage archive. It then invokes the isolated restore verifier and writes a checksum-bearing evidence manifest.

These helpers make #59 and #61 repeatable and auditable, but they do not bypass operator-owned credentials or physical deletion/restore execution. A requirement must remain `outstanding` until its corresponding helper actually passes and the evidence is retained.
