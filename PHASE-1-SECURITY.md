# Phase 1 — Security & Data Integrity

Phase 1 starts by tightening the highest-risk writable user record: `public.profiles`.

## Why this is first

`profiles.balance` is the Draw Credit source of truth and `profiles.role` controls admin authorization. Row-level ownership alone is not enough protection if an authenticated client still has permission to update every column in its own row.

Production was inspected before this change. The live database already had no table-level `UPDATE` grant for `authenticated`, and only legacy column-level updates for `display_name` / `avatar_url`. Sensitive columns such as `balance` and `role` were not directly writable. This phase makes the intended rule explicit and reproducible from Git.

## Phase 1.1 implemented here

- revoke direct authenticated `UPDATE` access to `public.profiles`;
- explicitly revoke legacy column update grants;
- remove the old own-row UPDATE policy;
- preserve profile editing through `public.update_my_profile(...)`;
- keep the RPC authenticated, validated, `SECURITY DEFINER`, and pinned to a safe `search_path`;
- add a repository regression check that fails if browser JavaScript starts directly updating `profiles`;
- run the Phase 1 security gate in CI before GitHub Pages can deploy.

## Preserved behavior

- users can still read their own profile;
- admins keep their server-authorized read/admin flows;
- profile name/nickname editing continues through `update_my_profile`;
- server-side balance mutations, referral rewards, games, ticket purchases, prizes, and admin adjustments continue through their existing protected functions;
- Google/Auth profile bootstrap remains server-side.

## Next Phase 1 slices

1. enumerate every `SECURITY DEFINER` function and its EXECUTE grants;
2. verify safe `search_path` on every privileged function;
3. source-control the remaining live Edge Functions;
4. add database-level regression tests for owner isolation, admin authorization, ticket atomicity, winner integrity, and ledger consistency.

Do not weaken this rule to fix a frontend bug. If a new user-editable profile field is needed, expose it through a validated RPC rather than restoring broad table UPDATE access.
