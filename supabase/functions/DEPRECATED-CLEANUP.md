# Deprecated Edge Function cleanup verification

Verified during Phase 1 concurrency/deprecation work on 2026-10-06.

## Caller analysis

Repository search found no active frontend caller for:

- `phone-bridge`
- `bridge-device-admin`
- `claim-demo-credit`

Current support flows reference:

- `support-phone-bridge`
- `support-device-admin`
- `claim-support-points`

## Runtime traffic

The previous 24 hours of Supabase `function_edge_logs` contained traffic for:

- `support-device-admin`
- `claim-support-points`
- `support-phone-bridge`

and **zero invocations** for the three deprecated endpoints above.

## Current production state

All three deprecated endpoints already return HTTP `410 Gone` in production.

This is intentionally safer than silently leaving historical behavior available. The current connector does not expose an Edge Function delete action, so physical deletion was not attempted from ChatGPT.

The sources remain in Git while the deployed 410 stubs exist so source control matches production. They may be physically deleted later through Supabase Dashboard/CLI after an additional no-traffic observation window.
