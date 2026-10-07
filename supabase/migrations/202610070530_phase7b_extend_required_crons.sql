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
begin
  v_operations:=private.operations_incident_report();

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
    ('operational-history-retention-daily')
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

comment on function private.production_slo_report() is
  'Phase 7A/7B private production SLO report: includes all required core, snapshot, and retention cron jobs.';
