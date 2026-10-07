-- Phase 6 privileged credit-review boundary contract.
-- Rollback-only: creates temporary request fixtures and leaves production unchanged.

begin;

do $phase6_credit_review_boundary$
declare
  v_admin uuid;
  v_player uuid;
  v_req uuid:=gen_random_uuid();
  v_req2 uuid:=gen_random_uuid();
  v_before numeric;
  v_after numeric;
  v_status text;
  v_denied boolean:=false;
  v_public_oid oid;
  v_private_oid oid;
begin
  select p.oid into v_public_oid
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='admin_review_credit_request'
    and pg_get_function_identity_arguments(p.oid)='p_request_id uuid, p_approve boolean, p_note text';

  select p.oid into v_private_oid
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private' and p.proname='review_credit_request'
    and pg_get_function_identity_arguments(p.oid)='p_request_id uuid, p_approve boolean, p_note text';

  if v_public_oid is null or v_private_oid is null then
    raise exception 'Credit review functions missing';
  end if;

  if not (select prosecdef from pg_proc where oid=v_public_oid) then
    raise exception 'Public credit review wrapper must be SECURITY DEFINER';
  end if;

  if not coalesce((select array_to_string(proconfig,',') from pg_proc where oid=v_public_oid),'') ilike '%search_path%' then
    raise exception 'Public credit review wrapper missing explicit search_path';
  end if;

  if has_function_privilege('anon',v_public_oid,'EXECUTE') then
    raise exception 'Anon can execute public credit review wrapper';
  end if;

  if not has_function_privilege('authenticated',v_public_oid,'EXECUTE') then
    raise exception 'Authenticated cannot execute public credit review wrapper';
  end if;

  if has_function_privilege('anon',v_private_oid,'EXECUTE')
     or has_function_privilege('authenticated',v_private_oid,'EXECUTE')
     or has_function_privilege('service_role',v_private_oid,'EXECUTE') then
    raise exception 'Private credit review helper remains directly executable';
  end if;

  select id into v_admin from public.profiles where role='admin' order by created_at limit 1;
  select id,balance into v_player,v_before from public.profiles where role<>'admin' order by created_at limit 1;
  if v_admin is null or v_player is null then raise exception 'Need admin and player'; end if;

  insert into public.credit_requests(id,user_id,requested_credits,note,status)
  values(v_req,v_player,5,'Phase 6 rollback approval drill','pending');

  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_admin,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  perform public.admin_review_credit_request(v_req,true,'Phase 6 rollback approval');
  execute 'reset role';

  select status into v_status from public.credit_requests where id=v_req;
  select balance into v_after from public.profiles where id=v_player;

  if v_status<>'approved' or v_after<>v_before+5 then
    raise exception 'Admin credit-review wrapper failed approval/balance contract';
  end if;

  if (
    select count(*)
    from public.balance_ledger
    where user_id=v_player
      and entry_type='admin_adjustment'
      and actor_user_id=v_admin
      and note='Phase 6 rollback approval'
  )<>1 then
    raise exception 'Admin credit-review wrapper did not create exactly one ledger row';
  end if;

  insert into public.credit_requests(id,user_id,requested_credits,note,status)
  values(v_req2,v_player,7,'Phase 6 rollback denial drill','pending');

  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_player,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  begin
    perform public.admin_review_credit_request(v_req2,false,'Should be denied');
  exception when others then
    if sqlerrm not like 'Admin access required%' then raise; end if;
    v_denied:=true;
  end;
  execute 'reset role';

  if not v_denied then
    raise exception 'Non-admin was able to review a credit request';
  end if;
end
$phase6_credit_review_boundary$;

rollback;
