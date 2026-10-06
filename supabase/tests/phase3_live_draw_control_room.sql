-- Phase 3 Control Room authorization and payload contract.
begin;

do $phase3_control_room$
declare
  v_admin uuid;
  r jsonb;
begin
  if has_function_privilege('anon','public.admin_get_live_draw_control_room()','EXECUTE') then
    raise exception 'Anon can execute live draw control room';
  end if;
  if not has_function_privilege('authenticated','public.admin_get_live_draw_control_room()','EXECUTE') then
    raise exception 'Authenticated EXECUTE grant missing for live draw control room';
  end if;

  if position('public.is_admin()' in pg_get_functiondef('public.admin_get_live_draw_control_room()'::regprocedure))=0 then
    raise exception 'Live draw control room is missing is_admin authorization';
  end if;

  select id into v_admin from public.profiles where role='admin' limit 1;
  if v_admin is null then raise exception 'Phase 3 test requires an admin profile'; end if;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_admin,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  r:=public.admin_get_live_draw_control_room();
  execute 'reset role';

  if jsonb_typeof(r->'events')<>'array' then raise exception 'Control room events payload is not an array'; end if;
  if jsonb_typeof(r->'summary')<>'object' then raise exception 'Control room summary missing'; end if;
  if jsonb_typeof(r->'operational_health')<>'object' then raise exception 'Operational health missing'; end if;
  if jsonb_typeof(r->'credit_integrity')<>'object' then raise exception 'Credit integrity missing'; end if;
  if (r->'summary'->>'total_events')::integer <> (select count(*) from public.lottery_events) then
    raise exception 'Control room event count mismatch';
  end if;
end
$phase3_control_room$;

rollback;
