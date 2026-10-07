-- Brand correction: current product name is Lootera / lootera.win.
-- Historical internal identifiers and migration names remain unchanged.

create or replace function private.production_alert_payload(
  p_audit_log_id bigint,
  p_delivery_kind text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $function$
declare
  v_action text;
  v_data jsonb;
  v_created timestamptz;
  v_severity text;
begin
  select action,new_data,created_at
  into v_action,v_data,v_created
  from public.audit_logs
  where id=p_audit_log_id;

  if v_action is null then
    raise exception 'Alert audit event not found';
  end if;

  v_severity:=case
    when v_action='production_slo_recovered' then 'ok'
    else coalesce(v_data->>'severity','warning')
  end;

  return jsonb_build_object(
    'project','Lootera',
    'domain','lootera.win',
    'event',v_action,
    'audit_log_id',p_audit_log_id,
    'delivery_kind',p_delivery_kind,
    'severity',v_severity,
    'breaches',coalesce(v_data->'breaches','[]'::jsonb),
    'slo',v_data,
    'occurred_at',v_created
  );
end;
$function$;

revoke all on function private.production_alert_payload(bigint,text)
from public,anon,authenticated,service_role;

comment on function private.production_alert_payload(bigint,text) is
  'Builds production alert payloads for Lootera (lootera.win).';
