-- Phase 1 security/data-integrity invariant suite.
-- Read-only assertions only. Safe to run against production; no data is changed.
begin;

do $phase1$
declare
  t text;
  f record;
  src text;
begin
  -- 1) Read-only-by-design tables must not be directly writable by browser roles.
  foreach t in array array[
    'audit_logs','binance_pay_orders','draw_events','draws','event_prize_tiers',
    'game_settings','games','love_point_payment_providers','plinko_drops',
    'referral_rewards','referrals','slot_spins','support_claim_requests','ticket_results'
  ]
  loop
    if has_table_privilege('anon', 'public.'||t, 'INSERT')
       or has_table_privilege('anon', 'public.'||t, 'UPDATE')
       or has_table_privilege('anon', 'public.'||t, 'DELETE')
       or has_table_privilege('authenticated', 'public.'||t, 'INSERT')
       or has_table_privilege('authenticated', 'public.'||t, 'UPDATE')
       or has_table_privilege('authenticated', 'public.'||t, 'DELETE') then
      raise exception 'Phase 1 invariant failed: direct write privilege remains on public.%', t;
    end if;
  end loop;

  -- 2) Intentional direct-write exceptions must keep working.
  if not has_table_privilege('authenticated','public.credit_requests','INSERT') then
    raise exception 'Phase 1 invariant failed: credit_requests INSERT path disappeared';
  end if;
  if not has_table_privilege('authenticated','public.tickets','INSERT')
     or not has_table_privilege('authenticated','public.tickets','UPDATE') then
    raise exception 'Phase 1 invariant failed: legacy tickets INSERT/UPDATE path disappeared';
  end if;

  -- 3) Sensitive profile mutation remains RPC-only.
  if has_table_privilege('authenticated','public.profiles','UPDATE') then
    raise exception 'Phase 1 invariant failed: authenticated can UPDATE profiles directly';
  end if;
  if not has_function_privilege('authenticated','public.update_my_profile(text,text)','EXECUTE')
     or has_function_privilege('anon','public.update_my_profile(text,text)','EXECUTE') then
    raise exception 'Phase 1 invariant failed: update_my_profile EXECUTE grants are wrong';
  end if;

  -- 4) SECURITY DEFINER functions require an explicit search_path.
  for f in
    select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args,p.proconfig
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private') and p.prosecdef
  loop
    if not exists (
      select 1 from unnest(coalesce(f.proconfig,'{}'::text[])) cfg
      where cfg like 'search_path=%'
    ) then
      raise exception 'Phase 1 invariant failed: %.%(%) has no explicit search_path',
        f.nspname,f.proname,f.args;
    end if;
  end loop;

  -- 5) Anonymous SECURITY DEFINER surface is a tiny explicit public-read allowlist.
  for f in
    select p.oid,p.proname,pg_get_function_identity_arguments(p.oid) args
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prosecdef
      and has_function_privilege('anon',p.oid,'EXECUTE')
      and p.proname not in ('get_platform_features','get_public_event_winners')
  loop
    raise exception 'Phase 1 invariant failed: anon can execute SECURITY DEFINER %.%(%)',
      'public',f.proname,f.args;
  end loop;

  -- 6) Every browser-callable admin SECURITY DEFINER function enforces is_admin().
  for f in
    select p.oid,p.proname,pg_get_function_identity_arguments(p.oid) args,p.prosrc
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prosecdef
      and p.proname like 'admin\_%' escape '\'
      and has_function_privilege('authenticated',p.oid,'EXECUTE')
  loop
    if f.prosrc !~* 'is_admin\s*\(' then
      raise exception 'Phase 1 invariant failed: authenticated admin RPC lacks is_admin(): %.%(%)',
        'public',f.proname,f.args;
    end if;
  end loop;

  -- 7) Service-only functions may never become browser-callable.
  for f in
    select p.oid,p.proname,pg_get_function_identity_arguments(p.oid) args
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prosecdef
      and (p.proname like 'service\_%' escape '\' or p.proname='handle_new_user')
      and (
        has_function_privilege('anon',p.oid,'EXECUTE')
        or has_function_privilege('authenticated',p.oid,'EXECUTE')
      )
  loop
    raise exception 'Phase 1 invariant failed: service-only function is browser-callable: %.%(%)',
      'public',f.proname,f.args;
  end loop;

  -- 8) Core owner-isolation SELECT policies must remain present.
  foreach t in array array['profiles','event_tickets','balance_ledger','support_wallets','support_claim_requests']
  loop
    if not exists (
      select 1 from pg_policies p
      where p.schemaname='public'
        and p.tablename=t
        and p.cmd='SELECT'
        and 'authenticated'=any(p.roles)
        and coalesce(p.qual,'') ~* 'auth\.uid'
    ) then
      raise exception 'Phase 1 invariant failed: owner SELECT policy missing on public.%', t;
    end if;
  end loop;

  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='audit_logs' and cmd='SELECT'
      and 'authenticated'=any(roles) and coalesce(qual,'') ~* 'is_admin'
  ) then
    raise exception 'Phase 1 invariant failed: audit_logs admin read policy missing';
  end if;

  -- 9) Ticket purchase remains one server transaction with locks + accounting.
  select p.prosrc into src
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='purchase_event_ticket'
    and pg_get_function_identity_arguments(p.oid)='p_event_id uuid, p_white_numbers integer[], p_bonus_ball integer';

  if src is null
     or src !~* 'lottery_events[\s\S]*for update'
     or src !~* 'profiles[\s\S]*for update'
     or src !~* 'insert into public\.event_tickets'
     or src !~* 'insert into public\.balance_ledger'
     or src !~* 'update public\.profiles set balance' then
    raise exception 'Phase 1 invariant failed: purchase_event_ticket atomicity/accounting contract changed';
  end if;

  -- 10) Winner selection remains event-local, existing-ticket based, and ledgered.
  select p.prosrc into src
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private' and p.proname='run_lottery_event_internal'
    and pg_get_function_identity_arguments(p.oid)='p_event_id uuid';

  if src is null
     or src !~* 'from public\.event_tickets[\s\S]*where[\s\S]*event_id\s*=\s*p_event_id'
     or src !~* 'v_ticket_count\s*<\s*v_event\.winner_count'
     or src !~* 'update\\s+public\\.event_tickets[\\s\\S]*set\\s+is_winner\\s*=\\s*true'
     or src !~* 'insert into public\.balance_ledger'
     or src !~* 'status=''completed''' then
    raise exception 'Phase 1 invariant failed: winner-pool/prize-ledger contract changed';
  end if;
end
$phase1$;

rollback;
