# Phase 1 — SECURITY DEFINER / RLS Audit

Audit target: production Supabase project for **Lootera / lootera.win** (`mwtlsnneooxmryondrex`).

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

Phase 6 tightened the virtual-credit review path: `public.admin_review_credit_request(...)` is now the canonical authenticated SECURITY DEFINER admin entrypoint, and direct `anon` / `authenticated` / `service_role` EXECUTE on `private.review_credit_request(...)` is revoked. Production classification now shows zero authenticated-executable SECURITY DEFINER functions in the `private` schema.

Phase 7C adds one intentional browser-callable admin SECURITY DEFINER endpoint, `public.admin_acknowledge_production_incident(bigint,text)`. It is executable by `authenticated` only, performs its own `auth.uid() + is_admin()` guard, and writes only the private acknowledgement record plus its audit event. The Supabase advisor authenticated SECURITY DEFINER warning count is therefore expected to be **47** after Phase 7C. This count is not a target to blindly reduce; each browser-callable endpoint must remain justified and guarded.

Phase 7D does not add another browser-callable privileged endpoint. Its three dispatcher RPCs are granted only to `service_role` and also require the independent Vault dispatch token. The authenticated SECURITY DEFINER warning count therefore remains **47**, while authenticated direct execution of private SECURITY DEFINER helpers remains zero. The two new private delivery tables have direct browser/service table grants revoked.

Phase 7F adds exactly three intentional authenticated SECURITY DEFINER public RPCs:

- `admin_get_mutation_guardrails()` — admin-only read, explicit `auth.uid() + is_admin()`;
- `admin_set_mutation_guardrails(...)` — admin-only audited emergency mutation control, explicit `auth.uid() + is_admin()`;
- `purchase_event_ticket_idempotent(...)` — authenticated player endpoint that derives the player from `auth.uid()` and delegates the financial transaction to the existing ticket purchase boundary.

The current authenticated SECURITY DEFINER advisor warning count is therefore expected to be **50** after Phase 7F. Authenticated direct execution of private SECURITY DEFINER functions remains zero.

Phase 7G temporarily used service-role-only probe RPCs protected by the independent dispatch token. After evidence capture, those probe functions were moved out of the public schema into `private` and all `anon`, `authenticated`, and `service_role` EXECUTE grants were revoked. Therefore the browser-callable authenticated SECURITY DEFINER baseline remains **50**, and authenticated direct private SECURITY DEFINER exposure remains zero.

### Authenticated player RPCs

Player-callable privileged functions scope themselves to `auth.uid()` or otherwise derive the current user server-side:

- `claim_referral_code(...)`
- `drop_plinko(...)`
- `drop_plinko_batch(...)`
- `get_my_referral_dashboard()`
- `purchase_event_ticket(...)` — compatibility/core transaction path, now protected by the Phase 7F insert guard
- `purchase_event_ticket_idempotent(...)` — preferred browser path with nonce-based replay safety
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

Phase 1 originally retained two direct-write exceptions. Phase 5 subsequently froze the retired legacy Powerball ticket path after confirming no active browser/REST caller.

Current production state:

- `credit_requests` — authenticated INSERT under a restrictive RLS policy;
- legacy `tickets` — authenticated historical read only; browser INSERT/UPDATE/DELETE grants and write policies removed;
- current `event_tickets` — SELECT-only for authenticated users and RPC-only for mutation.

## Future-object defaults

A Phase 1 migration revokes automatic browser grants for future `public` tables, functions, and sequences created by `postgres`. Future migrations must explicitly grant only the Data API access they need.

## Integrity regression suite

`supabase/tests/phase1_security_invariants.sql` checks:

- read-only table write grants
- intentional direct-write exceptions/boundaries
- profile RPC-only mutation
- explicit `search_path` on privileged functions
- anonymous privileged-function allowlist
- `is_admin()` enforcement on browser-callable admin RPCs
- service-only function isolation
- owner RLS policy presence
- ticket purchase locking + balance/ticket/ledger contract
- event-local existing-ticket winner selection + prize ledger contract

This test is deliberately read-only and rolls back its transaction.
