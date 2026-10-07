-- Phase 4 database/query performance + advisor hygiene contract.
begin;

do $phase4_performance_observability$
declare
  t text;
  f regprocedure;
  src text;
begin
  -- Service-only tables must remain RLS protected and explicitly deny browser roles.
  foreach t in array array[
    'draw_secrets',
    'platform_controls',
    'support_bridge_devices',
    'support_point_adjustments',
    'support_transactions'
  ]
  loop
    if not exists (
      select 1
      from pg_policies p
      where p.schemaname='public'
        and p.tablename=t
        and p.policyname='service_only_deny_all'
        and p.cmd='ALL'
        and 'anon'=any(p.roles)
        and 'authenticated'=any(p.roles)
        and p.qual='false'
        and p.with_check='false'
    ) then
      raise exception 'Missing explicit service-only deny policy on %',t;
    end if;
  end loop;

  -- Deprecated admin RPC generations must no longer be browser-executable.
  foreach f in array array[
    'public.admin_create_lottery_event(text,text,text,numeric,numeric,text,integer,smallint,smallint,boolean,smallint,timestamptz,timestamptz,timestamptz,boolean)'::regprocedure,
    'public.admin_create_lottery_event_v2(text,text,text,numeric,integer,smallint,smallint,boolean,smallint,text,timestamptz,timestamptz,timestamptz,numeric[],boolean)'::regprocedure,
    'public.admin_update_lottery_event(uuid,text,text,text,numeric,numeric,text,integer,smallint,smallint,boolean,smallint,timestamptz,timestamptz,timestamptz,text)'::regprocedure,
    'public.admin_update_lottery_event_v2(uuid,text,text,text,numeric,integer,smallint,smallint,boolean,smallint,text,timestamptz,timestamptz,timestamptz,numeric[],text)'::regprocedure,
    'public.admin_get_admin_change_audit(integer)'::regprocedure
  ]
  loop
    if has_function_privilege('anon',f,'EXECUTE')
       or has_function_privilege('authenticated',f,'EXECUTE') then
      raise exception 'Deprecated RPC remains browser-executable: %',f;
    end if;
  end loop;

  -- Canonical replacements must remain browser-callable only after internal admin checks.
  foreach f in array array[
    'public.admin_create_lottery_event_v3(text,text,text,numeric,integer,integer,integer,smallint,smallint,boolean,smallint,text,timestamptz,timestamptz,timestamptz,numeric[],boolean)'::regprocedure,
    'public.admin_update_lottery_event_v3(uuid,text,text,text,numeric,integer,integer,integer,smallint,smallint,boolean,smallint,text,timestamptz,timestamptz,timestamptz,numeric[],text)'::regprocedure,
    'public.admin_list_admin_changes_page(text,text,integer,timestamptz,bigint)'::regprocedure
  ]
  loop
    if has_function_privilege('anon',f,'EXECUTE') then
      raise exception 'Anon can execute protected canonical RPC: %',f;
    end if;
    if not has_function_privilege('authenticated',f,'EXECUTE') then
      raise exception 'Authenticated canonical RPC grant missing: %',f;
    end if;
  end loop;

  -- Pagination functions must stay keyset-based; OFFSET would recreate the Phase 3 hotspot.
  foreach f in array array[
    'public.admin_list_players_page(text,text,integer,timestamptz,uuid)'::regprocedure,
    'public.admin_list_tickets_page(uuid,text,integer,timestamptz,uuid)'::regprocedure,
    'public.admin_list_balance_ledger_page(uuid,text,text,integer,timestamptz,uuid)'::regprocedure,
    'public.admin_list_lottery_events_page(text,text,integer,timestamptz,uuid)'::regprocedure,
    'public.admin_list_audit_logs_page(text,text,integer,timestamptz,bigint)'::regprocedure,
    'public.admin_list_admin_changes_page(text,text,integer,timestamptz,bigint)'::regprocedure,
    'public.admin_list_support_wallets_page(text,integer,timestamptz,uuid)'::regprocedure,
    'public.admin_list_support_transactions_page(text,text,integer,timestamptz,uuid)'::regprocedure,
    'public.admin_list_support_devices_page(integer,timestamptz,uuid)'::regprocedure
  ]
  loop
    select p.prosrc into src from pg_proc p where p.oid=f::oid;
    if src ~* '[[:space:]]offset[[:space:]]' then
      raise exception 'Keyset pagination RPC contains OFFSET: %',f;
    end if;
  end loop;

  -- The high-volume ledger path requires the composite cursor index verified in production.
  if not exists (
    select 1
    from pg_indexes
    where schemaname='public'
      and tablename='balance_ledger'
      and indexname='balance_ledger_created_id_idx'
      and indexdef ilike '%created_at DESC%id DESC%'
  ) then
    raise exception 'Ledger keyset cursor index is missing';
  end if;
end
$phase4_performance_observability$;

rollback;
