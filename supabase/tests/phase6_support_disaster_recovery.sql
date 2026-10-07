-- Phase 6 Support Points disaster-recovery drill.
-- Snapshots one real settled claim graph, simulates corruption, restores exact values,
-- verifies invariants, and rolls the entire transaction back.

begin;

create temporary table dr_support_wallet on commit drop as
select * from public.support_wallets where false;
create temporary table dr_support_tx on commit drop as
select * from public.support_transactions where false;
create temporary table dr_support_req on commit drop as
select * from public.support_claim_requests where false;
create temporary table dr_support_claim on commit drop as
select * from public.support_point_claims where false;

do $phase6_support_dr$
declare
  v_claim_id uuid;
  v_tx_id uuid;
  v_user_id uuid;
  v_req_id uuid;
  b_wallet text; b_tx text; b_req text; b_claim text;
  a_wallet text; a_tx text; a_req text; a_claim text;
begin
  select c.id,c.transaction_id,c.user_id,
         (select r.id
          from public.support_claim_requests r
          where r.transaction_id=c.transaction_id
            and r.user_id=c.user_id
          order by r.created_at desc
          limit 1)
  into v_claim_id,v_tx_id,v_user_id,v_req_id
  from public.support_point_claims c
  order by c.created_at desc
  limit 1;

  if v_claim_id is null or v_tx_id is null or v_user_id is null or v_req_id is null then
    raise exception 'Phase 6 Support DR drill requires one settled support claim/request pair';
  end if;

  insert into dr_support_wallet select * from public.support_wallets where user_id=v_user_id;
  insert into dr_support_tx select * from public.support_transactions where id=v_tx_id;
  insert into dr_support_req select * from public.support_claim_requests where id=v_req_id;
  insert into dr_support_claim select * from public.support_point_claims where id=v_claim_id;

  if not exists(select 1 from dr_support_wallet)
     or not exists(select 1 from dr_support_tx)
     or not exists(select 1 from dr_support_req)
     or not exists(select 1 from dr_support_claim) then
    raise exception 'Support DR snapshot incomplete';
  end if;

  select md5(to_jsonb(x)::text) into b_wallet from dr_support_wallet x;
  select md5(to_jsonb(x)::text) into b_tx from dr_support_tx x;
  select md5(to_jsonb(x)::text) into b_req from dr_support_req x;
  select md5(to_jsonb(x)::text) into b_claim from dr_support_claim x;

  update public.support_wallets
  set balance=balance+999,updated_at=now()
  where user_id=v_user_id;

  update public.support_transactions
  set claimed_by=null,claimed_at=null
  where id=v_tx_id;

  update public.support_claim_requests
  set status='pending',transaction_id=null,amount_bdt=null,points=null,
      balance_after=null,settled_at=null
  where id=v_req_id;

  update public.support_point_claims
  set points=points+999,balance_after=balance_after+999
  where id=v_claim_id;

  if not exists(select 1 from public.support_claim_requests where id=v_req_id and status='pending') then
    raise exception 'Support DR corruption simulation failed';
  end if;

  update public.support_wallets w
  set balance=s.balance,updated_at=s.updated_at
  from dr_support_wallet s
  where w.user_id=s.user_id;

  update public.support_transactions t
  set device_id=s.device_id,provider=s.provider,sender_hash=s.sender_hash,sender_last4=s.sender_last4,
      amount=s.amount,trx_id=s.trx_id,received_at=s.received_at,sms_fingerprint=s.sms_fingerprint,
      claimed_by=s.claimed_by,claimed_at=s.claimed_at,created_at=s.created_at
  from dr_support_tx s
  where t.id=s.id;

  update public.support_claim_requests r
  set user_id=s.user_id,trx_id=s.trx_id,sender_hash=s.sender_hash,sender_last4=s.sender_last4,
      status=s.status,transaction_id=s.transaction_id,amount_bdt=s.amount_bdt,points=s.points,
      balance_after=s.balance_after,created_at=s.created_at,settled_at=s.settled_at,expires_at=s.expires_at
  from dr_support_req s
  where r.id=s.id;

  update public.support_point_claims c
  set user_id=s.user_id,transaction_id=s.transaction_id,amount_bdt=s.amount_bdt,points=s.points,
      balance_after=s.balance_after,created_at=s.created_at
  from dr_support_claim s
  where c.id=s.id;

  select md5(to_jsonb(x)::text) into a_wallet from public.support_wallets x where x.user_id=v_user_id;
  select md5(to_jsonb(x)::text) into a_tx from public.support_transactions x where x.id=v_tx_id;
  select md5(to_jsonb(x)::text) into a_req from public.support_claim_requests x where x.id=v_req_id;
  select md5(to_jsonb(x)::text) into a_claim from public.support_point_claims x where x.id=v_claim_id;

  if b_wallet<>a_wallet then raise exception 'Support DR restore mismatch: support_wallets'; end if;
  if b_tx<>a_tx then raise exception 'Support DR restore mismatch: support_transactions'; end if;
  if b_req<>a_req then raise exception 'Support DR restore mismatch: support_claim_requests'; end if;
  if b_claim<>a_claim then raise exception 'Support DR restore mismatch: support_point_claims'; end if;

  if exists (
    select transaction_id
    from public.support_point_claims
    group by transaction_id
    having count(*)>1
  ) then
    raise exception 'Support DR restore left duplicate transaction settlement';
  end if;

  if exists (
    select 1
    from public.support_point_claims c
    left join public.support_transactions t on t.id=c.transaction_id
    where t.id is null
  ) then
    raise exception 'Support DR restore left orphan claim';
  end if;

  if exists (
    select 1
    from public.support_claim_requests r
    where r.status='settled'
      and (r.transaction_id is null or r.points is null or r.balance_after is null or r.settled_at is null)
  ) then
    raise exception 'Support DR restore left malformed settled request';
  end if;
end
$phase6_support_dr$;

rollback;
