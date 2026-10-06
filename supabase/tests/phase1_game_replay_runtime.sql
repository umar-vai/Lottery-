-- Phase 1 duplicate game replay runtime test.
-- Read-only with respect to final state: duplicate calls return before mutation and transaction rolls back.
begin;

do $replay$
declare
  s public.slot_spins%rowtype;
  p public.plinko_drops%rowtype;
  before_balance numeric;
  after_balance numeric;
  r jsonb;
begin
  select * into s from public.slot_spins order by created_at desc limit 1;
  if found and private.platform_feature_enabled('slot') then
    select balance into before_balance from public.profiles where id=s.user_id;
    perform set_config('request.jwt.claim.sub',s.user_id::text,true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',s.user_id::text,'role','authenticated')::text,true);
    execute 'set local role authenticated';

    r := public.spin_slot(s.bet_amount,s.client_nonce);

    if coalesce((r->>'duplicate')::boolean,false) is not true
       or (r->>'spinId')::uuid is distinct from s.id then
      raise exception 'Slot replay invariant failed: existing nonce did not replay original spin';
    end if;

    execute 'reset role';
    select balance into after_balance from public.profiles where id=s.user_id;
    if after_balance is distinct from before_balance then
      raise exception 'Slot replay invariant failed: balance changed on duplicate replay';
    end if;
  end if;

  select * into p from public.plinko_drops order by created_at desc limit 1;
  if found and private.platform_feature_enabled('plinko') then
    select balance into before_balance from public.profiles where id=p.user_id;
    perform set_config('request.jwt.claim.sub',p.user_id::text,true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',p.user_id::text,'role','authenticated')::text,true);
    execute 'set local role authenticated';

    r := public.drop_plinko(p.bet_amount,p.risk_mode,p.client_nonce);

    if coalesce((r->>'duplicate')::boolean,false) is not true
       or (r->>'dropId')::uuid is distinct from p.id then
      raise exception 'Plinko replay invariant failed: existing nonce did not replay original drop';
    end if;

    execute 'reset role';
    select balance into after_balance from public.profiles where id=p.user_id;
    if after_balance is distinct from before_balance then
      raise exception 'Plinko replay invariant failed: balance changed on duplicate replay';
    end if;
  end if;
end
$replay$;

rollback;
