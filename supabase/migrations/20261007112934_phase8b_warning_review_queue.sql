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
  v_unresolved_warning_items jsonb:='[]'::jsonb;
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

  select coalesce(jsonb_agg(jsonb_build_object(
    'snapshot_id',s.id,
    'captured_at',s.captured_at,
    'technical_state',s.technical_state,
    'breaches',coalesce(s.report->'slo'->'breaches','[]'::jsonb),
    'technical_ready',s.technical_ready
  ) order by s.captured_at),'[]'::jsonb)
  into v_unresolved_warning_items
  from private.production_launch_stability_snapshots s
  left join private.production_launch_warning_dispositions d on d.snapshot_id=s.id
  where s.captured_at>=v_cfg.window_started_at
    and s.captured_at<=v_cfg.window_ends_at
    and s.technical_state='warning'
    and d.snapshot_id is null;

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
      'warning_snapshots',v_warning_snapshots,
      'dispositioned',v_warning_dispositioned,
      'unresolved',v_warning_unresolved,
      'unresolved_items',v_unresolved_warning_items
    ),
    'operator_signoff',v_operator,
    'final_decision',jsonb_build_object(
      'decision',v_final.decision,'note',v_final.note,'signed_by',v_final.signed_by,
      'signed_at',v_final.signed_at,'updated_at',v_final.updated_at
    )
  );
end;
$function$;

revoke all on function private.production_launch_exit_report() from public,anon,authenticated,service_role;
comment on function private.production_launch_exit_report() is
  'Phase 8B server-authoritative stabilization exit gate, warning-review queue and final sign-off report.';
