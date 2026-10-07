# Phase 7D — External Alert Delivery & Escalation

Date: 2026-10-07

## Result

Phase 7D adds a production-safe external notification pipeline on top of the Phase 7A–7C SLO system.

The engineering path is live, but **third-party delivery is intentionally disabled** until a real HTTPS webhook destination is configured as an Edge Function secret.

Production now has:

- a durable private alert outbox;
- first-alert de-duplication per active SLO incident;
- acknowledgement/recovery cancellation of pending escalations;
- critical/warning escalation timers;
- retry with bounded backoff;
- dead-letter handling;
- a one-minute internal dispatcher cron;
- a custom-authenticated Edge Function dispatcher;
- optional bearer and HMAC signing for the external webhook;
- alert-delivery health inside the SLO report and admin Incident Center;
- retention for delivered/cancelled/dead-letter rows.

No external URL, bearer token, or signing secret is committed to Git.

## 1. Current activation state

Current production state after deployment:

- external delivery: **disabled**;
- dispatcher Edge Function: deployed and active;
- internal dispatcher authentication: working;
- `pg_net`: enabled;
- dispatcher cron: active;
- webhook destination secret: not configured;
- outbox rows at baseline: 0;
- dead letters at baseline: 0;
- overall production SLO: OK.

A safe internal probe invoked the Edge Function with the Vault dispatch token. It returned HTTP 200 with:

- `configured=false`;
- `disabled=true`;
- no external delivery attempt.

The database therefore correctly records the missing webhook configuration without sending traffic to a third party.

## 2. Internal authentication

The database generates a random 32-byte dispatch token during migration.

The plaintext token is stored only in Supabase Vault under:

`production_alert_dispatch_token`

The private config stores only its SHA-256 hash.

The dispatcher cron reads the plaintext from Vault at call time and sends it in:

`x-alert-dispatch-token`

The Edge Function passes that token to service-role-only RPCs, which compare it against the stored hash.

Browser roles cannot read the Vault token, config table, or outbox.

## 3. Durable outbox

Private table:

`private.production_alert_outbox`

Delivery kinds:

- `initial`
- `escalation_1`
- `escalation_2`
- `recovery`

States:

- `pending`
- `in_flight`
- `delivered`
- `dead_letter`
- `cancelled`

The unique key `(audit_log_id, delivery_kind)` makes each stage idempotent.

## 4. Incident de-duplication

The SLO checker can create repeated `production_slo_breached` audit rows while a condition remains active.

External delivery does not send every repeated breach row.

For one active SLO incident:

1. the first breach after the latest recovery becomes the initial external alert;
2. escalation stages anchor to that active breach;
3. acknowledgement cancels pending escalation stages;
4. recovery cancels pending escalation stages and creates one recovery alert;
5. a later breach after recovery starts a new external incident lifecycle.

## 5. Escalation policy

Default thresholds:

- **Critical**: escalation level 1 after 5 minutes unacknowledged.
- **Warning**: escalation level 1 after 15 minutes unacknowledged.
- **Level 2**: after 30 minutes unacknowledged.

These values live in the private delivery config and are visible read-only through the admin Incident Center.

Acknowledgement stops future escalation stages but does not mark the SLO recovered.

## 6. Retry policy

Maximum attempts: 6.

After a failed webhook attempt, the retry delays are:

1. 1 minute
2. 2 minutes
3. 5 minutes
4. 15 minutes
5. 30 minutes
6. final failure becomes `dead_letter`

An `in_flight` row older than 5 minutes is automatically returned to `pending` before the next dispatch attempt.

Successful responses require HTTP 2xx.

## 7. Edge Function

Function:

`production-alert-dispatch`

The function uses custom dispatch-token authentication, so platform `verify_jwt=false` is intentional.

It is not a browser endpoint.

Responsibilities:

1. validate internal dispatch authentication;
2. require a valid HTTPS webhook URL;
3. claim at most 10 due outbox rows;
4. POST a standardized JSON alert to the configured webhook;
5. optionally add bearer authentication;
6. optionally add an HMAC SHA-256 signature;
7. apply an 8-second external request timeout;
8. report success/failure back to the database;
9. allow the database to schedule retries or dead-letter rows.

If the required webhook URL is missing/invalid, the function records the configuration error and auto-disables external delivery.

## 8. Edge Function secrets for activation

Required:

`PRODUCTION_ALERT_WEBHOOK_URL`

It must be an HTTPS URL.

Optional:

`PRODUCTION_ALERT_WEBHOOK_BEARER`

Adds:

`Authorization: Bearer <secret>`

Optional:

`PRODUCTION_ALERT_WEBHOOK_SIGNING_SECRET`

Adds:

`x-draw01-signature: sha256=<HMAC-SHA256>`

Secrets must be configured in Supabase Edge Function secrets management or with the Supabase CLI. Never commit them to this repository.

After secrets are configured, an operator must explicitly enable:

`private.production_alert_delivery_config.external_enabled = true`

The next dispatcher run verifies the Edge configuration. If the required URL is still missing, the dispatcher auto-disables delivery.

## 9. Dispatcher cron

Job:

`production-alert-dispatch-minute`

Schedule:

`* * * * *`

The job:

1. requeues stale `in_flight` rows;
2. evaluates escalation timers;
3. exits without HTTP work when external delivery is disabled;
4. exits when no alert is due;
5. reads the internal dispatch token from Vault;
6. invokes the Edge Function through `pg_net`.

The job is now part of the required production cron SLO contract.

## 10. Self-monitoring

`private.production_alert_delivery_report()` exposes internally:

- enabled state;
- dispatcher configuration state;
- pending/in-flight/dead-letter counts;
- alerts delivered in 24 hours;
- pending rows overdue by more than 10 minutes;
- dispatcher cron state;
- last dispatch/delivery timestamps;
- last error;
- escalation/retry policy.

The production SLO adds warnings for:

- delivery enabled while dispatcher configuration is unverified;
- any dead-letter row;
- any pending delivery overdue by more than 10 minutes.

External delivery being intentionally disabled is **not** itself an SLO breach because the Phase 7C admin alert channel and scheduled ChatGPT watch remain available.

## 11. Admin UI

The Incident Center shows:

- external delivery Enabled/Disabled;
- webhook Verified/Not configured;
- pending and in-flight queue counts;
- dead-letter count;
- delivered alerts in the last 24 hours;
- dispatcher cron status;
- last successful delivery;
- escalation timings;
- maximum retry attempts.

There is intentionally no browser control to set webhook secrets.

## 12. Retention

Operational retention now also removes:

- delivered/cancelled alert rows after 30 days;
- dead-letter rows after 90 days.

Pending/in-flight rows are never age-pruned.

## 13. Security advisor classification

Phase 7D adds no browser-callable admin SECURITY DEFINER RPC.

The authenticated SECURITY DEFINER advisor count therefore remains **47**.

The new dispatcher RPCs are service-role-only and also require the independent dispatch token.

Two private tables have RLS enabled with no policies. That is intentional deny-by-default defense in depth; direct grants to `anon`, `authenticated`, and `service_role` are revoked.

The advisor also reports `pg_net` extension placement. Supabase's current documented enablement is `create extension pg_net;`, and Phase 7D does not relocate a live networking extension without a verified supported migration path.

## 14. Remaining operator action

To make third-party delivery actually send messages, a real webhook destination/credential must be supplied through Supabase Edge Function secrets.

Until then:

- the dispatcher architecture is live;
- external delivery remains disabled;
- there is no notification spam;
- no secret is exposed;
- admin/SLO monitoring remains healthy.
