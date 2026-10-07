create table private.production_launch_operator_signoffs(
  key text primary key,
  issue_number integer not null,
  requirement text not null,
  required_for_exit boolean not null default true,
  status text not null check(status in ('outstanding','completed','accepted_risk','deferred','conditional')),
  note text,
  decided_by uuid,
  decided_at timestamptz,
  updated_at timestamptz not null default now(),
  check(char_length(key) between 3 and 100)
);

create table private.production_launch_warning_dispositions(
  snapshot_id bigint primary key references private.production_launch_stability_snapshots(id) on delete cascade,
  note text not null check(char_length(note) between 10 and 1000),
  dispositioned_by uuid not null,
  dispositioned_at timestamptz not null default now()
);

create table private.production_launch_exit_signoff(
  id smallint primary key check(id=1),
  decision text not null check(decision in ('pending','approved','held')),
  note text,
  signed_by uuid,
  signed_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table private.production_launch_operator_signoffs enable row level security;
alter table private.production_launch_warning_dispositions enable row level security;
alter table private.production_launch_exit_signoff enable row level security;

revoke all on table private.production_launch_operator_signoffs from public,anon,authenticated,service_role;
revoke all on table private.production_launch_warning_dispositions from public,anon,authenticated,service_role;
revoke all on table private.production_launch_exit_signoff from public,anon,authenticated,service_role;

insert into private.production_launch_operator_signoffs(
  key,issue_number,requirement,required_for_exit,status,note
) values
('offsite_backup_restore_rehearsal',61,'Real encrypted off-site production backup and isolated restore rehearsal',true,'outstanding',null),
('retired_edge_stub_physical_deletion',59,'Physically delete the three retired 410 Edge Function stubs from Supabase',true,'outstanding',null),
('leaked_password_protection',59,'Enable leaked-password protection if password auth is introduced or plan capability changes',false,'conditional','Not applicable while production remains Google-only on the current plan.');

insert into private.production_launch_exit_signoff(id,decision) values(1,'pending');

create or replace function private.production_launch_operator_signoff_report()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $function$
declare
  v_items jsonb;
  v_required_total bigint:=0;
  v_required_resolved bigint:=0;
  v_required_outstanding bigint:=0;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'key',s.key,'issue',s.issue_number,'requirement',s.requirement,
    'required_for_exit',s.required_for_exit,'status',s.status,'note',s.note,
    'decided_by',s.decided_by,'decided_at',s.decided_at,'updated_at',s.updated_at,
    'launch_effect',case
      when not s.required_for_exit then 'conditional'
      when s.status='outstanding' then 'operator_signoff_required'
      else 'operator_decision_recorded'
    end
  ) order by s.required_for_exit desc,s.issue_number,s.key),'[]'::jsonb)
  into v_items
  from private.production_launch_operator_signoffs s;

  select
    count(*) filter(where required_for_exit),
    count(*) filter(
      where required_for_exit
        and status in ('completed','accepted_risk','deferred')
        and decided_by is not null
        and decided_at is not null
        and char_length(btrim(coalesce(note,'')))>=10
    )
  into v_required_total,v_required_resolved
  from private.production_launch_operator_signoffs;

  v_required_outstanding:=greatest(0,v_required_total-v_required_resolved);

  return jsonb_build_object(
    'items',v_items,
    'required_total',v_required_total,
    'required_resolved',v_required_resolved,
    'required_outstanding',v_required_outstanding,
    'ready_for_exit',v_required_outstanding=0
  );
end;
$function$;

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
  v_operator_report jsonb;
  v_operator jsonb;
  v_required_outstanding bigint:=0;
  v_public_anon_secdef bigint:=0;
  v_private_auth_secdef bigint:=0;
  v_published_events bigint:=0;
  v_state text;
  v_ready boolean;
begin
  select * into v_cfg from private.production_launch_stability_config where id=1;
  v_operator_report:=private.production_launch_operator_signoff_report();
  v_operator:=coalesce(v_operator_report->'items','[]'::jsonb);
  v_required_outstanding:=coalesce((v_operator_report->>'required_outstanding')::bigint,0);

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
    v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object('signal','draw_credit_integrity','issue_total',coalesce((v_credit->>'issue_total')::integer,-1)));
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
    v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object('signal','anonymous_security_definer_surface_drift','expected',2,'actual',v_public_anon_secdef));
  end if;
  if v_private_auth_secdef<>0 then
    v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object('signal','private_authenticated_security_definer_exposure','expected',0,'actual',v_private_auth_secdef));
  end if;
  if v_published_events=0 then
    v_warnings:=v_warnings||jsonb_build_array(jsonb_build_object('signal','no_published_lottery'));
  end if;

  if jsonb_array_length(v_blockers)>0 then v_state:='blocked';
  elsif jsonb_array_length(v_warnings)>0 then v_state:='warning';
  else v_state:='ready';
  end if;
  v_ready:=v_state='ready';

  return jsonb_build_object(
    'phase','phase8','technical_ready',v_ready,'technical_state',v_state,
    'launch_decision',case
      when v_state='blocked' then 'no_go'
      when v_state='warning' then 'hold_for_warning'
      when v_required_outstanding>0 then 'technical_go_operator_signoff_required'
      else 'technical_go_operator_signoff_complete'
    end,
    'checked_at',clock_timestamp(),'blockers',v_blockers,'warnings',v_warnings,
    'operator_exceptions',v_operator,'operator_signoff',v_operator_report,
    'window',jsonb_build_object(
      'status',v_cfg.status,'started_at',v_cfg.window_started_at,
      'ends_at',v_cfg.window_ends_at,'baseline_git_sha',v_cfg.baseline_git_sha
    ),
    'slo',v_slo,'credit_integrity',v_credit,'guardrails',v_guard,'alert_delivery',v_alert,
    'security_surface',jsonb_build_object(
      'anonymous_public_security_definer',v_public_anon_secdef,
      'private_authenticated_security_definer',v_private_auth_secdef
    ),
    'published_events',v_published_events
  );
end;
$function$;

create or replace function private.production_launch_exit_report()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $function$
declare
  v_stability jsonb:=private.production_launch_stability_report();
  v_operator jsonb:=private.production_launch_operator_signoff_report();
  v_cfg private.production_launch_stability_config%rowtype;
  v_final private.production_launch_exit_signoff%rowtype;
  v_window_completed boolean:=false;
  v_current_ready boolean:=false;
  v_blocked_snapshots bigint:=0;
  v_warning_snapshots bigint:=0;
  v_warning_dispositioned bigint:=0;
  v_warning_unresolved bigint:=0;
  v_required_outstanding bigint:=0;
  v_gate_reasons jsonb:='[]'::jsonb;
  v_pre_signoff_ready boolean:=false;
  v_fully_signed_off boolean:=false;
  v_exit_state text;
begin
  select * into v_cfg from private.production_launch_stability_config where id=1;
  select * into v_final from private.production_launch_exit_signoff where id=1;

  v_window_completed:=coalesce(v_stability->'window'->>'status','')='completed';
  v_current_ready:=coalesce((v_stability->'current'->>'technical_ready')::boolean,false)
                   and coalesce(v_stability->'current'->>'technical_state','blocked')='ready';
  v_blocked_snapshots:=coalesce((v_stability->'state_counts'->>'blocked')::bigint,0);

  select count(*) into v_warning_snapshots
  from private.production_launch_stability_snapshots s
  where s.captured_at>=v_cfg.window_started_at
    and s.captured_at<=v_cfg.window_ends_at
    and s.technical_state='warning';

  select count(*) into v_warning_dispositioned
  from private.production_launch_stability_snapshots s
  join private.production_launch_warning_dispositions d on d.snapshot_id=s.id
  where s.captured_at>=v_cfg.window_started_at
    and s.captured_at<=v_cfg.window_ends_at
    and s.technical_state='warning';

  v_warning_unresolved:=greatest(0,v_warning_snapshots-v_warning_dispositioned);
  v_required_outstanding:=coalesce((v_operator->>'required_outstanding')::bigint,0);

  if not v_window_completed then
    v_gate_reasons:=v_gate_reasons||jsonb_build_array(jsonb_build_object('signal','stabilization_window_active','ends_at',v_cfg.window_ends_at));
  end if;
  if not v_current_ready then
    v_gate_reasons:=v_gate_reasons||jsonb_build_array(jsonb_build_object('signal','current_technical_state_not_ready','state',coalesce(v_stability->'current'->>'technical_state','blocked')));
  end if;
  if v_blocked_snapshots>0 then
    v_gate_reasons:=v_gate_reasons||jsonb_build_array(jsonb_build_object('signal','blocked_launch_snapshot_exists','value',v_blocked_snapshots,'threshold',0));
  end if;
  if v_warning_unresolved>0 then
    v_gate_reasons:=v_gate_reasons||jsonb_build_array(jsonb_build_object('signal','warning_snapshot_undispositioned','value',v_warning_unresolved,'threshold',0));
  end if;
  if v_required_outstanding>0 then
    v_gate_reasons:=v_gate_reasons||jsonb_build_array(jsonb_build_object('signal','operator_signoff_outstanding','value',v_required_outstanding,'threshold',0));
  end if;

  v_pre_signoff_ready:=v_window_completed and v_current_ready and v_blocked_snapshots=0
    and v_warning_unresolved=0 and v_required_outstanding=0;
  v_fully_signed_off:=v_pre_signoff_ready and v_final.decision='approved';

  if v_fully_signed_off then v_exit_state:='signed_off';
  elsif v_final.decision='held' then v_exit_state:='held';
  elsif not v_window_completed then v_exit_state:='stabilizing';
  elsif v_pre_signoff_ready then v_exit_state:='ready_for_signoff';
  else v_exit_state:='blocked';
  end if;

  return jsonb_build_object(
    'phase','phase8b','checked_at',clock_timestamp(),'exit_state',v_exit_state,
    'pre_signoff_ready',v_pre_signoff_ready,'fully_signed_off',v_fully_signed_off,
    'gate_reasons',v_gate_reasons,'window',v_stability->'window',
    'technical_state',v_stability->'current'->>'technical_state',
    'technical_ready',coalesce((v_stability->'current'->>'technical_ready')::boolean,false),
    'snapshot_counts',v_stability->'state_counts',
    'warning_review',jsonb_build_object(
      'warning_snapshots',v_warning_snapshots,'dispositioned',v_warning_dispositioned,'unresolved',v_warning_unresolved
    ),
    'operator_signoff',v_operator,
    'final_decision',jsonb_build_object(
      'decision',v_final.decision,'note',v_final.note,'signed_by',v_final.signed_by,
      'signed_at',v_final.signed_at,'updated_at',v_final.updated_at
    )
  );
end;
$function$;

create or replace function public.admin_record_launch_operator_signoff(p_key text,p_status text,p_note text)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $function$
declare
  v_uid uuid:=auth.uid();
  v_key text:=btrim(coalesce(p_key,''));
  v_status text:=btrim(coalesce(p_status,''));
  v_note text:=nullif(btrim(coalesce(p_note,'')),'');
  v_old jsonb;
  v_new jsonb;
  v_required boolean;
begin
  if v_uid is null or not public.is_admin() then raise exception 'Admin access required'; end if;

  select to_jsonb(s),s.required_for_exit into v_old,v_required
  from private.production_launch_operator_signoffs s where s.key=v_key;
  if v_old is null then raise exception 'Unknown launch operator sign-off key'; end if;

  if v_status not in ('outstanding','completed','accepted_risk','deferred') then
    raise exception 'Invalid launch operator sign-off status';
  end if;
  if v_status<>'outstanding' and (v_note is null or char_length(v_note)<10 or char_length(v_note)>1000) then
    raise exception 'Operator sign-off note must be 10-1000 characters';
  end if;

  update private.production_launch_operator_signoffs
  set status=v_status,
      note=case when v_status='outstanding' then null else v_note end,
      decided_by=case when v_status='outstanding' then null else v_uid end,
      decided_at=case when v_status='outstanding' then null else clock_timestamp() end,
      updated_at=clock_timestamp()
  where key=v_key
  returning to_jsonb(private.production_launch_operator_signoffs.*) into v_new;

  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,old_data,new_data)
  values(v_uid,'production_launch_operator_signoff_updated','system',v_key,v_old,v_new);

  return private.production_launch_exit_report();
end;
$function$;

create or replace function public.admin_disposition_launch_warning(p_snapshot_id bigint,p_note text)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $function$
declare
  v_uid uuid:=auth.uid();
  v_note text:=btrim(coalesce(p_note,''));
  v_snapshot jsonb;
begin
  if v_uid is null or not public.is_admin() then raise exception 'Admin access required'; end if;
  if char_length(v_note)<10 or char_length(v_note)>1000 then raise exception 'Warning disposition note must be 10-1000 characters'; end if;

  select to_jsonb(s) into v_snapshot
  from private.production_launch_stability_snapshots s
  where s.id=p_snapshot_id and s.technical_state='warning';
  if v_snapshot is null then raise exception 'Warning launch snapshot not found'; end if;

  insert into private.production_launch_warning_dispositions(snapshot_id,note,dispositioned_by,dispositioned_at)
  values(p_snapshot_id,v_note,v_uid,clock_timestamp())
  on conflict(snapshot_id) do update
  set note=excluded.note,dispositioned_by=excluded.dispositioned_by,dispositioned_at=excluded.dispositioned_at;

  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,new_data)
  values(v_uid,'production_launch_warning_dispositioned','launch_snapshot',p_snapshot_id::text,
    jsonb_build_object('note',v_note,'snapshot',v_snapshot));

  return private.production_launch_exit_report();
end;
$function$;

create or replace function public.admin_finalize_launch_stabilization(p_decision text,p_note text)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $function$
declare
  v_uid uuid:=auth.uid();
  v_decision text:=btrim(coalesce(p_decision,''));
  v_note text:=btrim(coalesce(p_note,''));
  v_exit jsonb;
  v_old jsonb;
  v_new jsonb;
begin
  if v_uid is null or not public.is_admin() then raise exception 'Admin access required'; end if;
  if v_decision not in ('approved','held') then raise exception 'Final launch decision must be approved or held'; end if;
  if char_length(v_note)<10 or char_length(v_note)>1000 then raise exception 'Final launch note must be 10-1000 characters'; end if;

  v_exit:=private.production_launch_exit_report();
  if v_decision='approved' and not coalesce((v_exit->>'pre_signoff_ready')::boolean,false) then
    raise exception 'Phase 8B exit criteria are not ready for approval';
  end if;

  select to_jsonb(x) into v_old from private.production_launch_exit_signoff x where id=1;
  update private.production_launch_exit_signoff
  set decision=v_decision,note=v_note,signed_by=v_uid,signed_at=clock_timestamp(),updated_at=clock_timestamp()
  where id=1
  returning to_jsonb(private.production_launch_exit_signoff.*) into v_new;

  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,old_data,new_data)
  values(v_uid,'production_launch_exit_decision_updated','system','phase8b',v_old,v_new);

  return private.production_launch_exit_report();
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
  v_last_recovery timestamptz;
  v_delivery jsonb;
  v_launch jsonb;
  v_exit jsonb;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Admin access required'; end if;

  v_base:=private.operations_incident_report();
  v_slo:=private.production_slo_report();
  v_history:=private.production_slo_history_report(24);
  v_delivery:=private.production_alert_delivery_report();
  v_launch:=private.production_launch_stability_report();
  v_exit:=private.production_launch_exit_report();

  select max(created_at) into v_last_recovery from public.audit_logs where action='production_slo_recovered';

  select count(*) into v_pending
  from public.audit_logs a
  left join private.production_incident_acknowledgements ack on ack.audit_log_id=a.id
  where a.action='production_slo_breached'
    and a.created_at>coalesce(v_last_recovery,'epoch'::timestamptz)
    and ack.audit_log_id is null;

  select count(*) into v_unacked_7d
  from public.audit_logs a
  left join private.production_incident_acknowledgements ack on ack.audit_log_id=a.id
  where a.action='production_slo_breached'
    and a.created_at>now()-interval '7 days'
    and ack.audit_log_id is null;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb)
  into v_events
  from (
    select a.id,a.action,
      case when a.action='production_slo_recovered' then 'ok' else coalesce(a.new_data->>'severity','warning') end as severity,
      coalesce(a.new_data->'breaches','[]'::jsonb) as breaches,a.created_at,
      (ack.audit_log_id is not null) as acknowledged,ack.acknowledged_by,ack.acknowledged_at,
      ack.note as acknowledgement_note,p.display_name as acknowledged_by_name,p.email as acknowledged_by_email
    from public.audit_logs a
    left join private.production_incident_acknowledgements ack on ack.audit_log_id=a.id
    left join public.profiles p on p.id=ack.acknowledged_by
    where a.action in ('production_slo_breached','production_slo_recovered')
      and a.created_at>now()-interval '7 days'
    order by a.created_at desc limit 50
  ) x;

  return v_base || jsonb_build_object(
    'production_slo',v_slo,'slo_history',v_history,'slo_events',v_events,
    'pending_slo_ack_count',v_pending,'unacknowledged_slo_breaches_7d',v_unacked_7d,
    'alert_delivery',v_delivery || jsonb_build_object('admin_polling_seconds',60),
    'launch_stability',v_launch,'launch_exit',v_exit
  );
end;
$function$;

revoke all on function private.production_launch_operator_signoff_report() from public,anon,authenticated,service_role;
revoke all on function private.production_launch_exit_report() from public,anon,authenticated,service_role;
revoke all on function private.production_launch_readiness_report() from public,anon,authenticated,service_role;

revoke all on function public.admin_record_launch_operator_signoff(text,text,text) from public,anon,service_role;
grant execute on function public.admin_record_launch_operator_signoff(text,text,text) to authenticated;
revoke all on function public.admin_disposition_launch_warning(bigint,text) from public,anon,service_role;
grant execute on function public.admin_disposition_launch_warning(bigint,text) to authenticated;
revoke all on function public.admin_finalize_launch_stabilization(text,text) from public,anon,service_role;
grant execute on function public.admin_finalize_launch_stabilization(text,text) to authenticated;

comment on table private.production_launch_operator_signoffs is 'Phase 8B operator-owned launch exceptions and explicit disposition state.';
comment on table private.production_launch_warning_dispositions is 'Phase 8B operator dispositions for warning launch snapshots.';
comment on table private.production_launch_exit_signoff is 'Phase 8B final operator launch stabilization decision.';
comment on function private.production_launch_exit_report() is 'Phase 8B server-authoritative stabilization exit gate and final sign-off report.';
