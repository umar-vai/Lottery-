# Phase 1 — Security & Data Integrity

Phase 1 tightens privileged database access without changing the lottery product behavior.

## Phase 1.1 — profile write hardening

- direct authenticated `UPDATE` access to `public.profiles` is revoked;
- legacy profile column update grants are removed;
- the old own-row UPDATE policy is removed;
- profile name/nickname editing remains available through validated `public.update_my_profile(...)`;
- browser code is blocked by CI from directly updating `profiles`.

## Phase 1.2 — privileged RPC exposure

Two admin `SECURITY DEFINER` functions that were unnecessarily executable by `anon` were restricted:

- `admin_relaunch_lottery_event(uuid)`
- `admin_update_completed_event_metadata(uuid,text,text,text)`

They remain executable by authenticated sessions and enforce `public.is_admin()` inside the RPC.

The two anonymous privileged endpoints that remain are intentional public reads:

- `get_platform_features()`
- `get_public_event_winners(uuid)`

## Phase 1.3 — SECURITY DEFINER + RLS audit

Production privileged functions were enumerated and checked.

Findings:

- every current `SECURITY DEFINER` function under `public` / `private` has an explicit `search_path`;
- every browser-callable `admin_*` RPC performs `public.is_admin()`;
- player mutation RPCs scope to `auth.uid()`;
- service settlement/bootstrap functions are not browser-callable;
- owner-isolation RLS policies exist for profiles, event tickets, Draw Credit ledger, Support wallets, and Support claims;
- audit logs are admin-readable through RLS.

Full audit: `PHASE-1-RPC-RLS-AUDIT.md`.

## Phase 1.4 — least-privilege Data API grants

RLS-only write blocking is no longer the only layer for read-only datasets.

Broad browser write grants are removed from read-only-by-design tables including draw/event catalog data, game history, referral history, support claims, payment-order history, ticket results, and audit logs.

Intentional direct-write exceptions remain:

- `credit_requests`: authenticated INSERT under restrictive RLS;
- legacy `tickets`: authenticated INSERT/UPDATE under legacy ownership rules.

Current `event_tickets` remains RPC-only for mutation.

## Phase 1.5 — secure defaults

Future `public` tables/functions/sequences created by `postgres` no longer automatically receive browser access. Each future migration must explicitly grant only the access it requires.

## Phase 1.6 — database invariant suite

`supabase/tests/phase1_security_invariants.sql` is a read-only regression suite that asserts:

- read-only tables have no browser write grants;
- intentional direct-write exceptions still work;
- profile mutation stays RPC-only;
- every privileged function has explicit `search_path`;
- anonymous `SECURITY DEFINER` exposure stays on the two approved public-read RPCs;
- authenticated admin RPCs enforce `is_admin()`;
- service-only functions stay isolated;
- critical owner RLS policies remain;
- ticket purchasing retains row locking + balance/ticket/ledger atomicity;
- winner selection remains event-local, based on existing tickets, and prize-ledgered.

## CI protection

GitHub Actions runs:

1. `scripts/phase0-smoke.mjs`
2. `scripts/phase1-security.mjs`

before deployment.

The Phase 1 gate also rejects later migrations that reintroduce browser write grants on the audited read-only tables.

## Phase 1.7 — runtime RLS/authorization test

`supabase/tests/phase1_rls_runtime_isolation.sql` runs inside a rollback-only transaction and impersonates the PostgreSQL `authenticated` role with JWT claims.

It verifies that a normal player:

- can read their own profile but not another player's profile;
- cannot see another user's event tickets, Draw Credit ledger, Support wallet, or Support claims;
- cannot read admin audit logs;
- cannot directly update `profiles`;
- is rejected by `admin_set_user_balance(...)`.

It also verifies that a real admin identity is recognized by `public.is_admin()`, can read player/admin data permitted by RLS, but still cannot bypass the RPC-only profile-write rule.

The committed runtime test was executed successfully against production during this Phase 1 audit.

## Phase 1.8 — production Edge Functions source-controlled

All eight currently deployed Edge Functions are mirrored under `supabase/functions/`:

- current support bridge/device/claim functions;
- current Binance Pay create-order/webhook functions;
- legacy phone-bridge/device-admin functions;
- the decommissioned `claim-demo-credit` 410 stub.

`supabase/functions/PRODUCTION-SNAPSHOT.md` records the production version, JWT-verification setting, and bundle SHA-256 observed during the audit.

No live Edge Function was redeployed or behavior-changed during this snapshot. Phase 0 secret scanning now covers the mirrored sources, and the Phase 1 CI gate requires all production entrypoints to stay source-controlled.

## Still remaining in Phase 1

- verify callers and then remove deprecated Edge Functions when safe;
- extend concurrency testing for ticket capacity and duplicate game requests;
- periodically rerun Supabase security advisors after schema changes.
