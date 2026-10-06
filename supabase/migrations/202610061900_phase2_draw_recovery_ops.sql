-- Phase 2 — draw failure recovery state and operational monitoring.

create table if not exists private.lottery_draw_runtime_state (
  event_id uuid primary key references public.lottery_events(id) on delete cascade,
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  total_failures bigint not null default 0 check (total_failures >= 0),
  first_failed_at timestamptz,
  last_failed_at timestamptz,
  last_alerted_at timestamptz,
  last_error_state text,
  last_error text,
  last_succeeded_at timestamptz,
  last_attempt_at timestamptz,
  updated_at timestamptz not null default now()
);

revoke all on table private.lottery_draw_runtime_state from public, anon, authenticated;

create or replace function private.record_lottery_draw_failure(
  p_event_id uuid,
  p_error_state text,
  p_error text
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $function$
declare
  v_previous_error text;
  v_last_alerted timestamptz;
  v_should_alert boolean;
begin
  select last_error,last_alerted_at
    into v_previous_error,v_last_alerted
  from private.lottery_draw_runtime_state
  where event_id=p_event_id;

  v_should_alert :=
    v_last_alerted is null
    or v_last_alerted < now()-interval '15 minutes'
    or v_previous_error is distinct from p_error;

  insert into private.lottery_draw_runtime_state(
    event_id,consecutive_failures,total_failures,first_failed_at,last_failed_at,
    last_error_state,last_error,last_attempt_at,updated_at
  )
  values(
    p_event_id,1,1,now(),now(),
    nullif(p_error_state,''),left(coalesce(p_error,'Unknown draw error'),2000),now(),now()
  )
  on conflict(event_id) do update
  set consecutive_failures=private.lottery_draw_runtime_state.consecutive_failures+1,
      total_failures=private.lottery_draw_runtime_state.total_failures+1,
      first_failed_at=coalesce(private.lottery_draw_runtime_state.first_failed_at,excluded.first_failed_at),
      last_failed_at=excluded.last_failed_at,
      last_error_state=excluded.last_error_state,
      last_error=excluded.last_error,
      last_attempt_at=excluded.last_attempt_at,
      updated_at=excluded.updated_at;

  if v_should_alert then
    insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,new_data)
    values(
      null,
      'lottery_event_draw_failed',
      'lottery_event',
      p_event_id::text,
      jsonb_build_object(
        'sqlstate',nullif(p_error_state,''),
        'error',left(coalesce(p_error,'Unknown draw error'),2000),
        'automatic_retry','next cron run'
      )
    );

    update private.lottery_draw_runtime_state
    set last_alerted_at=now(),updated_at=now()
    where event_id=p_event_id;
  end if;
end;
$function$;

create or replace function private.record_lottery_draw_success(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $function$
declare
  v_failures integer;
  v_last_error text;
begin
  select consecutive_failures,last_error
    into v_failures,v_last_error
  from private.lottery_draw_runtime_state
  where event_id=p_event_id;

  insert into private.lottery_draw_runtime_state(
    event_id,consecutive_failures,total_failures,last_succeeded_at,last_attempt_at,updated_at
  )
  values(p_event_id,0,0,now(),now(),now())
  on conflict(event_id) do update
  set consecutive_failures=0,
      first_failed_at=null,
      last_failed_at=null,
      last_alerted_at=null,
      last_error_state=null,
      last_error=null,
      last_succeeded_at=excluded.last_succeeded_at,
      last_attempt_at=excluded.last_attempt_at,
      updated_at=excluded.updated_at;

  if coalesce(v_failures,0)>0 then
    insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,new_data)
    values(
      null,
      'lottery_event_draw_recovered',
      'lottery_event',
      p_event_id::text,
      jsonb_build_object(
        'previous_consecutive_failures',v_failures,
        'previous_error',v_last_error
      )
    );
  end if;
end;
$function$;

revoke all on function private.record_lottery_draw_failure(uuid,text,text) from public,anon,authenticated;
revoke all on function private.record_lottery_draw_success(uuid) from public,anon,authenticated;

create or replace function private.run_due_lottery_events()
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $function$
declare
  r record;
  v_count integer:=0;
  v_error_state text;
  v_error text;
begin
  if not private.platform_feature_enabled('events') then
    return 0;
  end if;

  for r in
    select id
    from public.lottery_events
    where status='published'
      and schedule_mode='scheduled'
      and draw_at is not null
      and draw_at<=now()
    order by draw_at
  loop
    begin
      perform private.run_lottery_event_internal(r.id);
      perform private.record_lottery_draw_success(r.id);
      v_count:=v_count+1;
    exception when others then
      v_error_state:=sqlstate;
      v_error:=sqlerrm;
      perform private.record_lottery_draw_failure(r.id,v_error_state,v_error);
    end;
  end loop;

  return v_count;
end;
$function$;

revoke all on function private.run_due_lottery_events() from public,anon,authenticated;

create or replace function private.lottery_operational_health_report()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','private','cron'
as $function$
declare
  v_jobid bigint;
  v_cron_active boolean:=false;
  v_last_run timestamptz;
  v_last_status text;
  v_last_message text;
  v_cron_failures_24h bigint:=0;
  v_overdue bigint:=0;
  v_open_failures bigint:=0;
  v_recent_draws bigint:=0;
  v_last_completed timestamptz;
  v_incidents jsonb:='[]'::jsonb;
  v_cron_ok boolean:=false;
  v_ok boolean:=false;
begin
  select jobid,active
    into v_jobid,v_cron_active
  from cron.job
  where jobname='lottery-events-every-minute'
  limit 1;

  if v_jobid is not null then
    select start_time,status,return_message
      into v_last_run,v_last_status,v_last_message
    from cron.job_run_details
    where jobid=v_jobid
    order by start_time desc
    limit 1;

    select count(*) into v_cron_failures_24h
    from cron.job_run_details
    where jobid=v_jobid
      and start_time>now()-interval '24 hours'
      and status<>'succeeded';
  end if;

  select count(*) into v_overdue
  from public.lottery_events
  where status='published'
    and schedule_mode='scheduled'
    and draw_at is not null
    and draw_at<=now()-interval '2 minutes';

  select count(*) into v_open_failures
  from private.lottery_draw_runtime_state s
  join public.lottery_events e on e.id=s.event_id
  where e.status='published'
    and s.consecutive_failures>0;

  select count(*),max(completed_at)
    into v_recent_draws,v_last_completed
  from public.lottery_events
  where status='completed'
    and completed_at>now()-interval '24 hours';

  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb)
    into v_incidents
  from (
    select
      e.id as event_id,
      e.slug,
      e.title,
      e.draw_at,
      greatest(0,round(extract(epoch from (now()-e.draw_at))/60))::bigint as overdue_minutes,
      coalesce(s.consecutive_failures,0) as consecutive_failures,
      coalesce(s.total_failures,0) as total_failures,
      s.first_failed_at,
      s.last_failed_at,
      s.last_error_state,
      s.last_error
    from public.lottery_events e
    left join private.lottery_draw_runtime_state s on s.event_id=e.id
    where e.status='published'
      and (
        s.consecutive_failures>0
        or (
          e.schedule_mode='scheduled'
          and e.draw_at is not null
          and e.draw_at<=now()-interval '2 minutes'
        )
      )
    order by coalesce(s.last_failed_at,e.draw_at) desc
    limit 20
  ) x;

  v_cron_ok :=
    coalesce(v_cron_active,false)
    and v_last_status='succeeded'
    and v_last_run is not null
    and v_last_run>=now()-interval '3 minutes';

  v_ok:=v_cron_ok and v_cron_failures_24h=0 and v_overdue=0 and v_open_failures=0;

  return jsonb_build_object(
    'ok',v_ok,
    'checked_at',clock_timestamp(),
    'recovery_model','transaction rollback + automatic retry on the next minute',
    'cron',jsonb_build_object(
      'job_name','lottery-events-every-minute',
      'active',coalesce(v_cron_active,false),
      'healthy',v_cron_ok,
      'last_run_at',v_last_run,
      'last_status',v_last_status,
      'last_message',v_last_message,
      'failed_runs_24h',v_cron_failures_24h
    ),
    'draws',jsonb_build_object(
      'overdue_scheduled',v_overdue,
      'open_failure_incidents',v_open_failures,
      'completed_24h',v_recent_draws,
      'last_completed_at',v_last_completed
    ),
    'incidents',v_incidents
  );
end;
$function$;

create or replace function private.run_lottery_operational_health_check()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $function$
declare
  v_report jsonb;
  v_last_failed_alert timestamptz;
  v_last_recovered_alert timestamptz;
begin
  v_report:=private.lottery_operational_health_report();

  select max(created_at) into v_last_failed_alert
  from public.audit_logs
  where action='lottery_operational_health_failed';

  select max(created_at) into v_last_recovered_alert
  from public.audit_logs
  where action='lottery_operational_health_recovered';

  if not coalesce((v_report->>'ok')::boolean,false) then
    if v_last_failed_alert is null or v_last_failed_alert<now()-interval '15 minutes' then
      insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,new_data)
      values(null,'lottery_operational_health_failed','system','lottery-operations',v_report);
    end if;
  elsif v_last_failed_alert is not null
        and v_last_failed_alert>coalesce(v_last_recovered_alert,'epoch'::timestamptz) then
    insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,new_data)
    values(null,'lottery_operational_health_recovered','system','lottery-operations',v_report);
  end if;

  return v_report;
end;
$function$;

create or replace function public.admin_get_lottery_operational_health()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $function$
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  return private.lottery_operational_health_report();
end;
$function$;

create or replace function public.admin_retry_due_lottery_events()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $function$
declare
  v_processed integer;
  v_report jsonb;
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  v_processed:=private.run_due_lottery_events();
  v_report:=private.lottery_operational_health_report();

  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,new_data)
  values(
    (select auth.uid()),
    'admin_retry_due_lottery_events',
    'system',
    'lottery-operations',
    jsonb_build_object(
      'processed',v_processed,
      'health',v_report
    )
  );

  return v_report||jsonb_build_object('manual_retry_processed',v_processed);
end;
$function$;

revoke all on function private.lottery_operational_health_report() from public,anon,authenticated;
revoke all on function private.run_lottery_operational_health_check() from public,anon,authenticated;
revoke all on function public.admin_get_lottery_operational_health() from public,anon;
revoke all on function public.admin_retry_due_lottery_events() from public,anon;
grant execute on function public.admin_get_lottery_operational_health() to authenticated;
grant execute on function public.admin_retry_due_lottery_events() to authenticated;

select cron.schedule(
  'lottery-operational-health',
  '*/5 * * * *',
  'select private.run_lottery_operational_health_check();'
);
