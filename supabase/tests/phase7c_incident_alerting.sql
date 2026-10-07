-- Phase 7C admin alert-delivery and incident acknowledgement runtime contract.
-- Rollback-only: creates two SLO breach fixtures, acknowledges one, verifies the
-- admin observability payload and non-admin denial, then rolls everything back.

begin;

do $phase7c_incident_contract$
declare
  v_admin uuid;
  v_player uuid;
  v_ack_breach bigint;
  v_unacked_breach bigint;
  v_overview jsonb;
  v_denied_overview boolean:=false;
  v_denied_ack boolean:=false;
begin
  select id into v_admin
  from public.profiles
  where role='admin'
  order by created_at
  limit 1;

  select id into v_player
  from public.profiles
  where role<>'admin'
  order by created_at
  limit 1;

  if v_admin is null or v_player is null then
    raise exception 'Phase 7C requires one admin and one non-admin profile';
  end if;

  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,new_data)
  values(
    null,'production_slo_breached','system','phase7c-ack-fixture',
    jsonb_build_object(
      'severity','warning',
      'breaches',jsonb_build_array(jsonb_build_object(
        'signal','phase7c_ack_fixture',
        'severity','warning'
      ))
    )
  )
  returning id into v_ack_breach;

  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,new_data)
  values(
    null,'production_slo_breached','system','phase7c-unacked-fixture',
    jsonb_build_object(
      'severity','critical',
      'breaches',jsonb_build_array(jsonb_build_object(
        'signal','phase7c_unacked_fixture',
        'severity','critical'
      ))
    )
  )
  returning id into v_unacked_breach;

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub',v_admin,'role','authenticated')::text,
    true
  );
  execute 'set local role authenticated';

  perform public.admin_acknowledge_production_incident(
    v_ack_breach,
    'Phase 7C rollback acknowledgement'
  );

  v_overview:=public.admin_get_operations_incident_center();

  execute 'reset role';

  if not exists(
    select 1
    from private.production_incident_acknowledgements
    where audit_log_id=v_ack_breach
      and acknowledged_by=v_admin
      and note='Phase 7C rollback acknowledgement'
  ) then
    raise exception 'Phase 7C acknowledgement row missing';
  end if;

  if not exists(
    select 1
    from public.audit_logs
    where action='production_slo_acknowledged'
      and entity_id=v_ack_breach::text
      and actor_user_id=v_admin
  ) then
    raise exception 'Phase 7C acknowledgement audit row missing';
  end if;

  if coalesce((v_overview->>'pending_slo_ack_count')::bigint,0)<1 then
    raise exception 'Active unacknowledged SLO breach was not surfaced: %',v_overview;
  end if;

  if coalesce((v_overview->'alert_delivery'->>'admin_polling_seconds')::integer,0)<>60 then
    raise exception 'Admin alert polling contract drifted: %',v_overview->'alert_delivery';
  end if;

  if coalesce((v_overview->'alert_delivery'->>'external_webhook_configured')::boolean,true) then
    raise exception 'External webhook was unexpectedly marked configured';
  end if;

  if not (
    v_overview ? 'production_slo'
    and v_overview ? 'slo_history'
    and v_overview ? 'slo_events'
    and v_overview ? 'pending_slo_ack_count'
    and v_overview ? 'alert_delivery'
  ) then
    raise exception 'Phase 7C observability payload missing required sections';
  end if;

  if not exists(
    select 1
    from jsonb_array_elements(v_overview->'slo_events') e
    where (e->>'id')::bigint=v_ack_breach
      and coalesce((e->>'acknowledged')::boolean,false)
  ) then
    raise exception 'Acknowledged SLO event was not represented in observability payload';
  end if;

  if not exists(
    select 1
    from jsonb_array_elements(v_overview->'slo_events') e
    where (e->>'id')::bigint=v_unacked_breach
      and not coalesce((e->>'acknowledged')::boolean,false)
  ) then
    raise exception 'Unacknowledged SLO event was not represented in observability payload';
  end if;

  if has_table_privilege('anon','private.production_incident_acknowledgements','SELECT')
     or has_table_privilege('authenticated','private.production_incident_acknowledgements','SELECT')
     or has_table_privilege('service_role','private.production_incident_acknowledgements','SELECT') then
    raise exception 'Private incident acknowledgement table is externally readable';
  end if;

  if has_function_privilege('anon','public.admin_acknowledge_production_incident(bigint,text)','EXECUTE')
     or has_function_privilege('service_role','public.admin_acknowledge_production_incident(bigint,text)','EXECUTE') then
    raise exception 'Admin acknowledgement RPC is executable by an unintended role';
  end if;

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub',v_player,'role','authenticated')::text,
    true
  );
  execute 'set local role authenticated';

  begin
    perform public.admin_get_operations_incident_center();
  exception when others then
    if sqlerrm not like 'Admin access required%' then raise; end if;
    v_denied_overview:=true;
  end;

  begin
    perform public.admin_acknowledge_production_incident(
      v_unacked_breach,
      'Should be denied'
    );
  exception when others then
    if sqlerrm not like 'Admin access required%' then raise; end if;
    v_denied_ack:=true;
  end;

  execute 'reset role';

  if not v_denied_overview or not v_denied_ack then
    raise exception 'Non-admin Phase 7C access control failed: overview %, ack %',
      v_denied_overview,v_denied_ack;
  end if;
end
$phase7c_incident_contract$;

rollback;
