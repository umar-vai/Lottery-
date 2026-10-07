\set ON_ERROR_STOP on

do $phase7e_restore_verify$
declare
  v_credit jsonb;
  v_health jsonb;
  v_private_auth_secdef bigint;
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.lottery_events') is null
     or to_regclass('public.event_tickets') is null
     or to_regclass('public.balance_ledger') is null
     or to_regclass('public.audit_logs') is null
     or to_regclass('public.support_transactions') is null
     or to_regclass('public.support_claim_requests') is null
     or to_regclass('public.support_point_claims') is null then
    raise exception 'Critical Lootera tables are missing after restore';
  end if;

  if to_regprocedure('private.draw_credit_integrity_report()') is null
     or to_regprocedure('private.lottery_operational_health_report()') is null
     or to_regprocedure('public.purchase_event_ticket(uuid,integer[],integer)') is null then
    raise exception 'Critical Lootera functions are missing after restore';
  end if;

  if exists(
    select 1
    from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'
      and c.relname in ('profiles','lottery_events','event_tickets','balance_ledger','audit_logs','support_transactions','support_claim_requests','support_point_claims')
      and c.relrowsecurity=false
  ) then
    raise exception 'A critical public table lost RLS after restore';
  end if;

  select count(*)
  into v_private_auth_secdef
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private'
    and p.prosecdef
    and has_function_privilege('authenticated',p.oid,'EXECUTE');

  if v_private_auth_secdef<>0 then
    raise exception 'Authenticated role can execute private SECURITY DEFINER functions after restore: %',v_private_auth_secdef;
  end if;

  v_credit:=private.draw_credit_integrity_report();
  if not coalesce((v_credit->>'ok')::boolean,false)
     or coalesce((v_credit->>'issue_total')::integer,0)<>0 then
    raise exception 'Draw Credit integrity failed after restore: %',v_credit;
  end if;

  v_health:=private.lottery_operational_health_report();
  if coalesce((v_health->'draws'->>'open_failure_incidents')::integer,0)<>0 then
    raise exception 'Open lottery failure incidents exist after restore: %',v_health;
  end if;

  if exists(select 1 from cron.job) then
    raise exception 'Restore rehearsal safety failed: cron jobs were not unscheduled';
  end if;

  if exists(
    select 1
    from private.production_alert_delivery_config
    where external_enabled
  ) then
    raise exception 'Restore rehearsal safety failed: external alerts remain enabled';
  end if;
end
$phase7e_restore_verify$;

select jsonb_build_object(
  'ok',true,
  'product','Lootera',
  'domain','lootera.win',
  'auth_users',(select count(*) from auth.users),
  'profiles',(select count(*) from public.profiles),
  'lottery_events',(select count(*) from public.lottery_events),
  'event_tickets',(select count(*) from public.event_tickets),
  'balance_ledger',(select count(*) from public.balance_ledger),
  'support_transactions',(select count(*) from public.support_transactions),
  'migration_rows',case
    when to_regclass('supabase_migrations.schema_migrations') is null then 0
    else (select count(*) from supabase_migrations.schema_migrations)
  end
) as phase7e_restore_verification;
