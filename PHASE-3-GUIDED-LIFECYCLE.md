# Phase 3 — Guided Lottery Lifecycle & Result Verification

This slice turns event operations into a guided workflow without changing the existing historical data model.

## Lifecycle model

The authoritative event status remains:

- `draft`
- `published`
- `completed`
- `cancelled`

The guided UI derives operational stages:

`Draft → Publish → Open → Locked/Ready → Draw → Completed → Verify`

For **scheduled** lotteries, ticket sales lock at `cutoff_at` and the automatic draw becomes due at `draw_at`.

For **manual** lotteries there is no separate stored lock state. The existing event-row `FOR UPDATE` lock used by ticket purchase and draw execution is the atomic sales/draw boundary. This preserves the current concurrency-safe architecture rather than inventing a second lifecycle state.

## New server-authoritative review

`private.lottery_event_lifecycle_review(uuid)` calculates:

- current derived lifecycle state,
- next recommended action,
- publish checklist,
- pre-draw checklist,
- post-draw verification checklist,
- deterministic result fingerprint,
- latest verification state.

Browser roles cannot execute the private helper.

`admin_get_event_lifecycle_review(uuid)` exposes the review only to authenticated admins.

## Guarded publish

`admin_publish_lottery_event(uuid)` replaces the direct UI publish path.

It requires:

- admin authorization,
- a non-empty admin reason header,
- draft status,
- valid schedule,
- future cutoff/draw for scheduled lotteries,
- complete ranked prize tiers,
- prize total consistency,
- capacity that can fit every winner,
- a clean draft with no historical tickets/winner data,
- Events feature enabled.

The function locks the event row before validating/publishing and writes an audit entry.

## Pre-draw review

The checklist verifies before a manual/admin draw:

- published status,
- Events feature enabled,
- opening time reached,
- scheduled cutoff reached (or manual row-lock boundary),
- enough existing tickets for every winner,
- exactly one correct purchase-ledger row per ticket,
- complete prize tiers and total,
- no pre-existing winner/prize result.

The existing internal draw engine remains the final authority and retains its own transaction/locking checks.

## Post-draw verification

`admin_verify_completed_lottery_event(uuid,text)` refuses to verify unless all local result invariants pass:

- completed timestamp exists,
- exact winner count and contiguous ranks,
- each winner prize matches its configured tier,
- each ticket still has exactly one matching purchase ledger row,
- each winner has exactly one matching prize ledger credit,
- no extra/non-winner prize credits exist,
- privacy-safe public winner summary matches authoritative ticket rows,
- seed reveal hashes to the stored SHA-256 commitment,
- top-winner compatibility fields match rank #1,
- ranked prize total remains consistent.

A successful verification writes an append-only `audit_logs` record with:

- verification note,
- result fingerprint,
- checklist snapshot,
- verifying admin,
- verification timestamp.

If draw-critical rows are later altered outside the supported application paths, the current fingerprint no longer matches the stored verification fingerprint and the review becomes `stale`.

No new browser-writable verification table is introduced.

## Completed-event history

Verification does **not** reopen or rewrite completed events. Existing completed-event metadata correction remains limited to title, slug and description. Relaunch still creates a new draft with a new event ID.
