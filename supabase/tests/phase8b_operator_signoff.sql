-- Phase 8B operator sign-off / stabilization exit runtime contract.
-- Rollback-only: all simulated decisions and warning rows are reverted.

begin;

do $phase8b_runtime$
declare
  v_admin uuid;
  v_exit jsonb;
  v_ready jsonb;
  v_warning_id bigint;
  v_auth_public_secdef bigint;
  v_anon_public_secdef bigint;
  v_private_auth_secdef bigint;
begin
  v_exit:=private.production_launch_exit_report();

  if coalesce(v_exit->>'phase','')<>'phase8b'
     or coalesce(v_exit->>'exit_state','')<>'stabilizing'
     or coalesce((v_exit->>'fully_signed_off')::boolean,true)
     or coalesce((v_exit->'operator_signoff'->>'required_outstanding')::integer,-1)<>2
     or coalesce((v_exit->'warning_review'->>'unresolved')::integer,-1)<>0 then
    raise exception 'Phase 8B initial exit state invalid: %',v_exit;
  end if;

  if has_table_privilege('anon','private.production_launch_operator_signoffs','SELECT')
     or has_table_privilege('authenticated','private.production_launch_operator_signoffs','SELECT')
     or has_table_privilege('service_role','private.production_launch_operator_signoffs','SELECT')
     or has_table_privilege('anon','private.production_launch_warning_dispositions','SELECT')
     or has_table_privilege('authenticated','private.production_launch_warning_dispositions','SELECT')
     or has_table_privilege('service_role','private.production_launch_warning_dispositions','SELECT')
     or has_table_privilege('anon','private.production_launch_exit_signoff','SELECT')
     or has_table_privilege('authenticated','private.production_launch_exit_signoff','SELECT')
     or has_table_privilege('service_role','private.production_launch_exit_signoff','SELECT') then
    raise exception 'Phase 8B private tables are directly readable';
  end if;

  if has_function_privilege('anon','private.production_launch_operator_signoff_report()','EXECUTE')
     or has_function_privilege('authenticated','private.production_launch_operator_signoff_report()','EXECUTE')
     or has_function_privilege('service_role','private.production_launch_operator_signoff_report()','EXECUTE')
     or has_function_privilege('anon','private.production_launch_exit_report()','EXECUTE')
     or has_function_privilege('authenticated','private.production_launch_exit_report()','EXECUTE')
     or has_function_privilege('service_role','private.production_launch_exit_report()','EXECUTE') then
    raise exception 'Phase 8B private functions are externally executable';
  end if;

  if has_function_privilege('anon','public.admin_record_launch_operator_signoff(text,text,text)','EXECUTE')
     or has_function_privilege('service_role','public.admin_record_launch_operator_signoff(text,text,text)','EXECUTE')
     or not has_function_privilege('authenticated','public.admin_record_launch_operator_signoff(text,text,text)','EXECUTE')
     or has_function_privilege('anon','public.admin_disposition_launch_warning(bigint,text)','EXECUTE')
     or has_function_privilege('service_role','public.admin_disposition_launch_warning(bigint,text)','EXECUTE')
     or not has_function_privilege('authenticated','public.admin_disposition_launch_warning(bigint,text)','EXECUTE')
     or has_function_privilege('anon','public.admin_finalize_launch_stabilization(text,text)','EXECUTE')
     or has_function_privilege('service_role','public.admin_finalize_launch_stabilization(text,text)','EXECUTE')
     or not has_function_privilege('authenticated','public.admin_finalize_launch_stabilization(text,text)','EXECUTE') then
    raise exception 'Phase 8B admin RPC grants are incorrect';
  end if;

  select count(*) into v_auth_public_secdef
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prosecdef
    and has_function_privilege('authenticated',p.oid,'EXECUTE');

  select count(*) into v_anon_public_secdef
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prosecdef
    and has_function_privilege('anon',p.oid,'EXECUTE');

  select count(*) into v_private_auth_secdef
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private' and p.prosecdef
    and has_function_privilege('authenticated',p.oid,'EXECUTE');

  if v_auth_public_secdef<>53 then
    raise exception 'Phase 8B authenticated public SECURITY DEFINER baseline drifted: %',v_auth_public_secdef;
  end if;
  if v_anon_public_secdef<>2 then
    raise exception 'Phase 8B anonymous SECURITY DEFINER allowlist drifted: %',v_anon_public_secdef;
  end if;
  if v_private_auth_secdef<>0 then
    raise exception 'Phase 8B private authenticated SECURITY DEFINER exposure drifted: %',v_private_auth_secdef;
  end if;

  select id into v_admin
  from public.profiles
  where role='admin'
  order by created_at
  limit 1;

  if v_admin is null then
    raise exception 'Phase 8B runtime requires an admin profile';
  end if;

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub',v_admin,'role','authenticated')::text,
    true
  );

  perform public.admin_record_launch_operator_signoff(
    'offsite_backup_restore_rehearsal',
    'deferred',
    'Phase 8B rollback-only test defers the restore rehearsal with an operator note.'
  );

  perform public.admin_record_launch_operator_signoff(
    'retired_edge_stub_physical_deletion',
    'accepted_risk',
    'Phase 8B rollback-only test accepts the inert retired stubs until manual deletion.'
  );

  v_ready:=private.production_launch_readiness_report();
  if coalesce((v_ready->'operator_signoff'->>'required_outstanding')::integer,-1)<>0
     or coalesce(v_ready->>'launch_decision','')<>'technical_go_operator_signoff_complete' then
    raise exception 'Phase 8B operator decision aggregation failed: %',v_ready;
  end if;

  insert into private.production_launch_stability_snapshots(
    captured_at,technical_state,technical_ready,report
  ) values(
    clock_timestamp()-interval '2 minutes',
    'warning',
    false,
    jsonb_build_object(
      'phase','phase8b-runtime-test',
      'slo',jsonb_build_object(
        'breaches',jsonb_build_array(jsonb_build_object('signal','phase8b_synthetic_warning'))
      )
    )
  )
  returning id into v_warning_id;

  v_exit:=private.production_launch_exit_report();
  if coalesce((v_exit->'warning_review'->>'unresolved')::integer,-1)<>1
     or not exists(
       select 1
       from jsonb_array_elements(coalesce(v_exit->'warning_review'->'unresolved_items','[]'::jsonb)) x
       where (x->>'snapshot_id')::bigint=v_warning_id
     ) then
    raise exception 'Phase 8B warning review queue failed: %',v_exit;
  end if;

  perform public.admin_disposition_launch_warning(
    v_warning_id,
    'Phase 8B rollback-only test documents the synthetic warning disposition.'
  );

  v_exit:=private.production_launch_exit_report();
  if coalesce((v_exit->'warning_review'->>'unresolved')::integer,-1)<>0 then
    raise exception 'Phase 8B warning disposition did not clear the queue: %',v_exit;
  end if;

  begin
    perform public.admin_finalize_launch_stabilization(
      'approved',
      'Phase 8B rollback-only test approval must fail while the real window is active.'
    );
    raise exception 'Phase 8B approval unexpectedly succeeded during active window';
  exception
    when others then
      if sqlerrm='Phase 8B approval unexpectedly succeeded during active window' then
        raise;
      end if;
  end;

  update private.production_launch_stability_config
  set window_ends_at=clock_timestamp()-interval '1 minute',
      updated_at=clock_timestamp()
  where id=1;

  v_exit:=private.production_launch_exit_report();
  if coalesce(v_exit->>'exit_state','')<>'ready_for_signoff'
     or not coalesce((v_exit->>'pre_signoff_ready')::boolean,false) then
    raise exception 'Phase 8B completed-window exit gate did not become signable: %',v_exit;
  end if;

  v_exit:=public.admin_finalize_launch_stabilization(
    'approved',
    'Phase 8B rollback-only test records final approval after every exit criterion passes.'
  );

  if coalesce(v_exit->>'exit_state','')<>'signed_off'
     or not coalesce((v_exit->>'fully_signed_off')::boolean,false)
     or coalesce(v_exit->'final_decision'->>'decision','')<>'approved' then
    raise exception 'Phase 8B final sign-off contract failed: %',v_exit;
  end if;

  if (select count(*) from public.audit_logs
      where action='production_launch_operator_signoff_updated'
        and created_at>now()-interval '5 minutes')<2 then
    raise exception 'Phase 8B operator decisions were not audited';
  end if;

  if not exists(
    select 1 from public.audit_logs
    where action='production_launch_warning_dispositioned'
      and entity_id=v_warning_id::text
  ) then
    raise exception 'Phase 8B warning disposition audit missing';
  end if;

  if not exists(
    select 1 from public.audit_logs
    where action='production_launch_exit_decision_updated'
      and entity_id='phase8b'
  ) then
    raise exception 'Phase 8B final decision audit missing';
  end if;
end
$phase8b_runtime$;

rollback;
