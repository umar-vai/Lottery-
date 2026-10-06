# Phase 1 — Security & Data Integrity

Phase 1 starts by tightening the highest-risk writable user record and reducing unnecessary privileged RPC exposure.

## Why this is first

`profiles.balance` is the Draw Credit source of truth and `profiles.role` controls admin authorization. Row-level ownership alone is not enough protection if an authenticated client still has permission to update every column in its own row.

Production was inspected before this change. The live database already had no table-level `UPDATE` grant for `authenticated`, and only legacy column-level updates for `display_name` / `avatar_url`. Sensitive columns such as `balance` and `role` were not directly writable. This phase makes the intended rule explicit and reproducible from Git.

## Phase 1.1 — profile write hardening

- revoke direct authenticated `UPDATE` access to `public.profiles`;
- explicitly revoke legacy column update grants;
- remove the old own-row UPDATE policy;
- preserve profile editing through `public.update_my_profile(...)`;
- keep the RPC authenticated, validated, `SECURITY DEFINER`, and pinned to a safe `search_path`;
- add a repository regression check that fails if browser JavaScript starts directly updating `profiles`.

## Phase 1.2 — privileged RPC exposure

The Supabase security advisor identified two admin `SECURITY DEFINER` functions that were unnecessarily executable by `anon`:

- `admin_relaunch_lottery_event(uuid)`
- `admin_update_completed_event_metadata(uuid,text,text,text)`

Both functions already perform an internal `public.is_admin()` check, but anonymous callers had no reason to reach them at all. Phase 1 now revokes `PUBLIC` / `anon` EXECUTE and keeps `authenticated` EXECUTE so signed-in admins can continue to use the admin UI.

Public read RPCs such as `get_platform_features()` and `get_public_event_winners(...)` intentionally remain available to anonymous visitors.

## Preserved behavior

- users can still read their own profile;
- admins keep their server-authorized admin flows;
- profile name/nickname editing continues through `update_my_profile`;
- server-side balance mutations, referral rewards, games, ticket purchases, prizes, and admin adjustments continue through their existing protected functions;
- Google/Auth profile bootstrap remains server-side;
- public feature flags and public winner display remain readable without login.

## CI protection

GitHub Actions runs:

1. `scripts/phase0-smoke.mjs`
2. `scripts/phase1-security.mjs`

before deployment.

## Next Phase 1 slices

1. enumerate every `SECURITY DEFINER` function and its EXECUTE grants;
2. verify safe `search_path` and authorization checks on every privileged function;
3. source-control the remaining live Edge Functions;
4. add database-level regression tests for owner isolation, admin authorization, ticket atomicity, winner integrity, and ledger consistency.

Do not weaken these rules to fix a frontend bug. If a new user-editable profile field is needed, expose it through a validated RPC rather than restoring broad table UPDATE access.
