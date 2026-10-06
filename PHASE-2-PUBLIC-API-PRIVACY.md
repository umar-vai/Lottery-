# Phase 2 — Public API Privacy Minimization

This block minimizes anonymous/browser-visible identifiers while preserving the public winner experience.

## Winner API

`get_public_event_winners(event_id)` no longer returns raw:

- `profiles.id / auth.users.id`
- `event_tickets.id`

Instead it returns:

- `winner_key` — stable 20-character pseudonymous key for grouping one winner across public result cards,
- `ticket_ref` — 12-character opaque public ticket reference,
- intended display fields: display name, avatar, rank, prize and winning numbers.

If a player has set a nickname, the public winner endpoint prefers that nickname over the profile display name.

## Stored winner summaries

A database trigger strips `ticket_id` / `user_id` from `lottery_events.winner_summary` and writes only pseudonymous public references. Existing historical summaries are backfilled through the same sanitizer.

The actual draw/audit/accounting truth remains in protected `event_tickets` and `balance_ledger`.

## Lottery-event column access

Browser roles keep read access to the event fields required by the public and admin UIs, but no longer have direct SELECT privilege on `lottery_events.created_by`.

Creator/admin attribution remains available in the private canonical admin audit trail.

## Feature-state API

`get_platform_features()` now publishes only effective public availability:

- master
- events
- gameZone
- slot
- plinko

Internal configured sub-switch values and `updatedAt` are no longer exposed.

## Payment-provider visibility

`love_point_payment_providers.public_visible` is now enforced by RLS. Anonymous/authenticated browser sessions can only read providers that are both `public_visible=true` and `enabled=true`.

Service-role payment functions are unaffected.


## Realtime row payloads

The public lottery page no longer subscribes directly to `postgres_changes` on
`lottery_events`. Public event state uses the existing adaptive polling path,
which requests only the explicitly allowed column list. This avoids exposing
unneeded row columns through a Realtime network payload.
