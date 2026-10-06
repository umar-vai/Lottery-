# Phase 2 — Admin Audit Hardening & Incident Center

## Canonical admin change audit

The existing public `audit_logs` remains the product/system activity feed.

Phase 2 adds a separate private canonical row-change trail at
`private.admin_change_audit`. It is not directly readable by browser roles.

Database triggers capture sensitive admin mutations for:

- player profiles (role and Draw Credit changes),
- lottery events,
- event prize tiers,
- platform controls,
- credit-request reviews,
- Support/Love Point admin adjustments.

For authenticated Data API admin actions the trigger records:

- admin user,
- RPC action,
- affected table and row,
- complete before/after JSON,
- human reason from the `x-admin-reason` request header,
- request path,
- client forwarded IP,
- user agent,
- timestamp.

Support/Love Point adjustments are performed through the protected
`support-device-admin` Edge Function. Those rows already carry
`actor_user_id` and `note`, so the canonical audit mirrors that actor/reason
without relying on a browser JWT.

Legacy clients that do not send a reason remain compatible; their canonical
row is marked `Not supplied by client`. The current admin UI now requests a
reason for high-impact mutations.

## Operations Incident Center

`admin_get_operations_incident_center()` combines current application/database
health into one admin-only report:

- draw cron and overdue/recovery state,
- Draw Credit reconciliation,
- all cron failures in the previous 24 hours,
- failed/error Support Point claims,
- failed/error Binance Pay orders,
- failed/error credit requests,
- recent failure audit events,
- Auth audit event volume when Postgres Auth audit storage is enabled.

Supabase's HTTP-level Auth, PostgREST and Edge Function log streams are platform
logs rather than application tables. They remain available through Supabase log
queries and are intentionally not copied into the database incident table.

## Admin UI

The Control Center includes an Incidents tab with:

- overall healthy/attention status,
- open issue count,
- cron/support/payment/credit failure counters,
- recent incident cards,
- canonical admin changes with actor, reason and before/after snapshots.

The existing Audit tab remains available for the broader product/system audit
feed.
