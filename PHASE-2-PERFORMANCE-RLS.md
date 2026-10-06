# Phase 2 — Supabase Performance & RLS Cleanup

This change resolves the current Supabase advisor items that are safe to fix without changing product behavior.

## Foreign-key indexes

Eleven foreign-key columns reported by the advisor now have explicit btree indexes. These indexes support parent-row deletes/updates and joins without forcing scans of the referencing table.

## RLS initPlan optimization

Five SELECT policies were rewritten from per-row auth helper calls such as:

`auth.uid() = user_id`

to statement-cached forms such as:

`(select auth.uid()) = user_id`

Slot and Plinko policies also cache `public.is_admin()` once per statement. The Binance Pay policy is now explicitly scoped to `authenticated`; unauthenticated requests previously evaluated to false because `auth.uid()` was null, so effective access is unchanged.

## Duplicate permissive SELECT policies

The advisor-reported duplicate permissive policies were consolidated while preserving access:

- anonymous users can still read non-draft legacy draws,
- authenticated normal users can still read non-draft draws,
- admins can still read all draws,
- users can still read only their own profile/tickets/ticket results,
- admins can still read all profiles/tickets/ticket results.

Write policies are unchanged.

The runtime test verifies index presence, policy shape, policy counts, and player/admin profile visibility.
