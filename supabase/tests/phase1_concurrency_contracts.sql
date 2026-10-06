-- Phase 1 concurrency contract checks. Read-only.
begin;

do $phase1_concurrency$
declare
  src text;
  lock_pos integer;
  duplicate_pos integer;
  count_pos integer;
begin
  -- Ticket capacity/player-limit checks must run only after the event row lock.
  select p.prosrc into src
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='purchase_event_ticket';

  lock_pos := strpos(lower(src),'from public.lottery_events where id=p_event_id for update');
  count_pos := strpos(lower(src),'select count(*),count(distinct user_id)');

  if lock_pos=0 or count_pos=0 or lock_pos>=count_pos then
    raise exception 'Concurrency invariant failed: ticket capacity counts are not serialized behind the event row lock';
  end if;

  if src !~* 'max_total_tickets[\s\S]*v_total_tickets'
     or src !~* 'max_players[\s\S]*v_player_count'
     or src !~* 'max_tickets_per_user' then
    raise exception 'Concurrency invariant failed: ticket capacity/player limits are missing';
  end if;

  if src !~* 'profiles[\s\S]*for update'
     or src !~* 'update public\.profiles set balance'
     or src !~* 'insert into public\.event_tickets'
     or src !~* 'insert into public\.balance_ledger' then
    raise exception 'Concurrency invariant failed: ticket purchase accounting/locking contract changed';
  end if;

  -- Slot duplicate request safety: DB unique key + per-user/nonce advisory lock
  -- before the duplicate lookup.
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.slot_spins'::regclass
      and contype='u'
      and pg_get_constraintdef(oid) ilike '%user_id, client_nonce%'
  ) then
    raise exception 'Concurrency invariant failed: slot nonce unique constraint missing';
  end if;

  select p.prosrc into src
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='spin_slot';

  lock_pos := strpos(lower(src),'pg_advisory_xact_lock');
  duplicate_pos := strpos(lower(src),'from public.slot_spins');
  if lock_pos=0 or duplicate_pos=0 or lock_pos>=duplicate_pos
     or src !~* 'slot:[^'']*client_nonce|slot:'
  then
    raise exception 'Concurrency invariant failed: slot nonce is not serialized before duplicate lookup';
  end if;

  -- Plinko duplicate request safety.
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.plinko_drops'::regclass
      and contype='u'
      and pg_get_constraintdef(oid) ilike '%user_id, client_nonce%'
  ) then
    raise exception 'Concurrency invariant failed: plinko nonce unique constraint missing';
  end if;

  select p.prosrc into src
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='drop_plinko';

  lock_pos := strpos(lower(src),'pg_advisory_xact_lock');
  duplicate_pos := strpos(lower(src),'from public.plinko_drops');
  if lock_pos=0 or duplicate_pos=0 or lock_pos>=duplicate_pos
     or src !~* 'plinko:'
  then
    raise exception 'Concurrency invariant failed: plinko nonce is not serialized before duplicate lookup';
  end if;

  -- Batch requests already serialize their deterministic batch nonce.
  select p.prosrc into src
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='drop_plinko_batch';
  if src !~* 'pg_advisory_xact_lock'
     or src !~* 'v_batch'
     or src !~* 'v_ball_nonce' then
    raise exception 'Concurrency invariant failed: Plinko batch idempotency contract changed';
  end if;
end
$phase1_concurrency$;

rollback;
