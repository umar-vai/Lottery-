-- Admin-controlled platform feature switches.
-- Master OFF pauses public Events + Game Zone without deleting data.

create table if not exists public.platform_controls (
  id smallint primary key default 1 check (id=1),
  entertainment_enabled boolean not null default true,
  events_enabled boolean not null default true,
  game_zone_enabled boolean not null default true,
  slot_enabled boolean not null default true,
  plinko_enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

insert into public.platform_controls(id,entertainment_enabled,events_enabled,game_zone_enabled,slot_enabled,plinko_enabled)
values(1,false,true,true,true,true)
on conflict(id) do update set entertainment_enabled=false, updated_at=now();

alter table public.platform_controls enable row level security;
revoke all on public.platform_controls from public, anon, authenticated;

create or replace function private.platform_feature_enabled(p_feature text)
returns boolean language sql stable security definer
set search_path='pg_catalog','public','private'
as $$
  select case lower(coalesce(p_feature,''))
    when 'master' then c.entertainment_enabled
    when 'events' then c.entertainment_enabled and c.events_enabled
    when 'game_zone' then c.entertainment_enabled and c.game_zone_enabled
    when 'slot' then c.entertainment_enabled and c.game_zone_enabled and c.slot_enabled
    when 'plinko' then c.entertainment_enabled and c.game_zone_enabled and c.plinko_enabled
    else false end
  from public.platform_controls c where c.id=1;
$$;
revoke all on function private.platform_feature_enabled(text) from public, anon, authenticated;

create or replace function public.get_platform_features()
returns jsonb language sql stable security definer
set search_path='pg_catalog','public','private'
as $$
  select jsonb_build_object(
    'master',c.entertainment_enabled,
    'events',c.entertainment_enabled and c.events_enabled,
    'gameZone',c.entertainment_enabled and c.game_zone_enabled,
    'slot',c.entertainment_enabled and c.game_zone_enabled and c.slot_enabled,
    'plinko',c.entertainment_enabled and c.game_zone_enabled and c.plinko_enabled,
    'configured',jsonb_build_object('events',c.events_enabled,'gameZone',c.game_zone_enabled,'slot',c.slot_enabled,'plinko',c.plinko_enabled),
    'updatedAt',c.updated_at
  ) from public.platform_controls c where c.id=1;
$$;
revoke all on function public.get_platform_features() from public;
grant execute on function public.get_platform_features() to anon, authenticated;

create or replace function public.admin_set_platform_features(
  p_master boolean default null,
  p_events boolean default null,
  p_game_zone boolean default null,
  p_slot boolean default null,
  p_plinko boolean default null
)
returns jsonb language plpgsql security definer
set search_path='pg_catalog','public','private'
as $$
declare v_before jsonb; v_after jsonb; v_uid uuid:=auth.uid();
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  select public.get_platform_features() into v_before;
  update public.platform_controls set
    entertainment_enabled=coalesce(p_master,entertainment_enabled),
    events_enabled=coalesce(p_events,events_enabled),
    game_zone_enabled=coalesce(p_game_zone,game_zone_enabled),
    slot_enabled=coalesce(p_slot,slot_enabled),
    plinko_enabled=coalesce(p_plinko,plinko_enabled),
    updated_at=now(),updated_by=v_uid
  where id=1;
  select public.get_platform_features() into v_after;
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,old_data,new_data)
  values(v_uid,'update_platform_features','platform_controls','1',v_before,v_after);
  return v_after;
end;
$$;
revoke all on function public.admin_set_platform_features(boolean,boolean,boolean,boolean,boolean) from public, anon;
grant execute on function public.admin_set_platform_features(boolean,boolean,boolean,boolean,boolean) to authenticated;

-- Public participation RPCs check private.platform_feature_enabled(...) before mutating state.
-- The deployed migration updates: purchase_event_ticket -> events,
-- spin_slot -> slot, drop_plinko -> plinko, private.run_lottery_event_internal -> events,
-- and private.run_due_lottery_events returns 0 while events are paused.
