-- Phase 7F — go-live abuse hardening:
-- private mutation guardrails, successful-mutation rate budgets,
-- and nonce-based idempotent lottery ticket purchase.

create table if not exists private.production_mutation_guardrails (
  id smallint primary key check (id=1),
  master_enabled boolean not null default true,
  ticket_purchases_enabled boolean not null default true,
  game_writes_enabled boolean not null default true,
  support_claims_enabled boolean not null default true,
  credit_requests_enabled boolean not null default true,
  referral_writes_enabled boolean not null default true,
  payment_orders_enabled boolean not null default true,
  reason text,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into private.production_mutation_guardrails(id)
values(1)
on conflict(id) do nothing;

create table if not exists private.mutation_rate_limit_windows (
  user_id uuid not null,
  bucket text not null,
  window_epoch bigint not null,
  request_count integer not null default 0 check(request_count>=0),
  updated_at timestamptz not null default now(),
  primary key(user_id,bucket,window_epoch)
);

create index if not exists mutation_rate_limit_windows_updated_at_idx
  on private.mutation_rate_limit_windows(updated_at);

create table if not exists private.ticket_purchase_idempotency (
  user_id uuid not null references auth.users(id) on delete cascade,
  client_nonce uuid not null,
  event_id uuid not null references public.lottery_events(id) on delete cascade,
  white_numbers integer[],
  bonus_ball integer,
  ticket_id uuid not null references public.event_tickets(id) on delete cascade,
  balance_after numeric not null,
  created_at timestamptz not null default now(),
  primary key(user_id,client_nonce),
  unique(ticket_id)
);

alter table private.production_mutation_guardrails enable row level security;
alter table private.mutation_rate_limit_windows enable row level security;
alter table private.ticket_purchase_idempotency enable row level security;

revoke all on table private.production_mutation_guardrails from public,anon,authenticated,service_role;
revoke all on table private.mutation_rate_limit_windows from public,anon,authenticated,service_role;
revoke all on table private.ticket_purchase_idempotency from public,anon,authenticated,service_role;

create or replace function private.assert_mutation_enabled(p_category text)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $function$
declare
  g private.production_mutation_guardrails%rowtype;
  v_enabled boolean;
begin
  select * into g from private.production_mutation_guardrails where id=1;

  if not found or not g.master_enabled then
    raise exception 'User mutations are temporarily unavailable';
  end if;

  v_enabled:=case p_category
    when 'tickets' then g.ticket_purchases_enabled
    when 'games' then g.game_writes_enabled
    when 'support' then g.support_claims_enabled
    when 'credits' then g.credit_requests_enabled
    when 'referrals' then g.referral_writes_enabled
    when 'payments' then g.payment_orders_enabled
    else false
  end;

  if not coalesce(v_enabled,false) then
    raise exception '% mutations are temporarily unavailable',initcap(p_category);
  end if;
end;
$function$;

create or replace function private.consume_mutation_budget(
  p_user_id uuid,
  p_bucket text,
  p_limit integer,
  p_window_seconds integer
)
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $function$
declare
  v_epoch bigint;
  v_count integer;
begin
  if p_user_id is null then raise exception 'Mutation rate limit requires a user id'; end if;
  if nullif(btrim(coalesce(p_bucket,'')),'') is null then raise exception 'Mutation rate limit bucket required'; end if;
  if p_limit<1 or p_limit>10000 then raise exception 'Invalid mutation rate limit'; end if;
  if p_window_seconds<1 or p_window_seconds>604800 then raise exception 'Invalid mutation rate-limit window'; end if;

  v_epoch:=(floor(extract(epoch from clock_timestamp())/p_window_seconds)*p_window_seconds)::bigint;

  insert into private.mutation_rate_limit_windows(user_id,bucket,window_epoch,request_count,updated_at)
  values(p_user_id,p_bucket,v_epoch,1,now())
  on conflict(user_id,bucket,window_epoch) do update
  set request_count=private.mutation_rate_limit_windows.request_count+1,
      updated_at=now()
  returning request_count into v_count;

  if v_count>p_limit then
    raise exception 'Too many % operations. Please wait and try again.',p_bucket;
  end if;

  return v_count;
end;
$function$;

create or replace function private.guard_user_mutation_insert()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $function$
declare
  v_row jsonb:=to_jsonb(new);
  v_category text:=tg_argv[0];
  v_bucket text:=tg_argv[1];
  v_limit integer:=tg_argv[2]::integer;
  v_window integer:=tg_argv[3]::integer;
  v_user_key text:=coalesce(nullif(tg_argv[4],''),'user_id');
  v_uid uuid;
begin
  perform private.assert_mutation_enabled(v_category);

  v_uid:=nullif(v_row->>v_user_key,'')::uuid;
  if v_uid is null then raise exception 'Mutation user identity missing'; end if;

  perform private.consume_mutation_budget(v_uid,v_bucket,v_limit,v_window);
  return new;
end;
$function$;

drop trigger if exists phase7f_guard_event_tickets on public.event_tickets;
create trigger phase7f_guard_event_tickets before insert on public.event_tickets
for each row execute function private.guard_user_mutation_insert('tickets','ticket_purchase',20,60,'user_id');

drop trigger if exists phase7f_guard_slot_spins on public.slot_spins;
create trigger phase7f_guard_slot_spins before insert on public.slot_spins
for each row execute function private.guard_user_mutation_insert('games','slot_spin',240,60,'user_id');

drop trigger if exists phase7f_guard_plinko_drops on public.plinko_drops;
create trigger phase7f_guard_plinko_drops before insert on public.plinko_drops
for each row execute function private.guard_user_mutation_insert('games','plinko_drop',900,60,'user_id');

drop trigger if exists phase7f_guard_credit_requests on public.credit_requests;
create trigger phase7f_guard_credit_requests before insert on public.credit_requests
for each row execute function private.guard_user_mutation_insert('credits','credit_request',6,3600,'user_id');

drop trigger if exists phase7f_guard_support_claim_requests on public.support_claim_requests;
create trigger phase7f_guard_support_claim_requests before insert on public.support_claim_requests
for each row execute function private.guard_user_mutation_insert('support','support_claim_request',30,3600,'user_id');

drop trigger if exists phase7f_guard_support_point_claims on public.support_point_claims;
create trigger phase7f_guard_support_point_claims before insert on public.support_point_claims
for each row execute function private.guard_user_mutation_insert('support','support_point_claim',60,3600,'user_id');

drop trigger if exists phase7f_guard_binance_orders on public.binance_pay_orders;
create trigger phase7f_guard_binance_orders before insert on public.binance_pay_orders
for each row execute function private.guard_user_mutation_insert('payments','payment_order',12,3600,'user_id');

drop trigger if exists phase7f_guard_referrals on public.referrals;
create trigger phase7f_guard_referrals before insert on public.referrals
for each row execute function private.guard_user_mutation_insert('referrals','referral_join',3,86400,'referred_user_id');

create or replace function private.mutation_guardrail_report()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $function$
declare
  g private.production_mutation_guardrails%rowtype;
begin
  select * into g from private.production_mutation_guardrails where id=1;
  return jsonb_build_object(
    'master_enabled',g.master_enabled,
    'ticket_purchases_enabled',g.ticket_purchases_enabled,
    'game_writes_enabled',g.game_writes_enabled,
    'support_claims_enabled',g.support_claims_enabled,
    'credit_requests_enabled',g.credit_requests_enabled,
    'referral_writes_enabled',g.referral_writes_enabled,
    'payment_orders_enabled',g.payment_orders_enabled,
    'reason',g.reason,
    'updated_by',g.updated_by,
    'updated_at',g.updated_at,
    'rate_limits',jsonb_build_object(
      'ticket_purchase','20/min',
      'slot_spin','240/min',
      'plinko_drop','900/min',
      'credit_request','6/hour',
      'support_claim_request','30/hour',
      'support_point_claim','60/hour',
      'payment_order','12/hour',
      'referral_join','3/day'
    )
  );
end;
$function$;

create or replace function public.admin_get_mutation_guardrails()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $function$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Admin access required';
  end if;
  return private.mutation_guardrail_report();
end;
$function$;

create or replace function public.admin_set_mutation_guardrails(
  p_master_enabled boolean,
  p_ticket_purchases_enabled boolean,
  p_game_writes_enabled boolean,
  p_support_claims_enabled boolean,
  p_credit_requests_enabled boolean,
  p_referral_writes_enabled boolean,
  p_payment_orders_enabled boolean,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $function$
declare
  v_uid uuid:=auth.uid();
  v_reason text:=btrim(coalesce(p_reason,''));
begin
  if v_uid is null or not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  if char_length(v_reason)<3 or char_length(v_reason)>500 then
    raise exception 'Guardrail reason must be 3-500 characters';
  end if;

  update private.production_mutation_guardrails
  set master_enabled=coalesce(p_master_enabled,false),
      ticket_purchases_enabled=coalesce(p_ticket_purchases_enabled,false),
      game_writes_enabled=coalesce(p_game_writes_enabled,false),
      support_claims_enabled=coalesce(p_support_claims_enabled,false),
      credit_requests_enabled=coalesce(p_credit_requests_enabled,false),
      referral_writes_enabled=coalesce(p_referral_writes_enabled,false),
      payment_orders_enabled=coalesce(p_payment_orders_enabled,false),
      reason=v_reason,
      updated_by=v_uid,
      updated_at=now()
  where id=1;

  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,new_data)
  values(
    v_uid,
    'production_mutation_guardrails_updated',
    'system',
    'mutation-guardrails',
    jsonb_build_object(
      'master_enabled',p_master_enabled,
      'ticket_purchases_enabled',p_ticket_purchases_enabled,
      'game_writes_enabled',p_game_writes_enabled,
      'support_claims_enabled',p_support_claims_enabled,
      'credit_requests_enabled',p_credit_requests_enabled,
      'referral_writes_enabled',p_referral_writes_enabled,
      'payment_orders_enabled',p_payment_orders_enabled,
      'reason',v_reason
    )
  );

  return private.mutation_guardrail_report();
end;
$function$;

create or replace function public.purchase_event_ticket_idempotent(
  p_event_id uuid,
  p_white_numbers integer[],
  p_bonus_ball integer,
  p_client_nonce uuid
)
returns table(ticket_id uuid,new_balance numeric,duplicate boolean)
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $function$
declare
  v_uid uuid:=auth.uid();
  v_sorted integer[];
  v_existing private.ticket_purchase_idempotency%rowtype;
  v_ticket uuid;
  v_balance numeric;
begin
  if v_uid is null then raise exception 'Login required'; end if;
  if p_client_nonce is null then raise exception 'Client nonce required'; end if;

  select array_agg(x order by x) into v_sorted
  from unnest(p_white_numbers) x;

  perform pg_advisory_xact_lock(
    hashtextextended('ticket:'||v_uid::text||':'||p_client_nonce::text,0)
  );

  select * into v_existing
  from private.ticket_purchase_idempotency
  where user_id=v_uid and client_nonce=p_client_nonce;

  if found then
    if v_existing.event_id<>p_event_id
       or v_existing.white_numbers is distinct from v_sorted
       or v_existing.bonus_ball is distinct from p_bonus_ball then
      raise exception 'Idempotency key already used for a different ticket request';
    end if;

    return query
    select v_existing.ticket_id,v_existing.balance_after,true;
    return;
  end if;

  select p.ticket_id,p.new_balance
  into v_ticket,v_balance
  from public.purchase_event_ticket(
    p_event_id,
    p_white_numbers,
    p_bonus_ball
  ) p;

  insert into private.ticket_purchase_idempotency(
    user_id,client_nonce,event_id,white_numbers,bonus_ball,ticket_id,balance_after
  )
  values(
    v_uid,p_client_nonce,p_event_id,v_sorted,p_bonus_ball,v_ticket,v_balance
  );

  return query select v_ticket,v_balance,false;
end;
$function$;

create or replace function private.prune_operational_history()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','private','cron'
as $function$
declare
  v_slo_deleted bigint:=0;
  v_cron_deleted bigint:=0;
  v_alert_deleted bigint:=0;
  v_rate_deleted bigint:=0;
begin
  delete from private.production_slo_snapshots
  where captured_at<now()-interval '30 days';
  get diagnostics v_slo_deleted=row_count;

  delete from cron.job_run_details
  where start_time<now()-interval '30 days';
  get diagnostics v_cron_deleted=row_count;

  delete from private.production_alert_outbox
  where (
    status in ('delivered','cancelled')
    and updated_at<now()-interval '30 days'
  ) or (
    status='dead_letter'
    and updated_at<now()-interval '90 days'
  );
  get diagnostics v_alert_deleted=row_count;

  delete from private.mutation_rate_limit_windows
  where updated_at<now()-interval '2 days';
  get diagnostics v_rate_deleted=row_count;

  return jsonb_build_object(
    'retention_days',30,
    'dead_letter_retention_days',90,
    'rate_limit_retention_days',2,
    'slo_snapshots_deleted',v_slo_deleted,
    'cron_history_deleted',v_cron_deleted,
    'alert_outbox_deleted',v_alert_deleted,
    'mutation_rate_windows_deleted',v_rate_deleted,
    'pruned_at',clock_timestamp()
  );
end;
$function$;

revoke all on function private.assert_mutation_enabled(text) from public,anon,authenticated,service_role;
revoke all on function private.consume_mutation_budget(uuid,text,integer,integer) from public,anon,authenticated,service_role;
revoke all on function private.guard_user_mutation_insert() from public,anon,authenticated,service_role;
revoke all on function private.mutation_guardrail_report() from public,anon,authenticated,service_role;

revoke all on function public.admin_get_mutation_guardrails() from public,anon,service_role;
grant execute on function public.admin_get_mutation_guardrails() to authenticated;

revoke all on function public.admin_set_mutation_guardrails(boolean,boolean,boolean,boolean,boolean,boolean,boolean,text)
from public,anon,service_role;
grant execute on function public.admin_set_mutation_guardrails(boolean,boolean,boolean,boolean,boolean,boolean,boolean,text)
to authenticated;

revoke all on function public.purchase_event_ticket_idempotent(uuid,integer[],integer,uuid)
from public,anon,service_role;
grant execute on function public.purchase_event_ticket_idempotent(uuid,integer[],integer,uuid)
to authenticated;

comment on table private.production_mutation_guardrails is
  'Phase 7F emergency user-mutation kill switches for Lootera.';
comment on table private.mutation_rate_limit_windows is
  'Phase 7F successful-mutation rate-budget windows. Private and automatically pruned.';
comment on table private.ticket_purchase_idempotency is
  'Phase 7F nonce-to-ticket result map for idempotent browser ticket purchase retries.';
comment on function public.purchase_event_ticket_idempotent(uuid,integer[],integer,uuid) is
  'Authenticated Phase 7F ticket purchase endpoint with nonce-based idempotent replay.';
