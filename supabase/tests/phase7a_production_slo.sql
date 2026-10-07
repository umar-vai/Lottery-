-- Phase 7A production SLO runtime contract.
-- The test is rollback-only and leaves production unchanged.

begin;

do $phase7a_slo_contract$
declare
  r jsonb;
  r2 jsonb;
  original_active boolean;
begin
  r:=private.production_slo_report();

  if coalesce(r->>'severity','') not in ('ok','warning','critical') then
    raise exception 'Invalid SLO severity: %',r;
  end if;

  if not (r ? 'database' and r ? 'cron' and r ? 'support' and r ? 'application' and r ? 'thresholds' and r ? 'breaches') then
    raise exception 'SLO report missing required sections: %',r;
  end if;

  if has_function_privilege('anon','private.production_slo_report()','EXECUTE')
     or has_function_privilege('authenticated','private.production_slo_report()','EXECUTE')
     or has_function_privilege('service_role','private.production_slo_report()','EXECUTE')
     or has_function_privilege('anon','private.run_production_slo_check()','EXECUTE')
     or has_function_privilege('authenticated','private.run_production_slo_check()','EXECUTE')
     or has_function_privilege('service_role','private.run_production_slo_check()','EXECUTE') then
    raise exception 'Phase 7A private SLO functions are externally executable';
  end if;

  if (select count(*) from cron.job where jobname='production-slo-every-5-minutes' and active)<>1 then
    raise exception 'Production SLO cron must exist exactly once and be active';
  end if;

  if (r->'thresholds'->>'connections_warning_pct')::numeric<>75
     or (r->'thresholds'->>'connections_critical_pct')::numeric<>90
     or (r->'thresholds'->>'cache_hit_warning_below_pct')::numeric<>99
     or (r->'thresholds'->>'blocked_session_critical_after_seconds')::numeric<>30
     or (r->'thresholds'->>'idle_in_transaction_warning_after_seconds')::numeric<>60
     or (r->'thresholds'->>'cron_recent_failure_critical_window_minutes')::numeric<>15 then
    raise exception 'Phase 7A threshold contract drifted: %',r->'thresholds';
  end if;

  -- Prove the report detects a missing required monitor without persisting damage.
  select active into original_active
  from cron.job
  where jobname='production-slo-every-5-minutes'
  limit 1;

  update cron.job
  set active=false
  where jobname='production-slo-every-5-minutes';

  r2:=private.production_slo_report();

  if r2->>'severity'<>'critical' then
    raise exception 'Missing required cron did not raise critical SLO severity: %',r2;
  end if;

  if not exists (
    select 1
    from jsonb_array_elements(r2->'breaches') b
    where b->>'signal'='missing_required_cron'
      and b->>'severity'='critical'
  ) then
    raise exception 'Missing required cron breach not present: %',r2;
  end if;

  update cron.job
  set active=original_active
  where jobname='production-slo-every-5-minutes';
end
$phase7a_slo_contract$;

rollback;
