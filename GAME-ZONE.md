# Game Zone — Instant Games Architecture

> Added 2026-10-05. This document supplements `ARCHITECTURE.md`, `DATABASE.md`, and `DEVELOPER-HANDOFF.md`.

## Product boundary

Game Zone instant games use the same **virtual Draw Credit** balance stored in `profiles.balance` that the event simulation uses.

Draw Credits have no cash value, cannot be withdrawn, and are not connected to the Development Support Points system. Support Points must never be accepted by instant-game RPCs.

## Public pages

- `game-zone.html` — catalog / multi-game hub
- `slot.html` — Neon Fortune Slots
- `plinko.html` — Neon Plinko
- `game-zone.js/css` + `game-zone-v2.css`
- `slot.js/css`
- `plinko.js/css`

Shared shell branding is **GAME ZONE**. Existing event pages remain active and are linked as the Events part of the platform.

## Shared instant-game rules

- Final outcomes are server-authoritative.
- Browser animation only visualizes the server result.
- Bets are validated against server-side whitelists.
- The player profile row is locked before balance mutation.
- Every bet/payout is written to `balance_ledger`.
- Client UUID nonces make repeat submissions idempotent.
- Support Points are never accepted by game RPCs.
- Odds do not change based on player identity, balance, previous wins/losses, or bet history.

---

# Neon Fortune Slots v1

## Mathematics

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

## RNG

`private.secure_slot_roll_100()` uses `pgcrypto` random bytes and rejection sampling. Each reel is generated independently, then `private.slot_symbol_v1()` maps the 1..100 stop to a symbol.

## Spin RPC

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
9. update `profiles.balance`
10. insert `slot_spins`
11. insert `game_bet` / `game_payout` ledger rows
12. return result + final balance

### `slot_spins`

Stores player/game/version, nonce, bet, reel results, multiplier, payout, net, balance before/after, outcome, RNG version and timestamp.

RLS lets a player read only their own spin history; admins can read all through `is_admin()`.

---

# Neon Plinko v1

## Board probability model

Plinko uses exactly **12 server-generated left/right decisions**, producing **13 landing buckets**.

Each left/right decision is generated from `pgcrypto` random bytes. The landing index is the number of right decisions in the 12-step path, so bucket probabilities follow the exact 12-step binomial distribution.

The path probability is identical in Low, Medium and High modes. Risk selection changes only the payout curve.

### Low risk

Multipliers:

```text
5, 2, 1.5, 1.2, 1.05, 0.9, 0.65, 0.9, 1.05, 1.2, 1.5, 2, 5
```

- RTP: `93.9868%`
- House edge: `6.0132%`

### Medium risk

Multipliers:

```text
25, 8, 3.5, 1.8, 1.1, 0.65, 0.25, 0.65, 1.1, 1.8, 3.5, 8, 25
```

- RTP: `93.8867%`
- House edge: `6.1133%`

### High risk

Multipliers:

```text
150, 31.5, 8.3, 2.5, 0.45, 0.1, 0, 0.1, 0.45, 2.5, 8.3, 31.5, 150
```

- RTP: `94.1284%`
- House edge: `5.8716%`

One specific extreme bucket has probability `1 / 4096`; either extreme bucket combined has probability `2 / 4096` (about 1 in 2,048).

## Drop RPC

Authenticated clients call:

```text
drop_plinko(p_bet_amount, p_risk, p_client_nonce)
```

Server flow:

1. require `auth.uid()`
2. de-duplicate by `(user_id, client_nonce)`
3. load active `neon-plinko` game config
4. validate bet and risk mode
5. lock the player's `profiles` row
6. reject insufficient Draw Credits
7. generate 12 secure left/right decisions
8. derive landing bucket from the path
9. apply the fixed v1 multiplier for the selected risk mode
10. deduct bet and apply payout atomically
11. insert `plinko_drops`
12. insert `game_bet` / `game_payout` ledger rows
13. return exact path, landing bucket, multiplier and final balance

### `plinko_drops`

Stores:

- user / game / game version
- client nonce
- bet amount
- risk mode
- board rows
- 12-step path
- landing index
- multiplier
- payout / net change
- balance before / after
- outcome kind
- RNG version
- timestamp

RLS lets signed-in users read only their own drops; admins can read all through `is_admin()`.

Anonymous callers cannot execute `drop_plinko`; authenticated users can execute it, while validation and balance authority remain inside the server-side SECURITY DEFINER function.

## Frontend animation

The backend returns the exact 12-step path. `plinko.js` animates the ball through the matching peg positions and ends in the server-selected bucket.

The frontend includes:

- Low / Medium / High risk switch
- server-defined bet buttons
- animated ball path
- peg-hit glow
- landing bucket highlight
- optional sound
- supported-device vibration feedback
- win / jackpot confetti
- live Draw Credit balance update
- recent drop history
- exact paytable display

Changing browser JavaScript cannot change the persisted landing bucket or payout.

---

# Database / ledger integration

## `games`

Registry/config for modular instant games.

Current `game_type` values:

- `slot`
- `plinko`

Important fields include `slug`, `status`, bet limits, `bet_steps`, RTP, house edge, version and JSON config.

## `balance_ledger`

Instant-game entry types:

- `game_bet`
- `game_payout`

Game-specific nullable references:

- `game_spin_id -> slot_spins.id`
- `plinko_drop_id -> plinko_drops.id`

## UX rules

- No autoplay.
- Every play requires an explicit user action.
- Current bet options are 5 / 10 / 25 / 50 CR.
- UI displays RTP and house edge.
- Sound is optional and user-toggleable.
- Visual effects never affect the server payout.

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
