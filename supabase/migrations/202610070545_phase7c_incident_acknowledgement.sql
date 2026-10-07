-- Phase 7C — admin observability delivery and incident acknowledgement.
-- Extends the existing admin incident center with current SLO state/history/events
-- and adds an admin-only acknowledgement trail for production SLO breaches.

create table if not exists private.production_incident_acknowledgements (
  audit_log_id bigint primary key references public.audit_logs(id) on delete cascade,
  acknowledged_by uuid references auth.users(id) on delete set null,
  acknowledged_at timestamptz not null default now(),
  note text not null check (char_length(btrim(note)) between 3 and 500)
);

revoke all on table private.production_incident_acknowledgements
from public, anon, authenticated, service_role;

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
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  v_base:=private.operations_incident_report();
  v_slo:=private.production_slo_report();
  v_history:=private.production_slo_history_report(24);

  select max(created_at)
  into v_last_recovery
  from public.audit_logs
  where action='production_slo_recovered';

  select count(*)
  into v_pending
  from public.audit_logs a
  left join private.production_incident_acknowledgements ack
    on ack.audit_log_id=a.id
  where a.action='production_slo_breached'
    and a.created_at>coalesce(v_last_recovery,'epoch'::timestamptz)
    and ack.audit_log_id is null;

  select count(*)
  into v_unacked_7d
  from public.audit_logs a
  left join private.production_incident_acknowledgements ack
    on ack.audit_log_id=a.id
  where a.action='production_slo_breached'
    and a.created_at>now()-interval '7 days'
    and ack.audit_log_id is null;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb)
  into v_events
  from (
    select
      a.id,
      a.action,
      case
        when a.action='production_slo_recovered' then 'ok'
        else coalesce(a.new_data->>'severity','warning')
      end as severity,
      coalesce(a.new_data->'breaches','[]'::jsonb) as breaches,
      a.created_at,
      (ack.audit_log_id is not null) as acknowledged,
      ack.acknowledged_by,
      ack.acknowledged_at,
      ack.note as acknowledgement_note,
      p.display_name as acknowledged_by_name,
      p.email as acknowledged_by_email
    from public.audit_logs a
    left join private.production_incident_acknowledgements ack
      on ack.audit_log_id=a.id
    left join public.profiles p
      on p.id=ack.acknowledged_by
    where a.action in ('production_slo_breached','production_slo_recovered')
      and a.created_at>now()-interval '7 days'
    order by a.created_at desc
    limit 50
  ) x;

  return v_base || jsonb_build_object(
    'production_slo',v_slo,
    'slo_history',v_history,
    'slo_events',v_events,
    'pending_slo_ack_count',v_pending,
    'unacknowledged_slo_breaches_7d',v_unacked_7d,
    'alert_delivery',jsonb_build_object(
      'admin_polling_seconds',60,
      'external_webhook_configured',false,
      'external_delivery_note','No Vault alert secret / pg_net delivery channel was configured at Phase 7C deployment.'
    )
  );
end;
$function$;

create or replace function public.admin_acknowledge_production_incident(
  p_audit_log_id bigint,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','private','auth'
as $function$
declare
  v_uid uuid;
  v_note text;
  v_action text;
  v_payload jsonb;
begin
  v_uid:=auth.uid();
  if v_uid is null or not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  v_note:=btrim(coalesce(p_note,''));
  if char_length(v_note)<3 then
    raise exception 'Acknowledgement note must be at least 3 characters';
  end if;
  if char_length(v_note)>500 then
    raise exception 'Acknowledgement note must be 500 characters or fewer';
  end if;

  select action,new_data
  into v_action,v_payload
  from public.audit_logs
  where id=p_audit_log_id
  for share;

  if v_action is null then
    raise exception 'Incident audit event not found';
  end if;

  if v_action<>'production_slo_breached' then
    raise exception 'Only production SLO breach events can be acknowledged';
  end if;

  insert into private.production_incident_acknowledgements(
    audit_log_id,acknowledged_by,acknowledged_at,note
  )
  values(p_audit_log_id,v_uid,now(),v_note)
  on conflict(audit_log_id) do update
  set acknowledged_by=excluded.acknowledged_by,
      acknowledged_at=excluded.acknowledged_at,
      note=excluded.note;

  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,new_data)
  values(
    v_uid,
    'production_slo_acknowledged',
    'system',
    p_audit_log_id::text,
    jsonb_build_object(
      'audit_log_id',p_audit_log_id,
      'note',v_note,
      'breach',v_payload
    )
  );

  return jsonb_build_object(
    'ok',true,
    'audit_log_id',p_audit_log_id,
    'acknowledged_by',v_uid,
    'acknowledged_at',now(),
    'note',v_note
  );
end;
$function$;

revoke all on function public.admin_get_operations_incident_center()
from public, anon, service_role;
grant execute on function public.admin_get_operations_incident_center()
to authenticated;

revoke all on function public.admin_acknowledge_production_incident(bigint,text)
from public, anon, service_role;
grant execute on function public.admin_acknowledge_production_incident(bigint,text)
to authenticated;

comment on table private.production_incident_acknowledgements is
  'Phase 7C private acknowledgement trail for production_slo_breached audit events.';

comment on function public.admin_get_operations_incident_center() is
  'Admin-only incident center extended in Phase 7C with production SLO state, history, events, and acknowledgement counts.';

comment on function public.admin_acknowledge_production_incident(bigint,text) is
  'Admin-only acknowledgement workflow for production SLO breach audit events.';
