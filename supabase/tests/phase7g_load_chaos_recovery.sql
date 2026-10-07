-- Phase 7G retained-evidence and post-chaos recovery contract.
-- Read-only / rollback-only.

begin;

do $phase7g_runtime$
declare
  r jsonb;
  s jsonb;
  g jsonb;
  t jsonb;
  v_p95 numeric;
begin
  r:=private.phase7g_probe_summary('429d08d0-d992-4d8d-892b-71dc0f784eda'::uuid);

  if coalesce((r->>'total_requests')::integer,0)<>39
     or coalesce((r->>'failure_count')::integer,-1)<>0
     or coalesce((r->>'residue_count')::integer,-1)<>0 then
    raise exception 'Phase 7G evidence summary drifted: %',r;
  end if;

  if coalesce((r->'outcomes'->>'passed')::integer,0)<>25
     or coalesce((r->'outcomes'->>'allowed')::integer,0)<>5
     or coalesce((r->'outcomes'->>'rate_limited')::integer,0)<>7
     or coalesce((r->'outcomes'->>'released')::integer,0)<>1
     or coalesce((r->'outcomes'->>'lock_timeout')::integer,0)<>1 then
    raise exception 'Phase 7G outcome counts drifted: %',r->'outcomes';
  end if;

  select (x->>'p95_ms')::numeric
  into v_p95
  from jsonb_array_elements(r->'waves') x
  where x->>'wave'='ticket-12';

  if v_p95 is null or v_p95>=1000 then
    raise exception 'Phase 7G 12-way ticket p95 breached measured launch threshold: % ms',v_p95;
  end if;

  if exists(
    select 1 from private.mutation_rate_limit_windows
    where bucket like 'phase7g-%'
  ) then
    raise exception 'Synthetic Phase 7G rate-limit window residue exists';
  end if;

  if exists(
    select 1
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname like 'service_phase7g_%'
  ) then
    raise exception 'Phase 7G probe RPC remains in public schema';
  end if;

  if exists(
    select 1
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private'
      and p.proname like 'service_phase7g_%'
      and (
        has_function_privilege('anon',p.oid,'EXECUTE')
        or has_function_privilege('authenticated',p.oid,'EXECUTE')
        or has_function_privilege('service_role',p.oid,'EXECUTE')
      )
  ) then
    raise exception 'Retired Phase 7G private probe RPC has external execute privilege';
  end if;

  if has_table_privilege('anon','private.phase7g_probe_results','SELECT')
     or has_table_privilege('authenticated','private.phase7g_probe_results','SELECT')
     or has_table_privilege('service_role','private.phase7g_probe_results','SELECT') then
    raise exception 'Phase 7G evidence table is directly readable';
  end if;

  g:=private.mutation_guardrail_report();
  if not coalesce((g->>'master_enabled')::boolean,false)
     or not coalesce((g->>'ticket_purchases_enabled')::boolean,false)
     or not coalesce((g->>'game_writes_enabled')::boolean,false)
     or not coalesce((g->>'support_claims_enabled')::boolean,false)
     or not coalesce((g->>'credit_requests_enabled')::boolean,false)
     or not coalesce((g->>'referral_writes_enabled')::boolean,false)
     or not coalesce((g->>'payment_orders_enabled')::boolean,false) then
    raise exception 'Production mutation guardrails are not fully restored: %',g;
  end if;

  s:=private.production_slo_report();
  if coalesce((s->'cron'->>'missing_required_jobs')::integer,-1)<>0
     or coalesce((s->'cron'->>'failed_15m')::integer,-1)<>0
     or coalesce((s->'database'->>'blocked_sessions_over_30s')::integer,-1)<>0
     or coalesce((s->'database'->>'idle_in_transaction_over_60s')::integer,-1)<>0
     or coalesce((s->'database'->>'connection_usage_pct')::numeric,100)>=75 then
    raise exception 'Phase 7G post-chaos operational state unsafe: %',s;
  end if;

  if not coalesce((private.draw_credit_integrity_report()->>'ok')::boolean,false)
     or coalesce((private.draw_credit_integrity_report()->>'issue_total')::integer,-1)<>0 then
    raise exception 'Draw Credit integrity failed after Phase 7G';
  end if;

  t:=private.production_alert_delivery_report();
  if not coalesce((t->>'enabled')::boolean,false)
     or not coalesce((t->>'telegram_ready')::boolean,false)
     or coalesce((t->>'dead_letter_count')::integer,-1)<>0 then
    raise exception 'Telegram alert delivery unhealthy after Phase 7G: %',t;
  end if;
end
$phase7g_runtime$;

rollback;
