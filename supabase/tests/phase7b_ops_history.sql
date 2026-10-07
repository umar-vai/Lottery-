-- Phase 7B durable operations-history runtime contract.
-- Rollback-only: validates snapshot capture, retention, cron wiring, privacy, and
-- duplicate-index cleanup without leaving test rows behind.

begin;

do $phase7b_ops_history_contract$
declare
  v_before bigint;
  v_after bigint;
  v_history jsonb;
  v_prune jsonb;
  v_old_id bigint;
begin
  select count(*) into v_before from private.production_slo_snapshots;

  perform private.capture_production_slo_snapshot();

  select count(*) into v_after from private.production_slo_snapshots;
  if v_after<>v_before+1 then
    raise exception 'SLO snapshot capture did not add exactly one row: before %, after %',v_before,v_after;
  end if;

  v_history:=private.production_slo_history_report(24);
  if coalesce((v_history->>'snapshot_count')::bigint,0)<1 then
    raise exception 'SLO history report returned no recent snapshots: %',v_history;
  end if;

  if coalesce((v_history->>'window_hours')::integer,0)<>24 then
    raise exception 'SLO history window contract drifted: %',v_history;
  end if;

  insert into private.production_slo_snapshots(captured_at,severity,report)
  values(now()-interval '31 days','ok','{"phase7b_fixture":true}'::jsonb)
  returning id into v_old_id;

  v_prune:=private.prune_operational_history();

  if exists(select 1 from private.production_slo_snapshots where id=v_old_id) then
    raise exception '30-day SLO retention did not prune the old fixture';
  end if;

  if (v_prune->>'retention_days')::integer<>30 then
    raise exception 'Operational retention contract drifted: %',v_prune;
  end if;

  if (select count(*) from cron.job where jobname='production-slo-snapshot-15m' and active)<>1 then
    raise exception 'production-slo-snapshot-15m must exist exactly once and be active';
  end if;

  if (select count(*) from cron.job where jobname='operational-history-retention-daily' and active)<>1 then
    raise exception 'operational-history-retention-daily must exist exactly once and be active';
  end if;

  if has_table_privilege('anon','private.production_slo_snapshots','SELECT')
     or has_table_privilege('authenticated','private.production_slo_snapshots','SELECT')
     or has_table_privilege('service_role','private.production_slo_snapshots','SELECT') then
    raise exception 'Private SLO snapshot table is externally readable';
  end if;

  if has_function_privilege('anon','private.capture_production_slo_snapshot()','EXECUTE')
     or has_function_privilege('authenticated','private.capture_production_slo_snapshot()','EXECUTE')
     or has_function_privilege('service_role','private.capture_production_slo_snapshot()','EXECUTE')
     or has_function_privilege('anon','private.production_slo_history_report(integer)','EXECUTE')
     or has_function_privilege('authenticated','private.production_slo_history_report(integer)','EXECUTE')
     or has_function_privilege('service_role','private.production_slo_history_report(integer)','EXECUTE')
     or has_function_privilege('anon','private.prune_operational_history()','EXECUTE')
     or has_function_privilege('authenticated','private.prune_operational_history()','EXECUTE')
     or has_function_privilege('service_role','private.prune_operational_history()','EXECUTE') then
    raise exception 'Phase 7B private functions are externally executable';
  end if;

  if to_regclass('public.lottery_events_slug_idx') is not null then
    raise exception 'Duplicate lottery_events_slug_idx still exists';
  end if;

  if to_regclass('public.lottery_events_slug_key') is null then
    raise exception 'Unique lottery slug index is missing';
  end if;

  if not exists(
    select 1
    from pg_constraint
    where conname='lottery_events_slug_key'
      and conrelid='public.lottery_events'::regclass
      and contype='u'
  ) then
    raise exception 'Lottery slug uniqueness constraint is missing';
  end if;
end
$phase7b_ops_history_contract$;

rollback;
