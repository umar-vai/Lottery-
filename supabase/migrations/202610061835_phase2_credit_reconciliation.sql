-- Phase 2 — Draw Credit reconciliation, automated health checks, and ticket ledger guards.

create unique index if not exists balance_ledger_one_ticket_purchase_per_ticket_idx
on public.balance_ledger(ticket_id)
where entry_type='ticket_purchase' and ticket_id is not null;

create index if not exists event_tickets_user_created_idx
on public.event_tickets(user_id,created_at desc);

create index if not exists balance_ledger_ticket_idx
on public.balance_ledger(ticket_id)
where ticket_id is not null;

create index if not exists balance_ledger_game_spin_idx
on public.balance_ledger(game_spin_id)
where game_spin_id is not null;

create or replace function private.draw_credit_integrity_report()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $function$
declare
  v_profiles bigint;
  v_ledger_rows bigint;
  v_tickets bigint;
  v_slots bigint;
  v_plinko bigint;

  v_balance_mismatch bigint;
  v_negative_profiles bigint;
  v_ticket_ledger_count bigint;
  v_ticket_ledger_mismatch bigint;
  v_orphan_ticket_ledger bigint;
  v_winner_prize_mismatch bigint;
  v_nonwinner_prize_credits bigint;
  v_slot_bet_mismatch bigint;
  v_slot_payout_mismatch bigint;
  v_plinko_bet_mismatch bigint;
  v_plinko_payout_mismatch bigint;
  v_malformed_game_ledger bigint;
  v_issue_total bigint;
begin
  select count(*) into v_profiles from public.profiles;
  select count(*) into v_ledger_rows from public.balance_ledger;
  select count(*) into v_tickets from public.event_tickets;
  select count(*) into v_slots from public.slot_spins;
  select count(*) into v_plinko from public.plinko_drops;

  with ledger_sums as (
    select user_id,coalesce(sum(amount),0)::numeric as ledger_sum
    from public.balance_ledger
    group by user_id
  )
  select count(*) into v_balance_mismatch
  from public.profiles p
  left join ledger_sums s on s.user_id=p.id
  where p.balance is distinct from coalesce(s.ledger_sum,0);

  select count(*) into v_negative_profiles
  from public.profiles
  where balance<0;

  select count(*) into v_ticket_ledger_count
  from public.event_tickets t
  where (
    select count(*)
    from public.balance_ledger l
    where l.ticket_id=t.id and l.entry_type='ticket_purchase'
  )<>1;

  select count(*) into v_ticket_ledger_mismatch
  from public.event_tickets t
  where exists (
    select 1
    from public.balance_ledger l
    where l.ticket_id=t.id
      and l.entry_type='ticket_purchase'
      and (
        l.user_id is distinct from t.user_id
        or l.event_id is distinct from t.event_id
        or l.amount is distinct from -t.price_paid
      )
  );

  select count(*) into v_orphan_ticket_ledger
  from public.balance_ledger l
  left join public.event_tickets t on t.id=l.ticket_id
  where l.entry_type='ticket_purchase'
    and (
      l.ticket_id is null
      or t.id is null
      or l.user_id is distinct from t.user_id
      or l.event_id is distinct from t.event_id
    );

  select count(*) into v_winner_prize_mismatch
  from public.event_tickets t
  where t.is_winner
    and (
      (
        select count(*)
        from public.balance_ledger l
        where l.ticket_id=t.id and l.entry_type='prize_credit'
      )<>1
      or exists (
        select 1
        from public.balance_ledger l
        where l.ticket_id=t.id
          and l.entry_type='prize_credit'
          and (
            l.user_id is distinct from t.user_id
            or l.event_id is distinct from t.event_id
            or l.amount is distinct from t.prize_awarded
          )
      )
    );

  select count(*) into v_nonwinner_prize_credits
  from public.balance_ledger l
  left join public.event_tickets t on t.id=l.ticket_id
  where l.entry_type='prize_credit'
    and (t.id is null or not coalesce(t.is_winner,false));

  select count(*) into v_slot_bet_mismatch
  from public.slot_spins s
  where (
    select count(*)
    from public.balance_ledger l
    where l.game_spin_id=s.id and l.entry_type='game_bet'
  )<>1
  or exists (
    select 1
    from public.balance_ledger l
    where l.game_spin_id=s.id
      and l.entry_type='game_bet'
      and (
        l.user_id is distinct from s.user_id
        or l.amount is distinct from -s.bet_amount
      )
  );

  select count(*) into v_slot_payout_mismatch
  from public.slot_spins s
  where (
    s.payout>0
    and (
      (
        select count(*)
        from public.balance_ledger l
        where l.game_spin_id=s.id and l.entry_type='game_payout'
      )<>1
      or exists (
        select 1
        from public.balance_ledger l
        where l.game_spin_id=s.id
          and l.entry_type='game_payout'
          and (
            l.user_id is distinct from s.user_id
            or l.amount is distinct from s.payout
          )
      )
    )
  )
  or (
    s.payout=0
    and exists (
      select 1
      from public.balance_ledger l
      where l.game_spin_id=s.id and l.entry_type='game_payout'
    )
  );

  select count(*) into v_plinko_bet_mismatch
  from public.plinko_drops p
  where (
    select count(*)
    from public.balance_ledger l
    where l.plinko_drop_id=p.id and l.entry_type='game_bet'
  )<>1
  or exists (
    select 1
    from public.balance_ledger l
    where l.plinko_drop_id=p.id
      and l.entry_type='game_bet'
      and (
        l.user_id is distinct from p.user_id
        or l.amount is distinct from -p.bet_amount
      )
  );

  select count(*) into v_plinko_payout_mismatch
  from public.plinko_drops p
  where (
    p.payout>0
    and (
      (
        select count(*)
        from public.balance_ledger l
        where l.plinko_drop_id=p.id and l.entry_type='game_payout'
      )<>1
      or exists (
        select 1
        from public.balance_ledger l
        where l.plinko_drop_id=p.id
          and l.entry_type='game_payout'
          and (
            l.user_id is distinct from p.user_id
            or l.amount is distinct from p.payout
          )
      )
    )
  )
  or (
    p.payout=0
    and exists (
      select 1
      from public.balance_ledger l
      where l.plinko_drop_id=p.id and l.entry_type='game_payout'
    )
  );

  select count(*) into v_malformed_game_ledger
  from public.balance_ledger
  where entry_type in ('game_bet','game_payout')
    and (
      (game_spin_id is null and plinko_drop_id is null)
      or (game_spin_id is not null and plinko_drop_id is not null)
    );

  v_issue_total :=
    v_balance_mismatch
    + v_negative_profiles
    + v_ticket_ledger_count
    + v_ticket_ledger_mismatch
    + v_orphan_ticket_ledger
    + v_winner_prize_mismatch
    + v_nonwinner_prize_credits
    + v_slot_bet_mismatch
    + v_slot_payout_mismatch
    + v_plinko_bet_mismatch
    + v_plinko_payout_mismatch
    + v_malformed_game_ledger;

  return jsonb_build_object(
    'ok',v_issue_total=0,
    'checked_at',clock_timestamp(),
    'issue_total',v_issue_total,
    'counts',jsonb_build_object(
      'profile_balance_mismatches',v_balance_mismatch,
      'negative_profile_balances',v_negative_profiles,
      'tickets_without_exact_purchase_ledger',v_ticket_ledger_count,
      'ticket_purchase_mismatches',v_ticket_ledger_mismatch,
      'orphan_ticket_purchase_ledgers',v_orphan_ticket_ledger,
      'winner_prize_ledger_mismatches',v_winner_prize_mismatch,
      'nonwinner_prize_credits',v_nonwinner_prize_credits,
      'slot_bet_mismatches',v_slot_bet_mismatch,
      'slot_payout_mismatches',v_slot_payout_mismatch,
      'plinko_bet_mismatches',v_plinko_bet_mismatch,
      'plinko_payout_mismatches',v_plinko_payout_mismatch,
      'malformed_game_ledger_rows',v_malformed_game_ledger
    ),
    'totals',jsonb_build_object(
      'profiles',v_profiles,
      'ledger_rows',v_ledger_rows,
      'event_tickets',v_tickets,
      'slot_spins',v_slots,
      'plinko_drops',v_plinko
    )
  );
end;
$function$;

create or replace function private.run_draw_credit_integrity_check()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $function$
declare
  v_report jsonb;
begin
  v_report:=private.draw_credit_integrity_report();

  if not coalesce((v_report->>'ok')::boolean,false) then
    if not exists (
      select 1
      from public.audit_logs
      where action='draw_credit_integrity_failed'
        and created_at>now()-interval '1 hour'
    ) then
      insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,new_data)
      values(null,'draw_credit_integrity_failed','system','draw-credit-ledger',v_report);
    end if;
  end if;

  return v_report;
end;
$function$;

create or replace function public.admin_get_draw_credit_integrity_report()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $function$
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  return private.draw_credit_integrity_report();
end;
$function$;

revoke all on function private.draw_credit_integrity_report() from public,anon,authenticated;
revoke all on function private.run_draw_credit_integrity_check() from public,anon,authenticated;
revoke all on function public.admin_get_draw_credit_integrity_report() from public,anon;
grant execute on function public.admin_get_draw_credit_integrity_report() to authenticated;

select cron.schedule(
  'draw-credit-integrity-hourly',
  '17 * * * *',
  'select private.run_draw_credit_integrity_check();'
);
