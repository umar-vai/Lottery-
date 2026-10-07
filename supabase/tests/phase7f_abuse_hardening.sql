-- Phase 7F go-live abuse-hardening runtime contract.
-- Runs inside a transaction and rolls back every test mutation.

begin;

do $phase7f_runtime$
declare
  v_admin uuid;
  v_player uuid;
  v_event uuid;
  v_nonce uuid:=gen_random_uuid();
  v_ticket1 uuid;
  v_ticket2 uuid;
  v_balance1 numeric;
  v_balance2 numeric;
  v_dup1 boolean;
  v_dup2 boolean;
  v_before numeric;
  v_after numeric;
  v_rate integer;
  v_denied boolean:=false;
  v_guard jsonb;
  v_prune jsonb;
  v_trigger_count integer;
begin
  select id into v_admin from public.profiles where role='admin' order by created_at limit 1;
  select id into v_player from public.profiles where role<>'admin' order by created_at limit 1;

  if v_admin is null or v_player is null then
    raise exception 'Phase 7F requires one admin and one non-admin profile';
  end if;

  if has_table_privilege('authenticated','private.production_mutation_guardrails','SELECT')
     or has_table_privilege('authenticated','private.mutation_rate_limit_windows','SELECT')
     or has_table_privilege('authenticated','private.ticket_purchase_idempotency','SELECT')
     or has_table_privilege('anon','private.production_mutation_guardrails','SELECT')
     or has_table_privilege('service_role','private.ticket_purchase_idempotency','SELECT') then
    raise exception 'Phase 7F private guard tables are directly readable';
  end if;

  if has_function_privilege('anon','public.purchase_event_ticket_idempotent(uuid,integer[],integer,uuid)','EXECUTE')
     or has_function_privilege('service_role','public.purchase_event_ticket_idempotent(uuid,integer[],integer,uuid)','EXECUTE')
     or not has_function_privilege('authenticated','public.purchase_event_ticket_idempotent(uuid,integer[],integer,uuid)','EXECUTE') then
    raise exception 'Phase 7F ticket RPC grants are incorrect';
  end if;

  select count(*) into v_trigger_count
  from pg_trigger t
  join pg_class c on c.oid=t.tgrelid
  join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public'
    and not t.tgisinternal
    and t.tgname in (
      'phase7f_guard_event_tickets',
      'phase7f_guard_slot_spins',
      'phase7f_guard_plinko_drops',
      'phase7f_guard_credit_requests',
      'phase7f_guard_support_claim_requests',
      'phase7f_guard_support_point_claims',
      'phase7f_guard_binance_orders',
      'phase7f_guard_referrals'
    );

  if v_trigger_count<>8 then
    raise exception 'Phase 7F mutation-trigger inventory mismatch: %',v_trigger_count;
  end if;

  perform private.consume_mutation_budget(v_player,'phase7f-runtime-probe',2,60);
  v_rate:=private.consume_mutation_budget(v_player,'phase7f-runtime-probe',2,60);
  if v_rate<>2 then
    raise exception 'Phase 7F mutation budget counter mismatch: %',v_rate;
  end if;

  v_denied:=false;
  begin
    perform private.consume_mutation_budget(v_player,'phase7f-runtime-probe',2,60);
  exception when others then
    if sqlerrm not like 'Too many phase7f-runtime-probe operations%' then raise; end if;
    v_denied:=true;
  end;
  if not v_denied then
    raise exception 'Phase 7F rate limiter accepted an over-budget mutation';
  end if;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_admin,'role','authenticated')::text,true);
  perform set_config('request.headers',jsonb_build_object('x-admin-reason','Phase 7F rollback-only runtime')::text,true);
  execute 'set local role authenticated';

  perform public.admin_set_user_balance(v_player,100::numeric,'Phase 7F rollback-only starting balance');

  v_event:=public.admin_create_lottery_event_v3(
    'Phase 7F runtime',
    ('phase7f-runtime-'||substring(replace(gen_random_uuid()::text,'-','') from 1 for 12)),
    'Rollback-only idempotency and kill-switch probe',
    10::numeric,
    5::integer,
    10::integer,
    10::integer,
    3::smallint,
    10::smallint,
    false,
    2::smallint,
    'manual'::text,
    now()-interval '1 minute',
    null,
    null,
    array[25::numeric,10::numeric],
    false
  );

  perform public.admin_publish_lottery_event(v_event);

  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_player,'role','authenticated')::text,true);

  select ticket_id,new_balance,duplicate
  into v_ticket1,v_balance1,v_dup1
  from public.purchase_event_ticket_idempotent(
    v_event,array[1,2,3]::integer[],null::integer,v_nonce
  );

  select ticket_id,new_balance,duplicate
  into v_ticket2,v_balance2,v_dup2
  from public.purchase_event_ticket_idempotent(
    v_event,array[1,2,3]::integer[],null::integer,v_nonce
  );

  if v_ticket1 is null
     or v_ticket1<>v_ticket2
     or v_balance1<>90
     or v_balance2<>90
     or v_dup1
     or not v_dup2 then
    raise exception 'Phase 7F idempotent replay contract failed';
  end if;

  if (select count(*) from public.event_tickets where event_id=v_event and user_id=v_player)<>1 then
    raise exception 'Phase 7F replay inserted more than one ticket';
  end if;

  if (select count(*) from public.balance_ledger where ticket_id=v_ticket1 and entry_type='ticket_purchase')<>1 then
    raise exception 'Phase 7F replay inserted more than one ticket debit';
  end if;

  if (select count(*) from private.ticket_purchase_idempotency where user_id=v_player and client_nonce=v_nonce)<>1 then
    raise exception 'Phase 7F idempotency mapping missing';
  end if;

  v_denied:=false;
  begin
    perform * from public.purchase_event_ticket_idempotent(
      v_event,array[1,2,4]::integer[],null::integer,v_nonce
    );
  exception when others then
    if sqlerrm not like 'Idempotency key already used%' then raise; end if;
    v_denied:=true;
  end;
  if not v_denied then
    raise exception 'Phase 7F allowed nonce reuse with a different payload';
  end if;

  select balance into v_before from public.profiles where id=v_player;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_admin,'role','authenticated')::text,true);
  perform public.admin_set_mutation_guardrails(
    false,true,true,true,true,true,true,'Phase 7F rollback emergency stop'
  );

  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_player,'role','authenticated')::text,true);

  v_denied:=false;
  begin
    perform * from public.purchase_event_ticket(
      v_event,array[4,5,6]::integer[],null::integer
    );
  exception when others then
    if sqlerrm not like 'User mutations are temporarily unavailable%' then raise; end if;
    v_denied:=true;
  end;

  if not v_denied then
    raise exception 'Phase 7F emergency master guard failed';
  end if;

  select balance into v_after from public.profiles where id=v_player;
  if v_after<>v_before then
    raise exception 'Phase 7F blocked mutation changed balance: before %, after %',v_before,v_after;
  end if;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_admin,'role','authenticated')::text,true);
  perform public.admin_set_mutation_guardrails(
    true,true,true,true,true,true,true,'Phase 7F rollback emergency restore'
  );

  v_guard:=public.admin_get_mutation_guardrails();
  if not coalesce((v_guard->>'master_enabled')::boolean,false) then
    raise exception 'Phase 7F guardrail state failed to restore';
  end if;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_player,'role','authenticated')::text,true);
  v_denied:=false;
  begin
    perform public.admin_get_mutation_guardrails();
  exception when others then
    if sqlerrm not like 'Admin access required%' then raise; end if;
    v_denied:=true;
  end;
  if not v_denied then
    raise exception 'Phase 7F non-admin guardrail read was accepted';
  end if;

  execute 'reset role';

  insert into private.mutation_rate_limit_windows(user_id,bucket,window_epoch,request_count,updated_at)
  values(v_player,'phase7f-old-fixture',1,1,now()-interval '3 days')
  on conflict(user_id,bucket,window_epoch) do update
  set updated_at=excluded.updated_at;

  v_prune:=private.prune_operational_history();

  if exists(
    select 1 from private.mutation_rate_limit_windows
    where user_id=v_player and bucket='phase7f-old-fixture'
  ) then
    raise exception 'Phase 7F rate-limit retention did not prune old windows';
  end if;

  if coalesce((v_prune->>'rate_limit_retention_days')::integer,0)<>2 then
    raise exception 'Phase 7F rate-limit retention contract drifted: %',v_prune;
  end if;
end
$phase7f_runtime$;

rollback;
