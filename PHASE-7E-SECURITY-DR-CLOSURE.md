# Phase 7E — Security & Disaster-Recovery Closure

Date: 2026-10-07  
Product: **Lootera**  
Domain: **lootera.win**  
Supabase project ref: `mwtlsnneooxmryondrex`

## Scope

Phase 7E closes the remaining production-security and recovery-readiness gaps that can be handled safely through the connected GitHub/Supabase surfaces.

It does **not** pretend that an off-site backup exists until a real encrypted archive has actually been exported and transferred.

## Production security baseline

Observed at Phase 7E start:

- Supabase project healthy, PostgreSQL 17.
- Auth users: 7.
- Auth identities: Google = 7.
- Email/password users: 0.
- Authenticated-executable private `SECURITY DEFINER`: 0.
- Intentional anonymous `SECURITY DEFINER` allowlist:
  - `get_platform_features()`
  - `get_public_event_winners(uuid)`
- Production SLO: OK.
- Draw Credit integrity: OK, issue total 0.
- Telegram alert delivery: enabled, paired, healthy.
- Alert dead letters: 0.

## Leaked-password protection advisor

Supabase Security Advisor reports leaked-password protection disabled.

Current Supabase documentation states leaked-password protection is available on **Pro Plan and above**.

Lootera currently uses Google identities only and has **zero password users**, so this warning is not an active password-auth exposure on the current Free-plan configuration.

Policy:

- do not claim the warning is fixed;
- treat it as **plan-gated / currently non-applicable** while password login remains disabled;
- if Lootera enables password authentication or upgrades to Pro+, enable leaked-password protection before considering password auth production-ready.

## Retired Edge Functions

Retired stubs:

- `phone-bridge`
- `bridge-device-admin`
- `claim-demo-credit`

Current replacements:

- `support-phone-bridge`
- `support-device-admin`
- `claim-support-points`

Phase 7E re-verified:

- all three retired functions are inert HTTP 410 stubs;
- the latest 24-hour function-log window shows no invocation for any retired stub;
- current Support/admin/Telegram functions have activity;
- the connected Supabase MCP surface exposes list/get/deploy but **no Edge Function delete action**.

Therefore physical deletion remains an operator action through Dashboard/CLI. No fake deletion or unsafe replacement was attempted.

## pg_net advisor warning

Security Advisor reports `pg_net` installed in the `public` schema.

Live extension metadata reports:

- version: 0.20.4
- relocatable: **false**

Phase 7E does not attempt an unsupported `ALTER EXTENSION ... SET SCHEMA` just to silence the advisor.

The extension exists specifically for the internal production-alert dispatcher.

## Private-table RLS advisor INFO

The alert delivery config/outbox tables are in the private schema with:

- RLS enabled;
- no permissive RLS policies;
- direct grants revoked from anon/authenticated/service_role.

The resulting “RLS enabled, no policy” INFO findings are intentional deny-by-default defense in depth.

## Performance cleanup

Phase 7E adds covering indexes for the two advisor-reported unindexed private foreign keys:

- `production_alert_delivery_config(updated_by)`
- `production_incident_acknowledgements(acknowledged_by)`

No 7-day-evidence-dependent “unused” index is removed.

Post-migration advisor re-run confirms the `unindexed_foreign_keys` finding is gone. The two new FK indexes now appear as fresh `unused_index` INFO entries, which is expected immediately after creation and is not evidence that they should be removed.

## Free-plan backup reality

Current Supabase documentation recommends Free-plan projects regularly export their own data and keep off-site backups. Scheduled platform backups are documented for Pro/Team/Enterprise.

A Supabase logical database dump contains database/schema/auth rows and Storage metadata, but **not Storage object bytes**, Edge Function deployment/secrets, OAuth provider configuration, custom DNS, or other platform configuration.

## Encrypted backup export

`scripts/export-offsite-backup.sh` now:

- refuses to place production backups inside the Git repository;
- exports roles, schema and data using `supabase db dump`;
- exports `supabase_migrations` schema + data separately;
- excludes known Storage vector internals from the data dump;
- builds an internal manifest and SHA-256 file;
- requires an **age** public recipient by default;
- creates an encrypted `.tar.gz.age` archive;
- deletes raw staging SQL after encryption;
- produces an outer checksum file for transfer verification;
- records that Storage object bytes, Edge secrets and Auth-provider configuration are not included.

Plaintext backup requires the explicit exceptional override:

`ALLOW_PLAINTEXT_BACKUP=1`

That override is for disposable local testing only, not the production backup procedure.

## Restore rehearsal guard

`scripts/restore-offsite-backup.sh`:

- requires explicit `RESTORE_CONFIRM=LOOTERA_RESTORE_REHEARSAL`;
- requires a separate `RESTORE_DB_URL`;
- **refuses** any destination URL containing the Lootera production project ref;
- decrypts age archives;
- verifies the internal SHA-256 manifest;
- restores roles/schema/data following the Supabase documented order;
- restores migration history;
- immediately **unschedules** restored cron jobs and disables external alert delivery;
- runs `scripts/verify-restored-database.sql`.

## Restore verification

The restore verification checks:

- critical application tables exist;
- critical RPC/private integrity functions exist;
- critical public tables retained RLS;
- authenticated users cannot directly execute private SECURITY DEFINER helpers;
- Draw Credit integrity passes;
- no open lottery failure incident exists;
- cron jobs are absent/unscheduled in the rehearsal environment;
- external alert delivery is disabled in the rehearsal environment;
- key restored row counts are printed for comparison.

## What remains genuinely incomplete

A real encrypted off-site backup and a real restore rehearsal still require credentials/destinations that are intentionally unavailable to this chat connection:

1. a private production database connection string/password;
2. an age recipient/private identity controlled by the operator;
3. encrypted off-site storage;
4. a separate restore target (or self-hosted test instance).

Until those are supplied and the archive is actually exported/restored, GitHub issue #61 must remain open.

The restore verifier itself was exercised safely against production inside a transaction: all cron jobs were temporarily unscheduled and external alert delivery disabled, the verifier passed, and the transaction was rolled back. Post-rollback verification confirmed all 7 production cron jobs returned, Telegram remained enabled/ready, and production SLO remained OK. This validates the verifier logic; it is **not** a substitute for restoring a real backup into an isolated destination.

## Phase 7E security exceptions

Accepted/documented, not “fixed”:

1. leaked-password protection — Pro-only and current app has zero password users;
2. `pg_net` public-schema warning — extension is non-relocatable;
3. private RLS/no-policy INFO — intentional deny-by-default;
4. retired Edge stubs — inert/unused but physical deletion blocked by connected tool capability.

These exceptions must be re-reviewed if the plan, auth model, extension capabilities or connected management surface changes.
