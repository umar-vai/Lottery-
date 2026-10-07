# Lootera Developer Handoff

> Read this first when taking over the project.
>
> Current production snapshot: 2026-10-05  
> Repository: `umar-vai/Lottery-`  
> Branch: `main`  
> Public site: `https://umar-vai.github.io/Lottery-/`  
> Admin: `https://umar-vai.github.io/Lottery-/ops-v4.html`  
> Supabase project ref: `mwtlsnneooxmryondrex`

Related documents:

- [`ARCHITECTURE.md`](./ARCHITECTURE.md)
- [`DATABASE.md`](./DATABASE.md)

---

# 1. Project summary in one minute

Lootera is a static GitHub Pages application with a Supabase backend.

Current primary product model:

```text
Google Auth
   -> profile
   -> Draw Credit balance
   -> choose event
   -> buy event ticket through PostgreSQL RPC
   -> event ticket enters event-specific pool
   -> admin/cron draw selects ranked winner tickets from existing pool
   -> prize credits are added
   -> public completed-event result shows winners
```

A second system called **Development Support Points** exists beside it:

```text
phone bKash received-money notification
   -> MacroDroid
   -> support-phone-bridge Edge Function
   -> support transaction metadata
   -> user sender + TrxID claim
   -> match/settle
   -> Support Points wallet
```

**Support Points and Draw Credits are intentionally separate.**

Do not make Support Points spendable on draw tickets or merge the two balance fields.

---

# 2. Required developer profile

Best fit:

**Senior Full-Stack JavaScript + Supabase/PostgreSQL developer**

Required skills:

- strong vanilla JavaScript
- HTML/CSS and responsive UI
- Supabase Auth
- Supabase/PostgREST
- PostgreSQL
- PL/pgSQL RPC functions
- RLS
- `SECURITY DEFINER` security
- SQL transactions/locking
- Git/GitHub
- GitHub Actions + Pages
- REST APIs
- reverse engineering an existing codebase

Useful but not mandatory:

- Supabase Edge Functions / Deno
- pg_cron
- Supabase Storage
- Android/MacroDroid notification automation
- automated browser/integration testing

React/Next.js experience is not required for initial maintenance because the current frontend is not a React application.

---

# 3. Access the developer should receive

Minimum:

1. GitHub access to `umar-vai/Lottery-`
2. Supabase project access to `Lottery DRAW01`
3. ability to inspect Auth, Database, Storage, Edge Functions and logs
4. a non-owner test Google account
5. an admin-role test account
6. access to the GitHub Pages deployment workflow

For support-bridge work, developer may also need temporary physical access to the Android phone running MacroDroid, but bridge secrets should be rotated after handoff/testing.

Never send these through chat/tickets/docs:

- Supabase service-role key
- Google OAuth Client Secret
- raw phone bridge token
- user passwords/PINs/OTPs

The repository's Supabase publishable key is public browser configuration, not a server secret.

---

# 4. First-day reading order

Do not start by reading every file alphabetically.

Read in this order:

1. `DEVELOPER-HANDOFF.md`
2. `ARCHITECTURE.md`
3. `DATABASE.md`
4. `index.html`
5. `site-shell.js`
6. `home-v2.js`
7. `event.html`
8. `event.js`
9. `ops-v4.html`
10. `ops-v4.js`
11. `admin-v5.js`
12. `admin-v6.js`
13. `event-cover-admin.js`
14. `support-center.js`
15. `support-live.js`
16. `support-wallet-admin.js`
17. `credit-center.js`
18. `credit-admin.js`
19. `.github/workflows/pages.yml`
20. only then review `README.md`, `app.js`, and old Powerball SQL as legacy/reference material

Important: the original `README.md` describes the first Powerball-style version and is not sufficient documentation for the current multi-event system.

---

# 5. Active frontend map

## Public homepage

```text
index.html
  + site-shell.js / site-shell.css
  + home-v2.js
  + home-v2.css / home-v3.css / events-home.css
  + home-mobile-hotfix.css
  + support-live.js / support-live.css
```

Main job: event discovery, winners, balance/user shell.

## Event page

```text
event.html
  + event.js
  + event.css / event-v2.css / event-cover.css
  + winner-display-v2.js / winner-display-v2.css
  + site-shell.js
```

Main job: one event, number selection, Quick Pick, own tickets, ticket purchase, result.

## Admin

```text
ops-v4.html
  + ops-v4.js
  + ops-v2.css / ops-events.css / ops-v4.css
  + admin-v5.js / admin-v5.css
  + admin-v6.js / admin-v6.css
  + event-cover-admin.js / event-cover-admin.css
  + credit-admin.js / credit-admin.css
  + support-wallet-admin.js / support-wallet-admin.css
  + shared assets loaded by site-shell.js
```

The admin is layered. `ops-v4.js` is the base; V5/V6 scripts extend/replace parts of the UI.

Do not edit `admin.html` expecting it to change the live admin experience.

---

# 6. Local development

Because the public app is static, no frontend build command is required.

Clone:

```bash
git clone https://github.com/umar-vai/Lottery-.git
cd Lottery-
```

Run a local HTTP server. For example:

```bash
python3 -m http.server 8080
```

Then open:

```text
http://localhost:8080/
```

Do not use `file://` for serious testing because ES modules, OAuth behavior, storage/network behavior and browser security can differ.

Supabase Edge Functions already allow localhost origins in the current support function CORS logic, but verify exact origin/port behavior if adding a new local tool.

### OAuth warning

Production Google OAuth redirects to the GitHub Pages application URL. Local OAuth testing may require adding a permitted redirect URL in Supabase/Google configuration. Do not change production redirect settings casually.

---

# 7. Production deployment

Frontend deployment is automatic from `main`.

Workflow:

```text
.github/workflows/pages.yml
```

Every push to `main` starts a GitHub Pages deploy. Concurrency is configured to cancel older in-progress Pages deployments.

Before saying a change is live:

1. push/commit change
2. check the latest GitHub Actions Pages run
3. wait for `conclusion: success`
4. load the live URL
5. test logged-out and logged-in state where relevant

Do not rely only on the GitHub commit existing.

---

# 8. Authentication model

Google OAuth through Supabase Auth.

Current public callback base:

```text
https://umar-vai.github.io/Lottery-/
```

Application user row:

```text
profiles.id == auth user UUID
```

Role:

```text
profiles.role
```

Expected roles:

- `player`
- `admin`

Never use only frontend visibility (`Admin Panel` button hidden/shown) as authorization. Database RPCs/RLS must enforce admin access.

---

# 9. Draw Credit rules

Source of truth:

```text
profiles.balance
```

Ticket purchases and prizes are virtual-credit simulation operations.

Use protected RPC paths for balance changes.

Core purchase RPC:

```text
purchase_event_ticket(...)
```

Admin balance RPC:

```text
admin_set_user_balance(...)
```

Accounting history:

```text
balance_ledger
```

Do not implement a sensitive balance mutation as:

```javascript
supabase.from('profiles').update({ balance: ... })
```

from the browser.

Sensitive changes belong in a server-authoritative transaction/RPC.

---

# 10. Event rules that must not be broken

A current event can configure:

- event title/slug/description
- ticket price
- max tickets per user
- optional max players
- optional max total tickets
- number count/range
- optional bonus ball/range
- scheduled/manual mode
- opens/cutoff/draw times
- N ranked winners
- prize per rank
- cover image

Draw requirements:

1. winner must be an **existing ticket**
2. ticket must belong to the same event
3. no fabricated ticket at draw time
4. one rank maps to one configured prize
5. ticket count must be >= winner count
6. historical completed event tickets/ranks/prizes should not be silently rewritten
7. prize credit + ledger must remain consistent

If changing draw code, add tests before changing selection behavior.

---

# 11. Automatic draw behavior

Production cron:

```text
* * * * * -> select private.run_due_lottery_events();
```

Due scheduled events are processed from PostgreSQL.

Manual events are run by admin action.

Do not add a second scheduler for the same events without first understanding idempotency/locking, or two workers could race.

---

# 12. Completed-event behavior

Completed events are treated as historical records.

Allowed safe metadata edit path:

```text
admin_update_completed_event_metadata(...)
```

This only changes public metadata.

Relaunch path:

```text
admin_relaunch_lottery_event(...)
```

It creates a new draft with copied configuration/prize tiers/cover while leaving old tickets and winners intact.

Do not "reopen" a completed event by clearing winner flags and reusing the same event ID unless product requirements explicitly change and historical integrity is addressed.

---

# 13. Support Points rules

Source of truth:

```text
support_wallets.balance
```

Hard constraints:

- Support Points are not Draw Credits
- cannot buy tickets
- cannot change odds
- cannot create prize eligibility
- cannot be withdrawn
- cannot be converted to cash
- should not be added to `profiles.balance`

Current Support Points are a development-support record.

### Current settlement flow

```text
MacroDroid notification
 -> support-phone-bridge
 -> support_transactions
 -> pending support claim match
 -> support_wallets
 -> support_point_claims
```

User claim UI:

```text
support-center.js
 -> claim-support-points Edge Function
 -> service_submit_support_claim(...)
```

A claim can remain pending for up to its configured expiration period and settle automatically when matching transaction metadata arrives later.

---

# 14. Phone / MacroDroid bridge

Current device endpoint:

```text
/functions/v1/support-phone-bridge
```

Request auth:

```text
x-bridge-token: <raw device token>
```

The raw token is hashed and compared with:

```text
support_bridge_devices.token_hash
```

MacroDroid currently listens to the Android Messages notification and sends transaction notification content to the endpoint. The backend filters for received-money format and rejects authentication-message patterns such as OTP/PIN/password/verification-code text.

If rebuilding the Android side, prefer sending only structured transaction metadata:

- TrxID
- sender hash
- sender last 4
- amount
- received timestamp
- fingerprint

rather than raw message content.

### Secret rotation

If a bridge token appears in a screenshot, issue tracker, chat or source file:

1. revoke/disable the device token
2. create a fresh one
3. update MacroDroid
4. verify old token returns unauthorized

Never put a raw bridge token into these documentation files.

---

# 15. Edge Functions: what is current

Current support path:

- `support-phone-bridge`
- `support-device-admin`
- `claim-support-points`

Legacy:

- `phone-bridge`
- `bridge-device-admin`

Decommissioned demo endpoint:

- `claim-demo-credit` — now returns `410 Gone`

The demo-credit UI/tables/sandbox ticket lab were removed.

A future infrastructure cleanup should delete deprecated Edge Functions from Supabase after confirming no callers remain.

---

# 16. Important current technical debt

A developer should know these before adding features.

## A. Live DB is ahead of repo SQL

The original SQL files do not fully reproduce production.

Before migrations, inspect live:

- schema
- functions
- RLS
- triggers
- indexes
- grants
- Edge Functions

Then create proper migration files.

## B. Edge Function source is not fully in Git

Current support Edge Function code exists in Supabase production but is not fully mirrored under `supabase/functions/`.

Fix this early.

## C. Duplicate auth implementations

Some files use Supabase JS; others manually read `localStorage` auth objects.

Centralize later, but do not rewrite auth on day one unless tests exist.

## D. Layered admin

V4/V5/V6 scripts mutate the same admin DOM. Understand load order before changing markup/IDs.

## E. Legacy Powerball subsystem

Old tables/functions/files remain. Do not delete them simply because the new event system is active.

## F. Storage upload race

Cover upload can occur before event association is finalized, potentially leaving orphaned files.

## G. Polling

Several modules refresh with intervals. Avoid accidentally creating overlapping high-frequency polling loops.

## H. Profile UPDATE policy needs security review

Production currently has an own-profile UPDATE policy. Verify that database privileges/policies prevent ordinary users from changing sensitive `balance` or `role` columns directly.

This should be one of the first security checks by the incoming developer.

---

# 17. Three-day takeover plan

## Day 1 — Understand and reproduce

Goal: no feature development until the developer can explain the system.

Tasks:

1. clone repo and run locally
2. read the three handoff docs
3. map current frontend entry points
4. inspect production Supabase tables/RPC/RLS/cron/Edge Functions
5. sign in as normal player
6. inspect one active event
7. inspect `purchase_event_ticket`
8. inspect admin as admin user
9. trace one ticket purchase to `event_tickets` + `balance_ledger`
10. trace one completed event to winner rows/prize credits
11. trace Support Points claim tables/functions
12. write down active vs legacy files

Day-1 acceptance test:

Developer should be able to answer:

- Which function actually deducts ticket credit?
- Which table is the Draw Credit source of truth?
- Which table is the Support Point source of truth?
- How is an admin determined?
- How does a scheduled draw run?
- How are winners selected?
- Why can a user not read another user's event tickets?
- Which files are the live admin entry point?

## Day 2 — Stabilize + first feature

Suggested tasks:

1. source-control live Edge Functions
2. add missing migration snapshots/forward migrations
3. add smoke tests
4. fix one contained feature/bug
5. test normal/admin auth
6. verify Pages deploy

Do not combine a framework rewrite with feature delivery on day 2.

## Day 3 — New features + hardening

Suggested tasks:

1. implement agreed features
2. concurrent ticket/capacity tests
3. RLS/security review
4. mobile testing
5. admin regression tests
6. production deployment
7. update handoff docs with any architecture changes

---

# 18. Smoke-test checklist after any important change

### Public

- homepage loads logged out
- event cards load
- completed events load
- event page loads by slug
- Google login works
- user profile/balance displays
- Quick Pick works
- manual number pick works
- insufficient balance is rejected
- ticket limit is enforced
- successful ticket decreases balance once
- ticket appears in own ticket history

### Draw

- cannot draw with zero tickets
- cannot draw with fewer tickets than winner count
- ranked prizes match configured ranks
- winners come from the same event ticket pool
- winner tickets are marked correctly
- prize credits increase profile balance
- prize ledger rows exist
- event becomes completed
- public winners display correctly

### Admin

- non-admin cannot use admin RPCs
- event create/edit works
- publish works
- manual draw works
- scheduled event timing displays correctly
- completed metadata edit preserves result
- relaunch creates new draft/no copied tickets
- balance adjustment creates ledger/audit record
- cover upload displays publicly

### Support Points

- normal user can see own Support wallet only
- bridge invalid token is rejected
- valid received-money notification creates/deduplicates transaction
- OTP/PIN-style message is rejected by bridge
- unmatched claim remains pending
- later matching transaction settles pending claim
- same transaction cannot be claimed by a second user
- Support Points do not change `profiles.balance`
- Support Points cannot purchase event tickets

---

# 19. Database change checklist

Before applying a production migration:

1. identify exact current production definition
2. search repo for callers
3. search DB functions for dependencies
4. create migration
5. test on branch/staging where possible
6. confirm RLS implications
7. confirm grants/EXECUTE privileges
8. confirm rollback/recovery strategy
9. deploy
10. run smoke tests
11. update `DATABASE.md`

For destructive cleanup:

- never drop first and investigate later
- rename/deprecate before drop when feasible
- preserve historical tickets/winners/ledger/audit

---

# 20. Frontend change checklist

Before changing an ID/class on admin/public pages, search for it across:

- base JS
- V5/V6 enhancement JS
- shared shell
- CSS layers
- MutationObservers

Because several scripts inject or observe DOM added by other scripts, a harmless-looking markup rename can break another module.

When adding a new shared JS/CSS asset, choose one loading strategy:

- explicit page tag, or
- `site-shell.js` dynamic loader

Avoid both unless duplicate detection is robust by URL.

---

# 21. Source-control improvements strongly recommended

Create/maintain:

```text
supabase/
  migrations/
  functions/
    support-phone-bridge/
    support-device-admin/
    claim-support-points/
  tests/

tests/
  browser/
  database/
```

Recommended minimum test cases:

- purchase ticket atomicity
- concurrent event capacity
- winner selection only from event pool
- prize ledger consistency
- completed-event immutability expectations
- support claim duplicate protection
- RLS owner isolation
- admin authorization

---

# 22. Architecture decisions to preserve

Unless the owner explicitly changes product requirements, preserve these decisions:

1. Existing public website is a static GitHub Pages app.
2. Supabase is the authoritative backend.
3. Ticket mutation is server-authoritative.
4. Winners are selected from existing event tickets.
5. Completed historical results should remain stable.
6. Draw Credit has a ledger.
7. Support Points are isolated from Draw Credits.
8. Admin capabilities are enforced server-side, not by hidden buttons.
9. Secrets stay out of Git/browser source.
10. New database changes should be migration-driven.

---

# 23. What not to do in the first three days

Avoid:

- rewriting everything in React/Next.js
- replacing Supabase without a migration plan
- moving balance logic into browser JavaScript
- deleting old tables/functions based only on age
- editing historical winner rows manually
- making Support Points a ticket currency
- disabling RLS to make a feature work
- using the service-role key in frontend code
- committing phone bridge tokens
- running a second independent draw scheduler
- changing Google OAuth config without understanding production callback behavior

---

# 24. Handoff completion criteria

A new developer can be considered onboarded when they can, without guessing:

1. identify the current public/admin entry points
2. explain authentication and admin authorization
3. trace a ticket purchase from click to DB/ledger
4. trace an event draw from cron/admin trigger to winner credit
5. explain RLS owner isolation
6. explain the Support Points pipeline
7. identify current vs legacy subsystems
8. safely deploy a small frontend change
9. safely propose/apply a database migration
10. update these documents after architecture changes

If they cannot explain those ten items, they should not yet be making destructive database or draw-engine changes.
