-- Phase 2 — canonical admin audit trail and operations incident center.

create table if not exists private.admin_change_audit (
  id bigint generated always as identity primary key,
  actor_user_id uuid,
  action text not null,
  table_name text not null,
  row_id text,
  reason text not null,
  request_path text,
  request_ip text,
  user_agent text,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_change_audit_created_idx
on private.admin_change_audit(created_at desc);

create index if not exists admin_change_audit_actor_created_idx
on private.admin_change_audit(actor_user_id,created_at desc);

create index if not exists admin_change_audit_table_row_idx
on private.admin_change_audit(table_name,row_id,created_at desc);

revoke all on table private.admin_change_audit from public,anon,authenticated;

create or replace function private.capture_admin_change_audit()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $function$
declare
  v_old jsonb;
  v_new jsonb;
  v_row jsonb;
  v_headers jsonb:='{}'::jsonb;
  v_actor uuid;
  v_action text;
  v_reason text;
  v_path text;
  v_row_id text;
  v_ip text;
  v_ua text;
begin
  if tg_op='INSERT' then
    v_new:=to_jsonb(new);
    v_row:=v_new;
  elsif tg_op='UPDATE' then
    v_old:=to_jsonb(old);
    v_new:=to_jsonb(new);
    v_row:=v_new;
  else
    v_old:=to_jsonb(old);
    v_row:=v_old;
  end if;

  begin
    v_headers:=coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}'::jsonb);
  exception when others then
    v_headers:='{}'::jsonb;
  end;

  v_path:=nullif(current_setting('request.path',true),'');
  v_ip:=nullif(split_part(coalesce(v_headers->>'x-forwarded-for',''),',',1),'');
  v_ua:=nullif(left(coalesce(v_headers->>'user-agent',''),500),'');
  v_actor:=auth.uid();

  -- Support Point admin adjustments are performed by the protected
  -- support-device-admin Edge Function using service credentials. Preserve
  -- the authenticated admin actor and human note that the function writes
  -- into the row instead of relying on auth.uid() in that service request.
  if tg_table_name='support_point_adjustments' and tg_op='INSERT' then
    v_actor:=nullif(v_new->>'actor_user_id','')::uuid;
    if v_actor is null then
      return new;
    end if;
    v_action:='support_admin_adjust_points';
    v_reason:=nullif(btrim(v_new->>'note'),'');
  else
    if v_actor is null or not public.is_admin() then
      if tg_op='DELETE' then return old; else return new; end if;
    end if;

    -- Canonical row-change audit is scoped to authenticated admin Data API
    -- actions. System/cron mutations already have dedicated operational audit.
    if coalesce(v_path,'') !~* '(^|/)rpc/admin_' then
      if tg_op='DELETE' then return old; else return new; end if;
    end if;

    v_action:=regexp_replace(coalesce(v_path,'admin_change'),'^/?rpc/','','i');
    v_reason:=nullif(btrim(v_headers->>'x-admin-reason'),'');
  end if;

  v_reason:=coalesce(v_reason,'Not supplied by client');
  v_row_id:=coalesce(
    v_row->>'id',
    case when v_row ? 'event_id' and v_row ? 'rank'
      then (v_row->>'event_id')||':'||(v_row->>'rank') end,
    v_row->>'event_id',
    v_row->>'user_id'
  );

  insert into private.admin_change_audit(
    actor_user_id,action,table_name,row_id,reason,request_path,request_ip,
    user_agent,old_data,new_data
  )
  values(
    v_actor,v_action,tg_table_name,v_row_id,left(v_reason,500),v_path,v_ip,
    v_ua,v_old,v_new
  );

  if tg_op='DELETE' then return old; else return new; end if;
end;
$function$;

revoke all on function private.capture_admin_change_audit() from public,anon,authenticated;

drop trigger if exists audit_admin_profiles on public.profiles;
create trigger audit_admin_profiles
after update on public.profiles
for each row execute function private.capture_admin_change_audit();

drop trigger if exists audit_admin_lottery_events on public.lottery_events;
create trigger audit_admin_lottery_events
after insert or update or delete on public.lottery_events
for each row execute function private.capture_admin_change_audit();

drop trigger if exists audit_admin_event_prize_tiers on public.event_prize_tiers;
create trigger audit_admin_event_prize_tiers
after insert or update or delete on public.event_prize_tiers
for each row execute function private.capture_admin_change_audit();

drop trigger if exists audit_admin_platform_controls on public.platform_controls;
create trigger audit_admin_platform_controls
after insert or update or delete on public.platform_controls
for each row execute function private.capture_admin_change_audit();

drop trigger if exists audit_admin_credit_requests on public.credit_requests;
create trigger audit_admin_credit_requests
after update on public.credit_requests
for each row execute function private.capture_admin_change_audit();

drop trigger if exists audit_admin_support_adjustments on public.support_point_adjustments;
create trigger audit_admin_support_adjustments
after insert on public.support_point_adjustments
for each row execute function private.capture_admin_change_audit();

create or replace function private.operations_incident_report()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','private','cron','auth'
as $function$
declare
  v_draw jsonb;
  v_credit jsonb;
  v_cron_failed bigint:=0;
  v_support_failed bigint:=0;
  v_binance_failed bigint:=0;
  v_credit_failed bigint:=0;
  v_auth_events bigint:=0;
  v_open bigint:=0;
  v_recent jsonb:='[]'::jsonb;
  v_ok boolean:=false;
begin
  v_draw:=private.lottery_operational_health_report();
  v_credit:=private.draw_credit_integrity_report();

  select count(*) into v_cron_failed
  from cron.job_run_details
  where start_time>now()-interval '24 hours'
    and status='failed';

  select count(*) into v_support_failed
  from public.support_claim_requests
  where status ~* '(failed|error)'
    and created_at>now()-interval '24 hours';

  select count(*) into v_binance_failed
  from public.binance_pay_orders
  where status ~* '(failed|error)'
    and created_at>now()-interval '24 hours';

  select count(*) into v_credit_failed
  from public.credit_requests
  where status ~* '(failed|error)'
    and created_at>now()-interval '24 hours';

  if to_regclass('auth.audit_log_entries') is not null then
    execute 'select count(*) from auth.audit_log_entries where created_at>now()-interval ''24 hours'''
      into v_auth_events;
  end if;

  v_open :=
    coalesce((v_draw->'draws'->>'open_failure_incidents')::bigint,0)
    + coalesce((v_draw->'draws'->>'overdue_scheduled')::bigint,0)
    + coalesce((v_credit->>'issue_total')::bigint,0)
    + v_support_failed
    + v_binance_failed
    + v_credit_failed
    + v_cron_failed;

  with incident_rows as (
    select
      case
        when a.action='draw_credit_integrity_failed' then 'critical'
        when a.action in ('lottery_operational_health_failed','lottery_event_draw_failed') then 'critical'
        else 'warning'
      end as severity,
      'system'::text as category,
      replace(a.action,'_',' ') as title,
      coalesce(a.new_data->>'error',a.new_data::text) as detail,
      a.entity_type,
      a.entity_id,
      a.created_at
    from public.audit_logs a
    where a.created_at>now()-interval '24 hours'
      and (
        a.action like '%_failed'
        or a.action like '%_error'
        or a.action='draw_credit_integrity_failed'
      )

    union all

    select
      'warning','support','Support claim '||status,
      'Support claim requires review',
      'support_claim_request',id::text,created_at
    from public.support_claim_requests
    where status ~* '(failed|error)'
      and created_at>now()-interval '24 hours'

    union all

    select
      'warning','payment','Binance Pay order '||status,
      'Payment order requires review',
      'binance_pay_order',id::text,created_at
    from public.binance_pay_orders
    where status ~* '(failed|error)'
      and created_at>now()-interval '24 hours'

    union all

    select
      'warning','credit','Credit request '||status,
      coalesce(admin_note,note,'Credit request requires review'),
      'credit_request',id::text,created_at
    from public.credit_requests
    where status ~* '(failed|error)'
      and created_at>now()-interval '24 hours'

    union all

    select
      'warning','cron','Cron job failed',
      coalesce(r.return_message,'Cron execution failed'),
      'cron_job',r.jobid::text,r.start_time
    from cron.job_run_details r
    where r.start_time>now()-interval '24 hours'
      and r.status='failed'
  )
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb)
    into v_recent
  from (
    select * from incident_rows
    order by created_at desc
    limit 100
  ) x;

  v_ok :=
    coalesce((v_draw->>'ok')::boolean,false)
    and coalesce((v_credit->>'ok')::boolean,false)
    and v_support_failed=0
    and v_binance_failed=0
    and v_credit_failed=0
    and v_cron_failed=0;

  return jsonb_build_object(
    'ok',v_ok,
    'checked_at',clock_timestamp(),
    'open_issue_count',v_open,
    'draw',v_draw,
    'credit_integrity',v_credit,
    'counts',jsonb_build_object(
      'cron_failures_24h',v_cron_failed,
      'support_failures_24h',v_support_failed,
      'payment_failures_24h',v_binance_failed,
      'credit_request_failures_24h',v_credit_failed,
      'auth_audit_events_24h',v_auth_events
    ),
    'recent_incidents',v_recent,
    'platform_log_note','Auth/REST/Edge HTTP error streams are platform logs; this database report covers application and database incidents.'
  );
end;
$function$;

revoke all on function private.operations_incident_report() from public,anon,authenticated;

create or replace function public.admin_get_operations_incident_center()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $function$
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  return private.operations_incident_report();
end;
$function$;

create or replace function public.admin_get_admin_change_audit(p_limit integer default 100)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $function$
declare
  v_limit integer:=greatest(1,least(coalesce(p_limit,100),500));
  v_rows jsonb;
  v_count_24h bigint;
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  select count(*) into v_count_24h
  from private.admin_change_audit
  where created_at>now()-interval '24 hours';

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb)
    into v_rows
  from (
    select
      a.id,a.actor_user_id,p.display_name as actor_name,p.email as actor_email,
      a.action,a.table_name,a.row_id,a.reason,a.request_path,a.request_ip,
      a.old_data,a.new_data,a.created_at
    from private.admin_change_audit a
    left join public.profiles p on p.id=a.actor_user_id
    order by a.created_at desc
    limit v_limit
  ) x;

  return jsonb_build_object(
    'count_24h',v_count_24h,
    'rows',v_rows
  );
end;
$function$;

revoke all on function public.admin_get_operations_incident_center() from public,anon;
revoke all on function public.admin_get_admin_change_audit(integer) from public,anon;
grant execute on function public.admin_get_operations_incident_center() to authenticated;
grant execute on function public.admin_get_admin_change_audit(integer) to authenticated;


-- Race-safe operational health: ignore the draw cron row while it is still
-- running at the same second as the 5-minute health checker. Health is based
-- on the most recent successful heartbeat and terminal failed rows only.
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
      and status='succeeded'
    order by start_time desc
    limit 1;

    select count(*) into v_cron_failures_24h
    from cron.job_run_details
    where jobid=v_jobid
      and start_time>now()-interval '24 hours'
      and status='failed';
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

revoke all on function private.lottery_operational_health_report() from public,anon,authenticated;
