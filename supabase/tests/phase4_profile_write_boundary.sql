-- Phase 4: profile write-boundary regression contract.
begin;

do $phase4_profile_write_boundary$
begin
  if has_table_privilege('authenticated','public.profiles','UPDATE') then
    raise exception 'Authenticated role has direct profiles UPDATE privilege';
  end if;

  if exists (
    select 1
    from information_schema.column_privileges
    where table_schema='public'
      and table_name='profiles'
      and grantee='authenticated'
      and privilege_type='UPDATE'
  ) then
    raise exception 'Authenticated role has direct profiles column UPDATE privilege';
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname='public'
      and tablename='profiles'
      and cmd='UPDATE'
      and 'authenticated'=any(roles)
  ) then
    raise exception 'Authenticated profiles UPDATE RLS policy exists';
  end if;

  if has_function_privilege('anon','public.update_my_profile(text,text)','EXECUTE') then
    raise exception 'Anon can execute update_my_profile';
  end if;

  if not has_function_privilege('authenticated','public.update_my_profile(text,text)','EXECUTE') then
    raise exception 'Authenticated update_my_profile grant is missing';
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname='update_my_profile'
      and (
        p.prosrc ilike '%role=%'
        or p.prosrc ilike '%role =%'
        or p.prosrc ilike '%balance=%'
        or p.prosrc ilike '%balance =%'
      )
  ) then
    raise exception 'update_my_profile appears to mutate role or balance';
  end if;
end
$phase4_profile_write_boundary$;

rollback;
