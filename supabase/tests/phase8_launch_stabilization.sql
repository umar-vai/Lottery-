-- Phase 8 production launch/stabilization runtime contract.
-- Read-only / rollback-only.

begin;

do $phase8_runtime$
declare
  s jsonb;
  o jsonb;
  l jsonb;
  g jsonb;
  a jsonb;
  c jsonb;
  v_public_anon_secdef bigint;
  v_private_auth_secdef bigint;
  v_auth_public_secdef bigint;
  v_orphan_failed_24h bigint:=0;
  v_test_runid bigint;
  v_test_run_status text;
  v_test_run_message text;
  v_test_run_start timestamptz;
  v_test_run_end timestamptz;
  v_test_jobid bigint;
  v_probe jsonb;
begin
  s:=private.production_slo_report();
  o:=private.operations_incident_report();
  l:=private.production_launch_stability_report();
  g:=private.mutation_guardrail_report();
  a:=private.production_alert_delivery_report();
  c:=private.draw_credit_integrity_report();

  if not coalesce((s->>'ok')::boolean,false)
     or coalesce(s->>'severity','critical')<>'ok'
     or coalesce((s->'cron'->>'failed_15m')::integer,-1)<>0
     or coalesce((s->'cron'->>'failed_24h')::integer,-1)<>0
     or coalesce((s->'cron'->>'missing_required_jobs')::integer,-1)<>0 then
    raise exception 'Phase 8 production SLO is not launch-clean: %',s;
  end if;

  -- Phase 8A regression: deleted/unscheduled cron history must not degrade current SLO.
  select count(*) into v_orphan_failed_24h
  from cron.job_run_details r
  left join cron.job j on j.jobid=r.jobid
  where r.status='failed'
    and r.start_time>now()-interval '24 hours'
    and j.jobid is null;

  if v_orphan_failed_24h>0
     and coalesce((s->'cron'->>'failed_24h')::integer,-1)<>0 then
    raise exception 'Phase 8 orphan cron history leaked into current SLO: orphan=% slo=%',
      v_orphan_failed_24h,s;
  end if;

  -- Phase 8A regression: a real failure on a currently active cron must stay critical.
  select r.runid,r.status,r.return_message,r.start_time,r.end_time
    into v_test_runid,v_test_run_status,v_test_run_message,v_test_run_start,v_test_run_end
  from cron.job_run_details r
  join cron.job j on j.jobid=r.jobid and j.active
  where r.status='succeeded'
  order by r.start_time desc
  limit 1;

  if v_test_runid is null then
    raise exception 'Phase 8 active cron regression probe has no succeeded active cron run to reuse';
  end if;

  update cron.job_run_details
  set status='failed',
      return_message='phase8 runtime simulated active cron failure',
      start_time=clock_timestamp()-interval '1 minute',
      end_time=clock_timestamp()
  where runid=v_test_runid;

  v_probe:=private.production_slo_report();

  if coalesce(v_probe->>'severity','')<>'critical'
     or coalesce((v_probe->'cron'->>'failed_15m')::integer,0)<1
     or not exists(
       select 1
       from jsonb_array_elements(coalesce(v_probe->'breaches','[]'::jsonb)) b
       where b->>'signal'='cron_failures_15m'
     ) then
    raise exception 'Phase 8 active cron failure regression failed: %',v_probe;
  end if;

  update cron.job_run_details
  set status=v_test_run_status,
      return_message=v_test_run_message,
      start_time=v_test_run_start,
      end_time=v_test_run_end
  where runid=v_test_runid;

  -- Phase 8A regression: missing required cron detection remains independently critical.
  select jobid into v_test_jobid
  from cron.job
  where jobname='production-slo-snapshot-15m'
    and active
  limit 1;

  if v_test_jobid is null then
    raise exception 'Phase 8 missing-required-cron regression probe target is unavailable';
  end if;

  perform cron.alter_job(v_test_jobid, active := false);
  v_probe:=private.production_slo_report();

  if coalesce(v_probe->>'severity','')<>'critical'
     or coalesce((v_probe->'cron'->>'missing_required_jobs')::integer,0)<1
     or not exists(
       select 1
       from jsonb_array_elements(coalesce(v_probe->'breaches','[]'::jsonb)) b
       where b->>'signal'='missing_required_cron'
     ) then
    raise exception 'Phase 8 missing required cron regression failed: %',v_probe;
  end if;

  perform cron.alter_job(v_test_jobid, active := true);
  v_probe:=private.production_slo_report();

  if not coalesce((v_probe->>'ok')::boolean,false)
     or coalesce(v_probe->>'severity','critical')<>'ok'
     or coalesce((v_probe->'cron'->>'failed_15m')::integer,-1)<>0
     or coalesce((v_probe->'cron'->>'failed_24h')::integer,-1)<>0
     or coalesce((v_probe->'cron'->>'missing_required_jobs')::integer,-1)<>0 then
    raise exception 'Phase 8 cron regression probes did not restore a clean state: %',v_probe;
  end if;

  if not coalesce((o->>'ok')::boolean,false)
     or coalesce((o->>'open_issue_count')::integer,-1)<>0
     or coalesce((o->'counts'->>'cron_failures_24h')::integer,-1)<>0 then
    raise exception 'Phase 8 operations incident report is not clean: %',o;
  end if;

  if coalesce((c->>'issue_total')::integer,-1)<>0
     or not coalesce((c->>'ok')::boolean,false) then
    raise exception 'Phase 8 Draw Credit integrity failed: %',c;
  end if;

  if not (
    coalesce((g->>'master_enabled')::boolean,false)
    and coalesce((g->>'ticket_purchases_enabled')::boolean,false)
    and coalesce((g->>'game_writes_enabled')::boolean,false)
    and coalesce((g->>'support_claims_enabled')::boolean,false)
    and coalesce((g->>'credit_requests_enabled')::boolean,false)
    and coalesce((g->>'referral_writes_enabled')::boolean,false)
    and coalesce((g->>'payment_orders_enabled')::boolean,false)
  ) then
    raise exception 'Phase 8 mutation guardrails are not fully enabled: %',g;
  end if;

  if not coalesce((a->>'enabled')::boolean,false)
     or not coalesce((a->>'dispatcher_configured')::boolean,false)
     or not coalesce((a->>'telegram_ready')::boolean,false)
     or coalesce((a->>'pending_count')::integer,-1)<>0
     or coalesce((a->>'in_flight_count')::integer,-1)<>0
     or coalesce((a->>'dead_letter_count')::integer,-1)<>0 then
    raise exception 'Phase 8 Telegram delivery is not launch-ready: %',a;
  end if;

  if coalesce(l->>'phase','')<>'phase8'
     or coalesce((l->'current'->>'technical_ready')::boolean,false) is not true
     or coalesce(l->'current'->>'technical_state','blocked')<>'ready'
     or coalesce(l->'current'->>'launch_decision','')<>'technical_go_operator_signoff_required'
     or coalesce((l->>'snapshot_count')::integer,0)<1
     or coalesce((l->'state_counts'->>'blocked')::integer,-1)<>0 then
    raise exception 'Phase 8 launch stability contract failed: %',l;
  end if;

  if (l->'window'->>'status') not in ('stabilizing','completed') then
    raise exception 'Phase 8 launch window status invalid: %',l->'window';
  end if;

  if (l->'window'->>'ends_at')::timestamptz <= (l->'window'->>'started_at')::timestamptz then
    raise exception 'Phase 8 launch window has invalid timestamps: %',l->'window';
  end if;

  if not exists(
    select 1
    from cron.job
    where jobname='production-launch-stability-15m'
      and active
      and schedule='*/15 * * * *'
  ) then
    raise exception 'Phase 8 launch stabilization cron missing';
  end if;

  if (select count(*) from cron.job where jobname='production-launch-stability-15m' and active)<>1 then
    raise exception 'Phase 8 launch stabilization cron must be unique';
  end if;

  if has_table_privilege('anon','private.production_launch_stability_config','SELECT')
     or has_table_privilege('authenticated','private.production_launch_stability_config','SELECT')
     or has_table_privilege('service_role','private.production_launch_stability_config','SELECT')
     or has_table_privilege('anon','private.production_launch_stability_snapshots','SELECT')
     or has_table_privilege('authenticated','private.production_launch_stability_snapshots','SELECT')
     or has_table_privilege('service_role','private.production_launch_stability_snapshots','SELECT') then
    raise exception 'Phase 8 private launch tables are directly readable';
  end if;

  if has_function_privilege('anon','private.production_launch_readiness_report()','EXECUTE')
     or has_function_privilege('authenticated','private.production_launch_readiness_report()','EXECUTE')
     or has_function_privilege('service_role','private.production_launch_readiness_report()','EXECUTE')
     or has_function_privilege('anon','private.production_launch_stability_report()','EXECUTE')
     or has_function_privilege('authenticated','private.production_launch_stability_report()','EXECUTE')
     or has_function_privilege('service_role','private.production_launch_stability_report()','EXECUTE') then
    raise exception 'Phase 8 private launch functions are externally executable';
  end if;

  select count(*) into v_public_anon_secdef
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prosecdef
    and has_function_privilege('anon',p.oid,'EXECUTE');

  select count(*) into v_private_auth_secdef
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private' and p.prosecdef
    and has_function_privilege('authenticated',p.oid,'EXECUTE');

  select count(*) into v_auth_public_secdef
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prosecdef
    and has_function_privilege('authenticated',p.oid,'EXECUTE');

  if v_public_anon_secdef<>2 then
    raise exception 'Phase 8 anonymous SECURITY DEFINER allowlist drifted: %',v_public_anon_secdef;
  end if;

  if v_private_auth_secdef<>0 then
    raise exception 'Phase 8 private authenticated SECURITY DEFINER exposure drifted: %',v_private_auth_secdef;
  end if;

  if v_auth_public_secdef<>50 then
    raise exception 'Phase 8 authenticated public SECURITY DEFINER baseline drifted: %',v_auth_public_secdef;
  end if;

  if coalesce(jsonb_array_length(l->'current'->'operator_exceptions'),0)<2 then
    raise exception 'Phase 8 operator exception register missing: %',l->'current'->'operator_exceptions';
  end if;
end
$phase8_runtime$;

rollback;
