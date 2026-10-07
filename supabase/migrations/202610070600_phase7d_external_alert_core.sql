-- Phase 7D — durable external alert delivery outbox, retries, escalation, and internal dispatcher auth.
-- External webhook delivery is disabled by default. No third-party URL or credential is stored here.

create extension if not exists pg_net;

create table if not exists private.production_alert_delivery_config (
  id smallint primary key check (id=1),
  external_enabled boolean not null default false,
  channel text not null default 'webhook' check (channel='webhook'),
  warning_escalation_1_minutes integer not null default 15 check (warning_escalation_1_minutes between 1 and 1440),
  critical_escalation_1_minutes integer not null default 5 check (critical_escalation_1_minutes between 1 and 1440),
  escalation_2_minutes integer not null default 30 check (escalation_2_minutes between 2 and 2880),
  max_attempts integer not null default 6 check (max_attempts between 1 and 20),
  dispatcher_token_sha256 text not null,
  dispatcher_configured boolean not null default false,
  last_dispatch_at timestamptz,
  last_delivery_at timestamptz,
  last_error text,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists private.production_alert_outbox (
  id bigint generated always as identity primary key,
  audit_log_id bigint not null references public.audit_logs(id) on delete cascade,
  delivery_kind text not null check (delivery_kind in ('initial','escalation_1','escalation_2','recovery')),
  severity text not null check (severity in ('ok','warning','critical')),
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','in_flight','delivered','dead_letter','cancelled')),
  attempt_count integer not null default 0 check (attempt_count>=0),
  next_attempt_at timestamptz not null default now(),
  claimed_at timestamptz,
  delivered_at timestamptz,
  last_http_status integer,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(audit_log_id,delivery_kind)
);

create index if not exists production_alert_outbox_due_idx
on private.production_alert_outbox(status,next_attempt_at,id)
where status='pending';

create index if not exists production_alert_outbox_created_idx
on private.production_alert_outbox(created_at desc);

alter table private.production_alert_delivery_config enable row level security;
alter table private.production_alert_outbox enable row level security;

revoke all on table private.production_alert_delivery_config from public,anon,authenticated,service_role;
revoke all on table private.production_alert_outbox from public,anon,authenticated,service_role;
revoke all on sequence private.production_alert_outbox_id_seq from public,anon,authenticated,service_role;

do $phase7d_token$
declare
  v_token text;
begin
  select decrypted_secret
  into v_token
  from vault.decrypted_secrets
  where name='production_alert_dispatch_token'
  limit 1;

  if v_token is null then
    v_token:=encode(extensions.gen_random_bytes(32),'hex');
    perform vault.create_secret(v_token,'production_alert_dispatch_token');
  end if;

  insert into private.production_alert_delivery_config(
    id,external_enabled,channel,dispatcher_token_sha256
  )
  values(
    1,false,'webhook',encode(extensions.digest(v_token::text,'sha256'),'hex')
  )
  on conflict(id) do update
  set dispatcher_token_sha256=excluded.dispatcher_token_sha256,
      updated_at=now();
end
$phase7d_token$;

create or replace function private.verify_production_alert_dispatch_token(p_token text)
returns boolean
language sql
security definer
set search_path to 'pg_catalog','public','private','extensions'
as $function$
  select exists(
    select 1
    from private.production_alert_delivery_config
    where id=1
      and dispatcher_token_sha256=encode(extensions.digest(coalesce(p_token,'')::text,'sha256'),'hex')
  );
$function$;

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
    'project','DRAW//01',
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

create or replace function private.enqueue_production_alert_event()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $function$
declare
  v_enabled boolean:=false;
  v_last_recovery timestamptz;
  v_severity text;
begin
  if new.action='production_slo_acknowledged' then
    if coalesce(new.entity_id,'') ~ '^[0-9]+$' then
      update private.production_alert_outbox
      set status='cancelled',
          last_error='Escalation cancelled after operator acknowledgement',
          updated_at=now()
      where audit_log_id=new.entity_id::bigint
        and delivery_kind in ('escalation_1','escalation_2')
        and status='pending';
    end if;
    return new;
  end if;

  if new.action not in ('production_slo_breached','production_slo_recovered') then
    return new;
  end if;

  select external_enabled into v_enabled
  from private.production_alert_delivery_config
  where id=1;

  if new.action='production_slo_recovered' then
    update private.production_alert_outbox
    set status='cancelled',
        last_error='Escalation cancelled after SLO recovery',
        updated_at=now()
    where delivery_kind in ('escalation_1','escalation_2')
      and status='pending';

    if coalesce(v_enabled,false) then
      insert into private.production_alert_outbox(
        audit_log_id,delivery_kind,severity,payload
      )
      values(
        new.id,'recovery','ok',
        private.production_alert_payload(new.id,'recovery')
      )
      on conflict(audit_log_id,delivery_kind) do nothing;
    end if;

    return new;
  end if;

  if not coalesce(v_enabled,false) then
    return new;
  end if;

  select max(created_at)
  into v_last_recovery
  from public.audit_logs
  where action='production_slo_recovered'
    and created_at<=new.created_at;

  if exists(
    select 1
    from public.audit_logs a
    where a.action='production_slo_breached'
      and a.id<new.id
      and a.created_at>coalesce(v_last_recovery,'epoch'::timestamptz)
  ) then
    return new;
  end if;

  v_severity:=coalesce(new.new_data->>'severity','warning');

  insert into private.production_alert_outbox(
    audit_log_id,delivery_kind,severity,payload
  )
  values(
    new.id,'initial',v_severity,
    private.production_alert_payload(new.id,'initial')
  )
  on conflict(audit_log_id,delivery_kind) do nothing;

  return new;
end;
$function$;

drop trigger if exists production_alert_enqueue_trigger on public.audit_logs;
create trigger production_alert_enqueue_trigger
after insert on public.audit_logs
for each row
execute function private.enqueue_production_alert_event();

create or replace function private.enqueue_production_alert_escalations()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $function$
declare
  v_enabled boolean:=false;
  v_warning_1 integer:=15;
  v_critical_1 integer:=5;
  v_escalation_2 integer:=30;
  v_last_recovery timestamptz;
  v_audit_id bigint;
  v_created timestamptz;
  v_severity text;
  v_inserted integer:=0;
  v_rowcount integer:=0;
begin
  select external_enabled,warning_escalation_1_minutes,critical_escalation_1_minutes,escalation_2_minutes
  into v_enabled,v_warning_1,v_critical_1,v_escalation_2
  from private.production_alert_delivery_config
  where id=1;

  if not coalesce(v_enabled,false) then
    return jsonb_build_object('enabled',false,'inserted',0);
  end if;

  select max(created_at)
  into v_last_recovery
  from public.audit_logs
  where action='production_slo_recovered';

  select a.id,a.created_at,coalesce(a.new_data->>'severity','warning')
  into v_audit_id,v_created,v_severity
  from public.audit_logs a
  left join private.production_incident_acknowledgements ack
    on ack.audit_log_id=a.id
  where a.action='production_slo_breached'
    and a.created_at>coalesce(v_last_recovery,'epoch'::timestamptz)
    and ack.audit_log_id is null
  order by a.created_at asc,a.id asc
  limit 1;

  if v_audit_id is null then
    return jsonb_build_object('enabled',true,'inserted',0,'active_breach',false);
  end if;

  insert into private.production_alert_outbox(
    audit_log_id,delivery_kind,severity,payload
  )
  values(
    v_audit_id,'initial',v_severity,
    private.production_alert_payload(v_audit_id,'initial')
  )
  on conflict(audit_log_id,delivery_kind) do nothing;
  get diagnostics v_rowcount=row_count;
  v_inserted:=v_inserted+v_rowcount;

  if now()-v_created >= make_interval(mins=>case when v_severity='critical' then v_critical_1 else v_warning_1 end) then
    insert into private.production_alert_outbox(
      audit_log_id,delivery_kind,severity,payload
    )
    values(
      v_audit_id,'escalation_1',v_severity,
      private.production_alert_payload(v_audit_id,'escalation_1')
        || jsonb_build_object('unacknowledged_minutes',floor(extract(epoch from (now()-v_created))/60))
    )
    on conflict(audit_log_id,delivery_kind) do nothing;
    get diagnostics v_rowcount=row_count;
    v_inserted:=v_inserted+v_rowcount;
  end if;

  if now()-v_created >= make_interval(mins=>v_escalation_2) then
    insert into private.production_alert_outbox(
      audit_log_id,delivery_kind,severity,payload
    )
    values(
      v_audit_id,'escalation_2',v_severity,
      private.production_alert_payload(v_audit_id,'escalation_2')
        || jsonb_build_object('unacknowledged_minutes',floor(extract(epoch from (now()-v_created))/60))
    )
    on conflict(audit_log_id,delivery_kind) do nothing;
    get diagnostics v_rowcount=row_count;
    v_inserted:=v_inserted+v_rowcount;
  end if;

  return jsonb_build_object(
    'enabled',true,
    'active_breach',true,
    'audit_log_id',v_audit_id,
    'severity',v_severity,
    'inserted',v_inserted
  );
end;
$function$;

create or replace function public.service_claim_production_alert_batch(
  p_dispatch_token text,
  p_limit integer default 10
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $function$
declare
  v_limit integer;
  v_items jsonb;
begin
  if not private.verify_production_alert_dispatch_token(p_dispatch_token) then
    raise exception 'Invalid production alert dispatch token';
  end if;

  v_limit:=greatest(1,least(coalesce(p_limit,10),25));

  with picked as (
    select id
    from private.production_alert_outbox
    where status='pending'
      and next_attempt_at<=now()
    order by created_at,id
    for update skip locked
    limit v_limit
  ),
  claimed as (
    update private.production_alert_outbox o
    set status='in_flight',
        claimed_at=now(),
        attempt_count=o.attempt_count+1,
        updated_at=now()
    from picked
    where o.id=picked.id
    returning o.id,o.audit_log_id,o.delivery_kind,o.severity,o.payload,o.attempt_count,o.created_at
  )
  select coalesce(jsonb_agg(to_jsonb(claimed) order by created_at,id),'[]'::jsonb)
  into v_items
  from claimed;

  return v_items;
end;
$function$;

create or replace function public.service_complete_production_alert_delivery(
  p_dispatch_token text,
  p_outbox_id bigint,
  p_success boolean,
  p_http_status integer default null,
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $function$
declare
  v_row private.production_alert_outbox%rowtype;
  v_max_attempts integer:=6;
  v_next timestamptz;
  v_status text;
begin
  if not private.verify_production_alert_dispatch_token(p_dispatch_token) then
    raise exception 'Invalid production alert dispatch token';
  end if;

  select * into v_row
  from private.production_alert_outbox
  where id=p_outbox_id
  for update;

  if v_row.id is null then
    raise exception 'Alert outbox row not found';
  end if;

  if v_row.status='delivered' then
    return jsonb_build_object('ok',true,'status','delivered','id',v_row.id,'idempotent',true);
  end if;

  select max_attempts into v_max_attempts
  from private.production_alert_delivery_config
  where id=1;

  if coalesce(p_success,false) then
    update private.production_alert_outbox
    set status='delivered',
        delivered_at=now(),
        last_http_status=p_http_status,
        last_error=null,
        updated_at=now()
    where id=p_outbox_id;

    update private.production_alert_delivery_config
    set last_delivery_at=now(),
        last_error=null,
        updated_at=now()
    where id=1;

    v_status:='delivered';
  elsif v_row.attempt_count>=v_max_attempts then
    update private.production_alert_outbox
    set status='dead_letter',
        last_http_status=p_http_status,
        last_error=left(coalesce(p_error,'Delivery failed'),1000),
        updated_at=now()
    where id=p_outbox_id;

    update private.production_alert_delivery_config
    set last_error=left(coalesce(p_error,'Delivery reached max attempts'),1000),
        updated_at=now()
    where id=1;

    v_status:='dead_letter';
  else
    v_next:=now()+case v_row.attempt_count
      when 1 then interval '1 minute'
      when 2 then interval '2 minutes'
      when 3 then interval '5 minutes'
      when 4 then interval '15 minutes'
      when 5 then interval '30 minutes'
      else interval '60 minutes'
    end;

    update private.production_alert_outbox
    set status='pending',
        next_attempt_at=v_next,
        claimed_at=null,
        last_http_status=p_http_status,
        last_error=left(coalesce(p_error,'Delivery failed'),1000),
        updated_at=now()
    where id=p_outbox_id;

    update private.production_alert_delivery_config
    set last_error=left(coalesce(p_error,'Delivery failed; retry scheduled'),1000),
        updated_at=now()
    where id=1;

    v_status:='pending';
  end if;

  return jsonb_build_object(
    'ok',coalesce(p_success,false),
    'id',p_outbox_id,
    'status',v_status,
    'attempt_count',v_row.attempt_count,
    'next_attempt_at',case when v_status='pending' then v_next else null end
  );
end;
$function$;

create or replace function public.service_record_production_alert_dispatcher_state(
  p_dispatch_token text,
  p_configured boolean,
  p_error text default null,
  p_disable boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $function$
begin
  if not private.verify_production_alert_dispatch_token(p_dispatch_token) then
    raise exception 'Invalid production alert dispatch token';
  end if;

  update private.production_alert_delivery_config
  set dispatcher_configured=coalesce(p_configured,false),
      external_enabled=case when coalesce(p_disable,false) then false else external_enabled end,
      last_error=case when p_error is null then last_error else left(p_error,1000) end,
      last_dispatch_at=now(),
      updated_at=now()
  where id=1;

  return (
    select jsonb_build_object(
      'external_enabled',external_enabled,
      'dispatcher_configured',dispatcher_configured,
      'last_dispatch_at',last_dispatch_at,
      'last_error',last_error
    )
    from private.production_alert_delivery_config
    where id=1
  );
end;
$function$;

create or replace function private.kick_production_alert_dispatch()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','private','cron','net'
as $function$
declare
  v_enabled boolean:=false;
  v_token text;
  v_due bigint:=0;
  v_request_id bigint;
begin
  update private.production_alert_outbox
  set status='pending',
      claimed_at=null,
      next_attempt_at=now(),
      last_error=coalesce(last_error||'; ','')||'Requeued stale in-flight delivery',
      updated_at=now()
  where status='in_flight'
    and claimed_at<now()-interval '5 minutes';

  perform private.enqueue_production_alert_escalations();

  select external_enabled into v_enabled
  from private.production_alert_delivery_config
  where id=1;

  if not coalesce(v_enabled,false) then
    return jsonb_build_object('enabled',false,'queued',false);
  end if;

  select count(*) into v_due
  from private.production_alert_outbox
  where status='pending'
    and next_attempt_at<=now();

  if v_due=0 then
    return jsonb_build_object('enabled',true,'queued',false,'due',0);
  end if;

  select decrypted_secret
  into v_token
  from vault.decrypted_secrets
  where name='production_alert_dispatch_token'
  limit 1;

  if v_token is null then
    update private.production_alert_delivery_config
    set external_enabled=false,
        dispatcher_configured=false,
        last_error='Internal production alert dispatch token missing from Vault',
        updated_at=now()
    where id=1;
    return jsonb_build_object('enabled',false,'queued',false,'error','dispatch token missing');
  end if;

  select net.http_post(
    url:='https://mwtlsnneooxmryondrex.supabase.co/functions/v1/production-alert-dispatch',
    body:=jsonb_build_object('source','production-alert-dispatch-minute','due',v_due),
    headers:=jsonb_build_object(
      'Content-Type','application/json',
      'x-alert-dispatch-token',v_token
    ),
    timeout_milliseconds:=5000
  )
  into v_request_id;

  update private.production_alert_delivery_config
  set last_dispatch_at=now(),updated_at=now()
  where id=1;

  return jsonb_build_object(
    'enabled',true,
    'queued',true,
    'due',v_due,
    'request_id',v_request_id
  );
end;
$function$;

revoke all on function private.verify_production_alert_dispatch_token(text) from public,anon,authenticated,service_role;
revoke all on function private.production_alert_payload(bigint,text) from public,anon,authenticated,service_role;
revoke all on function private.enqueue_production_alert_escalations() from public,anon,authenticated,service_role;
revoke all on function private.kick_production_alert_dispatch() from public,anon,authenticated,service_role;
revoke all on function private.enqueue_production_alert_event() from public,anon,authenticated,service_role;

revoke all on function public.service_claim_production_alert_batch(text,integer) from public,anon,authenticated,service_role;
grant execute on function public.service_claim_production_alert_batch(text,integer) to service_role;

revoke all on function public.service_complete_production_alert_delivery(text,bigint,boolean,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.service_complete_production_alert_delivery(text,bigint,boolean,integer,text) to service_role;

revoke all on function public.service_record_production_alert_dispatcher_state(text,boolean,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.service_record_production_alert_dispatcher_state(text,boolean,text,boolean) to service_role;

select cron.schedule(
  'production-alert-dispatch-minute',
  '* * * * *',
  'select private.kick_production_alert_dispatch();'
);

comment on table private.production_alert_delivery_config is
  'Phase 7D external-alert delivery state. External delivery is disabled until an operator configures the Edge webhook secret and explicitly enables this row.';

comment on table private.production_alert_outbox is
  'Phase 7D durable SLO alert outbox with escalation, retry/backoff, delivery and dead-letter state.';

comment on function private.kick_production_alert_dispatch() is
  'Phase 7D minute dispatcher kick: requeues stale claims, creates escalations, and invokes the internal Edge dispatcher only when delivery is enabled and due work exists.';
