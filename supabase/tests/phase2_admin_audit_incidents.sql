-- Phase 2 canonical admin audit and incident-center runtime test.
begin;

do $phase2_admin_audit$
declare
  v_admin uuid;
  v_target uuid;
  v_before_role text;
  v_audit private.admin_change_audit%rowtype;
  v_incidents jsonb;
  v_changes jsonb;
begin
  select id into v_admin
  from public.profiles
  where role='admin'
  order by created_at
  limit 1;

  select id,role into v_target,v_before_role
  from public.profiles
  order by case when id=v_admin then 1 else 0 end,created_at
  limit 1;

  if v_admin is null or v_target is null then
    raise exception 'Phase 2 admin audit test requires profiles';
  end if;

  perform set_config('request.jwt.claim.sub',v_admin::text,true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub',v_admin::text,'role','authenticated')::text,
    true
  );
  perform set_config('request.path','rpc/admin_set_user_role',true);
  perform set_config(
    'request.headers',
    jsonb_build_object(
      'x-admin-reason','Phase 2 audit runtime test',
      'x-forwarded-for','127.0.0.1',
      'user-agent','phase2-test'
    )::text,
    true
  );

  update public.profiles
  set role=role
  where id=v_target;

  select * into v_audit
  from private.admin_change_audit
  where actor_user_id=v_admin
    and table_name='profiles'
    and row_id=v_target::text
  order by id desc
  limit 1;

  if v_audit.id is null
     or v_audit.action<>'admin_set_user_role'
     or v_audit.reason<>'Phase 2 audit runtime test'
     or v_audit.old_data is null
     or v_audit.new_data is null then
    raise exception 'Canonical admin audit did not capture actor/before/after/reason';
  end if;

  if has_table_privilege('authenticated','private.admin_change_audit','SELECT')
     or has_table_privilege('anon','private.admin_change_audit','SELECT') then
    raise exception 'Canonical admin audit table is directly readable by browser roles';
  end if;

  if has_function_privilege('anon','public.admin_get_operations_incident_center()','EXECUTE')
     or has_function_privilege('anon','public.admin_list_admin_changes_page(text,text,integer,timestamptz,bigint)','EXECUTE') then
    raise exception 'Anon can execute admin incident/audit RPCs';
  end if;

  if not has_function_privilege('authenticated','public.admin_get_operations_incident_center()','EXECUTE')
     or not has_function_privilege('authenticated','public.admin_list_admin_changes_page(text,text,integer,timestamptz,bigint)','EXECUTE') then
    raise exception 'Authenticated canonical admin incident/audit RPC grants are missing';
  end if;

  if has_function_privilege('authenticated','public.admin_get_admin_change_audit(integer)','EXECUTE') then
    raise exception 'Deprecated unpaginated admin audit RPC is still browser-executable';
  end if;

  v_incidents:=public.admin_get_operations_incident_center();
  if v_incidents is null
     or not (v_incidents ? 'open_issue_count')
     or not (v_incidents ? 'recent_incidents')
     or not (v_incidents ? 'counts') then
    raise exception 'Incident Center report contract is incomplete';
  end if;

  v_changes:=public.admin_list_admin_changes_page(null,null,20,null,null);
  if v_changes is null
     or not (v_changes ? 'rows')
     or jsonb_array_length(v_changes->'rows')<1 then
    raise exception 'Canonical admin audit RPC returned no runtime-test row';
  end if;

  if not exists (
    select 1 from pg_trigger tg
    join pg_class c on c.oid=tg.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where not tg.tgisinternal
      and n.nspname='public'
      and c.relname='profiles'
      and tg.tgname='audit_admin_profiles'
  ) then
    raise exception 'Profiles canonical audit trigger is missing';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private'
      and p.proname='review_credit_request'
      and p.prosrc ilike '%is_admin%'
  ) then
    raise exception 'Credit review private implementation lost admin authorization';
  end if;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private'
      and p.proname='lottery_operational_health_report'
      and p.prosrc ilike '%status<>%succeeded%'
  ) then
    raise exception 'Operational health still counts in-flight cron rows as failures';
  end if;

end
$phase2_admin_audit$;

rollback;
