-- Phase 7G temporary load/chaos probe harness.
-- Service-role only + independent internal dispatch-token verification.
-- Final cleanup migration drops probe RPCs after evidence capture.

create table if not exists private.phase7g_probe_results (
  id bigint generated always as identity primary key,
  run_id uuid not null,
  wave text not null,
  worker integer not null,
  outcome text not null,
  duration_ms numeric not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists phase7g_probe_results_run_idx
  on private.phase7g_probe_results(run_id, wave, worker);

alter table private.phase7g_probe_results enable row level security;
revoke all on table private.phase7g_probe_results from public,anon,authenticated,service_role;
revoke all on sequence private.phase7g_probe_results_id_seq from public,anon,authenticated,service_role;

create or replace function public.service_phase7g_ticket_probe(
  p_dispatch_token text,
  p_run_id uuid,
  p_wave text,
  p_worker integer,
  p_event_id uuid,
  p_user_id uuid,
  p_hold_ms integer default 75
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $fn$
declare
  v_started timestamptz:=clock_timestamp();
  v_finished timestamptz;
  v_event_before jsonb;
  v_balance_before numeric;
  v_event_tickets_before bigint;
  v_user_tickets_before bigint;
  v_ledger_before bigint;
  v_event_after jsonb;
  v_balance_after numeric;
  v_event_tickets_after bigint;
  v_user_tickets_after bigint;
  v_ledger_after bigint;
  v_ticket uuid;
  v_balance_inside numeric;
  v_outcome text:='failed';
  v_detail jsonb:='{}'::jsonb;
begin
  if not private.verify_production_alert_dispatch_token(p_dispatch_token) then
    raise exception 'Invalid production alert dispatch token';
  end if;

  select to_jsonb(e) into strict v_event_before
  from public.lottery_events e where e.id=p_event_id;
  select balance into strict v_balance_before
  from public.profiles where id=p_user_id;
  select count(*) into v_event_tickets_before from public.event_tickets where event_id=p_event_id;
  select count(*) into v_user_tickets_before from public.event_tickets where event_id=p_event_id and user_id=p_user_id;
  select count(*) into v_ledger_before from public.balance_ledger;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',p_user_id,'role','authenticated')::text,true);

  begin
    update public.lottery_events
    set status='published',
        opens_at=now()-interval '1 minute',
        cutoff_at=null,
        draw_at=null,
        schedule_mode='manual',
        max_tickets_per_user=1000,
        max_players=null,
        max_total_tickets=null,
        white_ball_count=3,
        white_ball_max=10,
        bonus_ball_enabled=false,
        bonus_ball_max=10
    where id=p_event_id;

    select ticket_id,new_balance into v_ticket,v_balance_inside
    from public.purchase_event_ticket(p_event_id,array[1,2,3]::integer[],null::integer);

    if v_ticket is null then raise exception 'Phase 7G ticket probe produced no ticket'; end if;

    if coalesce(p_hold_ms,0)>0 then
      perform pg_sleep(least(greatest(p_hold_ms,0),1000)/1000.0);
    end if;

    raise exception 'PHASE7G_ROLLBACK_OK';
  exception when others then
    if sqlerrm='PHASE7G_ROLLBACK_OK' then
      v_outcome:='passed';
      v_detail:=jsonb_build_object('ticket_created_then_rolled_back',true,'balance_inside',v_balance_inside);
    else
      v_outcome:='failed';
      v_detail:=jsonb_build_object('sqlstate',sqlstate,'message',left(sqlerrm,500));
    end if;
  end;

  select to_jsonb(e) into v_event_after from public.lottery_events e where e.id=p_event_id;
  select balance into v_balance_after from public.profiles where id=p_user_id;
  select count(*) into v_event_tickets_after from public.event_tickets where event_id=p_event_id;
  select count(*) into v_user_tickets_after from public.event_tickets where event_id=p_event_id and user_id=p_user_id;
  select count(*) into v_ledger_after from public.balance_ledger;

  if v_event_after is distinct from v_event_before
     or v_balance_after is distinct from v_balance_before
     or v_event_tickets_after<>v_event_tickets_before
     or v_user_tickets_after<>v_user_tickets_before
     or v_ledger_after<>v_ledger_before then
    v_outcome:='residue_detected';
    v_detail:=v_detail||jsonb_build_object(
      'event_same',v_event_after is not distinct from v_event_before,
      'balance_same',v_balance_after is not distinct from v_balance_before,
      'event_tickets_before',v_event_tickets_before,
      'event_tickets_after',v_event_tickets_after,
      'user_tickets_before',v_user_tickets_before,
      'user_tickets_after',v_user_tickets_after,
      'ledger_before',v_ledger_before,
      'ledger_after',v_ledger_after
    );
  end if;

  v_finished:=clock_timestamp();

  insert into private.phase7g_probe_results(run_id,wave,worker,outcome,duration_ms,detail)
  values(
    p_run_id,p_wave,p_worker,v_outcome,
    round((extract(epoch from (v_finished-v_started))*1000)::numeric,2),
    v_detail
  );

  return jsonb_build_object(
    'outcome',v_outcome,
    'duration_ms',round((extract(epoch from (v_finished-v_started))*1000)::numeric,2),
    'detail',v_detail
  );
end;
$fn$;

create or replace function public.service_phase7g_rate_probe(
  p_dispatch_token text,
  p_run_id uuid,
  p_wave text,
  p_worker integer,
  p_user_id uuid,
  p_bucket text,
  p_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $fn$
declare
  v_started timestamptz:=clock_timestamp();
  v_finished timestamptz;
  v_outcome text;
  v_detail jsonb;
  v_count integer;
begin
  if not private.verify_production_alert_dispatch_token(p_dispatch_token) then
    raise exception 'Invalid production alert dispatch token';
  end if;

  begin
    v_count:=private.consume_mutation_budget(
      p_user_id,p_bucket,least(greatest(p_limit,1),100),600
    );
    perform pg_sleep(0.12);
    v_outcome:='allowed';
    v_detail:=jsonb_build_object('count',v_count);
  exception when others then
    if sqlerrm like 'Too many % operations.%' then
      v_outcome:='rate_limited';
      v_detail:=jsonb_build_object('sqlstate',sqlstate,'message',left(sqlerrm,500));
    else
      v_outcome:='failed';
      v_detail:=jsonb_build_object('sqlstate',sqlstate,'message',left(sqlerrm,500));
    end if;
  end;

  v_finished:=clock_timestamp();

  insert into private.phase7g_probe_results(run_id,wave,worker,outcome,duration_ms,detail)
  values(
    p_run_id,p_wave,p_worker,v_outcome,
    round((extract(epoch from (v_finished-v_started))*1000)::numeric,2),
    v_detail
  );

  return jsonb_build_object(
    'outcome',v_outcome,
    'duration_ms',round((extract(epoch from (v_finished-v_started))*1000)::numeric,2),
    'detail',v_detail
  );
end;
$fn$;

create or replace function public.service_phase7g_lock_holder(
  p_dispatch_token text,
  p_run_id uuid,
  p_hold_ms integer default 900
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','private'
as $fn$
declare
  v_started timestamptz:=clock_timestamp();
  v_finished timestamptz;
begin
  if not private.verify_production_alert_dispatch_token(p_dispatch_token) then
    raise exception 'Invalid production alert dispatch token';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('phase7g-chaos-lock',0));
  perform pg_sleep(least(greatest(p_hold_ms,100),2000)/1000.0);
  v_finished:=clock_timestamp();

  insert into private.phase7g_probe_results(run_id,wave,worker,outcome,duration_ms,detail)
  values(
    p_run_id,'lock-holder',1,'released',
    round((extract(epoch from (v_finished-v_started))*1000)::numeric,2),
    jsonb_build_object('hold_ms',p_hold_ms)
  );

  return jsonb_build_object('outcome','released','duration_ms',
    round((extract(epoch from (v_finished-v_started))*1000)::numeric,2));
end;
$fn$;

create or replace function public.service_phase7g_lock_waiter(
  p_dispatch_token text,
  p_run_id uuid,
  p_timeout_ms integer default 250
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','private'
as $fn$
declare
  v_started timestamptz:=clock_timestamp();
  v_finished timestamptz;
  v_outcome text:='failed';
  v_detail jsonb:='{}'::jsonb;
begin
  if not private.verify_production_alert_dispatch_token(p_dispatch_token) then
    raise exception 'Invalid production alert dispatch token';
  end if;

  perform set_config('lock_timeout',least(greatest(p_timeout_ms,50),1000)::text||'ms',true);

  begin
    perform pg_advisory_xact_lock(hashtextextended('phase7g-chaos-lock',0));
    v_outcome:='acquired';
  exception when others then
    if sqlstate='55P03' then
      v_outcome:='lock_timeout';
      v_detail:=jsonb_build_object('sqlstate',sqlstate,'message',left(sqlerrm,500));
    else
      v_outcome:='failed';
      v_detail:=jsonb_build_object('sqlstate',sqlstate,'message',left(sqlerrm,500));
    end if;
  end;

  v_finished:=clock_timestamp();

  insert into private.phase7g_probe_results(run_id,wave,worker,outcome,duration_ms,detail)
  values(
    p_run_id,'lock-waiter',1,v_outcome,
    round((extract(epoch from (v_finished-v_started))*1000)::numeric,2),
    v_detail
  );

  return jsonb_build_object(
    'outcome',v_outcome,
    'duration_ms',round((extract(epoch from (v_finished-v_started))*1000)::numeric,2),
    'detail',v_detail
  );
end;
$fn$;

create or replace function private.phase7g_probe_summary(p_run_id uuid)
returns jsonb
language sql
security definer
set search_path to 'pg_catalog','private'
as $fn$
  with rows as (
    select * from private.phase7g_probe_results where run_id=p_run_id
  ),
  by_wave as (
    select wave,
      count(*) as requests,
      count(*) filter(where outcome in ('passed','allowed','released','lock_timeout','acquired')) as expected_outcomes,
      count(*) filter(where outcome in ('failed','residue_detected')) as failures,
      round(avg(duration_ms),2) as avg_ms,
      percentile_cont(0.95) within group(order by duration_ms)::numeric(12,2) as p95_ms,
      max(duration_ms) as max_ms
    from rows group by wave
  )
  select jsonb_build_object(
    'run_id',p_run_id,
    'total_requests',(select count(*) from rows),
    'failure_count',(select count(*) from rows where outcome in ('failed','residue_detected')),
    'residue_count',(select count(*) from rows where outcome='residue_detected'),
    'waves',coalesce((
      select jsonb_agg(jsonb_build_object(
        'wave',wave,'requests',requests,'expected_outcomes',expected_outcomes,
        'failures',failures,'avg_ms',avg_ms,'p95_ms',p95_ms,'max_ms',max_ms
      ) order by wave) from by_wave
    ),'[]'::jsonb),
    'outcomes',coalesce((
      select jsonb_object_agg(outcome,cnt)
      from (select outcome,count(*) cnt from rows group by outcome) x
    ),'{}'::jsonb)
  );
$fn$;

revoke all on function public.service_phase7g_ticket_probe(text,uuid,text,integer,uuid,uuid,integer)
from public,anon,authenticated,service_role;
grant execute on function public.service_phase7g_ticket_probe(text,uuid,text,integer,uuid,uuid,integer) to service_role;

revoke all on function public.service_phase7g_rate_probe(text,uuid,text,integer,uuid,text,integer)
from public,anon,authenticated,service_role;
grant execute on function public.service_phase7g_rate_probe(text,uuid,text,integer,uuid,text,integer) to service_role;

revoke all on function public.service_phase7g_lock_holder(text,uuid,integer)
from public,anon,authenticated,service_role;
grant execute on function public.service_phase7g_lock_holder(text,uuid,integer) to service_role;

revoke all on function public.service_phase7g_lock_waiter(text,uuid,integer)
from public,anon,authenticated,service_role;
grant execute on function public.service_phase7g_lock_waiter(text,uuid,integer) to service_role;

revoke all on function private.phase7g_probe_summary(uuid)
from public,anon,authenticated,service_role;
