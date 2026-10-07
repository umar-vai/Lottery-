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


## Second retirement observation — 2026-10-06

A second 24-hour function-edge log check was completed before Phase 2 closeout.

Observed current endpoint traffic:

- `support-device-admin`: 317 requests
- `claim-support-points`: 2 requests
- `support-phone-bridge`: 1 request

Observed deprecated endpoint traffic:

- `phone-bridge`: **0**
- `bridge-device-admin`: **0**
- `claim-demo-credit`: **0**

Repository caller search again found no active caller for the deprecated names. They are retirement-ready.

Physical deletion is still pending because the connected Supabase tool surface exposes list/get/deploy but not Edge Function deletion. Until a deletion-capable Supabase surface is available, all three production endpoints remain inert `410 Gone` stubs and source control must keep the matching stub code.


## Third retirement observation — 2026-10-07

After the Phase 4 telemetry deployment, repository search and the latest 24-hour `function_edge_logs` were checked again.

Deprecated endpoint traffic:

- `phone-bridge`: **0**
- `bridge-device-admin`: **0**
- `claim-demo-credit`: **0**

No active frontend caller was found. The current endpoints are `support-phone-bridge`, `support-device-admin`, and `claim-support-points`.

The connected Supabase MCP still has no physical Edge Function delete action, so the three deprecated production endpoints remain inert `410 Gone` stubs. This is a tracked infrastructure cleanup item rather than an active application dependency.
