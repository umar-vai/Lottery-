# Phase 3 — Ticket & Player Investigation Workspace

This slice adds an admin-only, read-only investigation layer for lottery/accounting operations.

## Goals

- investigate one player without scanning large tables in the browser,
- trace one ticket through its lottery and Draw Credit ledger,
- surface accounting inconsistencies as high-priority signals,
- surface high-velocity / large-adjustment activity only as human-review context,
- keep Support Points visibly and technically separate from Draw Credits.

## Admin RPCs

### `admin_search_investigation_subjects(text, integer)`

Searches by:

- player name / nickname,
- email,
- user UUID,
- referral code,
- ticket UUID,
- lottery title / slug associated with that player.

Returns a capped result set with quick activity/accounting summaries.

### `admin_get_player_investigation(uuid)`

Returns:

- profile identity and last activity,
- Draw Credit balance vs ledger reconciliation,
- lottery tickets, spend, wins and prizes,
- per-ticket purchase/prize ledger status,
- Slot and Plinko accounting consistency,
- admin Draw Credit adjustments,
- recent games,
- Support Points summary in a separate object,
- support adjustments,
- referrals,
- canonical admin changes that touched the player,
- evidence-based review signals.

The private helper is not browser executable.

### `admin_get_ticket_investigation(uuid)`

Validates one ticket against:

- event number rules,
- bonus-ball rules,
- exactly one purchase ledger debit,
- winner rank / prize tier,
- prize credit ledger,
- privacy-safe completed winner summary.

## Signal policy

Signals are explicitly not fraud determinations.

### Critical

Only deterministic integrity problems:

- Draw Credit balance mismatch,
- negative Draw Credit balance,
- ticket purchase ledger mismatch,
- winner prize ledger mismatch,
- Slot/Plinko accounting mismatch,
- self-referral relationship.

### Review

Operational patterns requiring human context:

- an admin Draw Credit adjustment of at least 10,000 credits within 30 days,
- at least 100 Slot/Plinko plays within one clock minute.

These may be legitimate testing/operations.

### Info / Watch

- five or more tickets for the same lottery within one clock minute.

This can be normal use and is shown only as context.

## Security

All browser-facing investigation RPCs:

- are `SECURITY DEFINER` only because they must aggregate admin-only tables,
- enforce `public.is_admin()` internally,
- revoke default `PUBLIC` / `anon` execution,
- grant execution only to `authenticated`,
- perform no writes.

The private report helper cannot be executed by browser roles.

## Data-domain separation

`profiles.balance` remains the Draw Credit source of truth.

`support_wallets.balance` remains the Support Points source of truth.

The investigation response exposes them in separate objects and never combines the values.
