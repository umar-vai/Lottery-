-- Phase 5 production-readiness runtime contract.
-- Runs entirely inside a transaction and rolls back all mutations.

begin;

do $phase5_security_surface$
declare
  bad_count integer;
begin
  select count(*) into bad_count
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where p.prosecdef
    and n.nspname in ('public','private')
    and not coalesce(array_to_string(p.proconfig,','),'') ilike '%search_path%';

  if bad_count<>0 then
    raise exception 'SECURITY DEFINER function missing explicit search_path: %',bad_count;
  end if;

  if exists (
    select 1
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where p.prosecdef
      and n.nspname='private'
      and has_function_privilege('anon',p.oid,'EXECUTE')
  ) then
    raise exception 'Anon can execute a private SECURITY DEFINER function';
  end if;

  select count(*) into bad_count
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where p.prosecdef
    and n.nspname='private'
    and has_function_privilege('authenticated',p.oid,'EXECUTE')
    and not (
      p.proname='review_credit_request'
      and pg_get_function_identity_arguments(p.oid)='p_request_id uuid, p_approve boolean, p_note text'
    );

  if bad_count<>0 then
    raise exception 'Unexpected authenticated private SECURITY DEFINER exposure: %',bad_count;
  end if;
end
$phase5_security_surface$;

do $phase5_e2e$
declare
  v_admin uuid;
  v_player uuid;
  v_event uuid;
  v_ticket uuid;
  v_new_balance numeric;
  v_final_balance numeric;
  v_review jsonb;
  v_rejected boolean;
  v_purchase_rows integer;
  v_prize_rows integer;
begin
  select id into v_admin from public.profiles where role='admin' order by created_at limit 1;
  select id into v_player from public.profiles where role<>'admin' order by created_at limit 1;

  if v_admin is null or v_player is null then
    raise exception 'Phase 5 E2E requires one admin and one non-admin profile';
  end if;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_admin,'role','authenticated')::text,true);
  perform set_config('request.headers',jsonb_build_object('x-admin-reason','Phase 5 rollback-only E2E')::text,true);
  execute 'set local role authenticated';

  -- Direct publication at create time must be rejected.
  v_rejected:=false;
  begin
    perform public.admin_create_lottery_event_v3(
      'Phase 5 bypass probe'::text,
      ('phase5-bypass-'||substring(replace(gen_random_uuid()::text,'-','') from 1 for 12))::text,
      'Rollback-only bypass probe'::text,
      10::numeric,5::integer,10::integer,10::integer,3::smallint,10::smallint,false,1::smallint,'manual'::text,
      (now()-interval '1 minute')::timestamptz,null::timestamptz,null::timestamptz,array[25::numeric],true
    );
  exception when others then
    if sqlerrm not like 'Direct publish is disabled.%' then raise; end if;
    v_rejected:=true;
  end;
  if not v_rejected then
    raise exception 'Direct create-and-publish bypass was accepted';
  end if;

  perform public.admin_set_user_balance(v_player,100::numeric,'Phase 5 rollback-only E2E starting balance');

  v_event:=public.admin_create_lottery_event_v3(
    'Phase 5 E2E'::text,
    ('phase5-e2e-'||substring(replace(gen_random_uuid()::text,'-','') from 1 for 12))::text,
    'Rollback-only production E2E'::text,
    10::numeric,5::integer,10::integer,10::integer,3::smallint,10::smallint,false,1::smallint,'manual'::text,
    (now()-interval '1 minute')::timestamptz,null::timestamptz,null::timestamptz,array[25::numeric],false
  );

  -- Draft -> published must not be reachable through the generic update RPC.
  v_rejected:=false;
  begin
    perform public.admin_update_lottery_event_v3(
      v_event,'Phase 5 E2E','phase5-e2e-update-probe','Rollback-only production E2E',
      10::numeric,5,10,10,3::smallint,10::smallint,false,1::smallint,'manual',
      now()-interval '1 minute',null,null,array[25::numeric],'published'
    );
  exception when others then
    if sqlerrm not like 'Direct draft-to-published update is disabled.%' then raise; end if;
    v_rejected:=true;
  end;
  if not v_rejected then
    raise exception 'Direct draft-to-published update bypass was accepted';
  end if;

  v_review:=public.admin_get_event_lifecycle_review(v_event);
  if not coalesce((v_review->'publish'->>'ready')::boolean,false) then
    raise exception 'Phase 5 E2E publish readiness failed: %',v_review;
  end if;

  perform public.admin_publish_lottery_event(v_event);

  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_player,'role','authenticated')::text,true);
  select ticket_id,new_balance into v_ticket,v_new_balance
  from public.purchase_event_ticket(v_event,array[1,2,3]::integer[],null::integer);

  if v_ticket is null or v_new_balance<>90 then
    raise exception 'Phase 5 E2E purchase mismatch: ticket %, balance %',v_ticket,v_new_balance;
  end if;

  -- Invalid duplicate-number ticket must be rejected.
  v_rejected:=false;
  begin
    perform * from public.purchase_event_ticket(v_event,array[1,1,2]::integer[],null::integer);
  exception when others then
    v_rejected:=true;
  end;
  if not v_rejected then
    raise exception 'Invalid duplicate-number ticket was accepted';
  end if;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_admin,'role','authenticated')::text,true);

  -- Prize promises become immutable once a ticket exists.
  v_rejected:=false;
  begin
    perform public.admin_update_lottery_event_v3(
      v_event,'Phase 5 E2E',(select slug from public.lottery_events where id=v_event),'Rollback-only production E2E',
      10::numeric,5,10,10,3::smallint,10::smallint,false,1::smallint,'manual',
      now()-interval '1 minute',null,null,array[30::numeric],'published'
    );
  exception when others then
    if sqlerrm not like 'Winner prize tiers are locked after the first ticket is sold%' then raise; end if;
    v_rejected:=true;
  end;
  if not v_rejected then
    raise exception 'Prize tiers changed after ticket sale';
  end if;

  v_review:=public.admin_get_event_lifecycle_review(v_event);
  if not coalesce((v_review->'draw'->>'ready')::boolean,false) then
    raise exception 'Phase 5 E2E draw readiness failed: %',v_review;
  end if;

  perform public.admin_run_lottery_event(v_event);
  perform public.admin_run_lottery_event(v_event);

  if (select status from public.lottery_events where id=v_event)<>'completed' then
    raise exception 'Phase 5 E2E event did not complete';
  end if;

  select count(*) into v_purchase_rows
  from public.balance_ledger
  where event_id=v_event and ticket_id=v_ticket and entry_type='ticket_purchase' and amount=-10;

  select count(*) into v_prize_rows
  from public.balance_ledger
  where event_id=v_event and ticket_id=v_ticket and entry_type='prize_credit' and amount=25;

  select balance into v_final_balance from public.profiles where id=v_player;

  if v_purchase_rows<>1 or v_prize_rows<>1 or v_final_balance<>115 then
    raise exception 'Phase 5 E2E ledger/balance mismatch purchase %, prize %, balance %',
      v_purchase_rows,v_prize_rows,v_final_balance;
  end if;

  v_review:=public.admin_get_event_lifecycle_review(v_event);
  if not coalesce((v_review->'post_draw'->>'ready')::boolean,false) then
    raise exception 'Phase 5 E2E post-draw integrity failed: %',v_review;
  end if;

  execute 'reset role';
end
$phase5_e2e$;

do $phase5_support_integrity$
begin
  if exists (
    select transaction_id
    from public.support_point_claims
    group by transaction_id
    having count(*)>1
  ) then
    raise exception 'Support transaction settled more than once';
  end if;

  if exists (
    select 1
    from public.support_point_claims c
    left join public.support_transactions t on t.id=c.transaction_id
    where t.id is null
  ) then
    raise exception 'Orphan support claim detected';
  end if;
end
$phase5_support_integrity$;

rollback;
