-- Phase 3 — scalable admin data access.
-- Replace browser-wide preload of players, tickets and ledger with bounded admin RPCs.

create index if not exists profiles_created_id_idx
on public.profiles(created_at desc,id desc);

create index if not exists event_tickets_created_id_idx
on public.event_tickets(created_at desc,id desc);

create index if not exists event_tickets_event_created_id_idx
on public.event_tickets(event_id,created_at desc,id desc);

create index if not exists balance_ledger_created_id_idx
on public.balance_ledger(created_at desc,id desc);

create or replace function public.admin_get_admin_scalability_snapshot()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $function$
declare
  v_summary jsonb;
  v_event_stats jsonb;
  v_actor_profiles jsonb;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;

  select jsonb_build_object(
    'lotteries',(select count(*) from public.lottery_events),
    'open_events',(
      select count(*)
      from public.lottery_events e
      where e.status='published'
        and (e.opens_at is null or e.opens_at<=now())
        and (e.schedule_mode='manual' or e.cutoff_at is null or e.cutoff_at>now())
    ),
    'tickets',(select count(*) from public.event_tickets),
    'players',(select count(*) from public.profiles),
    'draw_credits',coalesce((select sum(balance) from public.profiles),0),
    'ledger_rows',(select count(*) from public.balance_ledger)
  ) into v_summary;

  with recent_events as (
    select id
    from public.lottery_events
    order by created_at desc,id desc
    limit 500
  ), stats as (
    select
      r.id event_id,
      count(t.id) ticket_count,
      count(distinct t.user_id) player_count,
      count(t.id) filter(where t.is_winner) winner_count
    from recent_events r
    left join public.event_tickets t on t.event_id=r.id
    group by r.id
  )
  select coalesce(
    jsonb_object_agg(
      event_id::text,
      jsonb_build_object(
        'ticket_count',ticket_count,
        'player_count',player_count,
        'winner_count',winner_count
      )
    ),
    '{}'::jsonb
  ) into v_event_stats
  from stats;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',p.id,'display_name',p.display_name,'email',p.email,'role',p.role
  ) order by p.created_at),'[]'::jsonb)
  into v_actor_profiles
  from public.profiles p
  where p.role='admin';

  return jsonb_build_object(
    'generated_at',clock_timestamp(),
    'summary',v_summary,
    'event_stats',v_event_stats,
    'actor_profiles',v_actor_profiles
  );
end;
$function$;

create or replace function public.admin_list_players_page(
  p_query text default null,
  p_role text default null,
  p_limit integer default 50,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $function$
declare
  v_q text:=lower(trim(coalesce(p_query,'')));
  v_role text:=nullif(lower(trim(coalesce(p_role,''))),'');
  v_limit integer:=greatest(1,least(coalesce(p_limit,50),100));
  v_rows jsonb;
  v_has_more boolean:=false;
  v_next_created_at timestamptz;
  v_next_id uuid;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if p_cursor_created_at is not null and p_cursor_id is null then raise exception 'Player cursor id required'; end if;
  if v_role is not null and v_role not in ('player','admin') then raise exception 'Invalid role filter'; end if;

  with page as (
    select
      p.id,p.display_name,p.nickname,p.email,p.role,p.balance,p.referral_code,p.created_at,p.updated_at,
      coalesce(sw.balance,0) support_points
    from public.profiles p
    left join public.support_wallets sw on sw.user_id=p.id
    where (v_role is null or p.role=v_role)
      and (
        v_q=''
        or lower(coalesce(p.display_name,'')) like '%'||v_q||'%'
        or lower(coalesce(p.nickname,'')) like '%'||v_q||'%'
        or lower(coalesce(p.email,'')) like '%'||v_q||'%'
        or lower(coalesce(p.referral_code,'')) like '%'||v_q||'%'
        or lower(p.id::text) like '%'||v_q||'%'
      )
      and (
        p_cursor_created_at is null
        or (p.created_at,p.id)<(p_cursor_created_at,p_cursor_id)
      )
    order by p.created_at desc,p.id desc
    limit v_limit+1
  ), numbered as (
    select *,row_number() over(order by created_at desc,id desc) rn
    from page
  ), visible as (
    select * from numbered where rn<=v_limit
  )
  select
    coalesce(jsonb_agg(
      jsonb_build_object(
        'id',id,'display_name',display_name,'nickname',nickname,'email',email,'role',role,
        'balance',balance,'support_points',support_points,'referral_code',referral_code,
        'created_at',created_at,'updated_at',updated_at
      )
      order by created_at desc,id desc
    ),'[]'::jsonb),
    exists(select 1 from numbered where rn=v_limit+1),
    (select created_at from visible order by created_at asc,id asc limit 1),
    (select id from visible order by created_at asc,id asc limit 1)
  into v_rows,v_has_more,v_next_created_at,v_next_id;

  return jsonb_build_object(
    'rows',v_rows,
    'has_more',v_has_more,
    'next_cursor',case when v_has_more then jsonb_build_object('created_at',v_next_created_at,'id',v_next_id) else null end,
    'page_size',jsonb_array_length(v_rows),
    'generated_at',clock_timestamp()
  );
end;
$function$;

create or replace function public.admin_list_tickets_page(
  p_event_id uuid default null,
  p_query text default null,
  p_limit integer default 75,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $function$
declare
  v_q text:=lower(trim(coalesce(p_query,'')));
  v_limit integer:=greatest(1,least(coalesce(p_limit,75),150));
  v_rows jsonb;
  v_has_more boolean:=false;
  v_next_created_at timestamptz;
  v_next_id uuid;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if p_cursor_created_at is not null and p_cursor_id is null then raise exception 'Ticket cursor id required'; end if;

  with page as (
    select
      t.id,t.event_id,t.user_id,t.white_numbers,t.bonus_ball,t.price_paid,t.is_winner,
      t.winner_rank,t.prize_awarded,t.created_at,
      e.title event_title,e.slug event_slug,e.status event_status,e.schedule_mode,e.draw_at,
      p.display_name player_name,p.email player_email,p.balance player_balance
    from public.event_tickets t
    join public.lottery_events e on e.id=t.event_id
    join public.profiles p on p.id=t.user_id
    where (p_event_id is null or t.event_id=p_event_id)
      and (
        v_q=''
        or lower(t.id::text) like '%'||v_q||'%'
        or lower(t.user_id::text) like '%'||v_q||'%'
        or lower(coalesce(p.display_name,'')) like '%'||v_q||'%'
        or lower(coalesce(p.email,'')) like '%'||v_q||'%'
        or lower(e.title) like '%'||v_q||'%'
        or lower(e.slug) like '%'||v_q||'%'
      )
      and (
        p_cursor_created_at is null
        or (t.created_at,t.id)<(p_cursor_created_at,p_cursor_id)
      )
    order by t.created_at desc,t.id desc
    limit v_limit+1
  ), numbered as (
    select *,row_number() over(order by created_at desc,id desc) rn
    from page
  ), visible as (
    select * from numbered where rn<=v_limit
  )
  select
    coalesce(jsonb_agg(
      jsonb_build_object(
        'id',id,'event_id',event_id,'user_id',user_id,'white_numbers',white_numbers,'bonus_ball',bonus_ball,
        'price_paid',price_paid,'is_winner',is_winner,'winner_rank',winner_rank,'prize_awarded',prize_awarded,
        'created_at',created_at,'event_title',event_title,'event_slug',event_slug,'event_status',event_status,
        'schedule_mode',schedule_mode,'draw_at',draw_at,
        'player_name',player_name,'player_email',player_email,'player_balance',player_balance
      )
      order by created_at desc,id desc
    ),'[]'::jsonb),
    exists(select 1 from numbered where rn=v_limit+1),
    (select created_at from visible order by created_at asc,id asc limit 1),
    (select id from visible order by created_at asc,id asc limit 1)
  into v_rows,v_has_more,v_next_created_at,v_next_id;

  return jsonb_build_object(
    'rows',v_rows,
    'has_more',v_has_more,
    'next_cursor',case when v_has_more then jsonb_build_object('created_at',v_next_created_at,'id',v_next_id) else null end,
    'page_size',jsonb_array_length(v_rows),
    'generated_at',clock_timestamp()
  );
end;
$function$;

create or replace function public.admin_list_balance_ledger_page(
  p_user_id uuid default null,
  p_entry_type text default null,
  p_query text default null,
  p_limit integer default 75,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $function$
declare
  v_q text:=lower(trim(coalesce(p_query,'')));
  v_type text:=nullif(lower(trim(coalesce(p_entry_type,''))),'');
  v_limit integer:=greatest(1,least(coalesce(p_limit,75),150));
  v_rows jsonb;
  v_has_more boolean:=false;
  v_next_created_at timestamptz;
  v_next_id uuid;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if p_cursor_created_at is not null and p_cursor_id is null then raise exception 'Ledger cursor id required'; end if;

  with page as (
    select
      bl.id,bl.user_id,bl.amount,bl.balance_after,bl.entry_type,bl.event_id,bl.ticket_id,
      bl.actor_user_id,bl.note,bl.created_at,bl.game_spin_id,bl.plinko_drop_id,
      p.display_name player_name,p.email player_email,
      e.title event_title,
      coalesce(a.display_name,a.email) actor_name
    from public.balance_ledger bl
    join public.profiles p on p.id=bl.user_id
    left join public.lottery_events e on e.id=bl.event_id
    left join public.profiles a on a.id=bl.actor_user_id
    where (p_user_id is null or bl.user_id=p_user_id)
      and (v_type is null or bl.entry_type=v_type)
      and (
        v_q=''
        or lower(bl.id::text) like '%'||v_q||'%'
        or lower(bl.user_id::text) like '%'||v_q||'%'
        or lower(coalesce(p.display_name,'')) like '%'||v_q||'%'
        or lower(coalesce(p.email,'')) like '%'||v_q||'%'
        or lower(coalesce(bl.note,'')) like '%'||v_q||'%'
        or lower(coalesce(bl.entry_type,'')) like '%'||v_q||'%'
        or lower(coalesce(e.title,'')) like '%'||v_q||'%'
      )
      and (
        p_cursor_created_at is null
        or (bl.created_at,bl.id)<(p_cursor_created_at,p_cursor_id)
      )
    order by bl.created_at desc,bl.id desc
    limit v_limit+1
  ), numbered as (
    select *,row_number() over(order by created_at desc,id desc) rn
    from page
  ), visible as (
    select * from numbered where rn<=v_limit
  )
  select
    coalesce(jsonb_agg(
      jsonb_build_object(
        'id',id,'user_id',user_id,'amount',amount,'balance_after',balance_after,'entry_type',entry_type,
        'event_id',event_id,'ticket_id',ticket_id,'actor_user_id',actor_user_id,'note',note,'created_at',created_at,
        'game_spin_id',game_spin_id,'plinko_drop_id',plinko_drop_id,
        'player_name',player_name,'player_email',player_email,'event_title',event_title,'actor_name',actor_name
      )
      order by created_at desc,id desc
    ),'[]'::jsonb),
    exists(select 1 from numbered where rn=v_limit+1),
    (select created_at from visible order by created_at asc,id asc limit 1),
    (select id from visible order by created_at asc,id asc limit 1)
  into v_rows,v_has_more,v_next_created_at,v_next_id;

  return jsonb_build_object(
    'rows',v_rows,
    'has_more',v_has_more,
    'next_cursor',case when v_has_more then jsonb_build_object('created_at',v_next_created_at,'id',v_next_id) else null end,
    'page_size',jsonb_array_length(v_rows),
    'generated_at',clock_timestamp()
  );
end;
$function$;

create or replace function public.admin_list_winner_events_page(
  p_limit integer default 10,
  p_cursor_completed_at timestamptz default null,
  p_cursor_event_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $function$
declare
  v_limit integer:=greatest(1,least(coalesce(p_limit,10),25));
  v_rows jsonb;
  v_has_more boolean:=false;
  v_next_completed_at timestamptz;
  v_next_id uuid;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if p_cursor_completed_at is not null and p_cursor_event_id is null then raise exception 'Winner event cursor id required'; end if;

  with candidate_events as (
    select e.id,e.title,e.slug,e.status,e.draw_at,e.completed_at,e.created_at
    from public.lottery_events e
    where e.status='completed'
      and e.completed_at is not null
      and exists(select 1 from public.event_tickets t where t.event_id=e.id and t.is_winner)
      and (
        p_cursor_completed_at is null
        or (e.completed_at,e.id)<(p_cursor_completed_at,p_cursor_event_id)
      )
    order by e.completed_at desc,e.id desc
    limit v_limit+1
  ), numbered as (
    select *,row_number() over(order by completed_at desc,id desc) rn
    from candidate_events
  ), visible as (
    select * from numbered where rn<=v_limit
  ), packed as (
    select
      v.id,v.title,v.slug,v.status,v.draw_at,v.completed_at,v.created_at,
      (
        select coalesce(jsonb_agg(
          jsonb_build_object(
            'ticket_id',t.id,'ticket_ref',private.public_ticket_ref(t.id),
            'user_id',t.user_id,'player_name',coalesce(p.display_name,p.email,'Player'),'player_email',p.email,
            'winner_rank',t.winner_rank,'prize_awarded',t.prize_awarded,
            'white_numbers',t.white_numbers,'bonus_ball',t.bonus_ball
          )
          order by t.winner_rank,t.id
        ),'[]'::jsonb)
        from public.event_tickets t
        join public.profiles p on p.id=t.user_id
        where t.event_id=v.id and t.is_winner
      ) winners
    from visible v
  )
  select
    coalesce(jsonb_agg(
      jsonb_build_object(
        'id',id,'title',title,'slug',slug,'status',status,'draw_at',draw_at,'completed_at',completed_at,
        'winners',winners
      )
      order by completed_at desc,id desc
    ),'[]'::jsonb),
    exists(select 1 from numbered where rn=v_limit+1),
    (select completed_at from visible order by completed_at asc,id asc limit 1),
    (select id from visible order by completed_at asc,id asc limit 1)
  into v_rows,v_has_more,v_next_completed_at,v_next_id
  from packed;

  return jsonb_build_object(
    'rows',v_rows,
    'has_more',v_has_more,
    'next_cursor',case when v_has_more then jsonb_build_object('completed_at',v_next_completed_at,'event_id',v_next_id) else null end,
    'page_size',jsonb_array_length(v_rows),
    'generated_at',clock_timestamp()
  );
end;
$function$;

revoke all on function public.admin_get_admin_scalability_snapshot() from public,anon,authenticated;
revoke all on function public.admin_list_players_page(text,text,integer,timestamptz,uuid) from public,anon,authenticated;
revoke all on function public.admin_list_tickets_page(uuid,text,integer,timestamptz,uuid) from public,anon,authenticated;
revoke all on function public.admin_list_balance_ledger_page(uuid,text,text,integer,timestamptz,uuid) from public,anon,authenticated;
revoke all on function public.admin_list_winner_events_page(integer,timestamptz,uuid) from public,anon,authenticated;

grant execute on function public.admin_get_admin_scalability_snapshot() to authenticated;
grant execute on function public.admin_list_players_page(text,text,integer,timestamptz,uuid) to authenticated;
grant execute on function public.admin_list_tickets_page(uuid,text,integer,timestamptz,uuid) to authenticated;
grant execute on function public.admin_list_balance_ledger_page(uuid,text,text,integer,timestamptz,uuid) to authenticated;
grant execute on function public.admin_list_winner_events_page(integer,timestamptz,uuid) to authenticated;
