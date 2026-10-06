-- Phase 1 runtime RLS/authorization test.
-- Read-only transaction. It impersonates JWT-backed authenticated roles inside Postgres.
begin;

do $rls$
declare
  player1 uuid;
  player2 uuid;
  admin1 uuid;
  c bigint;
begin
  select id into player1 from public.profiles where role='player' order by created_at asc limit 1;
  select id into player2 from public.profiles where role='player' and id<>player1 order by created_at asc limit 1;
  select id into admin1 from public.profiles where role='admin' order by created_at asc limit 1;

  if player1 is null or player2 is null then
    raise notice 'RLS runtime isolation section skipped: two player profiles are required';
  else
    perform set_config('request.jwt.claim.sub',player1::text,true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',player1::text,'role','authenticated')::text,true);
    execute 'set local role authenticated';

    if auth.uid() is distinct from player1 then
      raise exception 'Runtime RLS setup failed: auth.uid mismatch';
    end if;
    if public.is_admin() then
      raise exception 'Runtime RLS failed: normal player is treated as admin';
    end if;

    select count(*) into c from public.profiles where id=player1;
    if c<>1 then raise exception 'Runtime RLS failed: player cannot read own profile'; end if;

    select count(*) into c from public.profiles where id=player2;
    if c<>0 then raise exception 'Runtime RLS failed: player can read another profile'; end if;

    select count(*) into c from public.event_tickets where user_id<>player1;
    if c<>0 then raise exception 'Runtime RLS failed: cross-user event_tickets visible'; end if;

    select count(*) into c from public.balance_ledger where user_id<>player1;
    if c<>0 then raise exception 'Runtime RLS failed: cross-user balance_ledger visible'; end if;

    select count(*) into c from public.support_wallets where user_id<>player1;
    if c<>0 then raise exception 'Runtime RLS failed: cross-user support_wallets visible'; end if;

    select count(*) into c from public.support_claim_requests where user_id<>player1;
    if c<>0 then raise exception 'Runtime RLS failed: cross-user support_claim_requests visible'; end if;

    select count(*) into c from public.audit_logs;
    if c<>0 then raise exception 'Runtime RLS failed: normal player can read audit_logs'; end if;

    begin
      update public.profiles set balance=balance where id=player1;
      raise exception 'Runtime RLS failed: player directly UPDATEd profiles';
    exception
      when insufficient_privilege then null;
    end;

    begin
      perform public.admin_set_user_balance(player1,0,'phase1 authorization test');
      raise exception 'Runtime auth failed: player called admin_set_user_balance successfully';
    exception
      when others then
        if sqlerrm not ilike '%Admin access required%' then
          raise;
        end if;
    end;

    execute 'reset role';
  end if;

  if admin1 is null then
    raise notice 'Admin runtime authorization section skipped: no admin profile exists';
  else
    perform set_config('request.jwt.claim.sub',admin1::text,true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',admin1::text,'role','authenticated')::text,true);
    execute 'set local role authenticated';

    if auth.uid() is distinct from admin1 or not public.is_admin() then
      raise exception 'Runtime admin authorization failed: admin identity not recognized';
    end if;

    if player1 is not null then
      select count(*) into c from public.profiles where id=player1;
      if c<>1 then raise exception 'Runtime admin authorization failed: admin cannot read player profile'; end if;
    end if;

    -- Query must be allowed for admins even if the table is currently empty.
    select count(*) into c from public.audit_logs;

    begin
      update public.profiles set balance=balance where id=admin1;
      raise exception 'Runtime grant failed: admin bypassed RPC-only profiles write rule';
    exception
      when insufficient_privilege then null;
    end;

    execute 'reset role';
  end if;
end
$rls$;

rollback;
