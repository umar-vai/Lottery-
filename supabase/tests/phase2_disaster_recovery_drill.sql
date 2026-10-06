-- Phase 2 disaster-recovery logical repair drill.
-- Runs entirely inside one transaction and rolls back at the end.
begin;

create temporary table dr_event on commit drop as
select *
from public.lottery_events
where false;

create temporary table dr_tickets on commit drop as
select *
from public.event_tickets
where false;

create temporary table dr_tiers on commit drop as
select *
from public.event_prize_tiers
where false;

create temporary table dr_ledger on commit drop as
select *
from public.balance_ledger
where false;

create temporary table dr_profiles on commit drop as
select *
from public.profiles
where false;

do $phase2_dr$
declare
  v_event_id uuid;
  v_before_event text;
  v_before_tickets text;
  v_before_tiers text;
  v_before_ledger text;
  v_before_profiles text;
  v_after_event text;
  v_after_tickets text;
  v_after_tiers text;
  v_after_ledger text;
  v_after_profiles text;
begin
  select e.id
    into v_event_id
  from public.lottery_events e
  where e.status='completed'
    and exists(select 1 from public.event_tickets t where t.event_id=e.id)
  order by e.completed_at desc nulls last,e.created_at desc
  limit 1;

  if v_event_id is null then
    raise exception 'Phase 2 DR drill requires at least one completed event with tickets';
  end if;

  insert into dr_event select * from public.lottery_events where id=v_event_id;
  insert into dr_tickets select * from public.event_tickets where event_id=v_event_id;
  insert into dr_tiers select * from public.event_prize_tiers where event_id=v_event_id;
  insert into dr_ledger select * from public.balance_ledger where event_id=v_event_id;
  insert into dr_profiles
  select p.*
  from public.profiles p
  where p.id in (select distinct user_id from dr_tickets);

  select md5(coalesce(string_agg(to_jsonb(x)::text,'|' order by x.id::text),'')) into v_before_event from dr_event x;
  select md5(coalesce(string_agg(to_jsonb(x)::text,'|' order by x.id::text),'')) into v_before_tickets from dr_tickets x;
  select md5(coalesce(string_agg(to_jsonb(x)::text,'|' order by x.event_id::text,x.rank),'')) into v_before_tiers from dr_tiers x;
  select md5(coalesce(string_agg(to_jsonb(x)::text,'|' order by x.id::text),'')) into v_before_ledger from dr_ledger x;
  select md5(coalesce(string_agg(to_jsonb(x)::text,'|' order by x.id::text),'')) into v_before_profiles from dr_profiles x;

  -- Simulate a bad operator/script mutation across the core lottery accounting graph.
  update public.lottery_events
  set description='PHASE2_DR_CORRUPTION',
      prize_amount=prize_amount+999
  where id=v_event_id;

  update public.event_tickets
  set is_winner=false,
      winner_rank=null,
      prize_awarded=0
  where event_id=v_event_id;

  update public.event_prize_tiers
  set prize_amount=prize_amount+999
  where event_id=v_event_id;

  update public.balance_ledger
  set note='PHASE2_DR_CORRUPTION'
  where event_id=v_event_id;

  update public.profiles
  set balance=balance+999
  where id in (select id from dr_profiles);

  if not exists(select 1 from public.lottery_events where id=v_event_id and description='PHASE2_DR_CORRUPTION') then
    raise exception 'DR drill could not simulate event corruption';
  end if;

  -- Restore the exact values that were intentionally changed.
  update public.lottery_events e
  set description=s.description,
      prize_amount=s.prize_amount
  from dr_event s
  where e.id=s.id;

  update public.event_tickets t
  set is_winner=s.is_winner,
      winner_rank=s.winner_rank,
      prize_awarded=s.prize_awarded
  from dr_tickets s
  where t.id=s.id;

  update public.event_prize_tiers t
  set prize_amount=s.prize_amount
  from dr_tiers s
  where t.event_id=s.event_id and t.rank=s.rank;

  update public.balance_ledger l
  set note=s.note
  from dr_ledger s
  where l.id=s.id;

  update public.profiles p
  set balance=s.balance
  from dr_profiles s
  where p.id=s.id;

  select md5(coalesce(string_agg(to_jsonb(x)::text,'|' order by x.id::text),''))
    into v_after_event
  from public.lottery_events x
  where x.id=v_event_id;

  select md5(coalesce(string_agg(to_jsonb(x)::text,'|' order by x.id::text),''))
    into v_after_tickets
  from public.event_tickets x
  where x.event_id=v_event_id;

  select md5(coalesce(string_agg(to_jsonb(x)::text,'|' order by x.event_id::text,x.rank),''))
    into v_after_tiers
  from public.event_prize_tiers x
  where x.event_id=v_event_id;

  select md5(coalesce(string_agg(to_jsonb(x)::text,'|' order by x.id::text),''))
    into v_after_ledger
  from public.balance_ledger x
  where x.event_id=v_event_id;

  select md5(coalesce(string_agg(to_jsonb(x)::text,'|' order by x.id::text),''))
    into v_after_profiles
  from public.profiles x
  where x.id in (select id from dr_profiles);

  if v_before_event<>v_after_event then raise exception 'DR restore mismatch: lottery_events'; end if;
  if v_before_tickets<>v_after_tickets then raise exception 'DR restore mismatch: event_tickets'; end if;
  if v_before_tiers<>v_after_tiers then raise exception 'DR restore mismatch: event_prize_tiers'; end if;
  if v_before_ledger<>v_after_ledger then raise exception 'DR restore mismatch: balance_ledger'; end if;
  if v_before_profiles<>v_after_profiles then raise exception 'DR restore mismatch: profiles'; end if;

  if exists (
    select 1 from public.profiles
    where id in (select id from dr_profiles)
      and balance<0
  ) then
    raise exception 'DR restore left a negative Draw Credit balance';
  end if;
end
$phase2_dr$;

-- Reconciliation must still pass after the logical restore.
do $phase2_dr_reconcile$
declare
  r jsonb;
begin
  r:=private.draw_credit_integrity_report();
  if not coalesce((r->>'ok')::boolean,false) then
    raise exception 'Draw Credit reconciliation failed after DR restore: %',r;
  end if;
end
$phase2_dr_reconcile$;

rollback;
