# Phase 7F — Production Go-Live & Abuse Hardening

Date: 2026-10-07  
Product: **Lootera**  
Domain: **lootera.win**

## Result

Phase 7F adds database-enforced emergency mutation controls, successful-mutation rate budgets, browser ticket-purchase idempotency, and production-domain Edge CORS hardening.

The goal is to make ordinary replay, double-click, accidental duplicate submission, runaway clients and basic application-layer abuse materially safer before load/chaos testing.

## 1. Emergency mutation guardrails

Private control:

`private.production_mutation_guardrails`

Protected categories:

- ticket purchases;
- game writes;
- support claims;
- credit requests;
- referral writes;
- payment orders.

There is also a global master switch.

The master switch is deliberately independent of the existing product-feature controls. It is an emergency **write stop**, not a content/navigation feature flag.

Admin RPCs:

- `admin_get_mutation_guardrails()`
- `admin_set_mutation_guardrails(...)`

Both are authenticated SECURITY DEFINER surfaces with an explicit server-side admin check.

Every guardrail update writes:

`production_mutation_guardrails_updated`

to the audit log with actor and reason.

## 2. Database-enforced successful-mutation budgets

Private state:

`private.mutation_rate_limit_windows`

Limits:

| Mutation | Budget |
| --- | --- |
| Ticket purchase | 20 / minute / user |
| Slot spin | 240 / minute / user |
| Plinko drop | 900 / minute / user |
| Credit request | 6 / hour / user |
| Support claim request | 30 / hour / user |
| Support point claim | 60 / hour / user |
| Payment order | 12 / hour / user |
| Referral join | 3 / day / referred user |

These checks run in **database BEFORE INSERT triggers**, so they also protect old compatible RPC paths and server functions that ultimately write the same tables.

The counters use an atomic upsert on:

`(user_id, bucket, window_epoch)`

so concurrent successful mutations cannot independently read the same stale count.

Old windows are retained for 2 days and then removed by the existing daily operational-history retention job.

### Important boundary

This is **not a Layer-7 DDoS/WAF replacement**.

A request that fails before a protected insert may roll back its transaction-local rate counter. Therefore these budgets protect successful financial/application mutations, not arbitrary network request floods.

Platform-level request throttling, CDN/WAF controls and load testing belong to the next load/chaos stage.

## 3. Ticket purchase idempotency

New browser RPC:

`purchase_event_ticket_idempotent(p_event_id, p_white_numbers, p_bonus_ball, p_client_nonce)`

Private replay map:

`private.ticket_purchase_idempotency`

The browser generates one UUID nonce for the selected ticket request and keeps the same nonce if the request has to be retried.

The server:

1. locks `user + nonce` with a transaction advisory lock;
2. checks whether that nonce already completed;
3. rejects reuse of the nonce with a different event/number payload;
4. runs the existing transaction-safe `purchase_event_ticket(...)` exactly once;
5. stores the ticket ID and resulting balance;
6. replays the original ticket/balance on retry without a second debit.

The existing `purchase_event_ticket(...)` remains callable for cached/legacy clients, but its successful insert still passes through the Phase 7F ticket guardrail/rate trigger.

## 4. Browser behavior

`event.js` now calls the idempotent RPC.

The nonce is reset only when:

- the number selection changes;
- Quick Pick changes the selection; or
- the purchase succeeds.

A network/server error with the same selection keeps the same nonce, allowing a safe retry if the first request actually committed but its response was lost.

## 5. Admin emergency UI

The Incident Center now includes **Emergency Mutation Guardrails**.

It shows:

- master write state;
- ticket/game/support/credit/referral/payment category state;
- last change timestamp/reason.

Admins can:

- **Pause all user mutations**
- **Resume user mutations**

Both actions require an operational reason and are server-authorized/audited.

The 60-second operations poll refreshes guardrail state together with incident/SLO data.

## 6. Edge auth/CORS hardening

Current production Edge functions were re-audited.

### JWT-protected

- `support-device-admin`
- `claim-support-points`

Both still require valid user JWTs. The admin function also independently verifies the user has the admin role.

### Custom-token protected

- `support-phone-bridge` — `verify_jwt=false` intentionally, but requires its per-device bridge token.
- `production-alert-dispatch` — `verify_jwt=false` intentionally, but requires the independent internal dispatch token.

### CORS

The three Support Edge functions now allow:

- `https://lootera.win`
- `https://www.lootera.win`
- `https://umar-vai.github.io`
- localhost for development.

Requests with a non-empty disallowed Origin are explicitly rejected.

Production probe:

- Origin `https://lootera.win` reached bridge authentication and returned expected **401 Bridge token required** with `Access-Control-Allow-Origin: https://lootera.win`.
- Origin `https://evil.example` returned **403 Origin not allowed** and `Access-Control-Allow-Origin: null`.

The native phone bridge can still call without an Origin header.

## 7. Edge deployments

Phase 7F deployments:

- `support-phone-bridge` → version 6, ACTIVE, custom bridge-token auth.
- `support-device-admin` → version 7, ACTIVE, JWT verification on.
- `claim-support-points` → version 6, ACTIVE, JWT verification on.
- `production-alert-dispatch` remains the existing custom-token internal channel.

## 8. Security surface

Phase 7F adds exactly three authenticated SECURITY DEFINER public RPCs:

1. `admin_get_mutation_guardrails()`
2. `admin_set_mutation_guardrails(...)`
3. `purchase_event_ticket_idempotent(...)`

The advisor authenticated SECURITY DEFINER count therefore moves from 47 to **50**.

The two admin RPCs require `is_admin()`. The ticket RPC requires an authenticated user and only performs a purchase for `auth.uid()`.

Authenticated direct execution of private SECURITY DEFINER helpers remains expected to be zero.

The new private tables are RLS-enabled, have no permissive policies and have direct grants revoked. Advisor “RLS enabled, no policy” INFO entries are therefore intentional deny-by-default.

## 9. Performance advisor

Two FK indexes introduced by the Phase 7F private tables are explicitly covered:

- `production_mutation_guardrails_updated_by_idx`
- `ticket_purchase_idempotency_event_id_idx`

No 7-day-evidence-dependent existing index is removed.

## 10. Runtime contract

`supabase/tests/phase7f_abuse_hardening.sql` verifies in a rollback-only transaction:

- all 8 mutation guard triggers exist;
- private tables are not browser-readable;
- the idempotent ticket RPC is authenticated-only;
- a two-operation budget accepts the first two and rejects the third;
- same nonce + same ticket request returns the same ticket/balance with `duplicate=true`;
- exactly one ticket and one purchase ledger debit exist;
- same nonce + different payload is rejected;
- emergency master pause blocks the compatible legacy ticket RPC;
- blocked purchase does not change the player balance;
- guardrail state can be restored by admin;
- non-admin guardrail read is rejected;
- old mutation-rate windows are pruned after 2 days.

## 11. What Phase 7F does not claim

Phase 7F does not claim full volumetric/DDoS protection.

Remaining work for Phase 7G:

- concurrent load across ticket/game/support/payment paths;
- database saturation/connection-pool tests;
- slow-request and timeout behavior;
- controlled Edge/API burst tests;
- failover/recovery drills;
- rollback under injected failure;
- evidence-based final go-live capacity thresholds.
