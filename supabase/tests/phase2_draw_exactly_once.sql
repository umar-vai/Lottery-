-- Phase 2 draw exactly-once contract + replay test.
begin;

do $phase2_draw$
declare
  src text;
  event_lock_pos integer;
  completed_pos integer;
  published_pos integer;
  e public.lottery_events%rowtype;
  before_ledger_count bigint;
  after_ledger_count bigint;
  before_ledger_amount numeric;
  after_ledger_amount numeric;
  before_seed text;
  before_summary jsonb;
  before_completed_at timestamptz;
begin
  select p.prosrc into src
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private'
    and p.proname='run_lottery_event_internal'
    and pg_get_function_identity_arguments(p.oid)='p_event_id uuid';

  if src is null then
    raise exception 'Draw idempotency invariant failed: private.run_lottery_event_internal(uuid) missing';
  end if;

  event_lock_pos:=strpos(lower(src),'from public.lottery_events');
  completed_pos:=strpos(lower(src),$$if v_event.status='completed' then$$);
  published_pos:=strpos(lower(src),$$if v_event.status<>'published' then$$);

  if event_lock_pos=0
     or strpos(lower(src),'for update')=0
     or completed_pos=0
     or published_pos=0
     or not (event_lock_pos < completed_pos and completed_pos < published_pos) then
    raise exception 'Draw idempotency invariant failed: completed retry guard must run after event FOR UPDATE and before published-state rejection';
  end if;

  if not exists (
    select 1
    from pg_indexes
    where schemaname='public'
      and tablename='balance_ledger'
      and indexname='balance_ledger_one_prize_credit_per_event_ticket_idx'
      and indexdef ilike '%unique%'
      and indexdef ilike '%event_id%'
      and indexdef ilike '%ticket_id%'
      and indexdef ilike '%prize_credit%'
  ) then
    raise exception 'Draw idempotency invariant failed: prize-credit unique guard missing';
  end if;

  select * into e
  from public.lottery_events
  where status='completed'
  order by completed_at desc nulls last
  limit 1;

  if found then
    select count(*),coalesce(sum(amount),0)
      into before_ledger_count,before_ledger_amount
    from public.balance_ledger
    where event_id=e.id and entry_type='prize_credit';

    before_seed:=e.seed_reveal;
    before_summary:=e.winner_summary;
    before_completed_at:=e.completed_at;

    perform private.run_lottery_event_internal(e.id);
    perform private.run_lottery_event_internal(e.id);

    select count(*),coalesce(sum(amount),0)
      into after_ledger_count,after_ledger_amount
    from public.balance_ledger
    where event_id=e.id and entry_type='prize_credit';

    select seed_reveal,winner_summary,completed_at
      into e.seed_reveal,e.winner_summary,e.completed_at
    from public.lottery_events
    where id=e.id;

    if after_ledger_count is distinct from before_ledger_count
       or after_ledger_amount is distinct from before_ledger_amount
       or e.seed_reveal is distinct from before_seed
       or e.winner_summary is distinct from before_summary
       or e.completed_at is distinct from before_completed_at then
      raise exception 'Draw replay invariant failed: completed event changed after repeated execution';
    end if;
  end if;
end
$phase2_draw$;

rollback;
