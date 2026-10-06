-- Phase 2 — scheduled draw exactly-once hardening.
-- 1) A completed event is an idempotent no-op under retries.
-- 2) Prize ledger rows are unique per event/ticket as defense in depth.

create unique index if not exists balance_ledger_one_prize_credit_per_event_ticket_idx
on public.balance_ledger(event_id,ticket_id)
where entry_type='prize_credit'
  and event_id is not null
  and ticket_id is not null;

create or replace function private.run_lottery_event_internal(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog','public','private','extensions'
as $function$
declare
  v_event public.lottery_events%rowtype;
  v_seed text;
  v_commit text;
  v_ticket_count integer;
  v_balance numeric;
  v_prize numeric;
  v_summary jsonb:='[]'::jsonb;
  v_first_numbers integer[];
  v_first_bonus integer;
  r record;
begin
  if not private.platform_feature_enabled('events') then
    raise exception 'Events are temporarily unavailable';
  end if;

  -- This row lock is the serialization boundary shared by cron and admin draws.
  select * into v_event
  from public.lottery_events
  where id=p_event_id
  for update;

  if not found then
    raise exception 'Event not found';
  end if;

  -- A concurrent runner may have completed the event while this call waited
  -- on FOR UPDATE. Treat that retry as a successful no-op.
  if v_event.status='completed' then
    return;
  end if;

  if v_event.status<>'published' then
    raise exception 'Event is not published';
  end if;

  if v_event.schedule_mode='scheduled'
     and v_event.cutoff_at is not null
     and now()<v_event.cutoff_at then
    raise exception 'Cannot run draw before ticket cutoff';
  end if;

  select count(*) into v_ticket_count
  from public.event_tickets
  where event_id=p_event_id;

  if v_ticket_count=0 then
    raise exception 'Cannot draw an event with no tickets';
  end if;

  if v_ticket_count<v_event.winner_count then
    raise exception 'Not enough tickets for configured winner count (% winners, % tickets)',
      v_event.winner_count,v_ticket_count;
  end if;

  if (select count(*) from public.event_prize_tiers where event_id=p_event_id)<>v_event.winner_count then
    raise exception 'Prize tiers do not match winner count';
  end if;

  v_seed:=encode(extensions.gen_random_bytes(32),'hex');
  v_commit:=encode(extensions.digest(v_seed,'sha256'),'hex');

  update public.event_tickets
  set is_winner=false,winner_rank=null,prize_awarded=0
  where event_id=p_event_id;

  for r in
    select q.id,q.user_id,q.white_numbers,q.bonus_ball,q.rn::integer as winner_rank
    from (
      select t.*,
        row_number() over(
          order by extensions.digest(v_seed||':ticket:'||t.id::text,'sha256')
        ) rn
      from public.event_tickets t
      where t.event_id=p_event_id
    ) q
    where q.rn<=v_event.winner_count
    order by q.rn
  loop
    select prize_amount into v_prize
    from public.event_prize_tiers
    where event_id=p_event_id and rank=r.winner_rank;

    update public.event_tickets
    set is_winner=true,winner_rank=r.winner_rank,prize_awarded=v_prize
    where id=r.id;

    update public.profiles
    set balance=balance+v_prize,updated_at=now()
    where id=r.user_id
    returning balance into v_balance;

    insert into public.balance_ledger(
      user_id,amount,balance_after,entry_type,event_id,ticket_id,note
    ) values(
      r.user_id,v_prize,v_balance,'prize_credit',p_event_id,r.id,
      'Rank #'||r.winner_rank||' virtual-credit event prize'
    );

    if r.winner_rank=1 then
      v_first_numbers:=r.white_numbers;
      v_first_bonus:=r.bonus_ball;
    end if;

    v_summary:=v_summary||jsonb_build_array(
      jsonb_build_object(
        'rank',r.winner_rank,
        'ticket_id',r.id,
        'white_numbers',r.white_numbers,
        'bonus_ball',r.bonus_ball,
        'prize',v_prize
      )
    );
  end loop;

  update public.lottery_events
  set status='completed',
      winning_numbers=v_first_numbers,
      winning_bonus_ball=v_first_bonus,
      seed_commitment=v_commit,
      seed_reveal=v_seed,
      winning_ticket_count=v_event.winner_count,
      prize_per_winning_ticket=0,
      winner_summary=v_summary,
      completed_at=now(),
      updated_at=now()
  where id=p_event_id;

  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,new_data)
  values(
    null,'run_lottery_event','lottery_event',p_event_id::text,
    jsonb_build_object(
      'selection_mode','existing_ticket_pool',
      'ticket_count',v_ticket_count,
      'winner_count',v_event.winner_count,
      'winners',v_summary,
      'automatic',v_event.schedule_mode='scheduled'
    )
  );
end;
$function$;
