-- Phase 3 remaining admin scalability runtime contract.
begin;

do $contract$
declare f regprocedure; src text;
begin
  foreach f in array array[
    'public.admin_get_admin_base_focus()'::regprocedure,
    'public.admin_get_lottery_event_detail(uuid)'::regprocedure,
    'public.admin_list_lottery_events_page(text,text,integer,timestamptz,uuid)'::regprocedure,
    'public.admin_list_audit_logs_page(text,text,integer,timestamptz,bigint)'::regprocedure,
    'public.admin_list_admin_changes_page(text,text,integer,timestamptz,bigint)'::regprocedure,
    'public.admin_get_support_operations_summary()'::regprocedure,
    'public.admin_list_support_wallets_page(text,integer,timestamptz,uuid)'::regprocedure,
    'public.admin_list_support_transactions_page(text,text,integer,timestamptz,uuid)'::regprocedure,
    'public.admin_list_support_devices_page(integer,timestamptz,uuid)'::regprocedure
  ]
  loop
    if has_function_privilege('anon',f,'EXECUTE') then raise exception 'Anon can execute remaining scalability RPC: %',f; end if;
    if not has_function_privilege('authenticated',f,'EXECUTE') then raise exception 'Authenticated grant missing: %',f; end if;
    src:=pg_get_functiondef(f);
    if position('public.is_admin()' in src)=0 then raise exception 'Admin guard missing: %',f; end if;
  end loop;
end
$contract$;

do $runtime$
declare
  v_admin uuid; v_player uuid; blocked boolean:=false;
  v_profile_count bigint; v_support_tx_count bigint;
  a jsonb;b jsonb;c jsonb;p1 jsonb;p2 jsonb;
begin
  select id into v_admin from public.profiles where role='admin' order by created_at limit 1;
  select id into v_player from public.profiles where role<>'admin' order by created_at limit 1;
  if v_admin is null or v_player is null then raise exception 'Need admin and player'; end if;
  select count(*) into v_profile_count from public.profiles;
  select count(*) into v_support_tx_count from public.support_transactions;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_admin,'role','authenticated')::text,true);
  execute 'set local role authenticated';

  a:=public.admin_get_admin_base_focus();
  if jsonb_typeof(a->'recent_audit')<>'array' then raise exception 'Base focus recent audit missing'; end if;

  p1:=public.admin_list_lottery_events_page(null,null,2,null,null);
  if jsonb_array_length(p1->'rows')>2 then raise exception 'Lottery page exceeded limit'; end if;
  if jsonb_array_length(p1->'rows')>0 and jsonb_typeof((p1->'rows')->0->'prizes')<>'array' then raise exception 'Lottery page missing prize tiers'; end if;
  if coalesce((p1->>'has_more')::boolean,false) then
    c:=p1->'next_cursor';
    p2:=public.admin_list_lottery_events_page(null,null,2,(c->>'created_at')::timestamptz,(c->>'id')::uuid);
    if exists(select 1 from jsonb_array_elements(p1->'rows') x join jsonb_array_elements(p2->'rows') y on x->>'id'=y->>'id') then raise exception 'Lottery keyset pages overlap'; end if;
  end if;

  p1:=public.admin_list_audit_logs_page(null,null,10,null,null);
  if jsonb_array_length(p1->'rows')>10 then raise exception 'Audit page exceeded limit'; end if;
  if coalesce((p1->>'has_more')::boolean,false) then
    c:=p1->'next_cursor';
    p2:=public.admin_list_audit_logs_page(null,null,10,(c->>'created_at')::timestamptz,(c->>'id')::bigint);
    if exists(select 1 from jsonb_array_elements(p1->'rows') x join jsonb_array_elements(p2->'rows') y on x->>'id'=y->>'id') then raise exception 'Audit keyset pages overlap'; end if;
  end if;

  p1:=public.admin_list_admin_changes_page(null,null,5,null,null);
  if jsonb_array_length(p1->'rows')>5 then raise exception 'Admin change page exceeded limit'; end if;

  a:=public.admin_get_support_operations_summary();
  if (a->>'players_total')::bigint<>v_profile_count
     or (a->>'transfers_total')::bigint<>v_support_tx_count then
    raise exception 'Support summary totals mismatch';
  end if;

  p1:=public.admin_list_support_wallets_page(null,3,null,null);
  if jsonb_array_length(p1->'rows')>3 then raise exception 'Support wallet page exceeded limit'; end if;
  if coalesce((p1->>'has_more')::boolean,false) then
    c:=p1->'next_cursor';
    p2:=public.admin_list_support_wallets_page(null,3,(c->>'created_at')::timestamptz,(c->>'user_id')::uuid);
    if exists(select 1 from jsonb_array_elements(p1->'rows') x join jsonb_array_elements(p2->'rows') y on x->>'user_id'=y->>'user_id') then raise exception 'Support wallet keyset pages overlap'; end if;
  end if;

  p1:=public.admin_list_support_transactions_page(null,null,2,null,null);
  if jsonb_array_length(p1->'rows')>2 then raise exception 'Support transaction page exceeded limit'; end if;
  if p1::text ~* 'sender_hash|sms_fingerprint|token_hash' then raise exception 'Sensitive support fields leaked'; end if;

  p1:=public.admin_list_support_devices_page(2,null,null);
  if jsonb_array_length(p1->'rows')>2 then raise exception 'Support device page exceeded limit'; end if;
  if p1::text ~* 'token_hash' then raise exception 'Device token hash leaked'; end if;

  execute 'reset role';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_player,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  begin
    perform public.admin_list_audit_logs_page(null,null,10,null,null);
  exception when others then
    if sqlerrm like '%Admin access required%' then blocked:=true; else raise; end if;
  end;
  if not blocked then raise exception 'Normal player could execute remaining admin scalability RPC'; end if;
  execute 'reset role';
end
$runtime$;

rollback;
