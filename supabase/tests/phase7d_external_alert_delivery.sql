-- Phase 7D external alert delivery runtime contract.
-- Rollback-only. Does not invoke the external webhook.

begin;

do $phase7d_delivery_contract$
declare
  v_token text;
  v_breach bigint;
  v_recovery bigint;
  v_items jsonb;
  v_id bigint;
  v_report jsonb;
  v_slo jsonb;
  v_denied boolean:=false;
begin
  select decrypted_secret
  into v_token
  from vault.decrypted_secrets
  where name='production_alert_dispatch_token'
  limit 1;

  if v_token is null or not private.verify_production_alert_dispatch_token(v_token) then
    raise exception 'Phase 7D Vault dispatcher token is missing or invalid';
  end if;

  if (select count(*) from cron.job where jobname='production-alert-dispatch-minute' and active)<>1 then
    raise exception 'Phase 7D dispatcher cron must exist exactly once and be active';
  end if;

  if not exists(select 1 from pg_extension where extname='pg_net') then
    raise exception 'Phase 7D pg_net extension is missing';
  end if;

  update private.production_alert_delivery_config
  set external_enabled=true,
      dispatcher_configured=true,
      last_error=null
  where id=1;

  insert into public.audit_logs(action,entity_type,entity_id,new_data,created_at)
  values(
    'production_slo_breached',
    'system',
    'phase7d-runtime-fixture',
    jsonb_build_object(
      'severity','critical',
      'breaches',jsonb_build_array(
        jsonb_build_object('signal','phase7d_runtime_fixture','severity','critical')
      )
    ),
    now()-interval '6 minutes'
  )
  returning id into v_breach;

  if not exists(
    select 1
    from private.production_alert_outbox
    where audit_log_id=v_breach
      and delivery_kind='initial'
      and status='pending'
  ) then
    raise exception 'Phase 7D initial alert was not queued';
  end if;

  perform private.enqueue_production_alert_escalations();

  if not exists(
    select 1
    from private.production_alert_outbox
    where audit_log_id=v_breach
      and delivery_kind='escalation_1'
      and status='pending'
  ) then
    raise exception 'Phase 7D critical escalation was not queued';
  end if;

  begin
    perform public.service_claim_production_alert_batch('invalid-phase7d-token',10);
  exception when others then
    if sqlerrm not like 'Invalid production alert dispatch token%' then
      raise;
    end if;
    v_denied:=true;
  end;

  if not v_denied then
    raise exception 'Phase 7D accepted an invalid internal dispatch token';
  end if;

  v_items:=public.service_claim_production_alert_batch(v_token,10);

  if jsonb_array_length(v_items)<1 then
    raise exception 'Phase 7D dispatcher did not claim a due alert';
  end if;

  v_id:=(v_items->0->>'id')::bigint;

  perform public.service_complete_production_alert_delivery(
    v_token,
    v_id,
    false,
    503,
    'Phase 7D rollback retry fixture'
  );

  if not exists(
    select 1
    from private.production_alert_outbox
    where id=v_id
      and status='pending'
      and attempt_count=1
      and next_attempt_at>now()
  ) then
    raise exception 'Phase 7D failed delivery did not enter retry backoff';
  end if;

  insert into public.audit_logs(action,entity_type,entity_id,new_data)
  values(
    'production_slo_acknowledged',
    'system',
    v_breach::text,
    jsonb_build_object('note','Phase 7D rollback acknowledgement')
  );

  if exists(
    select 1
    from private.production_alert_outbox
    where audit_log_id=v_breach
      and delivery_kind in ('escalation_1','escalation_2')
      and status='pending'
  ) then
    raise exception 'Phase 7D acknowledgement did not cancel pending escalations';
  end if;

  insert into public.audit_logs(action,entity_type,entity_id,new_data)
  values(
    'production_slo_recovered',
    'system',
    'phase7d-runtime-recovery',
    jsonb_build_object('severity','ok','breaches','[]'::jsonb)
  )
  returning id into v_recovery;

  if not exists(
    select 1
    from private.production_alert_outbox
    where audit_log_id=v_recovery
      and delivery_kind='recovery'
      and status='pending'
  ) then
    raise exception 'Phase 7D recovery alert was not queued';
  end if;

  if has_table_privilege('anon','private.production_alert_outbox','SELECT')
     or has_table_privilege('authenticated','private.production_alert_outbox','SELECT')
     or has_table_privilege('service_role','private.production_alert_outbox','SELECT')
     or has_table_privilege('anon','private.production_alert_delivery_config','SELECT')
     or has_table_privilege('authenticated','private.production_alert_delivery_config','SELECT')
     or has_table_privilege('service_role','private.production_alert_delivery_config','SELECT') then
    raise exception 'Phase 7D private delivery tables are directly readable';
  end if;

  if has_function_privilege('anon','public.service_claim_production_alert_batch(text,integer)','EXECUTE')
     or has_function_privilege('authenticated','public.service_claim_production_alert_batch(text,integer)','EXECUTE')
     or has_function_privilege('anon','public.service_complete_production_alert_delivery(text,bigint,boolean,integer,text)','EXECUTE')
     or has_function_privilege('authenticated','public.service_complete_production_alert_delivery(text,bigint,boolean,integer,text)','EXECUTE') then
    raise exception 'Phase 7D service dispatcher RPCs are browser executable';
  end if;

  if not has_function_privilege('service_role','public.service_claim_production_alert_batch(text,integer)','EXECUTE')
     or not has_function_privilege('service_role','public.service_complete_production_alert_delivery(text,bigint,boolean,integer,text)','EXECUTE')
     or not has_function_privilege('service_role','public.service_record_production_alert_dispatcher_state(text,boolean,text,boolean)','EXECUTE') then
    raise exception 'Phase 7D service dispatcher RPC grants are incomplete';
  end if;

  v_report:=private.production_alert_delivery_report();
  v_slo:=private.production_slo_report();

  if not (
    v_report ? 'dispatcher_cron_active'
    and v_report ? 'pending_count'
    and v_report ? 'dead_letter_count'
    and v_report ? 'pending_over_10m'
    and v_report ? 'max_attempts'
  ) then
    raise exception 'Phase 7D delivery health report is incomplete: %',v_report;
  end if;

  if coalesce((v_slo->'cron'->>'missing_required_jobs')::integer,-1)<>0 then
    raise exception 'Phase 7D production SLO required-cron contract failed: %',v_slo;
  end if;

  if not (v_slo ? 'alert_delivery') then
    raise exception 'Phase 7D production SLO lacks alert_delivery health';
  end if;
end
$phase7d_delivery_contract$;

rollback;
