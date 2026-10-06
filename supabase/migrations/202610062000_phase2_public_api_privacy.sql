-- Phase 2 — minimize anonymous/public API exposure without breaking public winner UX.

create or replace function private.public_winner_key(p_user_id uuid)
returns text
language sql
immutable
set search_path to 'pg_catalog','extensions'
as $function$
  select case
    when p_user_id is null then null
    else substring(encode(extensions.digest('winner:'||p_user_id::text,'sha256'),'hex') from 1 for 20)
  end;
$function$;

create or replace function private.public_ticket_ref(p_ticket_id uuid)
returns text
language sql
immutable
set search_path to 'pg_catalog','extensions'
as $function$
  select case
    when p_ticket_id is null then null
    else upper(substring(encode(extensions.digest('ticket:'||p_ticket_id::text,'sha256'),'hex') from 1 for 12))
  end;
$function$;

revoke all on function private.public_winner_key(uuid) from public,anon,authenticated;
revoke all on function private.public_ticket_ref(uuid) from public,anon,authenticated;

create or replace function private.sanitize_lottery_winner_summary()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $function$
declare
  v_item jsonb;
  v_safe jsonb:='[]'::jsonb;
  v_ticket public.event_tickets%rowtype;
  v_ticket_ref text;
  v_winner_key text;
begin
  if new.winner_summary is null or jsonb_typeof(new.winner_summary)<>'array' then
    return new;
  end if;

  for v_item in
    select value from jsonb_array_elements(new.winner_summary)
  loop
    v_ticket:=null;
    v_ticket_ref:=nullif(v_item->>'ticket_ref','');
    v_winner_key:=nullif(v_item->>'winner_key','');

    if v_item ? 'ticket_id' then
      select * into v_ticket
      from public.event_tickets
      where id::text=(v_item->>'ticket_id')
        and event_id=new.id
      limit 1;

      if found then
        v_ticket_ref:=coalesce(v_ticket_ref,private.public_ticket_ref(v_ticket.id));
        v_winner_key:=coalesce(v_winner_key,private.public_winner_key(v_ticket.user_id));
      end if;
    end if;

    v_safe:=v_safe||jsonb_build_array(
      jsonb_strip_nulls(
        (v_item-'ticket_id'-'user_id')
        ||jsonb_build_object(
          'ticket_ref',v_ticket_ref,
          'winner_key',v_winner_key
        )
      )
    );
  end loop;

  new.winner_summary:=v_safe;
  return new;
end;
$function$;

revoke all on function private.sanitize_lottery_winner_summary() from public,anon,authenticated;

drop trigger if exists sanitize_lottery_winner_summary on public.lottery_events;
create trigger sanitize_lottery_winner_summary
before insert or update of winner_summary on public.lottery_events
for each row execute function private.sanitize_lottery_winner_summary();

-- Backfill historical completed-event summaries through the sanitizer.
update public.lottery_events
set winner_summary=winner_summary
where winner_summary is not null
  and jsonb_typeof(winner_summary)='array'
  and jsonb_array_length(winner_summary)>0;

-- Remove raw auth/profile creator UUID from browser-readable lottery-event columns.
-- Admin actions remain attributable through the private canonical audit trail.
revoke select on table public.lottery_events from anon,authenticated;

grant select (
  id,slug,title,description,status,ticket_price,prize_amount,prize_mode,
  max_tickets_per_user,white_ball_count,white_ball_max,bonus_ball_enabled,
  bonus_ball_max,opens_at,cutoff_at,draw_at,winning_numbers,
  winning_bonus_ball,seed_commitment,seed_reveal,winning_ticket_count,
  prize_per_winning_ticket,created_at,updated_at,completed_at,schedule_mode,
  winner_count,winner_summary,max_players,max_total_tickets,cover_image_url
) on public.lottery_events to anon,authenticated;

drop function if exists public.get_public_event_winners(uuid);

create function public.get_public_event_winners(p_event_id uuid)
returns table(
  winner_key text,
  display_name text,
  avatar_url text,
  ticket_ref text,
  winner_rank integer,
  prize_awarded numeric,
  white_numbers integer[],
  bonus_ball integer
)
language sql
stable
security definer
set search_path to 'pg_catalog','public','private'
as $function$
  select
    private.public_winner_key(t.user_id) as winner_key,
    coalesce(
      nullif(trim(p.nickname),''),
      nullif(trim(p.display_name),''),
      'Player'
    ) as display_name,
    p.avatar_url,
    private.public_ticket_ref(t.id) as ticket_ref,
    t.winner_rank,
    t.prize_awarded,
    t.white_numbers,
    t.bonus_ball
  from public.event_tickets t
  join public.lottery_events e on e.id=t.event_id
  left join public.profiles p on p.id=t.user_id
  where t.event_id=p_event_id
    and e.status='completed'
    and t.is_winner=true
  order by t.winner_rank asc,t.created_at asc;
$function$;

revoke all on function public.get_public_event_winners(uuid) from public;
grant execute on function public.get_public_event_winners(uuid) to anon,authenticated;

create or replace function public.get_platform_features()
returns jsonb
language sql
stable
security definer
set search_path to 'pg_catalog','public','private'
as $function$
  select jsonb_build_object(
    'master',c.entertainment_enabled,
    'events',c.entertainment_enabled and c.events_enabled,
    'gameZone',c.entertainment_enabled and c.game_zone_enabled,
    'slot',c.entertainment_enabled and c.game_zone_enabled and c.slot_enabled,
    'plinko',c.entertainment_enabled and c.game_zone_enabled and c.plinko_enabled
  )
  from public.platform_controls c
  where c.id=1;
$function$;

revoke all on function public.get_platform_features() from public;
grant execute on function public.get_platform_features() to anon,authenticated;

drop policy if exists "love_point_payment_providers_read" on public.love_point_payment_providers;
create policy "public can read visible payment providers"
on public.love_point_payment_providers
for select
to anon,authenticated
using (public_visible=true and enabled=true);
