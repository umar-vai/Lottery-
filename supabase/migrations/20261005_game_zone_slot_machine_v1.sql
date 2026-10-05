-- Game Zone / Neon Fortune Slots v1
-- Virtual-credit simulation only. No cash value or withdrawal path.

create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  description text not null default '',
  game_type text not null check (game_type in ('slot')),
  status text not null default 'active' check (status in ('active','coming_soon','disabled')),
  min_bet numeric(16,2) not null default 5 check (min_bet > 0),
  max_bet numeric(16,2) not null default 50 check (max_bet >= min_bet),
  bet_steps numeric(16,2)[] not null default array[5,10,25,50]::numeric[],
  rtp numeric(9,6) not null,
  house_edge numeric(9,6) not null,
  version integer not null default 1,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.games(slug,title,description,game_type,status,min_bet,max_bet,bet_steps,rtp,house_edge,version,config)
values(
  'classic-slot','Neon Fortune Slots',
  'Three-reel virtual-credit slot with fixed server-side odds and transparent paytable.',
  'slot','active',5,50,array[5,10,25,50]::numeric[],0.937288,0.062712,1,
  jsonb_build_object(
    'symbols',jsonb_build_array(
      jsonb_build_object('key','cherry','label','🍒','weight',32,'tripleMultiplier',5),
      jsonb_build_object('key','lemon','label','🍋','weight',24,'tripleMultiplier',8),
      jsonb_build_object('key','bell','label','🔔','weight',18,'tripleMultiplier',12),
      jsonb_build_object('key','bar','label','BAR','weight',12,'tripleMultiplier',25),
      jsonb_build_object('key','seven','label','7','weight',9,'tripleMultiplier',60),
      jsonb_build_object('key','diamond','label','💎','weight',5,'tripleMultiplier',150)
    ),
    'pairMultiplier',1,
    'positiveProfitHitRate',0.055006,
    'anyReturnHitRate',0.542188,
    'rng','pgcrypto rejection-sampled 1..100 per reel',
    'cashValue',false
  )
)
on conflict(slug) do update set
  title=excluded.title,description=excluded.description,game_type=excluded.game_type,status=excluded.status,
  min_bet=excluded.min_bet,max_bet=excluded.max_bet,bet_steps=excluded.bet_steps,rtp=excluded.rtp,
  house_edge=excluded.house_edge,version=excluded.version,config=excluded.config,updated_at=now();

alter table public.games enable row level security;
drop policy if exists "public can read game catalog" on public.games;
create policy "public can read game catalog" on public.games for select to anon,authenticated
using(status in ('active','coming_soon') or public.is_admin());

create table if not exists public.slot_spins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  game_id uuid not null references public.games(id) on delete restrict,
  game_version integer not null,
  client_nonce uuid not null,
  bet_amount numeric(16,2) not null check (bet_amount>0),
  reel_1 text not null,reel_2 text not null,reel_3 text not null,
  multiplier numeric(16,4) not null default 0 check (multiplier>=0),
  payout numeric(16,2) not null default 0 check (payout>=0),
  net_change numeric(16,2) not null,
  balance_before numeric(16,2) not null check(balance_before>=0),
  balance_after numeric(16,2) not null check(balance_after>=0),
  outcome_kind text not null check(outcome_kind in ('loss','push','win','jackpot')),
  rng_version text not null default 'slot-rng-v1',
  created_at timestamptz not null default now(),
  unique(user_id,client_nonce)
);
create index if not exists slot_spins_user_created_idx on public.slot_spins(user_id,created_at desc);
create index if not exists slot_spins_game_created_idx on public.slot_spins(game_id,created_at desc);
alter table public.slot_spins enable row level security;
drop policy if exists "users can read own slot spins" on public.slot_spins;
create policy "users can read own slot spins" on public.slot_spins for select to authenticated
using(user_id=auth.uid() or public.is_admin());

alter table public.balance_ledger add column if not exists game_spin_id uuid null;
do $$ begin
  if not exists(select 1 from pg_constraint where conname='balance_ledger_game_spin_id_fkey') then
    alter table public.balance_ledger add constraint balance_ledger_game_spin_id_fkey foreign key(game_spin_id) references public.slot_spins(id) on delete set null;
  end if;
end $$;
alter table public.balance_ledger drop constraint if exists balance_ledger_entry_type_check;
alter table public.balance_ledger add constraint balance_ledger_entry_type_check
check(entry_type=any(array['admin_adjustment'::text,'ticket_purchase'::text,'prize_credit'::text,'referral_bonus'::text,'game_bet'::text,'game_payout'::text]));

create or replace function private.secure_slot_roll_100() returns integer
language plpgsql volatile security definer
set search_path=pg_catalog,public,private,extensions as $$
declare b bytea; n integer;
begin
  loop
    b:=extensions.gen_random_bytes(2);
    n:=get_byte(b,0)*256+get_byte(b,1);
    if n<65500 then return (n%100)+1; end if;
  end loop;
end;$$;
revoke all on function private.secure_slot_roll_100() from public,anon,authenticated;

create or replace function private.slot_symbol_v1(p_roll integer) returns text
language sql immutable security definer set search_path=pg_catalog,public,private as $$
select case when p_roll between 1 and 32 then 'cherry' when p_roll between 33 and 56 then 'lemon'
when p_roll between 57 and 74 then 'bell' when p_roll between 75 and 86 then 'bar'
when p_roll between 87 and 95 then 'seven' else 'diamond' end;$$;
revoke all on function private.slot_symbol_v1(integer) from public,anon,authenticated;

create or replace function public.spin_slot(p_bet_amount numeric,p_client_nonce uuid default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,private,extensions as $$
declare
  v_uid uuid:=auth.uid(); v_game public.games%rowtype; v_profile public.profiles%rowtype;
  v_existing public.slot_spins%rowtype; v_nonce uuid:=coalesce(p_client_nonce,gen_random_uuid());
  s1 text; s2 text; s3 text; v_multiplier numeric(16,4):=0; v_payout numeric(16,2):=0;
  v_after_bet numeric(16,2); v_final numeric(16,2); v_spin_id uuid; v_kind text;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  select * into v_existing from public.slot_spins where user_id=v_uid and client_nonce=v_nonce limit 1;
  if found then return jsonb_build_object('ok',true,'duplicate',true,'spinId',v_existing.id,
    'symbols',jsonb_build_array(v_existing.reel_1,v_existing.reel_2,v_existing.reel_3),'multiplier',v_existing.multiplier,
    'payout',v_existing.payout,'net',v_existing.net_change,'balanceBefore',v_existing.balance_before,
    'balanceAfter',v_existing.balance_after,'outcome',v_existing.outcome_kind); end if;
  select * into v_game from public.games where slug='classic-slot' and status='active' for share;
  if not found then raise exception 'Slot game is not available'; end if;
  if p_bet_amount is null or not(p_bet_amount=any(v_game.bet_steps)) then raise exception 'Invalid bet amount'; end if;
  if p_bet_amount<v_game.min_bet or p_bet_amount>v_game.max_bet then raise exception 'Bet amount is outside allowed range'; end if;
  select * into v_profile from public.profiles where id=v_uid for update;
  if not found then raise exception 'Player profile not found'; end if;
  if v_profile.balance<p_bet_amount then raise exception 'Insufficient Draw Credits'; end if;
  s1:=private.slot_symbol_v1(private.secure_slot_roll_100()); s2:=private.slot_symbol_v1(private.secure_slot_roll_100()); s3:=private.slot_symbol_v1(private.secure_slot_roll_100());
  if s1=s2 and s2=s3 then v_multiplier:=case s1 when 'cherry' then 5 when 'lemon' then 8 when 'bell' then 12 when 'bar' then 25 when 'seven' then 60 when 'diamond' then 150 else 0 end;
  elsif s1=s2 or s1=s3 or s2=s3 then v_multiplier:=1; else v_multiplier:=0; end if;
  v_payout:=round((p_bet_amount*v_multiplier)::numeric,2); v_after_bet:=v_profile.balance-p_bet_amount; v_final:=v_after_bet+v_payout;
  v_kind:=case when v_multiplier=0 then 'loss' when v_multiplier=1 then 'push' when s1='diamond' and s2='diamond' and s3='diamond' then 'jackpot' else 'win' end;
  update public.profiles set balance=v_final,updated_at=now() where id=v_uid;
  insert into public.slot_spins(user_id,game_id,game_version,client_nonce,bet_amount,reel_1,reel_2,reel_3,multiplier,payout,net_change,balance_before,balance_after,outcome_kind)
  values(v_uid,v_game.id,v_game.version,v_nonce,p_bet_amount,s1,s2,s3,v_multiplier,v_payout,v_payout-p_bet_amount,v_profile.balance,v_final,v_kind) returning id into v_spin_id;
  insert into public.balance_ledger(user_id,amount,balance_after,entry_type,game_spin_id,note)
  values(v_uid,-p_bet_amount,v_after_bet,'game_bet',v_spin_id,'Game Zone · Neon Fortune Slots bet');
  if v_payout>0 then insert into public.balance_ledger(user_id,amount,balance_after,entry_type,game_spin_id,note)
    values(v_uid,v_payout,v_final,'game_payout',v_spin_id,'Game Zone · Neon Fortune Slots payout ('||trim(to_char(v_multiplier,'FM999999990.####'))||'x)'); end if;
  return jsonb_build_object('ok',true,'duplicate',false,'spinId',v_spin_id,'symbols',jsonb_build_array(s1,s2,s3),'multiplier',v_multiplier,
    'payout',v_payout,'net',v_payout-p_bet_amount,'balanceBefore',v_profile.balance,'balanceAfter',v_final,'outcome',v_kind,
    'rtp',v_game.rtp,'houseEdge',v_game.house_edge,'gameVersion',v_game.version);
end;$$;
revoke all on function public.spin_slot(numeric,uuid) from public,anon;
grant execute on function public.spin_slot(numeric,uuid) to authenticated;
