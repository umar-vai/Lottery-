-- Phase 7D — external-alert self-monitoring, Incident Center visibility, and retention.

create or replace function private.production_alert_delivery_report()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','private','cron'
as $function$
declare
  v_cfg private.production_alert_delivery_config%rowtype;
  v_pending bigint:=0;
  v_in_flight bigint:=0;
  v_dead bigint:=0;
  v_delivered_24h bigint:=0;
  v_pending_old bigint:=0;
  v_cron_active boolean:=false;
begin
  select * into v_cfg
  from private.production_alert_delivery_config
  where id=1;

  select
    count(*) filter(where status='pending'),
    count(*) filter(where status='in_flight'),
    count(*) filter(where status='dead_letter'),
    count(*) filter(where status='delivered' and delivered_at>now()-interval '24 hours'),
    count(*) filter(where status='pending' and next_attempt_at<now()-interval '10 minutes')
  into v_pending,v_in_flight,v_dead,v_delivered_24h,v_pending_old
  from private.production_alert_outbox;

  select exists(
    select 1 from cron.job
    where jobname='production-alert-dispatch-minute' and active
  ) into v_cron_active;

  return jsonb_build_object(
    'enabled',coalesce(v_cfg.external_enabled,false),
    'channel',coalesce(v_cfg.channel,'webhook'),
    'dispatcher_configured',coalesce(v_cfg.dispatcher_configured,false),
    'external_webhook_configured',coalesce(v_cfg.dispatcher_configured,false),
    'warning_escalation_1_minutes',coalesce(v_cfg.warning_escalation_1_minutes,15),
    'critical_escalation_1_minutes',coalesce(v_cfg.critical_escalation_1_minutes,5),
    'escalation_2_minutes',coalesce(v_cfg.escalation_2_minutes,30),
    'max_attempts',coalesce(v_cfg.max_attempts,6),
    'pending_count',v_pending,
    'in_flight_count',v_in_flight,
    'dead_letter_count',v_dead,
    'delivered_24h',v_delivered_24h,
    'pending_over_10m',v_pending_old,
    'dispatcher_cron_active',v_cron_active,
    'last_dispatch_at',v_cfg.last_dispatch_at,
    'last_delivery_at',v_cfg.last_delivery_at,
    'last_error',v_cfg.last_error,
    'external_delivery_note',case
      when not coalesce(v_cfg.external_enabled,false)
        then 'External webhook delivery is disabled. Configure Edge Function webhook secrets before enabling.'
      when not coalesce(v_cfg.dispatcher_configured,false)
        then 'External delivery is enabled but the Edge dispatcher has not verified webhook configuration.'
      else 'External webhook delivery is enabled and dispatcher configuration has been verified.'
    end
  );
end;
$function$;

revoke all on function private.production_alert_delivery_report()
from public,anon,authenticated,service_role;

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
  v_severity text:='ok';\n  v_alert jsonb;
begin
  v_operations:=private.operations_incident_report();\n  v_alert:=private.production_alert_delivery_report();

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
    count(*) filter(where status='failed' and start_time>now()-interval '15 minutes'),
    count(*) filter(where status='failed' and start_time>now()-interval '24 hours')
  into v_cron_failed_15m,v_cron_failed_24h
  from cron.job_run_details
  where start_time>now()-interval '24 hours';

  select count(*) into v_expected_cron_missing
  from (values
    ('lottery-events-every-minute'),
    ('draw-credit-integrity-hourly'),
    ('lottery-operational-health'),
    ('production-slo-every-5-minutes'),
    ('production-slo-snapshot-15m'),
    ('operational-history-retention-daily'),\n    ('production-alert-dispatch-minute')
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
    v_breaches:=v_breaches||jsonb_build_array(jsonb_build_object(
      'signal','external_alert_dispatcher_unconfigured',
      'severity','warning'
    ));
  end if;

  if coalesce((v_alert->>'dead_letter_count')::bigint,0)>0 then
    if v_severity='ok' then v_severity:='warning'; end if;
    v_breaches:=v_breaches||jsonb_build_array(jsonb_build_object(
      'signal','external_alert_dead_letter',
      'severity','warning',
      'value',coalesce((v_alert->>'dead_letter_count')::bigint,0),
      'threshold',0
    ));
  end if;

  if coalesce((v_alert->>'pending_over_10m')::bigint,0)>0 then
    if v_severity='ok' then v_severity:='warning'; end if;
    v_breaches:=v_breaches||jsonb_build_array(jsonb_build_object(
      'signal','external_alert_backlog',
      'severity','warning',
      'value',coalesce((v_alert->>'pending_over_10m')::bigint,0),
      'threshold',0
    ));
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
    'alert_delivery',v_alert,\n    'application',v_operations,
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
  v_last_recovery timestamptz;\n  v_delivery jsonb;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  v_base:=private.operations_incident_report();
  v_slo:=private.production_slo_report();
  v_history:=private.production_slo_history_report(24);\n  v_delivery:=private.production_alert_delivery_report();

  select max(created_at)
  into v_last_recovery
  from public.audit_logs
  where action='production_slo_recovered';

  select count(*)
  into v_pending
  from public.audit_logs a
  left join private.production_incident_acknowledgements ack
    on ack.audit_log_id=a.id
  where a.action='production_slo_breached'
    and a.created_at>coalesce(v_last_recovery,'epoch'::timestamptz)
    and ack.audit_log_id is null;

  select count(*)
  into v_unacked_7d
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
    'alert_delivery',v_delivery || jsonb_build_object('admin_polling_seconds',60)
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
begin
  delete from private.production_slo_snapshots
  where captured_at<now()-interval '30 days';
  get diagnostics v_slo_deleted=row_count;

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

  return jsonb_build_object(
    'retention_days',30,
    'dead_letter_retention_days',90,
    'slo_snapshots_deleted',v_slo_deleted,
    'cron_history_deleted',v_cron_deleted,
    'alert_outbox_deleted',v_alert_deleted,
    'pruned_at',clock_timestamp()
  );
end;
$function$;

comment on function private.production_alert_delivery_report() is
  'Phase 7D private delivery-health report for webhook configuration, queue/backlog/dead-letter state and dispatcher cron health.';

comment on function private.production_slo_report() is
  'Phase 7A-7D production SLO report including the required external-alert dispatcher cron and alert-delivery health.';

comment on function public.admin_get_operations_incident_center() is
  'Admin-only incident center extended through Phase 7D with SLO history, acknowledgement data, and external alert delivery health.';
