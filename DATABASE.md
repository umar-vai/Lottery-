# Lootera Database

> Production database map as of 2026-10-07.
>
> Product: `Lootera` — `lootera.win`  
> Project ref: `mwtlsnneooxmryondrex`  
> Region: Mumbai (`ap-south-1`)

This document describes the **live database**, not only the older SQL files committed under `supabase/`.

The live database has evolved beyond the original `supabase/schema.sql`, so a developer must inspect production before making migrations.

---

# 1. Database domains

The database currently contains four logical domains:

1. **Current multi-event draw system**
2. **Draw Credit / ledger / admin accounting**
3. **Development Support Points system**
4. **Legacy Powerball-style subsystem**

Do not merge these domains casually.

---

# 2. Current multi-event draw system

## `lottery_events`

Primary event table.

Important columns:

| Column | Type | Purpose |
|---|---|---|
| `id` | uuid | Primary event ID |
| `slug` | text, unique | Public URL slug |
| `title` | text | Event title |
| `description` | text | Public description |
| `status` | text | `draft`, `published`, `completed`, `cancelled` |
| `ticket_price` | numeric | Draw Credits charged per ticket |
| `prize_amount` | numeric | Aggregate/config summary prize value |
| `prize_mode` | text | Historical/config field |
| `max_tickets_per_user` | integer | Required per-user ticket cap |
| `max_players` | integer nullable | Null = unlimited |
| `max_total_tickets` | integer nullable | Null = unlimited |
| `white_ball_count` | smallint | Number of main numbers to select |
| `white_ball_max` | smallint | Main-number upper bound |
| `bonus_ball_enabled` | boolean | Whether bonus ball is used |
| `bonus_ball_max` | smallint | Bonus upper bound |
| `schedule_mode` | text | `scheduled` or `manual` |
| `opens_at` | timestamptz | Opening time |
| `cutoff_at` | timestamptz nullable | Scheduled ticket cutoff |
| `draw_at` | timestamptz nullable | Scheduled draw time |
| `winner_count` | integer | Number of ranked winning tickets |
| `winner_summary` | jsonb | Completed-event winner summary |
| `winning_numbers` | integer[] nullable | Top winner's main numbers / historical display field |
| `winning_bonus_ball` | integer nullable | Top winner's bonus ball |
| `winning_ticket_count` | integer | Winner ticket count |
| `prize_per_winning_ticket` | numeric | Legacy/result compatibility field |
| `seed_commitment` | text nullable | SHA-256 commitment |
| `seed_reveal` | text nullable | Revealed draw seed |
| `cover_image_url` | text nullable | Public Storage URL |
| `created_by` | uuid nullable | Admin creator |
| `created_at` | timestamptz | Creation time |
| `updated_at` | timestamptz | Last update |
| `completed_at` | timestamptz nullable | Completion time |

Key constraints:

- primary key: `id`
- unique: `slug`
- `created_by` references `profiles.id`

### RLS

Anonymous users can read only events in public states:

- `published`
- `completed`
- `cancelled`

Authenticated users get the same public events, plus admins can see all events through `is_admin()`.

Direct browser writes are not the main mutation path. Admin creation/update/draw behavior goes through RPC functions.

Phase 5 enforces the lifecycle at the database boundary: `admin_create_lottery_event_v3` always creates a draft, direct draft-to-published updates are rejected, and publication must go through `admin_publish_lottery_event(uuid)`.

---

## `event_tickets`

Primary ticket table for the current event system.

| Column | Type | Purpose |
|---|---|---|
| `id` | uuid | Ticket ID |
| `event_id` | uuid | Parent event |
| `user_id` | uuid | Owner |
| `white_numbers` | integer[] | Selected main numbers |
| `bonus_ball` | integer nullable | Selected bonus |
| `price_paid` | numeric | Draw Credit cost at purchase time |
| `is_winner` | boolean | Winner flag |
| `winner_rank` | integer nullable | 1..N rank |
| `prize_awarded` | numeric | Draw Credits awarded |
| `created_at` | timestamptz | Ticket time |

Foreign keys:

- `event_id -> lottery_events.id`
- `user_id -> profiles.id`

### RLS

Authenticated users can read their own event tickets. Admins can read all event tickets.

Browser code should not directly insert event tickets. Phase 7F browser clients use the nonce-based idempotent wrapper:

```text
purchase_event_ticket_idempotent(
  p_event_id,
  p_white_numbers,
  p_bonus_ball,
  p_client_nonce
)
```

The older `purchase_event_ticket(...)` function remains the core/compatibility transaction boundary. Cached or legacy clients can still call it, but every successful ticket insert is protected by the Phase 7F database mutation guard/rate trigger.

---

## `event_prize_tiers`

Ranked prize configuration.

Composite primary key:

```text
(event_id, rank)
```

Columns:

| Column | Type |
|---|---|
| `event_id` | uuid |
| `rank` | integer |
| `prize_amount` | numeric |
| `created_at` | timestamptz |

`event_id` references `lottery_events.id`.

The internal draw engine requires the number of prize-tier rows to equal `lottery_events.winner_count`.

Public users may read tiers only for public-state events. Authenticated admins can also read tiers for draft/admin-visible events.

---

# 3. Profiles and Draw Credits

## `profiles`

Maps Supabase Auth users into application users.

| Column | Type | Purpose |
|---|---|---|
| `id` | uuid | Same user ID as Supabase Auth |
| `display_name` | text nullable | Display name |
| `avatar_url` | text nullable | Avatar |
| `email` | text nullable | Email |
| `role` | text | Usually `player` or `admin` |
| `balance` | numeric | **Draw Credit source of truth** |
| `created_at` | timestamptz | Created |
| `updated_at` | timestamptz | Updated |

### RLS / write boundary

- authenticated users can read their own profile
- admins can read all profiles
- authenticated browser roles have **SELECT-only** table/column privileges on `profiles`
- there is no browser UPDATE policy or UPDATE grant

Self-service profile editing uses `update_my_profile(display_name,nickname)`, which only updates those two display fields plus `updated_at`. Sensitive `role` and Draw Credit `balance` changes remain behind protected admin/database mutation paths.

---

## `balance_ledger`

Append-style Draw Credit accounting history.

| Column | Type |
|---|---|
| `id` | uuid |
| `user_id` | uuid |
| `amount` | numeric |
| `balance_after` | numeric |
| `entry_type` | text |
| `event_id` | uuid nullable |
| `ticket_id` | uuid nullable |
| `actor_user_id` | uuid nullable |
| `note` | text nullable |
| `created_at` | timestamptz |

Foreign keys connect to:

- `profiles`
- `lottery_events`
- `event_tickets`

Typical entry types:

- `admin_adjustment`
- `ticket_purchase`
- `prize_credit`

RLS: users can read their own ledger; admins can also read through `is_admin()`.

A new Draw Credit mutation should normally update the profile and insert a ledger row in the **same database transaction/function**.

---

## `credit_requests`

Virtual test-credit request workflow.

Columns:

- `id`
- `user_id`
- `requested_credits`
- `note`
- `status`
- `admin_note`
- `reviewed_by`
- `created_at`
- `reviewed_at`
- `updated_at`

Current statuses include:

- `pending`
- `approved`
- `rejected`
- `cancelled`

RLS:

- authenticated user can insert an own pending request
- user can read own requests
- admin can read all requests

Review path:

```text
authenticated admin
    -> public.admin_review_credit_request(...)   [canonical SECURITY DEFINER API]
        -> private.review_credit_request(...)    [internal helper]
```

Phase 6 removes direct anon/authenticated/service-role EXECUTE from the private helper. The public wrapper performs the server-side admin check and is the only browser-callable review entrypoint.

Approved requests become Draw Credit admin adjustments and should be reflected in `balance_ledger`.

---

# 4. Current ticket purchase transaction

RPC:

```text
public.purchase_event_ticket(
    p_event_id uuid,
    p_white_numbers integer[],
    p_bonus_ball integer default null
)
```

This is `SECURITY DEFINER` with a controlled search path.

Server-side behavior:

1. requires `auth.uid()`
2. locks the event row
3. requires `status='published'`
4. validates `opens_at`
5. for scheduled events validates `cutoff_at`
6. counts current tickets, players and user's tickets
7. enforces `max_total_tickets`
8. enforces `max_players`
9. enforces `max_tickets_per_user`
10. validates main number count, uniqueness and range
11. validates bonus-ball rules
12. locks the player's profile balance
13. checks sufficient Draw Credits
14. deducts `ticket_price`
15. inserts `event_tickets`
16. inserts `balance_ledger` entry with `ticket_purchase`
17. returns `ticket_id` and `new_balance`

Because the event/profile rows are locked inside one PostgreSQL transaction, this is the core concurrency boundary for ticket purchasing.

Phase 7F adds `public.purchase_event_ticket_idempotent(..., p_client_nonce)` for browser purchases. It takes an advisory transaction lock keyed by user + nonce, stores the completed ticket/balance in `private.ticket_purchase_idempotency`, replays the original result on retry, and rejects reuse of the same nonce for a different ticket payload.

---

# 5. Draw engine

## `private.run_lottery_event_internal(p_event_id uuid)`

Production event-draw engine.

Behavior:

1. locks event
2. requires event to be `published`
3. scheduled event cannot run before cutoff
4. counts tickets
5. rejects zero tickets
6. rejects when ticket count is lower than configured `winner_count`
7. rejects mismatched prize-tier count
8. creates a random 32-byte seed
9. stores SHA-256 commitment/reveal data
10. clears any previous winner flags for the event
11. deterministically orders **existing ticket IDs from this event** using the random seed + SHA-256 digest
12. takes first `winner_count` tickets as ranked winners
13. looks up prize per rank
14. marks each winning ticket
15. credits winner's `profiles.balance`
16. writes `prize_credit` rows to `balance_ledger`
17. completes `lottery_events`
18. records winner summary + audit log

Selection expression conceptually uses:

```text
SHA256(seed + ':ticket:' + ticket_id)
```

This means the draw is ticket-pool based, not number-match based in the current event architecture.

## Admin wrapper

```text
public.admin_run_lottery_event(p_event_id uuid)
```

Requires `is_admin()` and delegates to the private draw engine.

## Automatic scheduler

Function:

```text
private.run_due_lottery_events()
```

Current `pg_cron` job:

```text
job: lottery-events-every-minute
schedule: * * * * *
command: select private.run_due_lottery_events();
```

Additional production health cron jobs:

```text
draw-credit-integrity-hourly   -> 17 * * * *   -> private.run_draw_credit_integrity_check()
lottery-operational-health     -> */5 * * * *  -> private.run_lottery_operational_health_check()
production-slo-every-5-minutes -> */5 * * * *  -> private.run_production_slo_check()
production-slo-snapshot-15m    -> */15 * * * * -> private.capture_production_slo_snapshot()
operational-history-retention-daily -> 23 3 * * * -> private.prune_operational_history()
production-alert-dispatch-minute -> * * * * * -> private.kick_production_alert_dispatch()
```

Phase 7A's private `production_slo_report()` combines application integrity with connection pressure, blocking sessions, cache-hit rates, recent cron failures, required-cron presence, and Support settlement invariants. It is not exposed to browser/service API roles.

Phase 7C delivers that state to active admins through the existing Incident Center. The browser polls the admin-only incident RPC every 60 seconds while visible, shows a persistent banner for warning/critical states, and allows an admin to acknowledge a `production_slo_breached` event with a 3–500 character operator note. Acknowledgement is stored privately and audited separately; it never marks the SLO recovered.

It runs due `published + scheduled` events whose `draw_at <= now()`.

Failures are written into `audit_logs` instead of crashing the whole loop.

---

# 6. Event admin RPCs

Current database contains multiple generations of event RPCs. New work should normally use the latest-compatible functions already called by the current admin UI.

### Create/update generations

Current browser/API contract:

- `admin_create_lottery_event_v3(...)`
- `admin_update_lottery_event_v3(...)`

`v3` includes:

- ranked prizes
- schedule mode
- `max_players`
- `max_total_tickets`

Legacy v1/v2 function bodies are retained for migration/history compatibility, but Phase 4 revoked browser-role EXECUTE after code search confirmed there is no active caller. Do not re-expose v1/v2 through the Data API.

### Other current event RPCs

- `admin_delete_lottery_event(p_event_id)`
- `admin_run_lottery_event(p_event_id)`
- `admin_set_event_cover(p_event_id, p_cover_image_url)`
- `admin_update_completed_event_metadata(...)`
- `admin_relaunch_lottery_event(p_event_id)`
- `get_public_event_winners(p_event_id)`

### Completed event edit

`admin_update_completed_event_metadata(...)` intentionally allows only safe public metadata changes:

- title
- slug
- description

It refuses non-completed events and does not rewrite tickets, ranks or awarded prizes.

### Relaunch

`admin_relaunch_lottery_event(...)`:

- requires a completed source event
- creates a new event with a new slug
- copies configuration + prize tiers + cover
- makes the new event a `draft`
- changes it to `manual`
- starts with fresh tickets/winners
- preserves source historical results

---

# 7. Public winner RPC

```text
get_public_event_winners(p_event_id uuid)
```

Returns for completed events:

- `winner_key` — non-reversible public winner reference
- `display_name` — nickname/display-name fallback only
- `ticket_ref` — sanitized public ticket reference
- `winner_rank`
- `prize_awarded`
- `white_numbers`
- `bonus_ball`

It joins winner tickets to profiles and orders by rank, but does not expose raw user IDs, emails or raw ticket IDs.

This RPC intentionally remains a narrow anonymous `SECURITY DEFINER` projection so winner results can be public without opening direct read access to protected ticket/profile tables.

---

# 8. Audit system

## `audit_logs`

Columns:

- `id` bigint
- `actor_user_id` uuid nullable
- `action`
- `entity_type`
- `entity_id`
- `old_data` jsonb
- `new_data` jsonb
- `created_at`

RLS: admin read only.

Automatic actions may have `actor_user_id = null`.

Examples:

- run event
- event draw failure
- user balance change
- completed-event metadata edit
- relaunch event

Admin writes should continue to add audit entries when they mutate sensitive configuration or balances.

---

# 9. Development Support Points domain

Support Points are **not Draw Credits**.

## `support_wallets`

Source of truth for Support Points.

| Column | Type |
|---|---|
| `user_id` | uuid primary key |
| `balance` | numeric |
| `updated_at` | timestamptz |

RLS: user reads own wallet.

Do not use this balance in `purchase_event_ticket`.

---

## `support_bridge_devices`

Authorized phone/device bridge registrations.

| Column | Type |
|---|---|
| `id` | uuid |
| `label` | text |
| `token_hash` | text unique |
| `enabled` | boolean |
| `created_by` | uuid nullable |
| `created_at` | timestamptz |
| `last_seen_at` | timestamptz nullable |

Raw bridge tokens should never be stored in plaintext in the database or repository. The current phone-bridge endpoint hashes the provided token and compares it with `token_hash`.

---

## `support_transactions`

Verified/parsed support transfer metadata received by the phone bridge.

| Column | Type |
|---|---|
| `id` | uuid |
| `device_id` | uuid |
| `provider` | text |
| `sender_hash` | text |
| `sender_last4` | text |
| `amount` | numeric |
| `trx_id` | text unique |
| `received_at` | timestamptz |
| `sms_fingerprint` | text unique |
| `claimed_by` | uuid nullable |
| `claimed_at` | timestamptz nullable |
| `created_at` | timestamptz |

Unique `trx_id` and `sms_fingerprint` provide duplicate protection.

---

## `support_claim_requests`

Current pending/settled claim record used by the public Support Center.

Columns:

- `id`
- `user_id`
- `trx_id`
- `sender_hash`
- `sender_last4`
- `status`
- `transaction_id`
- `amount_bdt`
- `points`
- `balance_after`
- `created_at`
- `settled_at`
- `expires_at` (default current time + 7 days)

RLS: users read only their own requests.

The frontend displays these as pending/settled history.

---

## `support_point_claims`

Immutable-style settled claim history.

Columns:

- `id`
- `user_id`
- `transaction_id`
- `amount_bdt`
- `points`
- `balance_after`
- `created_at`

`transaction_id` is unique, preventing one support transaction from being credited twice.

RLS: user reads own rows.

---

## `support_point_adjustments`

Admin adjustment history for Support Point balances.

Columns:

- `id`
- `user_id`
- `previous_balance`
- `new_balance`
- `actor_user_id`
- `note`
- `created_at`

Use this when manually changing Support Points from the admin UI.

---

## `support_admin_recent`

Admin-facing projection/view-like object used to inspect recent support transfers and claim state.

Fields include:

- transaction ID
- provider
- sender last 4
- amount
- TrxID
- received time
- claimed time
- claimant
- claimant name

Treat it as read-only unless its underlying database definition is explicitly inspected.

---

## Retired legacy Support pending-claim path

The earlier `support_pending_claims` table and its 3-argument service/private function chain were retired in Phase 4 after:

- the table was confirmed empty;
- repository caller search found no active client;
- live function/dependency inspection isolated the chain from the current 4-argument Support flow;
- a rollback-only production drop test completed without dependency failures.

The canonical pending/settled state is now only `support_claim_requests`.

---

# 10. Current Support Points settlement logic

## Edge Function: `claim-support-points`

Requires a valid user JWT.

It:

1. verifies current user
2. normalizes sender number
3. validates TrxID
4. requires terms acknowledgement
5. SHA-256 hashes normalized sender number
6. calls `service_submit_support_claim(...)`

The four-argument service function creates/updates `support_claim_requests` and immediately attempts settlement.

## Edge Function: `support-phone-bridge`

Does not use user JWT; it authenticates via `x-bridge-token`.

It:

1. hashes token and checks `support_bridge_devices`
2. accepts structured transaction metadata or received-money notification text
3. rejects OTP/PIN/password/verification-style text
4. parses/validates amount + sender + TrxID
5. stores metadata in `support_transactions`
6. updates `last_seen_at`
7. calls `service_settle_pending_support_claim(...)`

## Settlement function

`private.settle_support_claim_request(p_request_id)`:

- locks the request
- returns existing result if already settled
- expires old requests
- matches on `TrxID + sender_hash`
- locks matched `support_transactions` row
- rejects transactions already claimed by another user
- sets `points = tx.amount`
- increments `support_wallets.balance`
- marks transaction claimed
- inserts `support_point_claims`
- marks request settled

Current conversion inside the support accounting system is:

```text
1 BDT recorded support amount = 1 Support Point
```

This is a supporter ledger convention only; Support Points cannot be consumed by draw-ticket logic.

---

# 11. Current Support Points Edge Functions

Primary/current:

- `support-phone-bridge` — bridge ingest; custom device token; `verify_jwt=false`
- `support-device-admin` — device management; JWT protected
- `claim-support-points` — user claim; JWT protected
- `production-alert-dispatch` — Phase 7D dispatcher v2; custom Vault dispatch-token auth; `verify_jwt=false`; supports generic HTTPS webhooks plus native Telegram Bot API pairing/test/delivery. Telegram bot token/chat ID remain in Vault.

Legacy:

- `phone-bridge`
- `bridge-device-admin`

Decommissioned:

- `claim-demo-credit` — returns HTTP `410 Gone`; demo credit tables/UI were removed

Delete deprecated functions only after confirming no current device/client references them.

---

# 12. Storage

Supabase Storage bucket:

```text
event-covers
```

Configuration:

- public: `true`
- max file size: `5,242,880` bytes (5 MB)
- MIME allowlist:
  - `image/jpeg`
  - `image/png`
  - `image/webp`

Event DB field:

```text
lottery_events.cover_image_url
```

Admin link RPC:

```text
admin_set_event_cover(p_event_id, p_cover_image_url)
```

---

# 13. Legacy Powerball-style tables

These are not the current multi-event event model but still exist.

## `game_settings`

Includes legacy game-wide settings such as:

- white ball count/max
- Powerball max
- starting jackpot
- rollover increment
- draw interval
- ticket cutoff seconds
- Power Play enabled
- automatic next draw
- system paused

## `draws`

Legacy draw records with:

- draw number
- status
- schedule
- jackpot
- winning numbers
- power play
- seed commitment/reveal

## `tickets`

Legacy number-match tickets retained for historical compatibility.

Phase 5 froze this table for browser writes after confirming the old engine is paused, no current HTML loads legacy `app.js`, and the observed 24-hour production window had no legacy REST traffic. Authenticated users may still read their own historical rows (admins may read all through RLS), but browser INSERT/UPDATE/DELETE privileges and write policies are removed.

## `ticket_results`

Legacy result/prize rows.

## `draw_events`

Legacy public draw event feed/audit structure.

## `draw_secrets`

Legacy seed storage.

### Legacy ticket triggers

Current triggers still visible on `tickets`:

- `validate_ticket_before_write` on INSERT
- `validate_ticket_before_write` on UPDATE
- `prevent_locked_ticket_delete_trigger` on DELETE

Do not assume these triggers protect `event_tickets`; the current event system uses its own RPC transaction boundary.

---

# 14. Database functions inventory

## Current event / admin functions

- `is_admin()`
- `handle_new_user()`
- `purchase_event_ticket(...)`
- `admin_create_lottery_event_v3(...)` — current browser/API
- `admin_update_lottery_event_v3(...)` — current browser/API
- legacy v1/v2 create/update bodies remain in the database with browser EXECUTE revoked
- `admin_delete_lottery_event(...)`
- `admin_run_lottery_event(...)`
- `admin_set_event_cover(...)`
- `admin_set_user_balance(...)`
- `admin_set_user_role(...)`
- `admin_update_completed_event_metadata(...)`
- `admin_relaunch_lottery_event(...)`
- `get_public_event_winners(...)`
- `private.run_lottery_event_internal(...)`
- `private.run_due_lottery_events()`
- `private.production_slo_report()` — Phase 7A production SLO classifier
- `private.run_production_slo_check()` — five-minute debounced SLO audit checker
- `private.capture_production_slo_snapshot()` — private 15-minute SLO snapshot writer
- `private.production_slo_history_report(integer)` — private 1–720 hour SLO history summary
- `private.prune_operational_history()` — 30-day SLO/pg_cron history retention
- `private.production_incident_acknowledgements` — Phase 7C private breach acknowledgement trail
- `public.admin_acknowledge_production_incident(bigint,text)` — admin-only SLO breach acknowledgement RPC
- `public.admin_get_operations_incident_center()` — existing admin incident RPC, extended in Phase 7C with SLO/history/event/acknowledgement data
- `private.production_alert_delivery_config` — Phase 7D private external-alert policy/config
- `private.production_alert_outbox` — durable external-alert delivery queue
- `private.production_alert_delivery_report()` — private external-alert health summary
- `private.enqueue_production_alert_escalations()` — warning/critical escalation scheduler
- `private.kick_production_alert_dispatch()` — minute dispatcher kick via pg_net
- `public.service_claim_production_alert_batch(text,integer)` — service-role-only Edge dispatcher claim API
- `public.service_complete_production_alert_delivery(...)` — service-role-only delivery result API
- `public.service_record_production_alert_dispatcher_state(...)` — service-role-only dispatcher configuration health API
- `private.set_production_alert_telegram_bot_token(text)` — trusted operator-only Vault token writer
- `private.rotate_production_alert_telegram_pairing_code()` — trusted operator-only pairing-code rotation
- `public.service_get_production_alert_delivery_target(text)` — service-role-only channel/Telegram target lookup, additionally protected by dispatch token
- `public.service_store_production_alert_telegram_chat(text,text,text)` — service-role-only Telegram pairing result writer

## Virtual credit-request functions

- `public.admin_review_credit_request(...)`
- `private.review_credit_request(...)`

## Support functions

Canonical current Support functions:

- `public.service_submit_support_claim(uuid,text,text,text)`
- `public.service_settle_pending_support_claim(text,text)`
- `private.settle_support_claim_request(uuid)`

The superseded `support_pending_claims` table, 3-argument submit wrapper, direct claim wrapper, pending-transaction wrapper, and their private implementations were removed in Phase 4.

## Legacy draw functions

- `private.run_draw_engine()`
- `private.draw_int(...)`
- legacy `admin_create_draw`, `admin_update_draw`, `admin_run_draw_now`, `admin_lock_draw`, `admin_pause_draw`, `admin_cancel_draw`, `admin_publish_draft`, `admin_update_game_settings`

---

# 15. RLS summary

The following is a conceptual summary; always inspect `pg_policies` before changing permissions.

| Table | Public/Anon | Authenticated owner | Admin |
|---|---|---|---|
| `lottery_events` | public states read | public states read | all event rows read |
| `event_prize_tiers` | public-event tiers read | public-event tiers read | all relevant tiers read |
| `event_tickets` | no | own read | all read |
| `profiles` | no | own read; display-name edits via `update_my_profile` RPC | all read |
| `balance_ledger` | no | own read | all via admin condition |
| `audit_logs` | no | no | read |
| `credit_requests` | no | own insert/read | read/review through protected path |
| `support_wallets` | no | own read | admin tooling uses protected backend/admin access |
| `support_point_claims` | no | own read | admin/backend tooling |
| `support_claim_requests` | no | own read | backend/admin tooling |
| `game_settings` | read | read | read/admin RPC mutations |
| `draws` | visible non-draft read | visible read | all read |
| `tickets` | no | own historical read only | all read |
| `ticket_results` | no | own read | all read |

---

# 16. Security review items for the next developer

These are high priority.

1. Keep the privileged-function inventory intentional. Phase 6 moved credit review behind the canonical public admin RPC: 37 authenticated public admin SECURITY DEFINER RPCs are now expected after the Phase 7C acknowledgement endpoint, while authenticated direct execution of private SECURITY DEFINER helpers is expected to remain zero.
   Phase 7D adds service-role-only dispatcher RPCs, so the authenticated SECURITY DEFINER advisor count remains 47 and private authenticated SECURITY DEFINER exposure remains zero.
2. Preserve explicit safe `search_path` on every SECURITY DEFINER function and the server-side `is_admin()` guard on authenticated admin RPCs.
3. Source-control every live migration and Edge Function.
4. Remove/decommission unused RPC generations only after caller analysis.
5. Physically delete the already-decommissioned `phone-bridge`, `bridge-device-admin`, and `claim-demo-credit` Edge stubs when a deletion-capable Supabase surface is available.
6. Keep database tests for concurrent ticket purchases at max capacity.
7. Keep tests proving one support transaction cannot be claimed twice.
8. Keep tests proving Support Points cannot be used in `purchase_event_ticket`.
9. Phase 7E confirmed Lootera Auth is currently Google-only: 7 identities, 0 password users. Supabase leaked-password protection remains a Free-plan advisor warning and must be enabled if password auth is introduced or the project upgrades to a plan that supports it.
10. Phase 7E confirms `pg_net 0.20.4` is non-relocatable in the live project. Do not attempt an unsupported schema move solely to silence the advisor.
11. The two Phase 7E private foreign keys are covered by `production_alert_delivery_config_updated_by_idx` and `production_incident_acknowledgements_acknowledged_by_idx`.
12. A real encrypted off-site backup and isolated restore rehearsal are still required; use `scripts/export-offsite-backup.sh`, `scripts/restore-offsite-backup.sh`, and `scripts/verify-restored-database.sql`.
13. Phase 7F adds exactly three intentional authenticated SECURITY DEFINER RPCs: `admin_get_mutation_guardrails()`, `admin_set_mutation_guardrails(...)`, and `purchase_event_ticket_idempotent(...)`. The current advisor authenticated SECURITY DEFINER warning count is therefore **50**; authenticated direct execution of private SECURITY DEFINER helpers remains zero.
14. Phase 7F user-write guardrails are private, database-enforced, and auditable. The master/category switches cover ticket, game, Support claim, credit-request, referral, and payment-order inserts.
15. The successful-mutation budgets are not a WAF/DDoS substitute. Phase 7G owns burst/load/connection-saturation testing and platform-level request-limit evidence.
16. Current Support Edge CORS explicitly allows `https://lootera.win`, `https://www.lootera.win`, the GitHub Pages origin, and localhost development; non-empty unapproved origins are rejected.

---

# 17. Migration rules

For future database work:

- do not manually patch production without a migration record
- use Supabase migrations for DDL
- test risky migrations in a development branch/staging project
- avoid generated production UUIDs in schema migrations
- use transactions for multi-table mutations
- preserve existing audit/history rows
- never remove a column/function/table based only on filename age; perform code + DB dependency search
- keep current event subsystem and legacy subsystem clearly labeled

Recommended repository target:

```text
supabase/
  migrations/
    <timestamp>_<description>.sql
  functions/
    support-phone-bridge/
    support-device-admin/
    claim-support-points/
  tests/
```

---

# 18. Database source-of-truth rule

Until production migrations are fully reconstructed into Git:

> **Production Supabase is the authoritative schema; repository SQL is historical/reference.**

Before changing the database, compare:

1. live `information_schema`
2. live `pg_proc`
3. live `pg_policies`
4. live triggers/indexes/grants
5. current frontend/RPC callers
6. repository SQL

Then create a migration that moves the known current state forward.

---

# 19. Phase 7F go-live mutation hardening

Private Phase 7F controls:

- `private.production_mutation_guardrails` — emergency master/category write switches;
- `private.mutation_rate_limit_windows` — atomic successful-mutation budgets, pruned after 2 days;
- `private.ticket_purchase_idempotency` — browser ticket nonce/result replay map.

Protected insert budgets:

- ticket purchases: 20/min/user;
- slot spins: 240/min/user;
- Plinko drops: 900/min/user;
- credit requests: 6/hour/user;
- Support claim requests: 30/hour/user;
- Support point claims: 60/hour/user;
- payment orders: 12/hour/user;
- referral joins: 3/day/referred user.

Admin Incident Center exposes the guardrail state and provides audited **Pause all user mutations** / **Resume user mutations** controls.

The guard triggers protect all current server paths that ultimately insert the protected records, including compatibility RPCs. These are successful-mutation budgets, not volumetric request throttles.

Current Support Edge versions after Phase 7F:

- `support-phone-bridge` v6 — custom bridge-token auth;
- `support-device-admin` v7 — JWT + admin check;
- `claim-support-points` v6 — JWT auth.

---

# 20. Phase 7E disaster-recovery rules

Lootera is currently on a Free-plan recovery model, so operator-controlled off-site backups remain mandatory.

Backup requirements:

- export roles, schema, data, and `supabase_migrations` history;
- encrypt the archive before off-site transfer;
- keep database credentials and dumps outside Git;
- verify SHA-256 before and after transfer;
- back up `event-covers` object bytes separately from database metadata;
- separately inventory Edge Function deployments/secrets, Google Auth provider configuration, and other platform settings.

Restore rehearsal requirements:

- use an isolated non-production destination;
- never restore the rehearsal bundle into project `mwtlsnneooxmryondrex`;
- unschedule all restored cron jobs before verification;
- disable restored external alert delivery before verification;
- run `scripts/verify-restored-database.sql`;
- only re-enable cron/outbound integrations after destination-specific credentials and settings are deliberately configured.


---

# 21. Phase 7G load / chaos evidence

Phase 7G retained private evidence for production run:

`429d08d0-d992-4d8d-892b-71dc0f784eda`

Measured same-user/same-event ticket contention:

- 1 worker p95: 93.56 ms
- 4 workers p95: 240.46 ms
- 8 workers p95: 514.02 ms
- 12 workers p95: 793.56 ms

The 12-worker wave completed with zero probe failures and zero financial/event residue.

A 12-way rate-limit contention probe with limit 5 produced exactly 5 allowed and 7 rate-limited outcomes.

A controlled advisory-lock holder ran for ~900 ms while a waiter failed in ~250 ms with the expected lock-timeout SQLSTATE, leaving no blocker.

Post-wave observations:

- connection usage remained below the existing 75% warning threshold;
- blocked sessions over 30s: 0;
- idle-in-transaction over 60s: 0;
- Draw Credit integrity issue total: 0;
- Telegram delivery remained enabled/ready;
- mutation guardrails remained enabled.

Temporary Phase 7G service probe RPCs were removed from the public schema after the run and retained only as private, externally non-executable historical helpers. The production alert dispatcher no longer contains the temporary Phase 7G suite action.

Phase 7G does not establish a maximum system capacity. Its measured launch target for the tested contention envelope is p95 < 1 second at <=12 concurrent same-row ticket workers. Aggregate multi-user capacity requires future traffic evidence.
