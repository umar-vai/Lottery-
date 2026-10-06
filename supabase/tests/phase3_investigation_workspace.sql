-- Phase 3 investigation workspace runtime and authorization test.
begin;

do $phase3_investigation_contract$
declare
  f regprocedure;
  src text;
begin
  foreach f in array array[
    'public.admin_search_investigation_subjects(text,integer)'::regprocedure,
    'public.admin_get_player_investigation(uuid)'::regprocedure,
    'public.admin_get_ticket_investigation(uuid)'::regprocedure
  ]
  loop
    if has_function_privilege('anon',f,'EXECUTE') then
      raise exception 'Anon can execute investigation RPC: %',f;
    end if;
    if not has_function_privilege('authenticated',f,'EXECUTE') then
      raise exception 'Authenticated EXECUTE grant missing: %',f;
    end if;
    src:=pg_get_functiondef(f);
    if position('public.is_admin()' in src)=0 then
      raise exception 'Investigation RPC missing is_admin guard: %',f;
    end if;
  end loop;

  if has_function_privilege('authenticated','private.admin_player_investigation_report(uuid)'::regprocedure,'EXECUTE') then
    raise exception 'Authenticated can execute private investigation helper';
  end if;
end
$phase3_investigation_contract$;

do $phase3_investigation_runtime$
declare
  v_admin uuid;
  v_player uuid;
  v_nonadmin uuid;
  v_ticket uuid;
  v_email text;
  r jsonb;
  s jsonb;
  t jsonb;
  blocked boolean:=false;
begin
  select id into v_admin from public.profiles where role='admin' order by created_at limit 1;
  select id,email into v_player,v_email
  from public.profiles
  order by (select count(*) from public.event_tickets et where et.user_id=profiles.id) desc,created_at
  limit 1;
  select id into v_nonadmin from public.profiles where role<>'admin' order by created_at limit 1;
  select id into v_ticket from public.event_tickets where user_id=v_player order by created_at desc limit 1;

  if v_admin is null or v_player is null or v_nonadmin is null or v_ticket is null then
    raise exception 'Investigation test requires admin, normal player and at least one ticket';
  end if;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_admin,'role','authenticated')::text,true);
  execute 'set local role authenticated';

  s:=public.admin_search_investigation_subjects(coalesce(v_email,v_player::text),25);
  if jsonb_typeof(s->'subjects')<>'array' or jsonb_array_length(s->'subjects')<1 then
    raise exception 'Investigation search did not return a known player';
  end if;

  r:=public.admin_get_player_investigation(v_player);
  if r->'profile'->>'id'<>v_player::text then
    raise exception 'Player investigation returned the wrong subject';
  end if;
  if not (r ? 'draw_credits') or not (r ? 'support_points') or not coalesce((r->'support_points'->>'separate_from_draw_credits')::boolean,false) then
    raise exception 'Investigation report did not keep Draw Credits and Support Points separate';
  end if;
  if jsonb_typeof(r->'tickets')<>'array' or jsonb_typeof(r->'ledger')<>'array' or jsonb_typeof(r->'review'->'signals')<>'array' then
    raise exception 'Investigation report arrays are incomplete';
  end if;

  if coalesce((public.admin_get_draw_credit_integrity_report()->>'ok')::boolean,false)
     and not coalesce((r->'draw_credits'->>'accounting_ok')::boolean,false) then
    raise exception 'Per-player accounting report disagrees with globally clean Draw Credit integrity';
  end if;

  t:=public.admin_get_ticket_investigation(v_ticket);
  if t->'ticket'->>'id'<>v_ticket::text then
    raise exception 'Ticket investigation returned the wrong ticket';
  end if;
  if not coalesce((t->'checks'->0->>'ok')::boolean,false)
     or not coalesce((t->'checks'->2->>'ok')::boolean,false) then
    raise exception 'Known ticket failed number or purchase-ledger investigation checks';
  end if;

  execute 'reset role';

  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_nonadmin,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  begin
    perform public.admin_get_player_investigation(v_player);
  exception when others then
    if sqlerrm like '%Admin access required%' then blocked:=true; else raise; end if;
  end;
  if not blocked then
    raise exception 'Normal player could execute admin player investigation';
  end if;
  execute 'reset role';
end
$phase3_investigation_runtime$;

rollback;
