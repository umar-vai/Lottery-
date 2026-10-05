-- Neon Plinko v1
-- Virtual Draw Credits only. No cash value / withdrawal.
-- 12 independent server-side left/right decisions -> 13 landing buckets.

alter table public.games drop constraint if exists games_game_type_check;
alter table public.games add constraint games_game_type_check check (game_type in ('slot','plinko'));

create table if not exists public.plinko_drops (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  game_id uuid not null references public.games(id) on delete restrict,
  game_version integer not null,
  client_nonce uuid not null,
  bet_amount numeric(16,2) not null check (bet_amount > 0),
  risk_mode text not null check (risk_mode in ('low','medium','high')),
  board_rows smallint not null default 12 check (board_rows = 12),
  path smallint[] not null,
  landing_index smallint not null check (landing_index between 0 and 12),
  multiplier numeric(16,4) not null check (multiplier >= 0),
  payout numeric(16,2) not null check (payout >= 0),
  net_change numeric(16,2) not null,
  balance_before numeric(16,2) not null check (balance_before >= 0),
  balance_after numeric(16,2) not null check (balance_after >= 0),
  outcome_kind text not null check (outcome_kind in ('loss','partial','push','win','jackpot')),
  rng_version text not null default 'plinko-rng-v1',
  created_at timestamptz not null default now(),
  unique(user_id, client_nonce)
);

create index if not exists plinko_drops_user_created_idx on public.plinko_drops(user_id, created_at desc);
create index if not exists plinko_drops_game_created_idx on public.plinko_drops(game_id, created_at desc);

alter table public.plinko_drops enable row level security;
drop policy if exists "users can read own plinko drops" on public.plinko_drops;
create policy "users can read own plinko drops" on public.plinko_drops
for select to authenticated
using (user_id = auth.uid() or public.is_admin());

grant select on public.plinko_drops to authenticated;
revoke all on public.plinko_drops from anon;

alter table public.balance_ledger add column if not exists plinko_drop_id uuid references public.plinko_drops(id) on delete set null;
create index if not exists balance_ledger_plinko_drop_idx on public.balance_ledger(plinko_drop_id) where plinko_drop_id is not null;

insert into public.games(slug,title,description,game_type,status,min_bet,max_bet,bet_steps,rtp,house_edge,version,config)
values(
  'neon-plinko','Neon Plinko',
  '12-row server-side Plinko with Low, Medium and High risk payout curves.',
  'plinko','active',5,50,array[5,10,25,50]::numeric[],0.938867,0.061133,1,
  jsonb_build_object(
    'rows',12,
    'riskModes',jsonb_build_object(
      'low',jsonb_build_object('rtp',0.939868,'houseEdge',0.060132,'multipliers',jsonb_build_array(5,2,1.5,1.2,1.05,0.9,0.65,0.9,1.05,1.2,1.5,2,5)),
      'medium',jsonb_build_object('rtp',0.938867,'houseEdge',0.061133,'multipliers',jsonb_build_array(25,8,3.5,1.8,1.1,0.65,0.25,0.65,1.1,1.8,3.5,8,25)),
      'high',jsonb_build_object('rtp',0.941284,'houseEdge',0.058716,'multipliers',jsonb_build_array(150,31.5,8.3,2.5,0.45,0.1,0,0.1,0.45,2.5,8.3,31.5,150))
    )
  )
)
on conflict (slug) do update set
  title=excluded.title,description=excluded.description,game_type=excluded.game_type,status=excluded.status,
  min_bet=excluded.min_bet,max_bet=excluded.max_bet,bet_steps=excluded.bet_steps,rtp=excluded.rtp,
  house_edge=excluded.house_edge,version=excluded.version,config=excluded.config,updated_at=now();

create or replace function public.drop_plinko(p_bet_amount numeric,p_risk text default 'medium',p_client_nonce uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $$
declare
  v_uid uuid := auth.uid();
  v_game public.games%rowtype;
  v_profile public.profiles%rowtype;
  v_existing public.plinko_drops%rowtype;
  v_nonce uuid := coalesce(p_client_nonce, gen_random_uuid());
  v_risk text := lower(coalesce(p_risk,'medium'));
  v_bytes bytea; v_path smallint[] := array[]::smallint[]; v_bit smallint; v_landing smallint := 0;
  v_multipliers numeric[]; v_multiplier numeric(16,4); v_rtp numeric(10,6); v_edge numeric(10,6);
  v_payout numeric(16,2); v_after_bet numeric(16,2); v_final numeric(16,2); v_drop_id uuid; v_kind text; i integer;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  select * into v_existing from public.plinko_drops where user_id=v_uid and client_nonce=v_nonce limit 1;
  if found then
    return jsonb_build_object('ok',true,'duplicate',true,'dropId',v_existing.id,'path',to_jsonb(v_existing.path),'landingIndex',v_existing.landing_index,'risk',v_existing.risk_mode,'multiplier',v_existing.multiplier,'payout',v_existing.payout,'net',v_existing.net_change,'balanceBefore',v_existing.balance_before,'balanceAfter',v_existing.balance_after,'outcome',v_existing.outcome_kind,'gameVersion',v_existing.game_version);
  end if;

  select * into v_game from public.games where slug='neon-plinko' and status='active' for share;
  if not found then raise exception 'Plinko game is not available'; end if;
  if p_bet_amount is null or not (p_bet_amount = any(v_game.bet_steps)) then raise exception 'Invalid bet amount'; end if;
  if p_bet_amount < v_game.min_bet or p_bet_amount > v_game.max_bet then raise exception 'Bet amount is outside allowed range'; end if;
  if v_risk not in ('low','medium','high') then raise exception 'Invalid risk mode'; end if;

  select * into v_profile from public.profiles where id=v_uid for update;
  if not found then raise exception 'Player profile not found'; end if;
  if v_profile.balance < p_bet_amount then raise exception 'Insufficient Draw Credits'; end if;

  if v_risk='low' then
    v_multipliers := array[5,2,1.5,1.2,1.05,0.9,0.65,0.9,1.05,1.2,1.5,2,5]::numeric[];
    v_rtp := 0.939868; v_edge := 0.060132;
  elsif v_risk='high' then
    v_multipliers := array[150,31.5,8.3,2.5,0.45,0.1,0,0.1,0.45,2.5,8.3,31.5,150]::numeric[];
    v_rtp := 0.941284; v_edge := 0.058716;
  else
    v_multipliers := array[25,8,3.5,1.8,1.1,0.65,0.25,0.65,1.1,1.8,3.5,8,25]::numeric[];
    v_rtp := 0.938867; v_edge := 0.061133;
  end if;

  v_bytes := gen_random_bytes(12);
  for i in 0..11 loop
    v_bit := mod(get_byte(v_bytes,i),2)::smallint;
    v_path := array_append(v_path,v_bit);
    v_landing := v_landing + v_bit;
  end loop;

  v_multiplier := v_multipliers[v_landing+1];
  v_payout := round((p_bet_amount*v_multiplier)::numeric,2);
  v_after_bet := v_profile.balance-p_bet_amount;
  v_final := v_after_bet+v_payout;
  v_kind := case when v_multiplier=0 then 'loss' when v_multiplier<1 then 'partial' when v_multiplier=1 then 'push' when v_multiplier>=100 then 'jackpot' else 'win' end;

  update public.profiles set balance=v_final,updated_at=now() where id=v_uid;
  insert into public.plinko_drops(user_id,game_id,game_version,client_nonce,bet_amount,risk_mode,board_rows,path,landing_index,multiplier,payout,net_change,balance_before,balance_after,outcome_kind)
  values(v_uid,v_game.id,v_game.version,v_nonce,p_bet_amount,v_risk,12,v_path,v_landing,v_multiplier,v_payout,v_payout-p_bet_amount,v_profile.balance,v_final,v_kind)
  returning id into v_drop_id;

  insert into public.balance_ledger(user_id,amount,balance_after,entry_type,plinko_drop_id,note)
  values(v_uid,-p_bet_amount,v_after_bet,'game_bet',v_drop_id,'Game Zone · Neon Plinko bet ('||v_risk||')');
  if v_payout>0 then
    insert into public.balance_ledger(user_id,amount,balance_after,entry_type,plinko_drop_id,note)
    values(v_uid,v_payout,v_final,'game_payout',v_drop_id,'Game Zone · Neon Plinko payout ('||trim(to_char(v_multiplier,'FM999999990.####'))||'x · '||v_risk||')');
  end if;

  return jsonb_build_object('ok',true,'duplicate',false,'dropId',v_drop_id,'path',to_jsonb(v_path),'landingIndex',v_landing,'risk',v_risk,'multiplier',v_multiplier,'payout',v_payout,'net',v_payout-p_bet_amount,'balanceBefore',v_profile.balance,'balanceAfter',v_final,'outcome',v_kind,'rtp',v_rtp,'houseEdge',v_edge,'gameVersion',v_game.version);
end;
$$;

revoke all on function public.drop_plinko(numeric,text,uuid) from public, anon;
grant execute on function public.drop_plinko(numeric,text,uuid) to authenticated;
