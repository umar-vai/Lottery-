-- Phase 5 production-readiness hardening.
-- Keep the current browser RPC signatures, but enforce the guarded lifecycle at the database boundary.

create or replace function public.admin_create_lottery_event_v3(
  p_title text,
  p_slug text,
  p_description text,
  p_ticket_price numeric,
  p_max_tickets_per_user integer,
  p_max_players integer,
  p_max_total_tickets integer,
  p_white_ball_count smallint,
  p_white_ball_max smallint,
  p_bonus_ball_enabled boolean,
  p_bonus_ball_max smallint,
  p_schedule_mode text,
  p_opens_at timestamptz,
  p_cutoff_at timestamptz,
  p_draw_at timestamptz,
  p_winner_prizes numeric[],
  p_publish boolean default false
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare
  v_id uuid;
  v_slug text;
  v_total_prize numeric;
  v_count integer;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;

  -- Phase 5: publication must always pass the guided lifecycle review/reason gate.
  if coalesce(p_publish,false) then
    raise exception 'Direct publish is disabled. Create the lottery as a draft, then use admin_publish_lottery_event.';
  end if;

  if nullif(trim(p_title),'') is null then raise exception 'Event title is required'; end if;
  if p_ticket_price is null or p_ticket_price<0 then raise exception 'Ticket price must be zero or greater'; end if;
  if p_max_tickets_per_user is null or p_max_tickets_per_user<1 or p_max_tickets_per_user>1000 then raise exception 'Per-player ticket limit must be between 1 and 1000'; end if;
  if p_max_players is not null and (p_max_players<1 or p_max_players>1000000) then raise exception 'Max players must be between 1 and 1000000, or left unlimited'; end if;
  if p_max_total_tickets is not null and (p_max_total_tickets<1 or p_max_total_tickets>10000000) then raise exception 'Max total tickets must be between 1 and 10000000, or left unlimited'; end if;
  if p_white_ball_count is null or p_white_ball_max is null or p_white_ball_count<1 or p_white_ball_count>10 or p_white_ball_count>p_white_ball_max or p_white_ball_max>500 then raise exception 'Invalid number rules'; end if;
  if p_bonus_ball_enabled and (p_bonus_ball_max is null or p_bonus_ball_max<1 or p_bonus_ball_max>500) then raise exception 'Invalid bonus ball range'; end if;
  if p_schedule_mode not in ('scheduled','manual') then raise exception 'Invalid schedule mode'; end if;
  if p_schedule_mode='scheduled' and (p_opens_at is null or p_cutoff_at is null or p_draw_at is null or p_opens_at>=p_cutoff_at or p_cutoff_at>=p_draw_at) then raise exception 'Invalid event schedule'; end if;
  if p_winner_prizes is null or cardinality(p_winner_prizes)<1 or cardinality(p_winner_prizes)>100 then raise exception 'Configure between 1 and 100 winners'; end if;
  if exists(select 1 from unnest(p_winner_prizes) x where x<0) then raise exception 'Winner prizes cannot be negative'; end if;
  if p_max_total_tickets is not null and cardinality(p_winner_prizes)>p_max_total_tickets then raise exception 'Winner count cannot exceed maximum total tickets'; end if;

  v_count:=cardinality(p_winner_prizes);
  select coalesce(sum(x),0) into v_total_prize from unnest(p_winner_prizes) x;
  v_slug:=lower(regexp_replace(coalesce(nullif(trim(p_slug),''),trim(p_title)),'[^a-zA-Z0-9]+','-','g'));
  v_slug:=trim(both '-' from v_slug);
  if v_slug='' then v_slug:='event'; end if;
  if exists(select 1 from public.lottery_events where slug=v_slug) then
    v_slug:=v_slug||'-'||substring(replace(gen_random_uuid()::text,'-','') from 1 for 6);
  end if;

  insert into public.lottery_events(
    slug,title,description,status,ticket_price,prize_amount,prize_mode,max_tickets_per_user,max_players,max_total_tickets,
    white_ball_count,white_ball_max,bonus_ball_enabled,bonus_ball_max,opens_at,cutoff_at,draw_at,created_by,schedule_mode,winner_count
  ) values(
    v_slug,trim(p_title),nullif(trim(p_description),''),'draft',
    p_ticket_price,v_total_prize,'ranked',p_max_tickets_per_user,p_max_players,p_max_total_tickets,
    p_white_ball_count,p_white_ball_max,p_bonus_ball_enabled,case when p_bonus_ball_enabled then p_bonus_ball_max else 1 end,
    coalesce(p_opens_at,now()),case when p_schedule_mode='manual' then null else p_cutoff_at end,
    case when p_schedule_mode='manual' then null else p_draw_at end,(select auth.uid()),p_schedule_mode,v_count
  ) returning id into v_id;

  insert into public.event_prize_tiers(event_id,rank,prize_amount)
  select v_id,ord::integer,val from unnest(p_winner_prizes) with ordinality as x(val,ord);

  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,new_data)
  values((select auth.uid()),'create_lottery_event','lottery_event',v_id::text,
    jsonb_build_object('title',trim(p_title),'slug',v_slug,'status','draft',
      'ticket_price',p_ticket_price,'schedule_mode',p_schedule_mode,'winner_count',v_count,'winner_prizes',to_jsonb(p_winner_prizes),
      'max_players',p_max_players,'max_total_tickets',p_max_total_tickets,'max_tickets_per_user',p_max_tickets_per_user));

  return v_id;
end;
$function$;

create or replace function public.admin_update_lottery_event_v3(
  p_event_id uuid,
  p_title text,
  p_slug text,
  p_description text,
  p_ticket_price numeric,
  p_max_tickets_per_user integer,
  p_max_players integer,
  p_max_total_tickets integer,
  p_white_ball_count smallint,
  p_white_ball_max smallint,
  p_bonus_ball_enabled boolean,
  p_bonus_ball_max smallint,
  p_schedule_mode text,
  p_opens_at timestamptz,
  p_cutoff_at timestamptz,
  p_draw_at timestamptz,
  p_winner_prizes numeric[],
  p_status text
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare
  v_old public.lottery_events%rowtype;
  v_slug text;
  v_ticket_count integer;
  v_player_count integer;
  v_max_user_tickets integer;
  v_total_prize numeric;
  v_count integer;
  v_old_prizes numeric[];
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if p_status not in ('draft','published','cancelled') then raise exception 'Invalid status'; end if;
  if nullif(trim(p_title),'') is null then raise exception 'Event title is required'; end if;
  if p_ticket_price is null or p_ticket_price<0 then raise exception 'Ticket price must be non-negative'; end if;
  if p_max_tickets_per_user is null or p_max_tickets_per_user<1 or p_max_tickets_per_user>1000 then raise exception 'Invalid per-player ticket limit'; end if;
  if p_max_players is not null and (p_max_players<1 or p_max_players>1000000) then raise exception 'Invalid max players'; end if;
  if p_max_total_tickets is not null and (p_max_total_tickets<1 or p_max_total_tickets>10000000) then raise exception 'Invalid max total tickets'; end if;
  if p_white_ball_count is null or p_white_ball_max is null or p_white_ball_count<1 or p_white_ball_count>10 or p_white_ball_count>p_white_ball_max or p_white_ball_max>500 then raise exception 'Invalid number rules'; end if;
  if p_bonus_ball_enabled and (p_bonus_ball_max is null or p_bonus_ball_max<1 or p_bonus_ball_max>500) then raise exception 'Invalid bonus ball range'; end if;
  if p_schedule_mode not in ('scheduled','manual') then raise exception 'Invalid schedule mode'; end if;
  if p_schedule_mode='scheduled' and (p_opens_at is null or p_cutoff_at is null or p_draw_at is null or p_opens_at>=p_cutoff_at or p_cutoff_at>=p_draw_at) then raise exception 'Invalid event schedule'; end if;
  if p_winner_prizes is null or cardinality(p_winner_prizes)<1 or cardinality(p_winner_prizes)>100 then raise exception 'Configure between 1 and 100 winners'; end if;
  if exists(select 1 from unnest(p_winner_prizes) x where x<0) then raise exception 'Winner prizes cannot be negative'; end if;
  if p_max_total_tickets is not null and cardinality(p_winner_prizes)>p_max_total_tickets then raise exception 'Winner count cannot exceed maximum total tickets'; end if;

  v_count:=cardinality(p_winner_prizes);
  select coalesce(sum(x),0) into v_total_prize from unnest(p_winner_prizes) x;

  select * into v_old from public.lottery_events where id=p_event_id for update;
  if not found then raise exception 'Event not found'; end if;
  if v_old.status='completed' then raise exception 'Completed events cannot be edited'; end if;

  -- Phase 5 lifecycle state machine.
  if v_old.status='draft' and p_status='published' then
    raise exception 'Direct draft-to-published update is disabled. Use admin_publish_lottery_event.';
  end if;
  if v_old.status='published' and p_status='draft' then
    raise exception 'Published lotteries cannot return to draft. Cancel or relaunch instead.';
  end if;
  if v_old.status='cancelled' and p_status<>'cancelled' then
    raise exception 'Cancelled lotteries cannot be republished or returned to draft. Relaunch a fresh draft instead.';
  end if;

  v_slug:=lower(regexp_replace(coalesce(nullif(trim(p_slug),''),trim(p_title)),'[^a-zA-Z0-9]+','-','g'));
  v_slug:=trim(both '-' from v_slug);
  if v_slug='' or exists(select 1 from public.lottery_events where slug=v_slug and id<>p_event_id) then
    raise exception 'Invalid or duplicate public slug';
  end if;

  select count(*),count(distinct user_id) into v_ticket_count,v_player_count
  from public.event_tickets where event_id=p_event_id;

  select coalesce(max(c),0)::integer into v_max_user_tickets
  from (select count(*)::integer c from public.event_tickets where event_id=p_event_id group by user_id) q;

  select array_agg(pt.prize_amount order by pt.rank) into v_old_prizes
  from public.event_prize_tiers pt
  where pt.event_id=p_event_id;

  if v_ticket_count>0 and (
    p_ticket_price<>v_old.ticket_price
    or p_white_ball_count<>v_old.white_ball_count
    or p_white_ball_max<>v_old.white_ball_max
    or p_bonus_ball_enabled<>v_old.bonus_ball_enabled
    or (p_bonus_ball_enabled and p_bonus_ball_max<>v_old.bonus_ball_max)
  ) then
    raise exception 'Ticket price and number rules are locked after the first ticket is sold';
  end if;

  -- Once players have purchased tickets, advertised winner ranks/prizes are immutable.
  if v_ticket_count>0 and v_old_prizes is distinct from p_winner_prizes then
    raise exception 'Winner prize tiers are locked after the first ticket is sold';
  end if;

  if p_max_tickets_per_user<v_max_user_tickets then raise exception 'Per-player ticket limit cannot be lower than a player already owns'; end if;
  if p_max_players is not null and p_max_players<v_player_count then raise exception 'Max players cannot be lower than the current player count (%)',v_player_count; end if;
  if p_max_total_tickets is not null and p_max_total_tickets<v_ticket_count then raise exception 'Max total tickets cannot be lower than the current ticket count (%)',v_ticket_count; end if;

  update public.lottery_events set
    title=trim(p_title),slug=v_slug,description=nullif(trim(p_description),''),ticket_price=p_ticket_price,
    prize_amount=v_total_prize,prize_mode='ranked',max_tickets_per_user=p_max_tickets_per_user,
    max_players=p_max_players,max_total_tickets=p_max_total_tickets,
    white_ball_count=p_white_ball_count,white_ball_max=p_white_ball_max,bonus_ball_enabled=p_bonus_ball_enabled,
    bonus_ball_max=case when p_bonus_ball_enabled then p_bonus_ball_max else 1 end,
    opens_at=coalesce(p_opens_at,opens_at,now()),
    cutoff_at=case when p_schedule_mode='manual' then null else p_cutoff_at end,
    draw_at=case when p_schedule_mode='manual' then null else p_draw_at end,
    schedule_mode=p_schedule_mode,winner_count=v_count,status=p_status,updated_at=now()
  where id=p_event_id;

  delete from public.event_prize_tiers where event_id=p_event_id;
  insert into public.event_prize_tiers(event_id,rank,prize_amount)
  select p_event_id,ord::integer,val from unnest(p_winner_prizes) with ordinality as x(val,ord);

  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,old_data,new_data)
  select (select auth.uid()),'update_lottery_event','lottery_event',p_event_id::text,to_jsonb(v_old),
    to_jsonb(e)||jsonb_build_object('winner_prizes',to_jsonb(p_winner_prizes))
  from public.lottery_events e where e.id=p_event_id;
end;
$function$;

comment on function public.admin_create_lottery_event_v3(
  text,text,text,numeric,integer,integer,integer,smallint,smallint,boolean,smallint,text,timestamptz,timestamptz,timestamptz,numeric[],boolean
) is 'Canonical admin lottery creation RPC. Phase 5 requires draft creation followed by guarded admin_publish_lottery_event.';

comment on function public.admin_update_lottery_event_v3(
  uuid,text,text,text,numeric,integer,integer,integer,smallint,smallint,boolean,smallint,text,timestamptz,timestamptz,timestamptz,numeric[],text
) is 'Canonical admin lottery update RPC. Phase 5 enforces lifecycle transitions and locks prize tiers after ticket sales.';
