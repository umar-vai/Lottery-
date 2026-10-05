# Game Zone — Instant Games Architecture

> Added 2026-10-05. This document supplements `ARCHITECTURE.md`, `DATABASE.md`, and `DEVELOPER-HANDOFF.md`.

## Product boundary

Game Zone instant games use the same **virtual Draw Credit** balance stored in `profiles.balance` that the event simulation uses.

Draw Credits have no cash value, cannot be withdrawn, and are not connected to the Development Support Points system. Support Points must never be accepted by instant-game RPCs.

## Public pages

- `game-zone.html` — catalog / future multi-game hub
- `slot.html` — Neon Fortune Slots
- `game-zone.js/css`
- `slot.js/css`

Shared shell branding is now **GAME ZONE**. Existing event pages remain active and are linked as the Events part of the platform.

## Slot v1 mathematics

Three independent server-generated reels use the following 100-stop virtual distribution on every reel:

| Symbol | Weight | Triple payout |
|---|---:|---:|
| Cherry | 32% | 5x |
| Lemon | 24% | 8x |
| Bell | 18% | 12x |
| BAR | 12% | 25x |
| 7 | 9% | 60x |
| Diamond | 5% | 150x |

Any matching pair pays `1x`, which returns the bet and creates a net-zero result.

Exact v1 long-run metrics:

- RTP: `93.7288%`
- House edge: `6.2712%`
- Any-return probability: `54.2188%`
- Positive-profit probability: `5.5006%`
- Diamond triple probability: `0.05^3 = 0.000125` = `0.0125%`, about 1 in 8,000 spins

These are fixed game-version odds. The backend must not change probability based on player identity, balance, previous wins/losses, or bet history.

## RNG

`private.secure_slot_roll_100()` uses `pgcrypto` random bytes and rejection sampling:

- generate a 16-bit cryptographic value
- reject values >= 65,500
- map the accepted value modulo 100 to `1..100`

This removes modulo bias for the 100-stop distribution.

Each reel is generated independently, then `private.slot_symbol_v1()` maps the 1..100 stop to a symbol.

The browser never decides the final result. Frontend reel animation only visualizes the already server-authoritative result.

## Spin transaction

Authenticated clients call:

```text
spin_slot(p_bet_amount, p_client_nonce)
```

Server flow:

1. require `auth.uid()`
2. de-duplicate requests using `(user_id, client_nonce)`
3. load active `classic-slot` game version
4. validate bet against server-side `bet_steps`
5. lock the player's `profiles` row
6. reject insufficient Draw Credits
7. generate three cryptographic reel stops
8. calculate multiplier and payout
9. compute final balance
10. update `profiles.balance`
11. insert `slot_spins`
12. insert `game_bet` ledger row
13. insert `game_payout` ledger row when payout > 0
14. return result + final balance

The entire call is one PostgreSQL transaction. A failed request cannot leave a deducted bet without its recorded result.

## Database additions

### `games`

Registry/config for modular future instant games.

Important fields:

- `slug`
- `game_type`
- `status`
- `min_bet` / `max_bet`
- `bet_steps`
- `rtp`
- `house_edge`
- `version`
- `config`

Public/anonymous access is read-only for active/coming-soon catalog entries.

### `slot_spins`

Immutable-style spin history:

- player / game / game version
- idempotency nonce
- bet
- 3 reel results
- multiplier
- payout
- net change
- balance before / after
- outcome type
- RNG version
- timestamp

RLS lets a player read only their own spin history; admins can read all through `is_admin()`.

### `balance_ledger`

New entry types:

- `game_bet`
- `game_payout`

New nullable FK:

- `game_spin_id -> slot_spins.id`

## UX rules

- No autoplay in v1.
- Every spin requires an explicit user tap/click.
- Bet options are server-defined and currently 5 / 10 / 25 / 50 CR.
- UI displays RTP and house edge.
- Pair is presented as a returned bet / push, not a profit win.
- Animation starts immediately for responsiveness, but the final symbols always come from the backend RPC.
- Sound is optional and user-toggleable.
- Jackpot/confetti animation is presentation only and cannot affect payout.

## Future games

Add future instant games as independent modules rather than modifying the event engine:

```text
games catalog
  -> game-specific public page
  -> protected game-specific RPC
  -> game-specific history table
  -> shared profiles.balance
  -> shared balance_ledger
```

Every future game should have versioned fixed odds, an explicit RTP/expected-value model, server-side randomness, idempotent transaction handling, RLS-protected history, and no Support Points integration.
