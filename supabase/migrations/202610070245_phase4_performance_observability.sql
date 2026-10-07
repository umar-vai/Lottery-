-- Phase 4: database/query performance + observability hardening.
-- Keep production query paths stable; remove stale browser execution grants and make
-- service-only RLS intent explicit without granting browser data access.

-- These tables are intentionally service-role / SECURITY DEFINER only.  Explicit
-- restrictive deny-all policies preserve the current deny-by-default behavior while
-- making that intent machine-visible to the database advisor.
drop policy if exists service_only_deny_all on public.draw_secrets;
create policy service_only_deny_all
  on public.draw_secrets
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

drop policy if exists service_only_deny_all on public.platform_controls;
create policy service_only_deny_all
  on public.platform_controls
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

drop policy if exists service_only_deny_all on public.support_bridge_devices;
create policy service_only_deny_all
  on public.support_bridge_devices
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

drop policy if exists service_only_deny_all on public.support_point_adjustments;
create policy service_only_deny_all
  on public.support_point_adjustments
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

drop policy if exists service_only_deny_all on public.support_transactions;
create policy service_only_deny_all
  on public.support_transactions
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

-- The admin UI has used v3 create/update RPCs since Phase 3.  Keep legacy functions
-- for rollback / historical migration compatibility, but remove them from the Data API
-- execution surface.
revoke all on function public.admin_create_lottery_event(
  text,text,text,numeric,numeric,text,integer,smallint,smallint,boolean,smallint,
  timestamptz,timestamptz,timestamptz,boolean
) from public, anon, authenticated;

revoke all on function public.admin_create_lottery_event_v2(
  text,text,text,numeric,integer,smallint,smallint,boolean,smallint,text,
  timestamptz,timestamptz,timestamptz,numeric[],boolean
) from public, anon, authenticated;

revoke all on function public.admin_update_lottery_event(
  uuid,text,text,text,numeric,numeric,text,integer,smallint,smallint,boolean,smallint,
  timestamptz,timestamptz,timestamptz,text
) from public, anon, authenticated;

revoke all on function public.admin_update_lottery_event_v2(
  uuid,text,text,text,numeric,integer,smallint,smallint,boolean,smallint,text,
  timestamptz,timestamptz,timestamptz,numeric[],text
) from public, anon, authenticated;

-- Superseded by admin_list_admin_changes_page(...), which is keyset paginated.
revoke all on function public.admin_get_admin_change_audit(integer)
  from public, anon, authenticated;

comment on function public.admin_get_admin_change_audit(integer) is
  'Deprecated browser RPC. Superseded by admin_list_admin_changes_page keyset pagination.';

comment on function public.admin_create_lottery_event(
  text,text,text,numeric,numeric,text,integer,smallint,smallint,boolean,smallint,
  timestamptz,timestamptz,timestamptz,boolean
) is 'Deprecated browser RPC. Use admin_create_lottery_event_v3.';

comment on function public.admin_create_lottery_event_v2(
  text,text,text,numeric,integer,smallint,smallint,boolean,smallint,text,
  timestamptz,timestamptz,timestamptz,numeric[],boolean
) is 'Deprecated browser RPC. Use admin_create_lottery_event_v3.';

comment on function public.admin_update_lottery_event(
  uuid,text,text,text,numeric,numeric,text,integer,smallint,smallint,boolean,smallint,
  timestamptz,timestamptz,timestamptz,text
) is 'Deprecated browser RPC. Use admin_update_lottery_event_v3.';

comment on function public.admin_update_lottery_event_v2(
  uuid,text,text,text,numeric,integer,smallint,smallint,boolean,smallint,text,
  timestamptz,timestamptz,timestamptz,numeric[],text
) is 'Deprecated browser RPC. Use admin_update_lottery_event_v3.';

-- These two anonymous SECURITY DEFINER functions are intentional narrow projections.
-- Keep the rationale next to the database objects so future advisor reviews do not
-- "fix" them by opening their underlying tables.
comment on function public.get_platform_features() is
  'Intentional anon SECURITY DEFINER projection. Returns only feature booleans while platform_controls remains direct-deny.';
comment on function public.get_public_event_winners(uuid) is
  'Intentional anon SECURITY DEFINER projection. Returns a sanitized completed-event winner projection; direct ticket/profile access remains protected.';
