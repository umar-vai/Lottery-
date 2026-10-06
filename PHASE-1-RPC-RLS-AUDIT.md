# Phase 1 — SECURITY DEFINER / RLS Audit

Audit target: production Supabase project `Lottery DRAW01`.

## SECURITY DEFINER findings

Every current `SECURITY DEFINER` function in the `public` and `private` schemas has an explicit `search_path`.

### Public anonymous surface

Only two privileged functions intentionally remain executable without login:

- `get_platform_features()` — public feature-state read
- `get_public_event_winners(uuid)` — public completed-winner read

Both are read-only endpoints required by the logged-out website.

### Authenticated admin RPCs

Current browser-callable `admin_*` functions are executable by `authenticated`, but every one performs a server-side `public.is_admin()` authorization check before mutation. This is intentional: Supabase does not create a separate PostgreSQL role for each application admin account, so application admin authorization is enforced inside the privileged RPC.

Legacy draw-admin functions that are not used by the current browser admin are already service-role-only.

### Authenticated player RPCs

Player-callable privileged functions scope themselves to `auth.uid()` or otherwise derive the current user server-side:

- `claim_referral_code(...)`
- `drop_plinko(...)`
- `drop_plinko_batch(...)`
- `get_my_referral_dashboard()`
- `purchase_event_ticket(...)`
- `spin_slot(...)`
- `update_my_profile(...)`
- `is_admin()` (read-only authorization helper)

### Service-only functions

Support/payment settlement functions and the auth bootstrap trigger are not executable by `anon` or `authenticated`.

## RLS findings

Critical owner-isolation policies are present for:

- `profiles`
- `event_tickets`
- `balance_ledger`
- `support_wallets`
- `support_claim_requests`

`audit_logs` is readable only through an admin RLS policy.

## Least-privilege grant cleanup

The audit found several tables whose RLS policies were read-only but whose PostgreSQL table grants still included broad write privileges inherited from older/default Supabase grants.

Phase 1 removes browser-role write grants from:

- `audit_logs`
- `binance_pay_orders`
- `draw_events`
- `draws`
- `event_prize_tiers`
- `game_settings`
- `games`
- `love_point_payment_providers`
- `plinko_drops`
- `referral_rewards`
- `referrals`
- `slot_spins`
- `support_claim_requests`
- `ticket_results`

Intentional direct-write exceptions remain:

- `credit_requests` — authenticated INSERT under a restrictive RLS policy
- legacy `tickets` — authenticated INSERT/UPDATE under legacy ownership/RLS rules

Current multi-event tickets remain RPC-only: `event_tickets` is SELECT-only for authenticated users.

## Future-object defaults

A Phase 1 migration revokes automatic browser grants for future `public` tables, functions, and sequences created by `postgres`. Future migrations must explicitly grant only the Data API access they need.

## Integrity regression suite

`supabase/tests/phase1_security_invariants.sql` checks:

- read-only table write grants
- intentional direct-write exceptions
- profile RPC-only mutation
- explicit `search_path` on privileged functions
- anonymous privileged-function allowlist
- `is_admin()` enforcement on browser-callable admin RPCs
- service-only function isolation
- owner RLS policy presence
- ticket purchase locking + balance/ticket/ledger contract
- event-local existing-ticket winner selection + prize ledger contract

This test is deliberately read-only and rolls back its transaction.
