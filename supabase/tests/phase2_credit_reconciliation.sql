-- Phase 2 Draw Credit reconciliation invariants.
begin;

do $phase2_reconcile$
declare
  r jsonb;
begin
  r:=private.draw_credit_integrity_report();

  if not coalesce((r->>'ok')::boolean,false) then
    raise exception 'Draw Credit reconciliation failed: %',r;
  end if;

  if coalesce((r->>'issue_total')::bigint,-1)<>0 then
    raise exception 'Integrity report says ok but issue_total is not zero';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname='public'
      and tablename='balance_ledger'
      and indexname='balance_ledger_one_ticket_purchase_per_ticket_idx'
      and indexdef ilike '%unique%'
      and indexdef ilike '%ticket_purchase%'
  ) then
    raise exception 'Missing unique ticket-purchase ledger guard';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname='public'
      and tablename='event_tickets'
      and indexname='event_tickets_user_created_idx'
  ) then
    raise exception 'Missing event_tickets user lookup index';
  end if;

  if not exists (
    select 1 from cron.job
    where jobname='draw-credit-integrity-hourly'
      and active
      and command ilike '%run_draw_credit_integrity_check%'
  ) then
    raise exception 'Hourly Draw Credit integrity cron job is missing or inactive';
  end if;

  if has_function_privilege('anon','public.admin_get_draw_credit_integrity_report()','EXECUTE') then
    raise exception 'Anon must not execute admin integrity report';
  end if;

  if not has_function_privilege('authenticated','public.admin_get_draw_credit_integrity_report()','EXECUTE') then
    raise exception 'Authenticated role must be able to call admin integrity RPC before internal is_admin() authorization';
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private')
      and p.proname ilike '%support%'
      and p.prosrc ilike '%profiles%'
      and p.prosrc ilike '%balance%'
  ) then
    raise exception 'Support/Love Points function appears to write Draw Credit profile balances';
  end if;
end
$phase2_reconcile$;

rollback;
