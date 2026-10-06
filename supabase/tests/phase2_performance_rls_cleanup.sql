-- Phase 2 performance/RLS advisor cleanup invariants.
begin;

do $phase2_perf$
declare
  idx text;
  p record;
  player1 uuid;
  player2 uuid;
  admin1 uuid;
  c bigint;
begin
  -- 1) Every advisor-reported FK now has a covering leading-column index.
  foreach idx in array array[
    'audit_logs_actor_user_id_idx',
    'balance_ledger_actor_user_id_idx',
    'credit_requests_reviewed_by_idx',
    'lottery_events_created_by_idx',
    'platform_controls_updated_by_idx',
    'referral_rewards_referred_user_id_idx',
    'support_bridge_devices_created_by_idx',
    'support_claim_requests_transaction_id_idx',
    'support_pending_claims_transaction_id_idx',
    'support_point_adjustments_actor_user_id_idx',
    'support_transactions_device_id_idx'
  ]
  loop
    if not exists (
      select 1
      from pg_indexes
      where schemaname='public' and indexname=idx
    ) then
      raise exception 'Missing Phase 2 FK index: %',idx;
    end if;
  end loop;

  -- 2) InitPlan targets must use SELECT-wrapped auth helpers.
  for p in
    select *
    from pg_policies
    where schemaname='public'
      and (
        (tablename='support_pending_claims' and policyname='support_pending_select_own')
        or (tablename='support_claim_requests' and policyname='support_claim_requests_select_own')
        or (tablename='slot_spins' and policyname='users can read own slot spins')
        or (tablename='plinko_drops' and policyname='users can read own plinko drops')
        or (tablename='binance_pay_orders' and policyname='binance_pay_orders_select_own')
      )
  loop
    if p.roles <> array['authenticated']::name[] then
      raise exception 'RLS performance invariant failed: %.% role scope changed: %',p.tablename,p.policyname,p.roles;
    end if;

    if coalesce(p.qual,'') not ilike '%SELECT auth.uid()%' then
      raise exception 'RLS performance invariant failed: %.% auth.uid() is not SELECT-wrapped',p.tablename,p.policyname;
    end if;

    if p.tablename in ('slot_spins','plinko_drops')
       and coalesce(p.qual,'') not ilike '%SELECT is_admin()%' then
      raise exception 'RLS performance invariant failed: %.% is_admin() is not SELECT-wrapped',p.tablename,p.policyname;
    end if;
  end loop;

  if (
    select count(*)
    from pg_policies
    where schemaname='public'
      and tablename in ('support_pending_claims','support_claim_requests','slot_spins','plinko_drops','binance_pay_orders')
      and cmd='SELECT'
  ) < 5 then
    raise exception 'One or more optimized RLS SELECT policies are missing';
  end if;

  -- 3) Duplicate permissive SELECT policies are consolidated for authenticated users.
  if (
    select count(*) from pg_policies
    where schemaname='public' and tablename='draws'
      and cmd='SELECT' and 'authenticated'=any(roles)
  ) <> 1 then
    raise exception 'draws still has duplicate authenticated SELECT policies';
  end if;

  if (
    select count(*) from pg_policies
    where schemaname='public' and tablename='draws'
      and cmd='SELECT' and 'anon'=any(roles)
  ) <> 1 then
    raise exception 'draws anon public-read policy missing or duplicated';
  end if;

  foreach idx in array array['profiles','ticket_results','tickets']
  loop
    if (
      select count(*) from pg_policies
      where schemaname='public' and tablename=idx
        and cmd='SELECT' and 'authenticated'=any(roles)
    ) <> 1 then
      raise exception '% still has duplicate authenticated SELECT policies',idx;
    end if;
  end loop;

  -- 4) Runtime authorization semantics remain unchanged for profiles.
  select id into player1 from public.profiles where role='player' order by created_at asc limit 1;
  select id into player2 from public.profiles where role='player' and id<>player1 order by created_at asc limit 1;
  select id into admin1 from public.profiles where role='admin' order by created_at asc limit 1;

  if player1 is not null and player2 is not null then
    perform set_config('request.jwt.claim.sub',player1::text,true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',player1::text,'role','authenticated')::text,true);
    execute 'set local role authenticated';

    select count(*) into c from public.profiles where id=player1;
    if c<>1 then raise exception 'Player lost own-profile SELECT after RLS consolidation'; end if;

    select count(*) into c from public.profiles where id=player2;
    if c<>0 then raise exception 'Player gained cross-profile SELECT after RLS consolidation'; end if;

    execute 'reset role';
  end if;

  if admin1 is not null and player1 is not null then
    perform set_config('request.jwt.claim.sub',admin1::text,true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',admin1::text,'role','authenticated')::text,true);
    execute 'set local role authenticated';

    select count(*) into c from public.profiles where id=player1;
    if c<>1 then raise exception 'Admin lost cross-profile SELECT after RLS consolidation'; end if;

    execute 'reset role';
  end if;
end
$phase2_perf$;

rollback;
