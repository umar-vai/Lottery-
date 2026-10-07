-- Phase 7B — durable SLO history and bounded operational retention.
-- Stores private SLO snapshots every 15 minutes and prunes both snapshots and
-- pg_cron run history older than 30 days. No browser-callable API is added.

create table if not exists private.production_slo_snapshots (
  id bigint generated always as identity primary key,
  captured_at timestamptz not null default now(),
  severity text not null check (severity in ('ok','warning','critical')),
  report jsonb not null
);

create index if not exists production_slo_snapshots_captured_at_idx
  on private.production_slo_snapshots(captured_at desc);

revoke all on table private.production_slo_snapshots from public, anon, authenticated, service_role;
revoke all on sequence private.production_slo_snapshots_id_seq from public, anon, authenticated, service_role;

create or replace function private.capture_production_slo_snapshot()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $function$
declare
  v_report jsonb;
begin
  v_report:=private.production_slo_report();

  insert into private.production_slo_snapshots(severity,report)
  values(coalesce(v_report->>'severity','critical'),v_report);

  return v_report;
end;
$function$;

create or replace function private.production_slo_history_report(p_hours integer default 24)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $function$
declare
  v_hours integer;
  v_from timestamptz;
begin
  v_hours:=greatest(1,least(coalesce(p_hours,24),720));
  v_from:=now()-make_interval(hours=>v_hours);

  return jsonb_build_object(
    'window_hours',v_hours,
    'from',v_from,
    'to',now(),
    'snapshot_count',(
      select count(*) from private.production_slo_snapshots
      where captured_at>=v_from
    ),
    'severity_counts',jsonb_build_object(
      'ok',(select count(*) from private.production_slo_snapshots where captured_at>=v_from and severity='ok'),
      'warning',(select count(*) from private.production_slo_snapshots where captured_at>=v_from and severity='warning'),
      'critical',(select count(*) from private.production_slo_snapshots where captured_at>=v_from and severity='critical')
    ),
    'latest',(
      select jsonb_build_object(
        'captured_at',captured_at,
        'severity',severity,
        'report',report
      )
      from private.production_slo_snapshots
      order by captured_at desc
      limit 1
    ),
    'recent_non_ok',coalesce((
      select jsonb_agg(jsonb_build_object(
        'captured_at',captured_at,
        'severity',severity,
        'breaches',report->'breaches'
      ) order by captured_at desc)
      from (
        select captured_at,severity,report
        from private.production_slo_snapshots
        where captured_at>=v_from and severity<>'ok'
        order by captured_at desc
        limit 50
      ) x
    ),'[]'::jsonb)
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
begin
  delete from private.production_slo_snapshots
  where captured_at<now()-interval '30 days';
  get diagnostics v_slo_deleted=row_count;

  delete from cron.job_run_details
  where start_time<now()-interval '30 days';
  get diagnostics v_cron_deleted=row_count;

  return jsonb_build_object(
    'retention_days',30,
    'slo_snapshots_deleted',v_slo_deleted,
    'cron_history_deleted',v_cron_deleted,
    'pruned_at',clock_timestamp()
  );
end;
$function$;

revoke all on function private.capture_production_slo_snapshot() from public,anon,authenticated,service_role;
revoke all on function private.production_slo_history_report(integer) from public,anon,authenticated,service_role;
revoke all on function private.prune_operational_history() from public,anon,authenticated,service_role;

select cron.schedule(
  'production-slo-snapshot-15m',
  '*/15 * * * *',
  'select private.capture_production_slo_snapshot();'
);

select cron.schedule(
  'operational-history-retention-daily',
  '23 3 * * *',
  'select private.prune_operational_history();'
);

select private.capture_production_slo_snapshot();

comment on table private.production_slo_snapshots is
  'Phase 7B private 15-minute SLO history. Retained for 30 days by operational-history-retention-daily.';

comment on function private.capture_production_slo_snapshot() is
  'Captures the current Phase 7A production SLO report into private history.';

comment on function private.production_slo_history_report(integer) is
  'Summarizes private SLO snapshot history for 1 to 720 hours.';

comment on function private.prune_operational_history() is
  'Deletes SLO snapshots and pg_cron job_run_details older than 30 days.';
