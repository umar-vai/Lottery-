-- DRAW//01 player profiles + referral system
-- Applied to production on 2026-10-05.

alter table public.profiles add column if not exists nickname text;
alter table public.profiles add column if not exists referral_code text;

alter table public.profiles drop constraint if exists profiles_nickname_length_check;
alter table public.profiles add constraint profiles_nickname_length_check check (nickname is null or char_length(nickname) between 2 and 30);
alter table public.profiles drop constraint if exists profiles_referral_code_check;
alter table public.profiles add constraint profiles_referral_code_check check (referral_code is null or referral_code ~ '^[A-Z0-9]{3,12}-[A-Z0-9]{6}$');
create unique index if not exists profiles_referral_code_unique_idx on public.profiles (upper(referral_code)) where referral_code is not null;

create or replace function private.make_referral_code(p_name text)
returns text
language plpgsql
set search_path='pg_catalog','public','private'
as $$
declare
  base text;
  candidate text;
begin
  base := upper(regexp_replace(coalesce(nullif(trim(p_name),''),'DRAW'), '[^A-Za-z0-9]+', '', 'g'));
  base := left(base, 12);
  if char_length(base) < 3 then base := 'DRAW'; end if;
  loop
    candidate := base || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
    exit when not exists(select 1 from public.profiles where upper(referral_code)=candidate);
  end loop;
  return candidate;
end;
$$;

update public.profiles
set referral_code = private.make_referral_code(coalesce(nickname,display_name,email))
where referral_code is null;

alter table public.profiles alter column referral_code set not null;

create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_user_id uuid not null references public.profiles(id) on delete cascade,
  referred_user_id uuid not null references public.profiles(id) on delete cascade,
  referral_code text not null,
  signup_bonus_credits numeric(12,2) not null default 3 check (signup_bonus_credits >= 0),
  support_points_total numeric(16,2) not null default 0 check (support_points_total >= 0),
  support_reward_points numeric(16,2) not null default 0 check (support_reward_points >= 0),
  created_at timestamptz not null default now(),
  constraint referrals_not_self check (referrer_user_id <> referred_user_id),
  constraint referrals_referred_unique unique (referred_user_id)
);
create index if not exists referrals_referrer_created_idx on public.referrals(referrer_user_id,created_at desc);

create table if not exists public.referral_rewards (
  id uuid primary key default gen_random_uuid(),
  referral_id uuid not null references public.referrals(id) on delete cascade,
  referrer_user_id uuid not null references public.profiles(id) on delete cascade,
  referred_user_id uuid not null references public.profiles(id) on delete cascade,
  reward_type text not null check (reward_type in ('signup_credit','support_point')),
  amount numeric(16,2) not null check (amount > 0),
  source_id uuid,
  created_at timestamptz not null default now()
);
create unique index if not exists referral_signup_reward_once_idx on public.referral_rewards(referral_id) where reward_type='signup_credit';
create unique index if not exists referral_support_reward_source_idx on public.referral_rewards(source_id) where reward_type='support_point' and source_id is not null;
create index if not exists referral_rewards_referrer_created_idx on public.referral_rewards(referrer_user_id,created_at desc);

alter table public.referrals enable row level security;
alter table public.referral_rewards enable row level security;

drop policy if exists "referrers can read own referrals" on public.referrals;
create policy "referrers can read own referrals" on public.referrals for select to authenticated using ((select auth.uid())=referrer_user_id);
drop policy if exists "users can read own referral rewards" on public.referral_rewards;
create policy "users can read own referral rewards" on public.referral_rewards for select to authenticated using ((select auth.uid())=referrer_user_id);

grant select on public.referrals to authenticated;
grant select on public.referral_rewards to authenticated;

alter table public.balance_ledger drop constraint if exists balance_ledger_entry_type_check;
alter table public.balance_ledger add constraint balance_ledger_entry_type_check check (entry_type = any(array['admin_adjustment'::text,'ticket_purchase'::text,'prize_credit'::text,'referral_bonus'::text]));

create or replace function public.update_my_profile(p_display_name text, p_nickname text)
returns table(display_name text,nickname text,referral_code text)
language plpgsql
security definer
set search_path='pg_catalog','public'
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Authentication required'; end if;
  if nullif(trim(p_display_name),'') is null or char_length(trim(p_display_name))>80 then raise exception 'Name must be between 1 and 80 characters'; end if;
  if nullif(trim(p_nickname),'') is not null and char_length(trim(p_nickname)) not between 2 and 30 then raise exception 'Nickname must be between 2 and 30 characters'; end if;
  update public.profiles set display_name=trim(p_display_name),nickname=nullif(trim(p_nickname),''),updated_at=now() where id=uid;
  return query select p.display_name,p.nickname,p.referral_code from public.profiles p where p.id=uid;
end;
$$;
revoke all on function public.update_my_profile(text,text) from public,anon;
grant execute on function public.update_my_profile(text,text) to authenticated;

create or replace function public.claim_referral_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','public','private'
as $$
declare
  uid uuid := auth.uid();
  me public.profiles%rowtype;
  referrer public.profiles%rowtype;
  ref_id uuid;
  new_balance numeric;
  code text := upper(trim(p_code));
begin
  if uid is null then raise exception 'Authentication required'; end if;
  if code !~ '^[A-Z0-9]{3,12}-[A-Z0-9]{6}$' then return jsonb_build_object('ok',false,'status','invalid_code'); end if;
  select * into me from public.profiles where id=uid for update;
  if not found then raise exception 'Profile not found'; end if;
  if exists(select 1 from public.referrals where referred_user_id=uid) then return jsonb_build_object('ok',true,'status','already_linked'); end if;
  if me.created_at < now()-interval '24 hours' then return jsonb_build_object('ok',false,'status','not_eligible'); end if;
  select * into referrer from public.profiles where upper(referral_code)=code for update;
  if not found then return jsonb_build_object('ok',false,'status','invalid_code'); end if;
  if referrer.id=uid then return jsonb_build_object('ok',false,'status','self_referral'); end if;

  insert into public.referrals(referrer_user_id,referred_user_id,referral_code)
  values(referrer.id,uid,referrer.referral_code) returning id into ref_id;
  update public.profiles set balance=balance+3,updated_at=now() where id=referrer.id returning balance into new_balance;
  insert into public.balance_ledger(user_id,amount,balance_after,entry_type,actor_user_id,note)
  values(referrer.id,3,new_balance,'referral_bonus',null,'Referral signup bonus');
  insert into public.referral_rewards(referral_id,referrer_user_id,referred_user_id,reward_type,amount)
  values(ref_id,referrer.id,uid,'signup_credit',3);
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,new_data)
  values(uid,'referral_joined','referral',ref_id::text,jsonb_build_object('referrer_user_id',referrer.id,'signup_bonus_credits',3));
  return jsonb_build_object('ok',true,'status','linked','bonusCredits',3,'referrer',coalesce(referrer.nickname,referrer.display_name,'Player'));
exception when unique_violation then
  return jsonb_build_object('ok',true,'status','already_linked');
end;
$$;
revoke all on function public.claim_referral_code(text) from public,anon;
grant execute on function public.claim_referral_code(text) to authenticated;

create or replace function public.get_my_referral_dashboard()
returns jsonb
language sql
security definer
set search_path='pg_catalog','public'
as $$
  with me as (select id,referral_code from public.profiles where id=auth.uid()),
  rows as (
    select r.id,r.created_at,r.signup_bonus_credits,r.support_points_total,r.support_reward_points,p.display_name,p.nickname,p.avatar_url
    from public.referrals r join public.profiles p on p.id=r.referred_user_id
    where r.referrer_user_id=auth.uid() order by r.created_at desc
  )
  select jsonb_build_object(
    'referralCode',(select referral_code from me),
    'totalReferred',(select count(*) from rows),
    'signupCreditsEarned',coalesce((select sum(signup_bonus_credits) from rows),0),
    'supportPointsGenerated',coalesce((select sum(support_points_total) from rows),0),
    'supportRewardEarned',coalesce((select sum(support_reward_points) from rows),0),
    'people',coalesce((select jsonb_agg(jsonb_build_object('displayName',display_name,'nickname',nickname,'avatarUrl',avatar_url,'joinedAt',created_at,'supportPoints',support_points_total,'supportReward',support_reward_points,'signupBonus',signup_bonus_credits) order by created_at desc) from rows),'[]'::jsonb)
  );
$$;
revoke all on function public.get_my_referral_dashboard() from public,anon;
grant execute on function public.get_my_referral_dashboard() to authenticated;

create or replace function private.apply_referral_support_reward(p_referred_user_id uuid,p_points numeric,p_source_id uuid)
returns numeric
language plpgsql
security definer
set search_path='pg_catalog','public','private'
as $$
declare
  r public.referrals%rowtype;
  old_total numeric;
  new_total numeric;
  old_reward numeric;
  new_reward numeric;
  delta numeric;
  previous_balance numeric;
  new_balance numeric;
begin
  if p_points is null or p_points<=0 then return 0; end if;
  select * into r from public.referrals where referred_user_id=p_referred_user_id for update;
  if not found then return 0; end if;
  old_total:=r.support_points_total; new_total:=old_total+p_points; old_reward:=floor(old_total/10); new_reward:=floor(new_total/10); delta:=new_reward-old_reward;
  update public.referrals set support_points_total=new_total,support_reward_points=support_reward_points+greatest(delta,0) where id=r.id;
  if delta<=0 then return 0; end if;
  select balance into previous_balance from public.support_wallets where user_id=r.referrer_user_id for update;
  previous_balance:=coalesce(previous_balance,0);
  insert into public.support_wallets(user_id,balance,updated_at) values(r.referrer_user_id,delta,now())
  on conflict(user_id) do update set balance=public.support_wallets.balance+excluded.balance,updated_at=now() returning balance into new_balance;
  insert into public.support_point_adjustments(user_id,previous_balance,new_balance,actor_user_id,note)
  values(r.referrer_user_id,previous_balance,new_balance,null,'Referral Support Points reward');
  insert into public.referral_rewards(referral_id,referrer_user_id,referred_user_id,reward_type,amount,source_id)
  values(r.id,r.referrer_user_id,r.referred_user_id,'support_point',delta,p_source_id) on conflict do nothing;
  return delta;
end;
$$;

create or replace function private.settle_support_claim_request(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','public','private'
as $$
declare
  r public.support_claim_requests%rowtype;
  tx public.support_transactions%rowtype;
  new_balance numeric(16,2);
  pts numeric(16,2);
  referral_reward numeric(16,2):=0;
begin
  select * into r from public.support_claim_requests where id=p_request_id for update;
  if not found then raise exception 'Support claim request not found'; end if;
  if r.status='settled' then return jsonb_build_object('ok',true,'status','settled','points',r.points,'amount',r.amount_bdt,'balance',r.balance_after,'trxId',r.trx_id); end if;
  if r.expires_at < now() then update public.support_claim_requests set status='expired' where id=r.id; return jsonb_build_object('ok',false,'status','expired','trxId',r.trx_id); end if;
  select * into tx from public.support_transactions where upper(trx_id)=upper(r.trx_id) and sender_hash=r.sender_hash for update;
  if not found then return jsonb_build_object('ok',true,'status','pending','trxId',r.trx_id); end if;
  if tx.claimed_by is not null and tx.claimed_by <> r.user_id then raise exception 'This transaction has already been claimed'; end if;
  if tx.claimed_by is null then
    pts:=tx.amount;
    insert into public.support_wallets(user_id,balance,updated_at) values(r.user_id,pts,now())
    on conflict(user_id) do update set balance=public.support_wallets.balance+excluded.balance,updated_at=now() returning balance into new_balance;
    update public.support_transactions set claimed_by=r.user_id,claimed_at=now() where id=tx.id;
    insert into public.support_point_claims(user_id,transaction_id,amount_bdt,points,balance_after) values(r.user_id,tx.id,tx.amount,pts,new_balance) on conflict do nothing;
    referral_reward:=private.apply_referral_support_reward(r.user_id,pts,tx.id);
  else
    select balance into new_balance from public.support_wallets where user_id=r.user_id;
    select points into pts from public.support_point_claims where transaction_id=tx.id and user_id=r.user_id order by created_at desc limit 1;
    if pts is null then pts:=tx.amount; end if;
  end if;
  update public.support_claim_requests set status='settled',transaction_id=tx.id,amount_bdt=tx.amount,points=pts,balance_after=new_balance,settled_at=now() where id=r.id;
  return jsonb_build_object('ok',true,'status','settled','points',pts,'amount',tx.amount,'balance',new_balance,'trxId',tx.trx_id,'referralReward',referral_reward);
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path='pg_catalog','public','private'
as $$
declare nm text;
begin
  nm:=coalesce(new.raw_user_meta_data->>'full_name',new.raw_user_meta_data->>'name',split_part(new.email,'@',1));
  insert into public.profiles(id,display_name,avatar_url,email,role,referral_code)
  values(new.id,nm,new.raw_user_meta_data->>'avatar_url',new.email,'player',private.make_referral_code(nm))
  on conflict(id) do update set display_name=coalesce(excluded.display_name,public.profiles.display_name),avatar_url=coalesce(excluded.avatar_url,public.profiles.avatar_url),email=coalesce(excluded.email,public.profiles.email),updated_at=now();
  return new;
end;
$$;
