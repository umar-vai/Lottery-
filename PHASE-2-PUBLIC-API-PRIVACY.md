# Phase 2 — Public API / Privacy Minimization

The logged-out site intentionally keeps two anonymous read-only RPCs:

- `get_platform_features()`
- `get_public_event_winners(uuid)`

## Winner payload

The public winner payload now exposes only:

- `winner_key` — pseudonymous stable player key
- `display_name` — nickname first, then public display name
- `ticket_ref` — pseudonymous ticket reference
- winner rank
- prize amount
- winning numbers

The RPC no longer returns `avatar_url`. Profile avatar URLs may originate from an OAuth provider and are not required for winner history; the public UI already has initials-based fallbacks.

The payload does not expose raw user UUIDs, raw ticket UUIDs, email, role, balances or referral codes.

## Public event table

`lottery_events.created_by` remains excluded from anon/authenticated column SELECT grants. Public event data may include the draw commitment/reveal and pseudonymous winner summary because those are part of the public draw-verification/reveal experience.

## Trigger-only functions

`validate_ticket()` and `prevent_locked_ticket_delete()` are trigger implementation functions. They no longer have Data API EXECUTE privileges for `anon` or `authenticated`; database triggers continue to invoke them internally.

## Frontend compatibility

Public winner components now use the actual privacy-safe contract:

- `winner_key` for grouping the same player across winning tickets/events
- `ticket_ref` for public ticket references
- initials when no public avatar is returned

This fixes older compatibility code that still expected the removed `user_id` / `ticket_id` fields.
