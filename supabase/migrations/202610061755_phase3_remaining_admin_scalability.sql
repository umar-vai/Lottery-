-- Phase 3 — remaining admin scalability.
-- Paginate lotteries, audit/admin-change history and support operations.

create index if not exists lottery_events_created_id_idx
on public.lottery_events(created_at desc,id desc);

create index if not exists audit_logs_created_id_idx
on public.audit_logs(created_at desc,id desc);

create index if not exists admin_change_audit_created_id_idx
on private.admin_change_audit(created_at desc,id desc);

create index if not exists support_transactions_received_id_idx
on public.support_transactions(received_at desc,id desc);

create index if not exists support_bridge_devices_created_id_idx
on public.support_bridge_devices(created_at desc,id desc);

create or replace function private.admin_lottery_event_json(p_event_id uuid)
returns jsonb
language sql
security definer
set search_path to 'pg_catalog','public','private'
as $function$
  select case when e.id is null then null else
    to_jsonb(e)
    || jsonb_build_object(
      'ticket_count',(select count(*) from public.event_tickets t where t.event_id=e.id),
      'player_count',(select count(distinct t.user_id) from public.event_tickets t where t.event_id=e.id),
      'prizes',coalesce((
        select jsonb_agg(jsonb_build_object('rank',pt.rank,'prize_amount',pt.prize_amount) order by pt.rank)
        from public.event_prize_tiers pt where pt.event_id=e.id
      ),'[]'::jsonb)
    )
  end
  from public.lottery_events e
  where e.id=p_event_id
$function$;

revoke all on function private.admin_lottery_event_json(uuid) from public,anon,authenticated;

create or replace function public.admin_get_admin_base_focus()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $function$
declare
  v_event_id uuid;
  v_focus jsonb;
  v_recent jsonb;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;

  select e.id into v_event_id
  from public.lottery_events e
  where e.status='published'
  order by
    case
      when (e.opens_at is null or e.opens_at<=now())
       and (e.schedule_mode='manual' or e.cutoff_at is null or e.cutoff_at>now()) then 0
      when e.schedule_mode<>'manual' and e.cutoff_at is not null and e.cutoff_at<=now()
       and e.draw_at is not null and e.draw_at>now() then 1
      when e.opens_at is not null and e.opens_at>now() then 2
      else 3
    end,
    case when e.schedule_mode='manual' then 0 else 1 end,
    coalesce(e.draw_at,e.opens_at,e.created_at),
    e.id
  limit 1;

  v_focus:=case when v_event_id is null then null else private.admin_lottery_event_json(v_event_id) end;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id desc),'[]'::jsonb)
  into v_recent
  from (
    select a.id,a.actor_user_id,coalesce(p.display_name,p.email) actor_name,
           a.action,a.entity_type,a.entity_id,a.old_data,a.new_data,a.created_at
    from public.audit_logs a
    left join public.profiles p on p.id=a.actor_user_id
    order by a.created_at desc,a.id desc
    limit 8
  ) x;

  return jsonb_build_object(
    'generated_at',clock_timestamp(),
    'focus_event',v_focus,
    'recent_audit',v_recent
  );
end;
$function$;

create or replace function public.admin_get_lottery_event_detail(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $function$
declare v_result jsonb;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  v_result:=private.admin_lottery_event_json(p_event_id);
  if v_result is null then raise exception 'Lottery event not found'; end if;
  return v_result;
end;
$function$;

create or replace function public.admin_list_lottery_events_page(
  p_status text default null,
  p_query text default null,
  p_limit integer default 40,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $function$
declare
  v_status text:=nullif(lower(trim(coalesce(p_status,''))),'');
  v_q text:=lower(trim(coalesce(p_query,'')));
  v_limit integer:=greatest(1,least(coalesce(p_limit,40),100));
  v_rows jsonb; v_more boolean:=false; v_ca timestamptz; v_id uuid;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if p_cursor_created_at is not null and p_cursor_id is null then raise exception 'Lottery cursor id required'; end if;
  if v_status is not null and v_status not in ('draft','published','completed','cancelled') then raise exception 'Invalid lottery status'; end if;

  with page as (
    select e.id,e.created_at,private.admin_lottery_event_json(e.id) payload
    from public.lottery_events e
    where (v_status is null or e.status=v_status)
      and (
        v_q=''
        or lower(e.id::text) like '%'||v_q||'%'
        or lower(coalesce(e.title,'')) like '%'||v_q||'%'
        or lower(coalesce(e.slug,'')) like '%'||v_q||'%'
        or lower(coalesce(e.description,'')) like '%'||v_q||'%'
      )
      and (p_cursor_created_at is null or (e.created_at,e.id)<(p_cursor_created_at,p_cursor_id))
    order by e.created_at desc,e.id desc
    limit v_limit+1
  ), numbered as (
    select *,row_number() over(order by created_at desc,id desc) rn from page
  ), visible as (
    select * from numbered where rn<=v_limit
  )
  select coalesce(jsonb_agg(payload order by created_at desc,id desc),'[]'::jsonb),
         exists(select 1 from numbered where rn=v_limit+1),
         (select created_at from visible order by created_at asc,id asc limit 1),
         (select id from visible order by created_at asc,id asc limit 1)
  into v_rows,v_more,v_ca,v_id
  from visible;

  return jsonb_build_object(
    'rows',v_rows,'has_more',v_more,
    'next_cursor',case when v_more then jsonb_build_object('created_at',v_ca,'id',v_id) else null end,
    'page_size',jsonb_array_length(v_rows),'generated_at',clock_timestamp()
  );
end;
$function$;

create or replace function public.admin_list_audit_logs_page(
  p_query text default null,
  p_action text default null,
  p_limit integer default 75,
  p_cursor_created_at timestamptz default null,
  p_cursor_id bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $function$
declare
  v_q text:=lower(trim(coalesce(p_query,'')));
  v_action text:=nullif(lower(trim(coalesce(p_action,''))),'');
  v_limit integer:=greatest(1,least(coalesce(p_limit,75),150));
  v_rows jsonb; v_more boolean:=false; v_ca timestamptz; v_id bigint;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if p_cursor_created_at is not null and p_cursor_id is null then raise exception 'Audit cursor id required'; end if;

  with page as (
    select a.id,a.created_at,
      jsonb_build_object(
        'id',a.id,'actor_user_id',a.actor_user_id,'actor_name',coalesce(p.display_name,p.email),
        'action',a.action,'entity_type',a.entity_type,'entity_id',a.entity_id,
        'old_data',a.old_data,'new_data',a.new_data,'created_at',a.created_at
      ) payload
    from public.audit_logs a
    left join public.profiles p on p.id=a.actor_user_id
    where (v_action is null or lower(a.action)=v_action)
      and (
        v_q=''
        or lower(coalesce(a.action,'')) like '%'||v_q||'%'
        or lower(coalesce(a.entity_type,'')) like '%'||v_q||'%'
        or lower(coalesce(a.entity_id,'')) like '%'||v_q||'%'
        or lower(coalesce(p.display_name,'')) like '%'||v_q||'%'
        or lower(coalesce(p.email,'')) like '%'||v_q||'%'
      )
      and (p_cursor_created_at is null or (a.created_at,a.id)<(p_cursor_created_at,p_cursor_id))
    order by a.created_at desc,a.id desc
    limit v_limit+1
  ), numbered as (
    select *,row_number() over(order by created_at desc,id desc) rn from page
  ), visible as (
    select * from numbered where rn<=v_limit
  )
  select coalesce(jsonb_agg(payload order by created_at desc,id desc),'[]'::jsonb),
         exists(select 1 from numbered where rn=v_limit+1),
         (select created_at from visible order by created_at asc,id asc limit 1),
         (select id from visible order by created_at asc,id asc limit 1)
  into v_rows,v_more,v_ca,v_id
  from visible;

  return jsonb_build_object(
    'rows',v_rows,'has_more',v_more,
    'next_cursor',case when v_more then jsonb_build_object('created_at',v_ca,'id',v_id) else null end,
    'page_size',jsonb_array_length(v_rows),'generated_at',clock_timestamp()
  );
end;
$function$;

create or replace function public.admin_list_admin_changes_page(
  p_query text default null,
  p_table_name text default null,
  p_limit integer default 50,
  p_cursor_created_at timestamptz default null,
  p_cursor_id bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $function$
declare
  v_q text:=lower(trim(coalesce(p_query,'')));
  v_table text:=nullif(lower(trim(coalesce(p_table_name,''))),'');
  v_limit integer:=greatest(1,least(coalesce(p_limit,50),100));
  v_rows jsonb; v_more boolean:=false; v_ca timestamptz; v_id bigint; v_count bigint;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if p_cursor_created_at is not null and p_cursor_id is null then raise exception 'Admin change cursor id required'; end if;

  select count(*) into v_count from private.admin_change_audit where created_at>now()-interval '24 hours';

  with page as (
    select a.id,a.created_at,
      jsonb_build_object(
        'id',a.id,'actor_user_id',a.actor_user_id,'actor_name',coalesce(p.display_name,p.email),
        'actor_email',p.email,'action',a.action,'table_name',a.table_name,'row_id',a.row_id,
        'reason',a.reason,'request_path',a.request_path,'old_data',a.old_data,'new_data',a.new_data,
        'created_at',a.created_at
      ) payload
    from private.admin_change_audit a
    left join public.profiles p on p.id=a.actor_user_id
    where (v_table is null or lower(a.table_name)=v_table)
      and (
        v_q=''
        or lower(coalesce(a.action,'')) like '%'||v_q||'%'
        or lower(coalesce(a.table_name,'')) like '%'||v_q||'%'
        or lower(coalesce(a.row_id,'')) like '%'||v_q||'%'
        or lower(coalesce(a.reason,'')) like '%'||v_q||'%'
        or lower(coalesce(p.display_name,'')) like '%'||v_q||'%'
        or lower(coalesce(p.email,'')) like '%'||v_q||'%'
      )
      and (p_cursor_created_at is null or (a.created_at,a.id)<(p_cursor_created_at,p_cursor_id))
    order by a.created_at desc,a.id desc
    limit v_limit+1
  ), numbered as (
    select *,row_number() over(order by created_at desc,id desc) rn from page
  ), visible as (
    select * from numbered where rn<=v_limit
  )
  select coalesce(jsonb_agg(payload order by created_at desc,id desc),'[]'::jsonb),
         exists(select 1 from numbered where rn=v_limit+1),
         (select created_at from visible order by created_at asc,id asc limit 1),
         (select id from visible order by created_at asc,id asc limit 1)
  into v_rows,v_more,v_ca,v_id
  from visible;

  return jsonb_build_object(
    'count_24h',v_count,'rows',v_rows,'has_more',v_more,
    'next_cursor',case when v_more then jsonb_build_object('created_at',v_ca,'id',v_id) else null end,
    'page_size',jsonb_array_length(v_rows),'generated_at',clock_timestamp()
  );
end;
$function$;

create or replace function public.admin_get_support_operations_summary()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $function$
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  return jsonb_build_object(
    'generated_at',clock_timestamp(),
    'support_received',coalesce((select sum(amount) from public.support_transactions),0),
    'love_points',coalesce((select sum(balance) from public.support_wallets),0),
    'draw_credits',coalesce((select sum(balance) from public.profiles),0),
    'enabled_phones',(select count(*) from public.support_bridge_devices where enabled),
    'phones_total',(select count(*) from public.support_bridge_devices),
    'transfers_total',(select count(*) from public.support_transactions),
    'wallets_total',(select count(*) from public.support_wallets),
    'players_total',(select count(*) from public.profiles)
  );
end;
$function$;

create or replace function public.admin_list_support_wallets_page(
  p_query text default null,
  p_limit integer default 50,
  p_cursor_created_at timestamptz default null,
  p_cursor_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $function$
declare
  v_q text:=lower(trim(coalesce(p_query,'')));
  v_limit integer:=greatest(1,least(coalesce(p_limit,50),100));
  v_rows jsonb; v_more boolean:=false; v_ca timestamptz; v_id uuid;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if p_cursor_created_at is not null and p_cursor_user_id is null then raise exception 'Support wallet cursor user id required'; end if;

  with page as (
    select p.id,p.created_at,
      jsonb_build_object(
        'user_id',p.id,'display_name',p.display_name,'email',p.email,
        'draw_credits',p.balance,'balance',coalesce(w.balance,0),
        'wallet_updated_at',w.updated_at,'created_at',p.created_at
      ) payload
    from public.profiles p
    left join public.support_wallets w on w.user_id=p.id
    where (
      v_q=''
      or lower(p.id::text) like '%'||v_q||'%'
      or lower(coalesce(p.display_name,'')) like '%'||v_q||'%'
      or lower(coalesce(p.email,'')) like '%'||v_q||'%'
    )
      and (p_cursor_created_at is null or (p.created_at,p.id)<(p_cursor_created_at,p_cursor_user_id))
    order by p.created_at desc,p.id desc
    limit v_limit+1
  ), numbered as (
    select *,row_number() over(order by created_at desc,id desc) rn from page
  ), visible as (
    select * from numbered where rn<=v_limit
  )
  select coalesce(jsonb_agg(payload order by created_at desc,id desc),'[]'::jsonb),
         exists(select 1 from numbered where rn=v_limit+1),
         (select created_at from visible order by created_at asc,id asc limit 1),
         (select id from visible order by created_at asc,id asc limit 1)
  into v_rows,v_more,v_ca,v_id
  from visible;

  return jsonb_build_object(
    'rows',v_rows,'has_more',v_more,
    'next_cursor',case when v_more then jsonb_build_object('created_at',v_ca,'user_id',v_id) else null end,
    'page_size',jsonb_array_length(v_rows),'generated_at',clock_timestamp()
  );
end;
$function$;

create or replace function public.admin_list_support_transactions_page(
  p_query text default null,
  p_claim_state text default null,
  p_limit integer default 50,
  p_cursor_received_at timestamptz default null,
  p_cursor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $function$
declare
  v_q text:=lower(trim(coalesce(p_query,'')));
  v_state text:=nullif(lower(trim(coalesce(p_claim_state,''))),'');
  v_limit integer:=greatest(1,least(coalesce(p_limit,50),100));
  v_rows jsonb; v_more boolean:=false; v_at timestamptz; v_id uuid;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if p_cursor_received_at is not null and p_cursor_id is null then raise exception 'Support transaction cursor id required'; end if;
  if v_state is not null and v_state not in ('claimed','unclaimed') then raise exception 'Invalid claim state'; end if;

  with page as (
    select s.id,s.received_at,
      jsonb_build_object(
        'id',s.id,'device_id',s.device_id,'provider',s.provider,'sender_last4',s.sender_last4,
        'amount',s.amount,'trx_id',s.trx_id,'received_at',s.received_at,
        'claimed_by',s.claimed_by,'claimed_at',s.claimed_at,
        'claimed_by_name',coalesce(p.display_name,p.email)
      ) payload
    from public.support_transactions s
    left join public.profiles p on p.id=s.claimed_by
    where (v_state is null or (v_state='claimed' and s.claimed_at is not null) or (v_state='unclaimed' and s.claimed_at is null))
      and (
        v_q=''
        or lower(coalesce(s.trx_id,'')) like '%'||v_q||'%'
        or lower(coalesce(s.provider,'')) like '%'||v_q||'%'
        or lower(coalesce(s.sender_last4,'')) like '%'||v_q||'%'
        or lower(coalesce(p.display_name,'')) like '%'||v_q||'%'
        or lower(coalesce(p.email,'')) like '%'||v_q||'%'
      )
      and (p_cursor_received_at is null or (s.received_at,s.id)<(p_cursor_received_at,p_cursor_id))
    order by s.received_at desc,s.id desc
    limit v_limit+1
  ), numbered as (
    select *,row_number() over(order by received_at desc,id desc) rn from page
  ), visible as (
    select * from numbered where rn<=v_limit
  )
  select coalesce(jsonb_agg(payload order by received_at desc,id desc),'[]'::jsonb),
         exists(select 1 from numbered where rn=v_limit+1),
         (select received_at from visible order by received_at asc,id asc limit 1),
         (select id from visible order by received_at asc,id asc limit 1)
  into v_rows,v_more,v_at,v_id
  from visible;

  return jsonb_build_object(
    'rows',v_rows,'has_more',v_more,
    'next_cursor',case when v_more then jsonb_build_object('received_at',v_at,'id',v_id) else null end,
    'page_size',jsonb_array_length(v_rows),'generated_at',clock_timestamp()
  );
end;
$function$;

create or replace function public.admin_list_support_devices_page(
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
  v_limit integer:=greatest(1,least(coalesce(p_limit,50),100));
  v_rows jsonb; v_more boolean:=false; v_ca timestamptz; v_id uuid;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if p_cursor_created_at is not null and p_cursor_id is null then raise exception 'Support device cursor id required'; end if;

  with page as (
    select d.id,d.created_at,
      jsonb_build_object(
        'id',d.id,'label',d.label,'enabled',d.enabled,'created_by',d.created_by,
        'created_at',d.created_at,'last_seen_at',d.last_seen_at
      ) payload
    from public.support_bridge_devices d
    where p_cursor_created_at is null or (d.created_at,d.id)<(p_cursor_created_at,p_cursor_id)
    order by d.created_at desc,d.id desc
    limit v_limit+1
  ), numbered as (
    select *,row_number() over(order by created_at desc,id desc) rn from page
  ), visible as (
    select * from numbered where rn<=v_limit
  )
  select coalesce(jsonb_agg(payload order by created_at desc,id desc),'[]'::jsonb),
         exists(select 1 from numbered where rn=v_limit+1),
         (select created_at from visible order by created_at asc,id asc limit 1),
         (select id from visible order by created_at asc,id asc limit 1)
  into v_rows,v_more,v_ca,v_id
  from visible;

  return jsonb_build_object(
    'rows',v_rows,'has_more',v_more,
    'next_cursor',case when v_more then jsonb_build_object('created_at',v_ca,'id',v_id) else null end,
    'page_size',jsonb_array_length(v_rows),'generated_at',clock_timestamp()
  );
end;
$function$;

revoke all on function public.admin_get_admin_base_focus() from public,anon,authenticated;
revoke all on function public.admin_get_lottery_event_detail(uuid) from public,anon,authenticated;
revoke all on function public.admin_list_lottery_events_page(text,text,integer,timestamptz,uuid) from public,anon,authenticated;
revoke all on function public.admin_list_audit_logs_page(text,text,integer,timestamptz,bigint) from public,anon,authenticated;
revoke all on function public.admin_list_admin_changes_page(text,text,integer,timestamptz,bigint) from public,anon,authenticated;
revoke all on function public.admin_get_support_operations_summary() from public,anon,authenticated;
revoke all on function public.admin_list_support_wallets_page(text,integer,timestamptz,uuid) from public,anon,authenticated;
revoke all on function public.admin_list_support_transactions_page(text,text,integer,timestamptz,uuid) from public,anon,authenticated;
revoke all on function public.admin_list_support_devices_page(integer,timestamptz,uuid) from public,anon,authenticated;

grant execute on function public.admin_get_admin_base_focus() to authenticated;
grant execute on function public.admin_get_lottery_event_detail(uuid) to authenticated;
grant execute on function public.admin_list_lottery_events_page(text,text,integer,timestamptz,uuid) to authenticated;
grant execute on function public.admin_list_audit_logs_page(text,text,integer,timestamptz,bigint) to authenticated;
grant execute on function public.admin_list_admin_changes_page(text,text,integer,timestamptz,bigint) to authenticated;
grant execute on function public.admin_get_support_operations_summary() to authenticated;
grant execute on function public.admin_list_support_wallets_page(text,integer,timestamptz,uuid) to authenticated;
grant execute on function public.admin_list_support_transactions_page(text,text,integer,timestamptz,uuid) to authenticated;
grant execute on function public.admin_list_support_devices_page(integer,timestamptz,uuid) to authenticated;
