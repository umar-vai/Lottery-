-- Phase 8 — production launch and 72-hour stabilization.
-- Filters cron SLOs to currently active jobs, captures launch readiness every 15m,
-- and surfaces launch stability through the existing admin Incident Center.

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
  from cron.job_run_details r
  join cron.job j on j.jobid=r.jobid and j.active
  where r.start_time>now()-interval '24 hours'
    and r.status='failed';

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
    join cron.job j on j.jobid=r.jobid and j.active
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

create or replace function private.production_slo_report()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','private','cron'
as $function$
declare
  v_operations jsonb;
  v_client_connections bigint:=0;
  v_active_connections bigint:=0;
  v_max_connections integer:=0;
  v_connection_pct numeric:=0;
  v_blocked_long bigint:=0;
  v_idle_tx_long bigint:=0;
  v_table_cache numeric:=100;
  v_index_cache numeric:=100;
  v_cron_failed_15m bigint:=0;
  v_cron_failed_24h bigint:=0;
  v_expected_cron_missing bigint:=0;
  v_support_duplicate bigint:=0;
  v_support_orphan bigint:=0;
  v_support_expired_pending bigint:=0;
  v_breaches jsonb:='[]'::jsonb;
  v_severity text:='ok';
  v_alert jsonb;
begin
  v_operations:=private.operations_incident_report();
  v_alert:=private.production_alert_delivery_report();

  select
    count(*) filter(where backend_type='client backend'),
    count(*) filter(where state='active'),
    current_setting('max_connections')::integer
  into v_client_connections,v_active_connections,v_max_connections
  from pg_stat_activity;

  v_connection_pct:=round(100.0*v_client_connections/nullif(v_max_connections,0),2);

  select count(*) into v_blocked_long
  from pg_stat_activity a
  where cardinality(pg_blocking_pids(a.pid))>0
    and now()-coalesce(a.query_start,a.xact_start,a.backend_start)>interval '30 seconds';

  select count(*) into v_idle_tx_long
  from pg_stat_activity
  where state='idle in transaction'
    and xact_start<now()-interval '60 seconds';

  select coalesce(round(100.0*sum(heap_blks_hit)/nullif(sum(heap_blks_hit)+sum(heap_blks_read),0),2),100)
  into v_table_cache
  from pg_statio_user_tables;

  select coalesce(round(100.0*sum(idx_blks_hit)/nullif(sum(idx_blks_hit)+sum(idx_blks_read),0),2),100)
  into v_index_cache
  from pg_statio_user_indexes;

  select
    count(*) filter(where r.status='failed' and r.start_time>now()-interval '15 minutes'),
    count(*) filter(where r.status='failed' and r.start_time>now()-interval '24 hours')
  into v_cron_failed_15m,v_cron_failed_24h
  from cron.job_run_details r
  join cron.job j on j.jobid=r.jobid and j.active
  where r.start_time>now()-interval '24 hours';

  select count(*) into v_expected_cron_missing
  from (values
    ('lottery-events-every-minute'),
    ('draw-credit-integrity-hourly'),
    ('lottery-operational-health'),
    ('production-slo-every-5-minutes'),
    ('production-slo-snapshot-15m'),
    ('operational-history-retention-daily'),
    ('production-alert-dispatch-minute')
  ) expected(jobname)
  where not exists(
    select 1 from cron.job j
    where j.jobname=expected.jobname and j.active
  );

  select count(*) into v_support_duplicate
  from (
    select transaction_id
    from public.support_point_claims
    group by transaction_id
    having count(*)>1
  ) d;

  select count(*) into v_support_orphan
  from public.support_point_claims c
  left join public.support_transactions t on t.id=c.transaction_id
  where t.id is null;

  select count(*) into v_support_expired_pending
  from public.support_claim_requests
  where status='pending' and expires_at<now();

  if not coalesce((v_operations->'draw'->>'ok')::boolean,false) then
    v_severity:='critical';
    v_breaches:=v_breaches||jsonb_build_array(jsonb_build_object('signal','lottery_operations','severity','critical'));
  end if;

  if not coalesce((v_operations->'credit_integrity'->>'ok')::boolean,false) then
    v_severity:='critical';
    v_breaches:=v_breaches||jsonb_build_array(jsonb_build_object('signal','draw_credit_integrity','severity','critical'));
  end if;

  if v_support_duplicate>0 then
    v_severity:='critical';
    v_breaches:=v_breaches||jsonb_build_array(jsonb_build_object('signal','support_duplicate_settlement','severity','critical','value',v_support_duplicate,'threshold',0));
  end if;

  if v_support_orphan>0 then
    v_severity:='critical';
    v_breaches:=v_breaches||jsonb_build_array(jsonb_build_object('signal','support_orphan_claim','severity','critical','value',v_support_orphan,'threshold',0));
  end if;

  if v_cron_failed_15m>0 then
    v_severity:='critical';
    v_breaches:=v_breaches||jsonb_build_array(jsonb_build_object('signal','cron_failures_15m','severity','critical','value',v_cron_failed_15m,'threshold',0));
  end if;

  if v_expected_cron_missing>0 then
    v_severity:='critical';
    v_breaches:=v_breaches||jsonb_build_array(jsonb_build_object('signal','missing_required_cron','severity','critical','value',v_expected_cron_missing,'threshold',0));
  end if;

  if v_connection_pct>=90 then
    v_severity:='critical';
    v_breaches:=v_breaches||jsonb_build_array(jsonb_build_object('signal','connection_usage_pct','severity','critical','value',v_connection_pct,'threshold',90));
  elsif v_connection_pct>=75 then
    if v_severity='ok' then v_severity:='warning'; end if;
    v_breaches:=v_breaches||jsonb_build_array(jsonb_build_object('signal','connection_usage_pct','severity','warning','value',v_connection_pct,'threshold',75));
  end if;

  if v_blocked_long>0 then
    v_severity:='critical';
    v_breaches:=v_breaches||jsonb_build_array(jsonb_build_object('signal','blocked_sessions_over_30s','severity','critical','value',v_blocked_long,'threshold',0));
  end if;

  if v_idle_tx_long>0 then
    if v_severity='ok' then v_severity:='warning'; end if;
    v_breaches:=v_breaches||jsonb_build_array(jsonb_build_object('signal','idle_in_transaction_over_60s','severity','warning','value',v_idle_tx_long,'threshold',0));
  end if;

  if v_table_cache<99 then
    if v_severity='ok' then v_severity:='warning'; end if;
    v_breaches:=v_breaches||jsonb_build_array(jsonb_build_object('signal','table_cache_hit_pct','severity','warning','value',v_table_cache,'threshold',99));
  end if;

  if v_index_cache<99 then
    if v_severity='ok' then v_severity:='warning'; end if;
    v_breaches:=v_breaches||jsonb_build_array(jsonb_build_object('signal','index_cache_hit_pct','severity','warning','value',v_index_cache,'threshold',99));
  end if;

  if v_cron_failed_24h>0 and v_cron_failed_15m=0 then
    if v_severity='ok' then v_severity:='warning'; end if;
    v_breaches:=v_breaches||jsonb_build_array(jsonb_build_object('signal','cron_failures_24h','severity','warning','value',v_cron_failed_24h,'threshold',0));
  end if;

  if v_support_expired_pending>0 then
    if v_severity='ok' then v_severity:='warning'; end if;
    v_breaches:=v_breaches||jsonb_build_array(jsonb_build_object('signal','expired_support_pending','severity','warning','value',v_support_expired_pending,'threshold',0));
  end if;

  if coalesce((v_operations->'counts'->>'support_failures_24h')::bigint,0)>0
     or coalesce((v_operations->'counts'->>'payment_failures_24h')::bigint,0)>0
     or coalesce((v_operations->'counts'->>'credit_request_failures_24h')::bigint,0)>0 then
    if v_severity='ok' then v_severity:='warning'; end if;
    v_breaches:=v_breaches||jsonb_build_array(jsonb_build_object(
      'signal','application_failures_24h','severity','warning',
      'support',coalesce((v_operations->'counts'->>'support_failures_24h')::bigint,0),
      'payment',coalesce((v_operations->'counts'->>'payment_failures_24h')::bigint,0),
      'credit',coalesce((v_operations->'counts'->>'credit_request_failures_24h')::bigint,0)
    ));
  end if;

  if coalesce((v_alert->>'enabled')::boolean,false)
     and not coalesce((v_alert->>'dispatcher_configured')::boolean,false) then
    if v_severity='ok' then v_severity:='warning'; end if;
    v_breaches:=v_breaches||jsonb_build_array(jsonb_build_object('signal','external_alert_dispatcher_unconfigured','severity','warning'));
  end if;

  if coalesce((v_alert->>'dead_letter_count')::bigint,0)>0 then
    if v_severity='ok' then v_severity:='warning'; end if;
    v_breaches:=v_breaches||jsonb_build_array(jsonb_build_object('signal','external_alert_dead_letter','severity','warning','value',coalesce((v_alert->>'dead_letter_count')::bigint,0),'threshold',0));
  end if;

  if coalesce((v_alert->>'pending_over_10m')::bigint,0)>0 then
    if v_severity='ok' then v_severity:='warning'; end if;
    v_breaches:=v_breaches||jsonb_build_array(jsonb_build_object('signal','external_alert_backlog','severity','warning','value',coalesce((v_alert->>'pending_over_10m')::bigint,0),'threshold',0));
  end if;

  return jsonb_build_object(
    'ok',v_severity='ok',
    'severity',v_severity,
    'checked_at',clock_timestamp(),
    'breaches',v_breaches,
    'database',jsonb_build_object(
      'client_connections',v_client_connections,
      'active_connections',v_active_connections,
      'max_connections',v_max_connections,
      'connection_usage_pct',v_connection_pct,
      'blocked_sessions_over_30s',v_blocked_long,
      'idle_in_transaction_over_60s',v_idle_tx_long,
      'table_cache_hit_pct',v_table_cache,
      'index_cache_hit_pct',v_index_cache
    ),
    'cron',jsonb_build_object(
      'failed_15m',v_cron_failed_15m,
      'failed_24h',v_cron_failed_24h,
      'missing_required_jobs',v_expected_cron_missing
    ),
    'support',jsonb_build_object(
      'duplicate_settlements',v_support_duplicate,
      'orphan_claims',v_support_orphan,
      'expired_pending',v_support_expired_pending
    ),
    'alert_delivery',v_alert,
    'application',v_operations,
    'thresholds',jsonb_build_object(
      'connections_warning_pct',75,
      'connections_critical_pct',90,
      'blocked_session_critical_after_seconds',30,
      'idle_in_transaction_warning_after_seconds',60,
      'cache_hit_warning_below_pct',99,
      'cron_recent_failure_critical_window_minutes',15
    )
  );
end;
$function$;

create table private.production_launch_stability_config(
  id smallint primary key check(id=1),
  phase text not null default 'phase8',
  baseline_git_sha text not null,
  window_started_at timestamptz not null,
  window_ends_at timestamptz not null,
  status text not null check(status in ('stabilizing','completed','paused')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table private.production_launch_stability_snapshots(
  id bigint generated always as identity primary key,
  captured_at timestamptz not null default now(),
  technical_state text not null check(technical_state in ('ready','warning','blocked')),
  technical_ready boolean not null,
  report jsonb not null
);

create index production_launch_stability_snapshots_captured_at_idx
  on private.production_launch_stability_snapshots(captured_at desc);

alter table private.production_launch_stability_config enable row level security;
alter table private.production_launch_stability_snapshots enable row level security;
revoke all on table private.production_launch_stability_config from public,anon,authenticated,service_role;
revoke all on table private.production_launch_stability_snapshots from public,anon,authenticated,service_role;
revoke all on sequence private.production_launch_stability_snapshots_id_seq from public,anon,authenticated,service_role;

insert into private.production_launch_stability_config(
  id,phase,baseline_git_sha,window_started_at,window_ends_at,status
) values(
  1,'phase8','a04a30d7d3841a778382a0e43893d31c3421f131',
  clock_timestamp(),clock_timestamp()+interval '72 hours','stabilizing'
);

create or replace function private.production_launch_readiness_report()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $function$
declare
  v_slo jsonb:=private.production_slo_report();
  v_credit jsonb:=private.draw_credit_integrity_report();
  v_guard jsonb:=private.mutation_guardrail_report();
  v_alert jsonb:=private.production_alert_delivery_report();
  v_cfg private.production_launch_stability_config%rowtype;
  v_blockers jsonb:='[]'::jsonb;
  v_warnings jsonb:='[]'::jsonb;
  v_operator jsonb;
  v_public_anon_secdef bigint:=0;
  v_private_auth_secdef bigint:=0;
  v_published_events bigint:=0;
  v_state text;
  v_ready boolean;
begin
  select * into v_cfg from private.production_launch_stability_config where id=1;

  select count(*) into v_public_anon_secdef
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prosecdef
    and has_function_privilege('anon',p.oid,'EXECUTE');

  select count(*) into v_private_auth_secdef
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private' and p.prosecdef
    and has_function_privilege('authenticated',p.oid,'EXECUTE');

  select count(*) into v_published_events
  from public.lottery_events where status='published';

  if coalesce(v_slo->>'severity','critical')='critical' then
    v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object('signal','production_slo_critical','detail',v_slo->'breaches'));
  elsif coalesce(v_slo->>'severity','critical')='warning' then
    v_warnings:=v_warnings||jsonb_build_array(jsonb_build_object('signal','production_slo_warning','detail',v_slo->'breaches'));
  end if;

  if not coalesce((v_credit->>'ok')::boolean,false) then
    v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
      'signal','draw_credit_integrity','issue_total',coalesce((v_credit->>'issue_total')::integer,-1)
    ));
  end if;

  if not (
    coalesce((v_guard->>'master_enabled')::boolean,false)
    and coalesce((v_guard->>'ticket_purchases_enabled')::boolean,false)
    and coalesce((v_guard->>'game_writes_enabled')::boolean,false)
    and coalesce((v_guard->>'support_claims_enabled')::boolean,false)
    and coalesce((v_guard->>'credit_requests_enabled')::boolean,false)
    and coalesce((v_guard->>'referral_writes_enabled')::boolean,false)
    and coalesce((v_guard->>'payment_orders_enabled')::boolean,false)
  ) then
    v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object('signal','mutation_guardrail_disabled'));
  end if;

  if not coalesce((v_alert->>'enabled')::boolean,false)
     or not coalesce((v_alert->>'dispatcher_configured')::boolean,false)
     or not coalesce((v_alert->>'telegram_ready')::boolean,false)
     or coalesce((v_alert->>'dead_letter_count')::integer,0)>0 then
    v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
      'signal','external_alert_delivery',
      'enabled',coalesce((v_alert->>'enabled')::boolean,false),
      'dispatcher_configured',coalesce((v_alert->>'dispatcher_configured')::boolean,false),
      'telegram_ready',coalesce((v_alert->>'telegram_ready')::boolean,false),
      'dead_letter_count',coalesce((v_alert->>'dead_letter_count')::integer,0)
    ));
  end if;

  if v_public_anon_secdef<>2 then
    v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
      'signal','anonymous_security_definer_surface_drift','expected',2,'actual',v_public_anon_secdef
    ));
  end if;

  if v_private_auth_secdef<>0 then
    v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
      'signal','private_authenticated_security_definer_exposure','expected',0,'actual',v_private_auth_secdef
    ));
  end if;

  if v_published_events=0 then
    v_warnings:=v_warnings||jsonb_build_array(jsonb_build_object('signal','no_published_lottery'));
  end if;

  if jsonb_array_length(v_blockers)>0 then
    v_state:='blocked';
  elsif jsonb_array_length(v_warnings)>0 then
    v_state:='warning';
  else
    v_state:='ready';
  end if;

  v_ready:=v_state='ready';

  v_operator:=jsonb_build_array(
    jsonb_build_object(
      'issue',61,'key','offsite_backup_restore_rehearsal','status','outstanding',
      'launch_effect','operator_signoff_required'
    ),
    jsonb_build_object(
      'issue',59,'key','retired_edge_stub_physical_deletion','status','outstanding',
      'launch_effect','operator_signoff_required'
    ),
    jsonb_build_object(
      'issue',59,'key','leaked_password_protection','status','conditional',
      'launch_effect','not_applicable_while_google_only_free_plan'
    )
  );

  return jsonb_build_object(
    'phase','phase8',
    'technical_ready',v_ready,
    'technical_state',v_state,
    'launch_decision',case
      when v_state='blocked' then 'no_go'
      when v_state='warning' then 'hold_for_warning'
      else 'technical_go_operator_signoff_required'
    end,
    'checked_at',clock_timestamp(),
    'blockers',v_blockers,
    'warnings',v_warnings,
    'operator_exceptions',v_operator,
    'window',jsonb_build_object(
      'status',v_cfg.status,
      'started_at',v_cfg.window_started_at,
      'ends_at',v_cfg.window_ends_at,
      'baseline_git_sha',v_cfg.baseline_git_sha
    ),
    'slo',v_slo,
    'credit_integrity',v_credit,
    'guardrails',v_guard,
    'alert_delivery',v_alert,
    'security_surface',jsonb_build_object(
      'anonymous_public_security_definer',v_public_anon_secdef,
      'private_authenticated_security_definer',v_private_auth_secdef
    ),
    'published_events',v_published_events
  );
end;
$function$;

create or replace function private.capture_production_launch_stability_snapshot()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $function$
declare
  v_cfg private.production_launch_stability_config%rowtype;
  v_report jsonb;
  v_state text;
  v_ready boolean;
begin
  select * into v_cfg from private.production_launch_stability_config where id=1;

  if v_cfg.status='paused' then
    return jsonb_build_object('captured',false,'reason','paused');
  end if;

  if clock_timestamp()>v_cfg.window_ends_at then
    if v_cfg.status<>'completed' then
      update private.production_launch_stability_config
      set status='completed',updated_at=clock_timestamp()
      where id=1;
    end if;
    return jsonb_build_object('captured',false,'reason','window_completed','ended_at',v_cfg.window_ends_at);
  end if;

  v_report:=private.production_launch_readiness_report();
  v_state:=coalesce(v_report->>'technical_state','blocked');
  v_ready:=coalesce((v_report->>'technical_ready')::boolean,false);

  insert into private.production_launch_stability_snapshots(
    captured_at,technical_state,technical_ready,report
  ) values(clock_timestamp(),v_state,v_ready,v_report);

  return jsonb_build_object(
    'captured',true,
    'technical_state',v_state,
    'technical_ready',v_ready,
    'report',v_report
  );
end;
$function$;

create or replace function private.production_launch_stability_report()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $function$
declare
  v_cfg private.production_launch_stability_config%rowtype;
  v_current jsonb;
begin
  select * into v_cfg from private.production_launch_stability_config where id=1;
  v_current:=private.production_launch_readiness_report();

  return jsonb_build_object(
    'phase','phase8',
    'window',jsonb_build_object(
      'status',case when clock_timestamp()>v_cfg.window_ends_at and v_cfg.status='stabilizing' then 'completed' else v_cfg.status end,
      'started_at',v_cfg.window_started_at,
      'ends_at',v_cfg.window_ends_at,
      'remaining_seconds',greatest(0,extract(epoch from (v_cfg.window_ends_at-clock_timestamp()))::bigint),
      'baseline_git_sha',v_cfg.baseline_git_sha
    ),
    'current',v_current,
    'snapshot_count',(
      select count(*) from private.production_launch_stability_snapshots
      where captured_at>=v_cfg.window_started_at
    ),
    'state_counts',jsonb_build_object(
      'ready',(select count(*) from private.production_launch_stability_snapshots where captured_at>=v_cfg.window_started_at and technical_state='ready'),
      'warning',(select count(*) from private.production_launch_stability_snapshots where captured_at>=v_cfg.window_started_at and technical_state='warning'),
      'blocked',(select count(*) from private.production_launch_stability_snapshots where captured_at>=v_cfg.window_started_at and technical_state='blocked')
    ),
    'max_connection_usage_pct',coalesce((
      select max((report->'slo'->'database'->>'connection_usage_pct')::numeric)
      from private.production_launch_stability_snapshots
      where captured_at>=v_cfg.window_started_at
    ),0),
    'max_blocked_sessions_over_30s',coalesce((
      select max((report->'slo'->'database'->>'blocked_sessions_over_30s')::integer)
      from private.production_launch_stability_snapshots
      where captured_at>=v_cfg.window_started_at
    ),0),
    'latest',(
      select jsonb_build_object(
        'captured_at',captured_at,
        'technical_state',technical_state,
        'technical_ready',technical_ready,
        'report',report
      )
      from private.production_launch_stability_snapshots
      order by captured_at desc
      limit 1
    )
  );
end;
$function$;

revoke all on function private.production_launch_readiness_report() from public,anon,authenticated,service_role;
revoke all on function private.capture_production_launch_stability_snapshot() from public,anon,authenticated,service_role;
revoke all on function private.production_launch_stability_report() from public,anon,authenticated,service_role;

create or replace function public.admin_get_operations_incident_center()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','private','auth'
as $function$
declare
  v_base jsonb;
  v_slo jsonb;
  v_history jsonb;
  v_events jsonb;
  v_pending bigint:=0;
  v_unacked_7d bigint:=0;
  v_last_recovery timestamptz;
  v_delivery jsonb;
  v_launch jsonb;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  v_base:=private.operations_incident_report();
  v_slo:=private.production_slo_report();
  v_history:=private.production_slo_history_report(24);
  v_delivery:=private.production_alert_delivery_report();
  v_launch:=private.production_launch_stability_report();

  select max(created_at) into v_last_recovery
  from public.audit_logs
  where action='production_slo_recovered';

  select count(*) into v_pending
  from public.audit_logs a
  left join private.production_incident_acknowledgements ack
    on ack.audit_log_id=a.id
  where a.action='production_slo_breached'
    and a.created_at>coalesce(v_last_recovery,'epoch'::timestamptz)
    and ack.audit_log_id is null;

  select count(*) into v_unacked_7d
  from public.audit_logs a
  left join private.production_incident_acknowledgements ack
    on ack.audit_log_id=a.id
  where a.action='production_slo_breached'
    and a.created_at>now()-interval '7 days'
    and ack.audit_log_id is null;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb)
  into v_events
  from (
    select
      a.id,
      a.action,
      case
        when a.action='production_slo_recovered' then 'ok'
        else coalesce(a.new_data->>'severity','warning')
      end as severity,
      coalesce(a.new_data->'breaches','[]'::jsonb) as breaches,
      a.created_at,
      (ack.audit_log_id is not null) as acknowledged,
      ack.acknowledged_by,
      ack.acknowledged_at,
      ack.note as acknowledgement_note,
      p.display_name as acknowledged_by_name,
      p.email as acknowledged_by_email
    from public.audit_logs a
    left join private.production_incident_acknowledgements ack
      on ack.audit_log_id=a.id
    left join public.profiles p
      on p.id=ack.acknowledged_by
    where a.action in ('production_slo_breached','production_slo_recovered')
      and a.created_at>now()-interval '7 days'
    order by a.created_at desc
    limit 50
  ) x;

  return v_base || jsonb_build_object(
    'production_slo',v_slo,
    'slo_history',v_history,
    'slo_events',v_events,
    'pending_slo_ack_count',v_pending,
    'unacknowledged_slo_breaches_7d',v_unacked_7d,
    'alert_delivery',v_delivery || jsonb_build_object('admin_polling_seconds',60),
    'launch_stability',v_launch
  );
end;
$function$;

create or replace function private.prune_operational_history()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','private','cron'
as $function$
declare
  v_slo_deleted bigint:=0;
  v_cron_deleted bigint:=0;
  v_alert_deleted bigint:=0;
  v_rate_deleted bigint:=0;
  v_launch_deleted bigint:=0;
begin
  delete from private.production_slo_snapshots
  where captured_at<now()-interval '30 days';
  get diagnostics v_slo_deleted=row_count;

  delete from private.production_launch_stability_snapshots
  where captured_at<now()-interval '30 days';
  get diagnostics v_launch_deleted=row_count;

  delete from cron.job_run_details
  where start_time<now()-interval '30 days';
  get diagnostics v_cron_deleted=row_count;

  delete from private.production_alert_outbox
  where (
    status in ('delivered','cancelled')
    and updated_at<now()-interval '30 days'
  ) or (
    status='dead_letter'
    and updated_at<now()-interval '90 days'
  );
  get diagnostics v_alert_deleted=row_count;

  delete from private.mutation_rate_limit_windows
  where updated_at<now()-interval '2 days';
  get diagnostics v_rate_deleted=row_count;

  return jsonb_build_object(
    'retention_days',30,
    'dead_letter_retention_days',90,
    'rate_limit_retention_days',2,
    'slo_snapshots_deleted',v_slo_deleted,
    'launch_snapshots_deleted',v_launch_deleted,
    'cron_history_deleted',v_cron_deleted,
    'alert_outbox_deleted',v_alert_deleted,
    'mutation_rate_windows_deleted',v_rate_deleted,
    'pruned_at',clock_timestamp()
  );
end;
$function$;

revoke all on function private.operations_incident_report() from public,anon,authenticated,service_role;
revoke all on function private.production_slo_report() from public,anon,authenticated,service_role;
revoke all on function private.prune_operational_history() from public,anon,authenticated,service_role;

select cron.schedule(
  'production-launch-stability-15m',
  '*/15 * * * *',
  'select private.capture_production_launch_stability_snapshot();'
);

select private.run_production_slo_check();
select private.capture_production_launch_stability_snapshot();

comment on table private.production_launch_stability_config is
  'Phase 8 private 72-hour production launch stabilization window.';
comment on table private.production_launch_stability_snapshots is
  'Phase 8 private 15-minute launch-readiness evidence retained for 30 days.';
comment on function private.production_launch_readiness_report() is
  'Combines SLO, Draw Credit, Support, guardrails, Telegram and privileged-surface invariants into launch readiness.';
comment on function private.production_launch_stability_report() is
  'Summarizes the current Phase 8 launch window and its retained readiness snapshots.';
comment on function private.operations_incident_report() is
  'Production application/database incident report. Cron failures are scoped to currently active jobs.';
comment on function private.production_slo_report() is
  'Production SLO report. Historical runs for deleted cron jobs do not keep current SLOs degraded.';
