# Phase 7C — Alert Delivery, Admin Observability & Incident Acknowledgement

Date: 2026-10-07

## Result

Phase 7C connects the Phase 7A/7B production SLO system to the admin operator workflow.

Production now provides:

- admin-only current SLO visibility;
- 24-hour SLO snapshot summary inside the Incident Center;
- recent 7-day SLO breach/recovery events;
- persistent in-admin alert delivery with 60-second polling;
- acknowledgement of SLO breach audit events with operator note and identity;
- an immutable acknowledgement audit entry;
- a prominent alert banner when the current SLO is warning/critical or an active breach still needs acknowledgement.

No arbitrary third-party webhook endpoint or secret was invented.

## 1. Delivery-channel inventory

At Phase 7C deployment:

- Supabase Vault secret names: none;
- `pg_net`: not enabled;
- no dedicated alert-delivery Edge Function existed.

Therefore Phase 7C deliberately implements **admin-panel delivery** rather than silently creating or hardcoding Slack, Telegram, email, Discord, or another external destination.

The existing ChatGPT scheduled SLO watch is separate from the application infrastructure and remains useful as an additional operator notification path.

A future external adapter should use an explicit destination and secret, preferably through Vault, and asynchronous delivery. It must not embed a webhook secret in frontend code or a public repository.

## 2. Incident acknowledgement storage

Private table:

`private.production_incident_acknowledgements`

One row per acknowledged `production_slo_breached` audit event:

- breach audit-log ID;
- acknowledging admin user ID;
- acknowledgement timestamp;
- operator note.

The table is private and is not readable by:

- `PUBLIC`;
- `anon`;
- `authenticated`;
- `service_role`.

Admins interact with it only through the protected RPC.

Acknowledgement means **an operator has seen/owned the incident**. It does not mark the SLO as recovered. Recovery remains server-authoritative through `production_slo_recovered`.

## 3. Admin Incident Center payload

Existing RPC:

`public.admin_get_operations_incident_center()`

was extended rather than adding a second read RPC.

Its existing fields remain available, and Phase 7C adds:

- `production_slo`;
- `slo_history`;
- `slo_events`;
- `pending_slo_ack_count`;
- `unacknowledged_slo_breaches_7d`;
- `alert_delivery`.

The RPC remains protected by the server-side `is_admin()` authorization check.

### Active acknowledgement count

`pending_slo_ack_count` counts unacknowledged `production_slo_breached` events newer than the latest SLO recovery.

That prevents an already recovered historical incident from keeping the global production alert banner permanently active.

Historical unacknowledged breaches are still visible through the 7-day counter/event list.

## 4. Acknowledgement RPC

New RPC:

`public.admin_acknowledge_production_incident(p_audit_log_id bigint, p_note text)`

Rules:

- authenticated admin only;
- target audit row must exist;
- only `production_slo_breached` can be acknowledged;
- note length: 3–500 characters;
- acknowledgement is upserted for the breach event;
- every acknowledgement/update writes a separate `production_slo_acknowledged` audit record.

The private acknowledgement table is never directly exposed to browser roles.

## 5. Admin UI alert delivery

The current admin page loads the enhanced Incident Center payload.

Phase 7C adds:

### Global production alert banner

The banner is hidden while:

- current SLO severity is `ok`; and
- active pending acknowledgement count is zero.

It appears when:

- current SLO is `warning` or `critical`; or
- an active breach still requires acknowledgement.

The banner shows:

- severity;
- breach signal summary;
- pending acknowledgement count;
- one-click navigation to the Incident Center.

### 60-second polling

While the admin page is visible:

`admin_get_operations_incident_center()`

is refreshed every 60 seconds.

Polling pauses when the browser tab/document is hidden.

When severity transitions:

- `ok -> warning/critical`: admin toast alert;
- `warning/critical -> ok`: recovery toast.

The server-side 5-minute SLO checker remains the source of truth. Browser polling only delivers that state to an active operator.

## 6. Incident Center observability panel

The Incident tab now displays:

### Current SLO

- connection usage;
- blocked sessions over 30 seconds;
- idle transactions over 60 seconds;
- table/index cache hit rates;
- cron failures in 15 minutes;
- missing required cron jobs;
- Support integrity count;
- pending acknowledgements;
- current SLO check time.

### 24-hour durable history

- snapshot count;
- OK snapshots;
- warning snapshots;
- critical snapshots;
- unacknowledged breaches in the last 7 days.

### SLO event timeline

For each recent breach/recovery:

- event time;
- severity;
- breached signals;
- acknowledgement status;
- acknowledging admin;
- acknowledgement time/note.

An unacknowledged breach has an **Acknowledge** action.

## 7. External alert delivery status

Current production response explicitly reports:

- admin polling: 60 seconds;
- external webhook configured: false.

This is intentional.

Do not enable `pg_net`, create Vault secrets, or deploy an outbound notification function until there is a real destination/credential and an agreed failure/retry policy.

When external delivery is added, it should preserve the existing database/audit signal so external-provider failure cannot erase the incident itself.

## 8. Runtime contract

`supabase/tests/phase7c_incident_alerting.sql`

runs inside a transaction and rolls back.

It proves:

- admin can acknowledge a breach;
- acknowledgement persists in the private table during the transaction;
- an acknowledgement audit row is written;
- a second unacknowledged active breach is surfaced;
- observability payload contains current SLO/history/events/delivery metadata;
- event acknowledgement state is returned correctly;
- private acknowledgement storage is not directly readable;
- unintended roles cannot execute the acknowledgement RPC;
- non-admin cannot read the enhanced Incident Center or acknowledge a breach.

## 9. Operational workflow

When the banner reports a production warning/critical state:

1. open Incidents;
2. inspect the SLO signals and current metrics;
3. acknowledge the breach with a useful operator note;
4. follow `RELEASE-ROLLBACK-RUNBOOK.md` if the issue is release-related;
5. repair/rollback the underlying problem;
6. wait for server-authoritative SLO recovery;
7. confirm `production_slo_recovered` and healthy snapshots;
8. record prevention/follow-up work.

Acknowledgement is never a substitute for recovery.
