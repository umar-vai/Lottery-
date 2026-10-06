-- Phase 3 — Ticket / Player Investigation Workspace.
-- Read-only, admin-only investigation RPCs with evidence-based accounting/activity signals.

create or replace function private.admin_player_investigation_report(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $function$
declare
  p public.profiles%rowtype;
  v_ledger_total numeric:=0;
  v_balance_delta numeric:=0;
  v_ticket_count integer:=0;
  v_event_count integer:=0;
  v_ticket_spend numeric:=0;
  v_win_count integer:=0;
  v_prize_total numeric:=0;
  v_ticket_purchase_mismatches integer:=0;
  v_prize_ledger_mismatches integer:=0;
  v_extra_prize_credits integer:=0;
  v_slot_mismatches integer:=0;
  v_plinko_mismatches integer:=0;
  v_admin_adjustment_count integer:=0;
  v_admin_adjustment_total numeric:=0;
  v_max_admin_adjustment_30d numeric:=0;
  v_max_game_plays_minute integer:=0;
  v_max_ticket_event_minute integer:=0;
  v_self_referral boolean:=false;
  v_support_balance numeric:=0;
  v_support_claim_count integer:=0;
  v_support_points_received numeric:=0;
  v_support_adjustment_count integer:=0;
  v_referrals_sent integer:=0;
  v_referral_rewards numeric:=0;
  v_referred_by uuid;
  v_signals jsonb:='[]'::jsonb;
  v_review_level text:='clear';
  v_critical_count integer:=0;
  v_review_count integer:=0;
  v_info_count integer:=0;
  v_last_activity timestamptz;
  v_tickets jsonb:='[]'::jsonb;
  v_ledger jsonb:='[]'::jsonb;
  v_games jsonb:='[]'::jsonb;
  v_support_adjustments jsonb:='[]'::jsonb;
  v_admin_changes jsonb:='[]'::jsonb;
begin
  select * into p from public.profiles where id=p_user_id;
  if not found then raise exception 'Player not found'; end if;

  select coalesce(sum(amount),0)
    into v_ledger_total
  from public.balance_ledger
  where user_id=p_user_id;

  v_balance_delta:=p.balance-v_ledger_total;

  select
    count(*),
    count(distinct event_id),
    coalesce(sum(price_paid),0),
    count(*) filter(where is_winner),
    coalesce(sum(prize_awarded) filter(where is_winner),0)
  into v_ticket_count,v_event_count,v_ticket_spend,v_win_count,v_prize_total
  from public.event_tickets
  where user_id=p_user_id;

  select count(*) into v_ticket_purchase_mismatches
  from public.event_tickets t
  where t.user_id=p_user_id
    and (
      select count(*)
      from public.balance_ledger bl
      where bl.user_id=t.user_id
        and bl.event_id=t.event_id
        and bl.ticket_id=t.id
        and bl.entry_type='ticket_purchase'
        and bl.amount=-t.price_paid
    )<>1;

  select count(*) into v_prize_ledger_mismatches
  from public.event_tickets t
  where t.user_id=p_user_id
    and t.is_winner
    and (
      select count(*)
      from public.balance_ledger bl
      where bl.user_id=t.user_id
        and bl.event_id=t.event_id
        and bl.ticket_id=t.id
        and bl.entry_type='prize_credit'
        and bl.amount=t.prize_awarded
    )<>1;

  select count(*) into v_extra_prize_credits
  from public.balance_ledger bl
  where bl.user_id=p_user_id
    and bl.entry_type='prize_credit'
    and not exists (
      select 1
      from public.event_tickets t
      where t.id=bl.ticket_id
        and t.user_id=bl.user_id
        and t.event_id=bl.event_id
        and t.is_winner
        and t.prize_awarded=bl.amount
    );

  select count(*) into v_slot_mismatches
  from public.slot_spins s
  where s.user_id=p_user_id
    and (
      s.balance_after is distinct from s.balance_before-s.bet_amount+s.payout
      or (
        select count(*)
        from public.balance_ledger bl
        where bl.user_id=s.user_id
          and bl.game_spin_id=s.id
          and bl.entry_type='game_bet'
          and bl.amount=-s.bet_amount
      )<>1
      or (
        case
          when s.payout>0 then (
            select count(*)
            from public.balance_ledger bl
            where bl.user_id=s.user_id
              and bl.game_spin_id=s.id
              and bl.entry_type='game_payout'
              and bl.amount=s.payout
          )<>1
          else exists (
            select 1
            from public.balance_ledger bl
            where bl.user_id=s.user_id
              and bl.game_spin_id=s.id
              and bl.entry_type='game_payout'
          )
        end
      )
    );

  select count(*) into v_plinko_mismatches
  from public.plinko_drops d
  where d.user_id=p_user_id
    and (
      d.balance_after is distinct from d.balance_before-d.bet_amount+d.payout
      or (
        select count(*)
        from public.balance_ledger bl
        where bl.user_id=d.user_id
          and bl.plinko_drop_id=d.id
          and bl.entry_type='game_bet'
          and bl.amount=-d.bet_amount
      )<>1
      or (
        case
          when d.payout>0 then (
            select count(*)
            from public.balance_ledger bl
            where bl.user_id=d.user_id
              and bl.plinko_drop_id=d.id
              and bl.entry_type='game_payout'
              and bl.amount=d.payout
          )<>1
          else exists (
            select 1
            from public.balance_ledger bl
            where bl.user_id=d.user_id
              and bl.plinko_drop_id=d.id
              and bl.entry_type='game_payout'
          )
        end
      )
    );

  select
    count(*),
    coalesce(sum(amount),0),
    coalesce(max(abs(amount)) filter(where created_at>=now()-interval '30 days'),0)
  into v_admin_adjustment_count,v_admin_adjustment_total,v_max_admin_adjustment_30d
  from public.balance_ledger
  where user_id=p_user_id
    and entry_type='admin_adjustment';

  select coalesce(max(n),0)::integer into v_max_game_plays_minute
  from (
    select date_trunc('minute',created_at) bucket,count(*) n
    from (
      select created_at from public.slot_spins where user_id=p_user_id
      union all
      select created_at from public.plinko_drops where user_id=p_user_id
    ) z
    group by date_trunc('minute',created_at)
  ) q;

  select coalesce(max(n),0)::integer into v_max_ticket_event_minute
  from (
    select event_id,date_trunc('minute',created_at) bucket,count(*) n
    from public.event_tickets
    where user_id=p_user_id
    group by event_id,date_trunc('minute',created_at)
  ) q;

  select exists(
    select 1 from public.referrals
    where referrer_user_id=p_user_id and referred_user_id=p_user_id
  ) into v_self_referral;

  select coalesce(balance,0)
    into v_support_balance
  from public.support_wallets
  where user_id=p_user_id;
  v_support_balance:=coalesce(v_support_balance,0);

  select count(*),coalesce(sum(points),0)
    into v_support_claim_count,v_support_points_received
  from public.support_point_claims
  where user_id=p_user_id;

  select count(*)
    into v_support_adjustment_count
  from public.support_point_adjustments
  where user_id=p_user_id;

  select count(*)
    into v_referrals_sent
  from public.referrals
  where referrer_user_id=p_user_id;

  select coalesce(sum(amount),0)
    into v_referral_rewards
  from public.referral_rewards
  where referrer_user_id=p_user_id;

  select referrer_user_id
    into v_referred_by
  from public.referrals
  where referred_user_id=p_user_id
  limit 1;

  if v_balance_delta<>0 then
    v_critical_count:=v_critical_count+1;
    v_signals:=v_signals||jsonb_build_array(jsonb_build_object(
      'level','critical','code','draw_credit_balance_mismatch',
      'title','Draw Credit balance does not reconcile',
      'detail','Profile balance differs from the sum of this player''s Draw Credit ledger by '||v_balance_delta||' credits.',
      'evidence',jsonb_build_object('profile_balance',p.balance,'ledger_total',v_ledger_total,'delta',v_balance_delta)
    ));
  end if;

  if p.balance<0 then
    v_critical_count:=v_critical_count+1;
    v_signals:=v_signals||jsonb_build_array(jsonb_build_object(
      'level','critical','code','negative_draw_credit_balance',
      'title','Negative Draw Credit balance',
      'detail','The authoritative profile balance is below zero.',
      'evidence',jsonb_build_object('balance',p.balance)
    ));
  end if;

  if v_ticket_purchase_mismatches>0 then
    v_critical_count:=v_critical_count+1;
    v_signals:=v_signals||jsonb_build_array(jsonb_build_object(
      'level','critical','code','ticket_purchase_ledger_mismatch',
      'title','Ticket purchase accounting mismatch',
      'detail',v_ticket_purchase_mismatches||' ticket(s) do not have exactly one matching purchase ledger debit.',
      'evidence',jsonb_build_object('mismatches',v_ticket_purchase_mismatches)
    ));
  end if;

  if v_prize_ledger_mismatches+v_extra_prize_credits>0 then
    v_critical_count:=v_critical_count+1;
    v_signals:=v_signals||jsonb_build_array(jsonb_build_object(
      'level','critical','code','prize_credit_ledger_mismatch',
      'title','Winner prize accounting mismatch',
      'detail',(v_prize_ledger_mismatches+v_extra_prize_credits)||' prize-credit inconsistency/inconsistencies found.',
      'evidence',jsonb_build_object('winner_mismatches',v_prize_ledger_mismatches,'extra_prize_credits',v_extra_prize_credits)
    ));
  end if;

  if v_slot_mismatches+v_plinko_mismatches>0 then
    v_critical_count:=v_critical_count+1;
    v_signals:=v_signals||jsonb_build_array(jsonb_build_object(
      'level','critical','code','game_ledger_mismatch',
      'title','Game accounting mismatch',
      'detail',(v_slot_mismatches+v_plinko_mismatches)||' Slot/Plinko result(s) disagree with their ledger or stored balance transition.',
      'evidence',jsonb_build_object('slot_mismatches',v_slot_mismatches,'plinko_mismatches',v_plinko_mismatches)
    ));
  end if;

  if v_self_referral then
    v_critical_count:=v_critical_count+1;
    v_signals:=v_signals||jsonb_build_array(jsonb_build_object(
      'level','critical','code','self_referral',
      'title','Self-referral relationship found',
      'detail','The same user appears as both referrer and referred user.',
      'evidence',jsonb_build_object('user_id',p_user_id)
    ));
  end if;

  if v_max_admin_adjustment_30d>=10000 then
    v_review_count:=v_review_count+1;
    v_signals:=v_signals||jsonb_build_array(jsonb_build_object(
      'level','review','code','large_admin_adjustment',
      'title','Large recent admin Draw Credit adjustment',
      'detail','At least one admin adjustment in the last 30 days is 10,000 credits or more in absolute value. Review the operator reason; this is not by itself evidence of misuse.',
      'evidence',jsonb_build_object('largest_absolute_adjustment_30d',v_max_admin_adjustment_30d,'threshold',10000)
    ));
  end if;

  if v_max_game_plays_minute>=100 then
    v_review_count:=v_review_count+1;
    v_signals:=v_signals||jsonb_build_array(jsonb_build_object(
      'level','review','code','high_game_request_velocity',
      'title','High game request velocity',
      'detail','At least 100 Slot/Plinko plays occurred within one clock minute. This can be load testing or automation and is a review signal, not a fraud conclusion.',
      'evidence',jsonb_build_object('max_plays_in_one_minute',v_max_game_plays_minute,'threshold',100)
    ));
  end if;

  if v_max_ticket_event_minute>=5 then
    v_info_count:=v_info_count+1;
    v_signals:=v_signals||jsonb_build_array(jsonb_build_object(
      'level','info','code','rapid_ticket_purchase',
      'title','Rapid ticket purchase burst',
      'detail','Five or more tickets for one lottery were purchased within one clock minute. This may be normal use and is shown only as context.',
      'evidence',jsonb_build_object('max_same_event_tickets_in_one_minute',v_max_ticket_event_minute,'threshold',5)
    ));
  end if;

  v_review_level:=case
    when v_critical_count>0 then 'attention'
    when v_review_count>0 then 'review'
    when v_info_count>0 then 'watch'
    else 'clear'
  end;

  select greatest(
    p.created_at,
    coalesce((select max(created_at) from public.event_tickets where user_id=p_user_id),p.created_at),
    coalesce((select max(created_at) from public.balance_ledger where user_id=p_user_id),p.created_at),
    coalesce((select max(created_at) from public.slot_spins where user_id=p_user_id),p.created_at),
    coalesce((select max(created_at) from public.plinko_drops where user_id=p_user_id),p.created_at),
    coalesce((select max(created_at) from public.support_point_claims where user_id=p_user_id),p.created_at)
  ) into v_last_activity;

  select coalesce(jsonb_agg(row_data order by created_at desc),'[]'::jsonb)
    into v_tickets
  from (
    select
      t.created_at,
      jsonb_build_object(
        'id',t.id,
        'ticket_ref',private.public_ticket_ref(t.id),
        'event_id',t.event_id,
        'event_title',e.title,
        'event_slug',e.slug,
        'event_status',e.status,
        'white_numbers',t.white_numbers,
        'bonus_ball',t.bonus_ball,
        'price_paid',t.price_paid,
        'is_winner',t.is_winner,
        'winner_rank',t.winner_rank,
        'prize_awarded',t.prize_awarded,
        'created_at',t.created_at,
        'purchase_ledger_ok',(
          select count(*)=1
          from public.balance_ledger bl
          where bl.user_id=t.user_id and bl.event_id=t.event_id and bl.ticket_id=t.id
            and bl.entry_type='ticket_purchase' and bl.amount=-t.price_paid
        ),
        'prize_ledger_ok',case
          when t.is_winner then (
            select count(*)=1
            from public.balance_ledger bl
            where bl.user_id=t.user_id and bl.event_id=t.event_id and bl.ticket_id=t.id
              and bl.entry_type='prize_credit' and bl.amount=t.prize_awarded
          )
          else not exists(
            select 1 from public.balance_ledger bl
            where bl.ticket_id=t.id and bl.entry_type='prize_credit'
          )
        end
      ) row_data
    from public.event_tickets t
    join public.lottery_events e on e.id=t.event_id
    where t.user_id=p_user_id
    order by t.created_at desc
    limit 100
  ) q;

  select coalesce(jsonb_agg(row_data order by created_at desc),'[]'::jsonb)
    into v_ledger
  from (
    select
      bl.created_at,
      jsonb_build_object(
        'id',bl.id,'amount',bl.amount,'balance_after',bl.balance_after,'entry_type',bl.entry_type,
        'event_id',bl.event_id,'ticket_id',bl.ticket_id,'game_spin_id',bl.game_spin_id,'plinko_drop_id',bl.plinko_drop_id,
        'note',bl.note,'created_at',bl.created_at,'actor_user_id',bl.actor_user_id,
        'actor_name',coalesce(a.display_name,a.email),
        'event_title',e.title
      ) row_data
    from public.balance_ledger bl
    left join public.profiles a on a.id=bl.actor_user_id
    left join public.lottery_events e on e.id=bl.event_id
    where bl.user_id=p_user_id
    order by bl.created_at desc
    limit 150
  ) q;

  select coalesce(jsonb_agg(row_data order by created_at desc),'[]'::jsonb)
    into v_games
  from (
    select s.created_at,
      jsonb_build_object(
        'kind','slot','id',s.id,'bet',s.bet_amount,'payout',s.payout,'net',s.net_change,
        'outcome',s.outcome_kind,'risk',null,'multiplier',s.multiplier,'created_at',s.created_at
      ) row_data
    from public.slot_spins s where s.user_id=p_user_id
    union all
    select d.created_at,
      jsonb_build_object(
        'kind','plinko','id',d.id,'bet',d.bet_amount,'payout',d.payout,'net',d.net_change,
        'outcome',d.outcome_kind,'risk',d.risk_mode,'multiplier',d.multiplier,'created_at',d.created_at
      ) row_data
    from public.plinko_drops d where d.user_id=p_user_id
    order by created_at desc
    limit 60
  ) q;

  select coalesce(jsonb_agg(row_data order by created_at desc),'[]'::jsonb)
    into v_support_adjustments
  from (
    select a.created_at,
      jsonb_build_object(
        'id',a.id,'previous_balance',a.previous_balance,'new_balance',a.new_balance,
        'actor_user_id',a.actor_user_id,'actor_name',coalesce(ap.display_name,ap.email),
        'note',a.note,'created_at',a.created_at
      ) row_data
    from public.support_point_adjustments a
    left join public.profiles ap on ap.id=a.actor_user_id
    where a.user_id=p_user_id
    order by a.created_at desc
    limit 30
  ) q;

  select coalesce(jsonb_agg(row_data order by created_at desc),'[]'::jsonb)
    into v_admin_changes
  from (
    select a.created_at,
      jsonb_build_object(
        'id',a.id,'action',a.action,'table_name',a.table_name,'row_id',a.row_id,
        'reason',a.reason,'actor_user_id',a.actor_user_id,'request_path',a.request_path,
        'request_ip',a.request_ip,'user_agent',a.user_agent,'created_at',a.created_at
      ) row_data
    from private.admin_change_audit a
    where a.row_id=p_user_id::text
       or a.old_data->>'user_id'=p_user_id::text
       or a.new_data->>'user_id'=p_user_id::text
       or a.old_data->>'id'=p_user_id::text
       or a.new_data->>'id'=p_user_id::text
    order by a.created_at desc
    limit 50
  ) q;

  return jsonb_build_object(
    'generated_at',clock_timestamp(),
    'review',jsonb_build_object(
      'level',v_review_level,
      'critical_count',v_critical_count,
      'review_count',v_review_count,
      'info_count',v_info_count,
      'signals',v_signals,
      'signal_policy','Signals identify accounting inconsistencies or operational patterns for human review. Activity flags are not fraud determinations.'
    ),
    'profile',jsonb_build_object(
      'id',p.id,'display_name',p.display_name,'nickname',p.nickname,'email',p.email,'role',p.role,
      'referral_code',p.referral_code,'created_at',p.created_at,'updated_at',p.updated_at,'last_activity_at',v_last_activity
    ),
    'draw_credits',jsonb_build_object(
      'balance',p.balance,'ledger_total',v_ledger_total,'balance_delta',v_balance_delta,
      'ticket_spend',v_ticket_spend,'prizes',v_prize_total,
      'admin_adjustment_count',v_admin_adjustment_count,'admin_adjustment_total',v_admin_adjustment_total,
      'largest_admin_adjustment_30d',v_max_admin_adjustment_30d,
      'accounting_ok',v_balance_delta=0 and v_ticket_purchase_mismatches=0
        and v_prize_ledger_mismatches=0 and v_extra_prize_credits=0
        and v_slot_mismatches=0 and v_plinko_mismatches=0 and p.balance>=0
    ),
    'lottery',jsonb_build_object(
      'ticket_count',v_ticket_count,'event_count',v_event_count,'wins',v_win_count,
      'ticket_purchase_mismatches',v_ticket_purchase_mismatches,
      'winner_prize_mismatches',v_prize_ledger_mismatches,
      'extra_prize_credits',v_extra_prize_credits,
      'max_same_event_tickets_in_one_minute',v_max_ticket_event_minute
    ),
    'games',jsonb_build_object(
      'slot_count',(select count(*) from public.slot_spins where user_id=p_user_id),
      'plinko_count',(select count(*) from public.plinko_drops where user_id=p_user_id),
      'slot_accounting_mismatches',v_slot_mismatches,
      'plinko_accounting_mismatches',v_plinko_mismatches,
      'max_plays_in_one_minute',v_max_game_plays_minute
    ),
    'support_points',jsonb_build_object(
      'separate_from_draw_credits',true,
      'balance',v_support_balance,
      'claim_count',v_support_claim_count,
      'points_received',v_support_points_received,
      'admin_adjustment_count',v_support_adjustment_count
    ),
    'referrals',jsonb_build_object(
      'referrals_sent',v_referrals_sent,'reward_total',v_referral_rewards,'referred_by',v_referred_by,
      'self_referral',v_self_referral
    ),
    'tickets',v_tickets,
    'ledger',v_ledger,
    'recent_games',v_games,
    'support_adjustments',v_support_adjustments,
    'admin_changes',v_admin_changes
  );
end;
$function$;

create or replace function public.admin_search_investigation_subjects(
  p_query text default null,
  p_limit integer default 25
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $function$
declare
  v_query text:=lower(trim(coalesce(p_query,'')));
  v_limit integer:=greatest(1,least(coalesce(p_limit,25),50));
  v_rows jsonb;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;

  with matched as (
    select
      p.*,
      case
        when v_query='' then 'recent'
        when lower(coalesce(p.display_name,'')) like '%'||v_query||'%'
          or lower(coalesce(p.nickname,'')) like '%'||v_query||'%'
          or lower(coalesce(p.email,'')) like '%'||v_query||'%'
          or lower(coalesce(p.referral_code,'')) like '%'||v_query||'%'
          or lower(p.id::text) like '%'||v_query||'%' then 'profile'
        when exists(
          select 1
          from public.event_tickets t
          where t.user_id=p.id and lower(t.id::text) like '%'||v_query||'%'
        ) then 'ticket'
        else 'lottery'
      end matched_by
    from public.profiles p
    where v_query=''
       or lower(coalesce(p.display_name,'')) like '%'||v_query||'%'
       or lower(coalesce(p.nickname,'')) like '%'||v_query||'%'
       or lower(coalesce(p.email,'')) like '%'||v_query||'%'
       or lower(coalesce(p.referral_code,'')) like '%'||v_query||'%'
       or lower(p.id::text) like '%'||v_query||'%'
       or exists(
          select 1 from public.event_tickets t
          where t.user_id=p.id and lower(t.id::text) like '%'||v_query||'%'
       )
       or exists(
          select 1
          from public.event_tickets t
          join public.lottery_events e on e.id=t.event_id
          where t.user_id=p.id
            and (lower(e.title) like '%'||v_query||'%' or lower(e.slug) like '%'||v_query||'%')
       )
    order by p.created_at desc
    limit v_limit
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id',m.id,'display_name',m.display_name,'nickname',m.nickname,'email',m.email,'role',m.role,
      'balance',m.balance,'support_points',coalesce(sw.balance,0),'created_at',m.created_at,'matched_by',m.matched_by,
      'ticket_count',coalesce(ts.ticket_count,0),'wins',coalesce(ts.wins,0),'ticket_spend',coalesce(ts.ticket_spend,0),
      'prizes',coalesce(ts.prizes,0),'game_plays',coalesce(gs.game_plays,0),
      'admin_adjustment_count',coalesce(ls.adjustment_count,0),'admin_adjustment_total',coalesce(ls.adjustment_total,0),
      'ledger_total',coalesce(ls.ledger_total,0),'balance_delta',m.balance-coalesce(ls.ledger_total,0),
      'last_activity_at',greatest(
        m.created_at,
        coalesce(ts.last_ticket_at,m.created_at),
        coalesce(ls.last_ledger_at,m.created_at),
        coalesce(gs.last_game_at,m.created_at)
      )
    )
    order by greatest(
      m.created_at,
      coalesce(ts.last_ticket_at,m.created_at),
      coalesce(ls.last_ledger_at,m.created_at),
      coalesce(gs.last_game_at,m.created_at)
    ) desc
  ),'[]'::jsonb)
  into v_rows
  from matched m
  left join public.support_wallets sw on sw.user_id=m.id
  left join lateral (
    select count(*) ticket_count,
      count(*) filter(where is_winner) wins,
      coalesce(sum(price_paid),0) ticket_spend,
      coalesce(sum(prize_awarded) filter(where is_winner),0) prizes,
      max(created_at) last_ticket_at
    from public.event_tickets t where t.user_id=m.id
  ) ts on true
  left join lateral (
    select count(*) filter(where entry_type='admin_adjustment') adjustment_count,
      coalesce(sum(amount) filter(where entry_type='admin_adjustment'),0) adjustment_total,
      coalesce(sum(amount),0) ledger_total,
      max(created_at) last_ledger_at
    from public.balance_ledger bl where bl.user_id=m.id
  ) ls on true
  left join lateral (
    select count(*) game_plays,max(created_at) last_game_at
    from (
      select created_at from public.slot_spins s where s.user_id=m.id
      union all
      select created_at from public.plinko_drops d where d.user_id=m.id
    ) x
  ) gs on true;

  return jsonb_build_object(
    'query',coalesce(p_query,''),
    'limit',v_limit,
    'subjects',v_rows,
    'generated_at',clock_timestamp()
  );
end;
$function$;

create or replace function public.admin_get_player_investigation(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $function$
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  return private.admin_player_investigation_report(p_user_id);
end;
$function$;

create or replace function public.admin_get_ticket_investigation(p_ticket_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $function$
declare
  t public.event_tickets%rowtype;
  e public.lottery_events%rowtype;
  p public.profiles%rowtype;
  v_purchase_count integer:=0;
  v_prize_count integer:=0;
  v_any_prize_count integer:=0;
  v_tier_prize numeric;
  v_numbers_ok boolean:=false;
  v_bonus_ok boolean:=false;
  v_summary_ok boolean:=true;
  v_ledger jsonb:='[]'::jsonb;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;

  select * into t from public.event_tickets where id=p_ticket_id;
  if not found then raise exception 'Ticket not found'; end if;
  select * into e from public.lottery_events where id=t.event_id;
  select * into p from public.profiles where id=t.user_id;

  select count(*) into v_purchase_count
  from public.balance_ledger bl
  where bl.user_id=t.user_id and bl.event_id=t.event_id and bl.ticket_id=t.id
    and bl.entry_type='ticket_purchase' and bl.amount=-t.price_paid;

  select
    count(*) filter(where bl.amount=t.prize_awarded),
    count(*)
  into v_prize_count,v_any_prize_count
  from public.balance_ledger bl
  where bl.user_id=t.user_id and bl.event_id=t.event_id and bl.ticket_id=t.id
    and bl.entry_type='prize_credit';

  select prize_amount into v_tier_prize
  from public.event_prize_tiers
  where event_id=t.event_id and rank=t.winner_rank;

  v_numbers_ok:=
    array_length(t.white_numbers,1)=e.white_ball_count
    and (select count(distinct n)=count(*) from unnest(t.white_numbers) n)
    and not exists(select 1 from unnest(t.white_numbers) n where n<1 or n>e.white_ball_max);

  v_bonus_ok:=case
    when e.bonus_ball_enabled then t.bonus_ball between 1 and e.bonus_ball_max
    else t.bonus_ball is null
  end;

  if e.status='completed' and t.is_winner then
    v_summary_ok:=exists(
      select 1
      from jsonb_array_elements(
        case when jsonb_typeof(e.winner_summary)='array' then e.winner_summary else '[]'::jsonb end
      ) s
      where nullif(s->>'rank','')::integer=t.winner_rank
        and s->>'ticket_ref'=private.public_ticket_ref(t.id)
        and s->>'winner_key'=private.public_winner_key(t.user_id)
        and nullif(s->>'prize','')::numeric=t.prize_awarded
        and s->'white_numbers'=to_jsonb(t.white_numbers)
        and (
          (t.bonus_ball is null and (s->'bonus_ball' is null or s->'bonus_ball'='null'::jsonb))
          or nullif(s->>'bonus_ball','')::integer=t.bonus_ball
        )
    );
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id',bl.id,'entry_type',bl.entry_type,'amount',bl.amount,'balance_after',bl.balance_after,
      'actor_user_id',bl.actor_user_id,'actor_name',coalesce(a.display_name,a.email),
      'note',bl.note,'created_at',bl.created_at
    ) order by bl.created_at
  ),'[]'::jsonb)
  into v_ledger
  from public.balance_ledger bl
  left join public.profiles a on a.id=bl.actor_user_id
  where bl.ticket_id=t.id;

  return jsonb_build_object(
    'generated_at',clock_timestamp(),
    'ok',
      v_numbers_ok and v_bonus_ok and v_purchase_count=1
      and (
        (t.is_winner and v_tier_prize=t.prize_awarded and v_prize_count=1 and v_any_prize_count=1 and v_summary_ok)
        or (not t.is_winner and v_any_prize_count=0)
      ),
    'ticket',jsonb_build_object(
      'id',t.id,'ticket_ref',private.public_ticket_ref(t.id),'event_id',t.event_id,'user_id',t.user_id,
      'white_numbers',t.white_numbers,'bonus_ball',t.bonus_ball,'price_paid',t.price_paid,
      'is_winner',t.is_winner,'winner_rank',t.winner_rank,'prize_awarded',t.prize_awarded,'created_at',t.created_at
    ),
    'player',jsonb_build_object(
      'id',p.id,'display_name',p.display_name,'email',p.email,'role',p.role,'balance',p.balance
    ),
    'event',jsonb_build_object(
      'id',e.id,'title',e.title,'slug',e.slug,'status',e.status,'white_ball_count',e.white_ball_count,
      'white_ball_max',e.white_ball_max,'bonus_ball_enabled',e.bonus_ball_enabled,'bonus_ball_max',e.bonus_ball_max,
      'winner_count',e.winner_count,'completed_at',e.completed_at
    ),
    'checks',jsonb_build_array(
      jsonb_build_object('key','numbers','label','Ticket numbers still satisfy this lottery''s number rules','ok',v_numbers_ok),
      jsonb_build_object('key','bonus','label','Bonus-ball value matches this lottery''s rule','ok',v_bonus_ok),
      jsonb_build_object('key','purchase_ledger','label','Exactly one matching ticket-purchase debit exists','ok',v_purchase_count=1,'detail',v_purchase_count||' matching row(s)'),
      jsonb_build_object('key','winner_tier','label','Winner prize matches configured rank, when applicable','ok',not t.is_winner or v_tier_prize=t.prize_awarded),
      jsonb_build_object('key','prize_ledger','label','Prize-credit ledger state matches winner state','ok',(t.is_winner and v_prize_count=1 and v_any_prize_count=1) or (not t.is_winner and v_any_prize_count=0),'detail',v_any_prize_count||' total prize row(s); '||v_prize_count||' exact match(es)'),
      jsonb_build_object('key','public_summary','label','Completed winner appears correctly in the privacy-safe public summary','ok',v_summary_ok)
    ),
    'ledger',v_ledger
  );
end;
$function$;

revoke all on function private.admin_player_investigation_report(uuid) from public,anon,authenticated;
revoke all on function public.admin_search_investigation_subjects(text,integer) from public,anon,authenticated;
revoke all on function public.admin_get_player_investigation(uuid) from public,anon,authenticated;
revoke all on function public.admin_get_ticket_investigation(uuid) from public,anon,authenticated;

grant execute on function public.admin_search_investigation_subjects(text,integer) to authenticated;
grant execute on function public.admin_get_player_investigation(uuid) to authenticated;
grant execute on function public.admin_get_ticket_investigation(uuid) to authenticated;
