-- Phase 2 draw recovery and operational-health runtime test.
begin;

create or replace function pg_temp.phase2_fail_prize_ledger()
returns trigger
language plpgsql
as $function$
begin
  if new.entry_type='prize_credit'
     and new.event_id::text=current_setting('phase2.test_event_id',true) then
    raise exception 'phase2 simulated prize-ledger interruption';
  end if;
  return new;
end;
$function$;

create trigger phase2_test_fail_prize
before insert on public.balance_ledger
for each row execute function pg_temp.phase2_fail_prize_ledger();

do $phase2_recovery$
declare
  v_admin uuid;
  v_event uuid;
  v_ticket uuid;
  v_before_balance numeric;
  v_after_balance numeric;
  v_status text;
  v_is_winner boolean;
  v_prize numeric;
  v_prize_rows integer;
  v_failed boolean:=false;
  v_health jsonb;
  v_src text;
begin
  select id into v_admin
  from public.profiles
  where role='admin'
  order by created_at
  limit 1;

  if v_admin is null then
    raise exception 'Phase 2 recovery test requires one admin profile';
  end if;

  perform set_config('request.jwt.claim.sub',v_admin::text,true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub',v_admin::text,'role','authenticated')::text,
    true
  );

  select public.admin_create_lottery_event_v3(
    'Phase 2 recovery test',
    'phase2-recovery-'||substring(replace(gen_random_uuid()::text,'-','') from 1 for 12),
    'rollback-only recovery test',
    0::numeric,
    1,
    1,
    1,
    5::smallint,
    69::smallint,
    true,
    26::smallint,
    'manual',
    now()-interval '1 minute',
    null,
    null,
    array[10::numeric],
    true
  ) into v_event;

  insert into public.event_tickets(
    event_id,user_id,white_numbers,bonus_ball,price_paid
  )
  values(v_event,v_admin,array[1,2,3,4,5],1,0)
  returning id into v_ticket;

  select balance into v_before_balance
  from public.profiles
  where id=v_admin;

  perform set_config('phase2.test_event_id',v_event::text,true);

  begin
    perform private.run_lottery_event_internal(v_event);
  exception when others then
    if sqlerrm not like '%phase2 simulated prize-ledger interruption%' then
      raise;
    end if;
    v_failed:=true;
  end;

  if not v_failed then
    raise exception 'Simulated draw interruption did not fire';
  end if;

  select status into v_status
  from public.lottery_events
  where id=v_event;

  select is_winner,prize_awarded
    into v_is_winner,v_prize
  from public.event_tickets
  where id=v_ticket;

  select balance into v_after_balance
  from public.profiles
  where id=v_admin;

  select count(*) into v_prize_rows
  from public.balance_ledger
  where event_id=v_event and entry_type='prize_credit';

  if v_status<>'published'
     or coalesce(v_is_winner,false)
     or coalesce(v_prize,0)<>0
     or v_after_balance is distinct from v_before_balance
     or v_prize_rows<>0 then
    raise exception 'Interrupted draw did not roll back atomically';
  end if;

  execute 'drop trigger phase2_test_fail_prize on public.balance_ledger';

  perform private.run_lottery_event_internal(v_event);

  select status into v_status
  from public.lottery_events
  where id=v_event;

  select is_winner,prize_awarded
    into v_is_winner,v_prize
  from public.event_tickets
  where id=v_ticket;

  select balance into v_after_balance
  from public.profiles
  where id=v_admin;

  select count(*) into v_prize_rows
  from public.balance_ledger
  where event_id=v_event and entry_type='prize_credit';

  if v_status<>'completed'
     or not coalesce(v_is_winner,false)
     or v_prize<>10
     or v_after_balance<>v_before_balance+10
     or v_prize_rows<>1 then
    raise exception 'Draw retry did not recover exactly once';
  end if;

  select p.prosrc into v_src
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private'
    and p.proname='run_due_lottery_events'
    and pg_get_function_identity_arguments(p.oid)='';

  if v_src is null
     or v_src !~* 'record_lottery_draw_failure'
     or v_src !~* 'record_lottery_draw_success'
     or v_src !~* 'exception when others' then
    raise exception 'Due-draw runner lost automatic recovery instrumentation';
  end if;

  if not exists (
    select 1 from cron.job
    where jobname='lottery-events-every-minute' and active
  ) then
    raise exception 'Minute draw cron is missing or inactive';
  end if;

  if not exists (
    select 1 from cron.job
    where jobname='lottery-operational-health' and active
      and command ilike '%run_lottery_operational_health_check%'
  ) then
    raise exception 'Operational health cron is missing or inactive';
  end if;

  if has_function_privilege('anon','public.admin_get_lottery_operational_health()','EXECUTE')
     or has_function_privilege('anon','public.admin_retry_due_lottery_events()','EXECUTE') then
    raise exception 'Anon can execute operational admin RPCs';
  end if;

  if not has_function_privilege('authenticated','public.admin_get_lottery_operational_health()','EXECUTE')
     or not has_function_privilege('authenticated','public.admin_retry_due_lottery_events()','EXECUTE') then
    raise exception 'Authenticated admin RPC grants are missing';
  end if;

  v_health:=private.lottery_operational_health_report();

  if v_health is null
     or not (v_health ? 'cron')
     or not (v_health ? 'draws')
     or not (v_health ? 'incidents')
     or not (v_health ? 'recovery_model') then
    raise exception 'Operational health report contract is incomplete';
  end if;
end
$phase2_recovery$;

rollback;
