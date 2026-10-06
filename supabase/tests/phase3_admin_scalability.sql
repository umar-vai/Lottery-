-- Phase 3 scalable admin paging runtime test.
begin;

do $phase3_scalability_contract$
declare
  f regprocedure;
  src text;
begin
  foreach f in array array[
    'public.admin_get_admin_scalability_snapshot()'::regprocedure,
    'public.admin_list_players_page(text,text,integer,timestamptz,uuid)'::regprocedure,
    'public.admin_list_tickets_page(uuid,text,integer,timestamptz,uuid)'::regprocedure,
    'public.admin_list_balance_ledger_page(uuid,text,text,integer,timestamptz,uuid)'::regprocedure,
    'public.admin_list_winner_events_page(integer,timestamptz,uuid)'::regprocedure
  ]
  loop
    if has_function_privilege('anon',f,'EXECUTE') then
      raise exception 'Anon can execute scalable admin RPC: %',f;
    end if;
    if not has_function_privilege('authenticated',f,'EXECUTE') then
      raise exception 'Authenticated EXECUTE grant missing: %',f;
    end if;
    src:=pg_get_functiondef(f);
    if position('public.is_admin()' in src)=0 then
      raise exception 'Scalable admin RPC missing is_admin guard: %',f;
    end if;
  end loop;
end
$phase3_scalability_contract$;

do $phase3_scalability_runtime$
declare
  v_admin uuid;
  v_nonadmin uuid;
  snapshot jsonb;
  p1 jsonb;
  p2 jsonb;
  t1 jsonb;
  t2 jsonb;
  l1 jsonb;
  l2 jsonb;
  w1 jsonb;
  c jsonb;
  blocked boolean:=false;
begin
  select id into v_admin from public.profiles where role='admin' order by created_at limit 1;
  select id into v_nonadmin from public.profiles where role<>'admin' order by created_at limit 1;
  if v_admin is null or v_nonadmin is null then raise exception 'Scalability test requires admin and non-admin'; end if;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_admin,'role','authenticated')::text,true);
  execute 'set local role authenticated';

  snapshot:=public.admin_get_admin_scalability_snapshot();

  if (snapshot->'summary'->>'tickets')::bigint<>(select count(*) from public.event_tickets)
     or (snapshot->'summary'->>'players')::bigint<>(select count(*) from public.profiles)
     or (snapshot->'summary'->>'ledger_rows')::bigint<>(select count(*) from public.balance_ledger)
     or (snapshot->'summary'->>'draw_credits')::numeric<>coalesce((select sum(balance) from public.profiles),0) then
    raise exception 'Scalability snapshot totals do not match authoritative tables';
  end if;

  if jsonb_typeof(snapshot->'event_stats')<>'object'
     or jsonb_typeof(snapshot->'actor_profiles')<>'array' then
    raise exception 'Scalability snapshot shape is incomplete';
  end if;

  p1:=public.admin_list_players_page(null,null,3,null,null);
  if jsonb_array_length(p1->'rows')>3 then raise exception 'Player page exceeded requested limit'; end if;
  if coalesce((p1->>'has_more')::boolean,false) then
    c:=p1->'next_cursor';
    p2:=public.admin_list_players_page(null,null,3,(c->>'created_at')::timestamptz,(c->>'id')::uuid);
    if exists(
      select 1
      from jsonb_array_elements(p1->'rows') a
      join jsonb_array_elements(p2->'rows') b on a->>'id'=b->>'id'
    ) then raise exception 'Player keyset pages overlap'; end if;
  end if;

  t1:=public.admin_list_tickets_page(null,null,2,null,null);
  if jsonb_array_length(t1->'rows')>2 then raise exception 'Ticket page exceeded requested limit'; end if;
  if coalesce((t1->>'has_more')::boolean,false) then
    c:=t1->'next_cursor';
    t2:=public.admin_list_tickets_page(null,null,2,(c->>'created_at')::timestamptz,(c->>'id')::uuid);
    if exists(
      select 1
      from jsonb_array_elements(t1->'rows') a
      join jsonb_array_elements(t2->'rows') b on a->>'id'=b->>'id'
    ) then raise exception 'Ticket keyset pages overlap'; end if;
  end if;

  l1:=public.admin_list_balance_ledger_page(null,null,null,10,null,null);
  if jsonb_array_length(l1->'rows')>10 then raise exception 'Ledger page exceeded requested limit'; end if;
  if coalesce((l1->>'has_more')::boolean,false) then
    c:=l1->'next_cursor';
    l2:=public.admin_list_balance_ledger_page(null,null,null,10,(c->>'created_at')::timestamptz,(c->>'id')::uuid);
    if exists(
      select 1
      from jsonb_array_elements(l1->'rows') a
      join jsonb_array_elements(l2->'rows') b on a->>'id'=b->>'id'
    ) then raise exception 'Ledger keyset pages overlap'; end if;
  end if;

  w1:=public.admin_list_winner_events_page(2,null,null);
  if jsonb_array_length(w1->'rows')>2 then raise exception 'Winner event page exceeded requested limit'; end if;

  execute 'reset role';

  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_nonadmin,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  begin
    perform public.admin_list_players_page(null,null,10,null,null);
  exception when others then
    if sqlerrm like '%Admin access required%' then blocked:=true; else raise; end if;
  end;
  if not blocked then raise exception 'Normal player could execute scalable admin paging'; end if;
  execute 'reset role';
end
$phase3_scalability_runtime$;

rollback;
