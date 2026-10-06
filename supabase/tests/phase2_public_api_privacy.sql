-- Phase 2 public API/privacy minimization invariants.
begin;

do $phase2_privacy$
declare
  f record;
  completed_event uuid;
  payload jsonb;
begin
  -- Only the two intentional read-only SECURITY DEFINER endpoints may be anonymous.
  for f in
    select p.proname,pg_get_function_identity_arguments(p.oid) args
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.prosecdef
      and has_function_privilege('anon',p.oid,'EXECUTE')
      and p.proname not in ('get_platform_features','get_public_event_winners')
  loop
    raise exception 'Unexpected anon SECURITY DEFINER endpoint: %.%(%)','public',f.proname,f.args;
  end loop;

  if has_function_privilege('anon','public.prevent_locked_ticket_delete()','EXECUTE')
     or has_function_privilege('authenticated','public.prevent_locked_ticket_delete()','EXECUTE')
     or has_function_privilege('anon','public.validate_ticket()','EXECUTE')
     or has_function_privilege('authenticated','public.validate_ticket()','EXECUTE') then
    raise exception 'Trigger-only functions remain executable through browser roles';
  end if;

  if not has_function_privilege('anon','public.get_public_event_winners(uuid)','EXECUTE')
     or not has_function_privilege('authenticated','public.get_public_event_winners(uuid)','EXECUTE') then
    raise exception 'Public winner RPC grants are missing';
  end if;

  if exists (
    select 1
    from information_schema.parameters
    where specific_schema='public'
      and specific_name like 'get_public_event_winners_%'
      and parameter_mode='OUT'
      and parameter_name in ('user_id','ticket_id','avatar_url','email','role','balance','referral_code')
  ) then
    raise exception 'Public winner RPC exposes a sensitive/internal output field';
  end if;

  if exists (
    select 1
    from information_schema.column_privileges
    where table_schema='public'
      and table_name='lottery_events'
      and grantee in ('anon','authenticated')
      and column_name='created_by'
      and privilege_type='SELECT'
  ) then
    raise exception 'Internal lottery_events.created_by is public-readable';
  end if;

  select id into completed_event
  from public.lottery_events
  where status='completed'
  order by completed_at desc nulls last
  limit 1;

  if completed_event is not null then
    perform set_config('request.jwt.claims','{"role":"anon"}',true);
    execute 'set local role anon';

    select coalesce(jsonb_agg(to_jsonb(w)),'[]'::jsonb)
      into payload
    from public.get_public_event_winners(completed_event) w;

    if payload::text ~* '"(user_id|ticket_id|avatar_url|email|role|balance|referral_code)"\s*:' then
      raise exception 'Anon winner payload contains a sensitive/internal key';
    end if;

    if payload::text ~* '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}' then
      raise exception 'Anon winner payload contains a raw UUID';
    end if;

    execute 'reset role';
  end if;
end
$phase2_privacy$;

rollback;
