# Phase 3 — Scalable Admin Data Access

This block removes the largest browser-side admin preloads and moves Players, Tickets, Ledger and Winner history to bounded server queries.

## Problem removed

The base admin dashboard previously loaded up to:

- 5,000 ticket rows,
- 1,000 profile rows,
- 2,000 Draw Credit ledger rows

on every dashboard refresh, even when the admin was not viewing those tabs.

That pattern becomes slow and memory-heavy as the platform grows, and it creates arbitrary visibility cutoffs once the fixed limit is reached.

## New data model

### Lightweight dashboard snapshot

`admin_get_admin_scalability_snapshot()` returns exact aggregate totals and per-event counts for the recent event set used by the base admin page.

It includes only:

- total lotteries,
- open lotteries,
- total tickets,
- total players,
- total Draw Credits,
- ledger row count,
- ticket/player/winner counts for the latest 500 events,
- small admin actor identity cache for audit labels.

It does not return the full ticket, player, or ledger tables.

### Keyset pagination

The following admin-only RPCs use stable `created_at + id` cursors:

- `admin_list_players_page`
- `admin_list_tickets_page`
- `admin_list_balance_ledger_page`

Winner history uses completed-event keyset pagination through:

- `admin_list_winner_events_page`

Keyset pagination avoids increasingly expensive deep OFFSET scans and prevents fixed browser preload limits from becoming hidden data cutoffs.

## Search and filters

Players:
- name, nickname, email, UUID, referral code
- role filter

Tickets:
- lottery filter
- ticket UUID / user UUID
- player name / email
- lottery title / slug

Ledger:
- player UUID
- entry type
- player name / email
- entry UUID
- note
- lottery title

## Indexes

Adds stable pagination indexes:

- `profiles(created_at desc,id desc)`
- `event_tickets(created_at desc,id desc)`
- `event_tickets(event_id,created_at desc,id desc)`
- `balance_ledger(created_at desc,id desc)`

Existing player-specific and game-specific indexes remain unchanged.

## Security

Every browser-callable function:

- is admin-only with `public.is_admin()`,
- has default PUBLIC/anon execution revoked,
- grants execution only to `authenticated`,
- performs reads only.

No ticket, Draw Credit, game, winner, or Support Point write path is changed.


## Love Points player-row compatibility

The previous canonical Players enhancer called `support-device-admin { action: 'list' }` and downloaded up to 2,000 profiles plus 2,000 Support Point wallets, then repeated that bulk request every 10 seconds.

That polling path is removed from the Players tab.

The paginated player RPC already returns the current Support Point balance for each visible row. The canonical enhancer reads that row-local value and keeps the existing `adjust_support` mutation for explicit admin edits. `adjust_support` safely upserts a missing wallet and continues to write the canonical Support Point adjustment audit.

This keeps Draw Credits and Support Points separate while removing a second hidden bulk preload.
