-- Phase 3 — guided lottery lifecycle and post-draw verification.
-- Adds server-authoritative lifecycle review, guarded publish, and completed-result verification.

create or replace function private.lottery_event_lifecycle_review(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','private','extensions'
as $function$
declare
  e public.lottery_events%rowtype;
  v_ticket_count integer:=0;
  v_player_count integer:=0;
  v_tier_count integer:=0;
  v_tier_total numeric:=0;
  v_winner_rows integer:=0;
  v_distinct_ranks integer:=0;
  v_min_rank integer;
  v_max_rank integer;
  v_winner_tier_mismatch integer:=0;
  v_purchase_ledger_mismatch integer:=0;
  v_prize_ledger_mismatch integer:=0;
  v_extra_prize_ledger integer:=0;
  v_summary_count integer:=0;
  v_summary_mismatch integer:=0;
  v_seed_ok boolean:=false;
  v_top_mirror_ok boolean:=false;
  v_feature_ok boolean:=false;
  v_schedule_ok boolean:=false;
  v_publish_ready boolean:=false;
  v_draw_ready boolean:=false;
  v_post_ready boolean:=false;
  v_state text;
  v_next_action text;
  v_fingerprint text;
  v_verified_at timestamptz;
  v_verified_by uuid;
  v_verified_note text;
  v_verified_fingerprint text;
  v_verification_status text:='unverified';
begin
  select * into e
  from public.lottery_events
  where id=p_event_id;

  if not found then
    raise exception 'Event not found';
  end if;

  v_feature_ok:=private.platform_feature_enabled('events');

  select count(*),count(distinct user_id)
    into v_ticket_count,v_player_count
  from public.event_tickets
  where event_id=e.id;

  select count(*),coalesce(sum(prize_amount),0)
    into v_tier_count,v_tier_total
  from public.event_prize_tiers
  where event_id=e.id;

  select
    count(*) filter(where is_winner),
    count(distinct winner_rank) filter(where is_winner),
    min(winner_rank) filter(where is_winner),
    max(winner_rank) filter(where is_winner)
  into v_winner_rows,v_distinct_ranks,v_min_rank,v_max_rank
  from public.event_tickets
  where event_id=e.id;

  select count(*) into v_winner_tier_mismatch
  from public.event_tickets t
  left join public.event_prize_tiers pt
    on pt.event_id=t.event_id and pt.rank=t.winner_rank
  where t.event_id=e.id
    and t.is_winner
    and (
      t.winner_rank is null
      or pt.rank is null
      or t.prize_awarded is distinct from pt.prize_amount
    );

  select count(*) into v_purchase_ledger_mismatch
  from public.event_tickets t
  where t.event_id=e.id
    and (
      select count(*)
      from public.balance_ledger bl
      where bl.ticket_id=t.id
        and bl.event_id=e.id
        and bl.user_id=t.user_id
        and bl.entry_type='ticket_purchase'
        and bl.amount=-t.price_paid
    )<>1;

  select count(*) into v_prize_ledger_mismatch
  from public.event_tickets t
  where t.event_id=e.id
    and t.is_winner
    and (
      select count(*)
      from public.balance_ledger bl
      where bl.ticket_id=t.id
        and bl.event_id=e.id
        and bl.user_id=t.user_id
        and bl.entry_type='prize_credit'
        and bl.amount=t.prize_awarded
    )<>1;

  select count(*) into v_extra_prize_ledger
  from public.balance_ledger bl
  where bl.event_id=e.id
    and bl.entry_type='prize_credit'
    and not exists (
      select 1
      from public.event_tickets t
      where t.id=bl.ticket_id
        and t.event_id=e.id
        and t.user_id=bl.user_id
        and t.is_winner
        and t.prize_awarded=bl.amount
    );

  v_summary_count:=case
    when jsonb_typeof(e.winner_summary)='array' then jsonb_array_length(e.winner_summary)
    else 0
  end;

  if e.status='completed' then
    select count(*) into v_summary_mismatch
    from public.event_tickets t
    where t.event_id=e.id
      and t.is_winner
      and not exists (
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

    v_seed_ok:=
      e.seed_reveal is not null
      and e.seed_commitment is not null
      and encode(extensions.digest(e.seed_reveal,'sha256'),'hex')=e.seed_commitment;

    select coalesce(
      t.white_numbers=e.winning_numbers
      and t.bonus_ball is not distinct from e.winning_bonus_ball,
      false
    )
    into v_top_mirror_ok
    from public.event_tickets t
    where t.event_id=e.id
      and t.is_winner
      and t.winner_rank=1
    limit 1;

    v_top_mirror_ok:=coalesce(v_top_mirror_ok,false);
  end if;

  v_schedule_ok:=case
    when e.schedule_mode='manual' then e.opens_at is not null
    when e.schedule_mode='scheduled' then
      e.opens_at is not null
      and e.cutoff_at is not null
      and e.draw_at is not null
      and e.opens_at<e.cutoff_at
      and e.cutoff_at<e.draw_at
    else false
  end;

  v_publish_ready:=
    e.status='draft'
    and v_feature_ok
    and nullif(trim(e.title),'') is not null
    and nullif(trim(e.slug),'') is not null
    and v_schedule_ok
    and (e.schedule_mode='manual' or (e.cutoff_at>now() and e.draw_at>now()))
    and e.winner_count between 1 and 100
    and v_tier_count=e.winner_count
    and v_tier_total=e.prize_amount
    and (e.max_total_tickets is null or e.max_total_tickets>=e.winner_count)
    and v_ticket_count=0
    and v_winner_rows=0
    and not exists (
      select 1 from public.balance_ledger bl
      where bl.event_id=e.id and bl.entry_type='prize_credit'
    );

  v_draw_ready:=
    e.status='published'
    and v_feature_ok
    and now()>=e.opens_at
    and (
      e.schedule_mode='manual'
      or (e.schedule_mode='scheduled' and e.cutoff_at is not null and now()>=e.cutoff_at)
    )
    and v_ticket_count>=e.winner_count
    and v_tier_count=e.winner_count
    and v_tier_total=e.prize_amount
    and v_purchase_ledger_mismatch=0
    and v_winner_rows=0
    and not exists (
      select 1 from public.balance_ledger bl
      where bl.event_id=e.id and bl.entry_type='prize_credit'
    );

  v_post_ready:=
    e.status='completed'
    and e.completed_at is not null
    and v_ticket_count>=e.winner_count
    and v_tier_count=e.winner_count
    and v_tier_total=e.prize_amount
    and v_purchase_ledger_mismatch=0
    and v_winner_rows=e.winner_count
    and v_distinct_ranks=e.winner_count
    and v_min_rank=1
    and v_max_rank=e.winner_count
    and e.winning_ticket_count=e.winner_count
    and v_winner_tier_mismatch=0
    and v_prize_ledger_mismatch=0
    and v_extra_prize_ledger=0
    and v_summary_count=e.winner_count
    and v_summary_mismatch=0
    and v_seed_ok
    and v_top_mirror_ok;

  v_fingerprint:=md5(concat_ws('|',
    e.id::text,
    e.status,
    coalesce(e.completed_at::text,''),
    e.winner_count::text,
    coalesce(e.winning_ticket_count,0)::text,
    coalesce(e.seed_commitment,''),
    coalesce(e.seed_reveal,''),
    coalesce(e.winning_numbers::text,''),
    coalesce(e.winning_bonus_ball::text,''),
    coalesce(e.winner_summary::text,''),
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id',t.id,'user_id',t.user_id,'white_numbers',t.white_numbers,'bonus_ball',t.bonus_ball,
          'price_paid',t.price_paid,'is_winner',t.is_winner,'winner_rank',t.winner_rank,'prize_awarded',t.prize_awarded
        ) order by t.id
      )::text
      from public.event_tickets t where t.event_id=e.id
    ),'[]'),
    coalesce((
      select jsonb_agg(
        jsonb_build_object('rank',pt.rank,'prize_amount',pt.prize_amount) order by pt.rank
      )::text
      from public.event_prize_tiers pt where pt.event_id=e.id
    ),'[]'),
    coalesce((
      select jsonb_agg(
        jsonb_build_object('ticket_id',bl.ticket_id,'user_id',bl.user_id,'amount',bl.amount,'entry_type',bl.entry_type)
        order by bl.ticket_id,bl.id
      )::text
      from public.balance_ledger bl
      where bl.event_id=e.id and bl.entry_type in ('ticket_purchase','prize_credit')
    ),'[]')
  ));

  select
    a.created_at,
    a.actor_user_id,
    a.new_data->>'note',
    a.new_data->>'result_fingerprint'
  into v_verified_at,v_verified_by,v_verified_note,v_verified_fingerprint
  from public.audit_logs a
  where a.action='verify_completed_lottery_event'
    and a.entity_type='lottery_event'
    and a.entity_id=e.id::text
  order by a.created_at desc
  limit 1;

  v_verification_status:=case
    when not v_post_ready then 'needs_attention'
    when v_verified_at is null then 'unverified'
    when v_verified_fingerprint=v_fingerprint then 'verified'
    else 'stale'
  end;

  v_state:=case
    when e.status in ('draft','completed','cancelled') then e.status
    when now()<e.opens_at then 'upcoming'
    when e.schedule_mode='manual' then 'open'
    when e.cutoff_at is not null and now()<e.cutoff_at then 'open'
    when e.draw_at is not null and now()<e.draw_at then 'locked'
    else 'due'
  end;

  v_next_action:=case
    when e.status='draft' and v_publish_ready then 'publish'
    when e.status='draft' then 'fix_configuration'
    when e.status='published' and now()<e.opens_at then 'wait_for_open'
    when e.status='published' and e.schedule_mode='manual' and v_draw_ready then 'draw'
    when e.status='published' and e.schedule_mode='manual' then 'collect_tickets'
    when e.status='published' and e.schedule_mode='scheduled' and now()<e.cutoff_at then 'collect_tickets'
    when e.status='published' and e.schedule_mode='scheduled' and now()<e.draw_at and v_draw_ready then 'locked_waiting_draw'
    when e.status='published' and v_draw_ready then 'draw_due'
    when e.status='published' then 'fix_draw_blockers'
    when e.status='completed' and v_verification_status='verified' then 'verified'
    when e.status='completed' and v_post_ready then 'verify'
    when e.status='completed' then 'investigate_result'
    when e.status='cancelled' then 'cancelled'
    else 'review'
  end;

  return jsonb_build_object(
    'generated_at',clock_timestamp(),
    'event',jsonb_build_object(
      'id',e.id,'slug',e.slug,'title',e.title,'status',e.status,'state',v_state,
      'schedule_mode',e.schedule_mode,'opens_at',e.opens_at,'cutoff_at',e.cutoff_at,'draw_at',e.draw_at,
      'completed_at',e.completed_at,'ticket_count',v_ticket_count,'player_count',v_player_count,
      'winner_count',e.winner_count,'winning_ticket_count',e.winning_ticket_count,
      'prize_amount',e.prize_amount,'prize_tier_count',v_tier_count,'prize_tier_total',v_tier_total
    ),
    'next_action',v_next_action,
    'publish',jsonb_build_object(
      'ready',v_publish_ready,
      'checks',jsonb_build_array(
        jsonb_build_object('key','draft_state','label','Lottery is still a draft','ok',e.status='draft','blocking',true),
        jsonb_build_object('key','events_enabled','label','Lottery events are enabled','ok',v_feature_ok,'blocking',true),
        jsonb_build_object('key','identity','label','Title and public slug are configured','ok',nullif(trim(e.title),'') is not null and nullif(trim(e.slug),'') is not null,'blocking',true),
        jsonb_build_object('key','schedule','label','Schedule is structurally valid','ok',v_schedule_ok,'blocking',true),
        jsonb_build_object('key','future_schedule','label','Scheduled cutoff and draw are still in the future','ok',e.schedule_mode='manual' or (e.cutoff_at>now() and e.draw_at>now()),'blocking',true),
        jsonb_build_object('key','prize_tiers','label','Prize tiers match configured winners','ok',v_tier_count=e.winner_count,'blocking',true,'detail',v_tier_count||' / '||e.winner_count),
        jsonb_build_object('key','prize_total','label','Prize tier total matches prize pool','ok',v_tier_total=e.prize_amount,'blocking',true,'detail',v_tier_total||' / '||e.prize_amount),
        jsonb_build_object('key','capacity','label','Capacity can support all configured winners','ok',e.max_total_tickets is null or e.max_total_tickets>=e.winner_count,'blocking',true),
        jsonb_build_object('key','clean_draft','label','Draft has no historical ticket/result data','ok',v_ticket_count=0 and v_winner_rows=0,'blocking',true)
      )
    ),
    'draw',jsonb_build_object(
      'ready',v_draw_ready,
      'automatic_due',e.schedule_mode='scheduled' and e.draw_at is not null and now()>=e.draw_at,
      'manual_override',e.schedule_mode='scheduled' and e.cutoff_at is not null and now()>=e.cutoff_at and e.draw_at is not null and now()<e.draw_at,
      'checks',jsonb_build_array(
        jsonb_build_object('key','published','label','Lottery is published','ok',e.status='published','blocking',true),
        jsonb_build_object('key','events_enabled','label','Lottery events are enabled','ok',v_feature_ok,'blocking',true),
        jsonb_build_object('key','opened','label','Lottery has opened','ok',now()>=e.opens_at,'blocking',true),
        jsonb_build_object('key','sales_locked','label',case when e.schedule_mode='manual' then 'Manual draw uses the event row lock as its sales boundary' else 'Scheduled ticket cutoff has passed' end,'ok',e.schedule_mode='manual' or (e.cutoff_at is not null and now()>=e.cutoff_at),'blocking',true),
        jsonb_build_object('key','tickets','label','Enough tickets exist for every winner rank','ok',v_ticket_count>=e.winner_count,'blocking',true,'detail',v_ticket_count||' tickets / '||e.winner_count||' winners'),
        jsonb_build_object('key','purchase_ledger','label','Every ticket has one matching purchase ledger row','ok',v_purchase_ledger_mismatch=0,'blocking',true,'detail',v_purchase_ledger_mismatch||' mismatch(es)'),
        jsonb_build_object('key','prize_tiers','label','Prize tiers are complete and total correctly','ok',v_tier_count=e.winner_count and v_tier_total=e.prize_amount,'blocking',true),
        jsonb_build_object('key','clean_result','label','No winner/prize result already exists','ok',v_winner_rows=0 and not exists(select 1 from public.balance_ledger bl where bl.event_id=e.id and bl.entry_type='prize_credit'),'blocking',true)
      )
    ),
    'post_draw',jsonb_build_object(
      'ready',v_post_ready,
      'result_fingerprint',v_fingerprint,
      'checks',jsonb_build_array(
        jsonb_build_object('key','completed','label','Event is completed with a completion timestamp','ok',e.status='completed' and e.completed_at is not null,'blocking',true),
        jsonb_build_object('key','winner_count','label','Winner rows and ranks exactly match configuration','ok',v_winner_rows=e.winner_count and v_distinct_ranks=e.winner_count and v_min_rank=1 and v_max_rank=e.winner_count and e.winning_ticket_count=e.winner_count,'blocking',true,'detail',v_winner_rows||' / '||e.winner_count),
        jsonb_build_object('key','winner_prizes','label','Every winner prize matches its configured rank','ok',v_winner_tier_mismatch=0,'blocking',true,'detail',v_winner_tier_mismatch||' mismatch(es)'),
        jsonb_build_object('key','purchase_ledger','label','Every ticket still has one correct purchase ledger row','ok',v_purchase_ledger_mismatch=0,'blocking',true,'detail',v_purchase_ledger_mismatch||' mismatch(es)'),
        jsonb_build_object('key','prize_ledger','label','Every winner has exactly one matching prize ledger credit','ok',v_prize_ledger_mismatch=0 and v_extra_prize_ledger=0,'blocking',true,'detail',(v_prize_ledger_mismatch+v_extra_prize_ledger)||' mismatch(es)'),
        jsonb_build_object('key','winner_summary','label','Public winner summary matches the authoritative winner tickets','ok',v_summary_count=e.winner_count and v_summary_mismatch=0,'blocking',true,'detail',v_summary_count||' summary row(s)'),
        jsonb_build_object('key','seed_commitment','label','Revealed seed matches the stored SHA-256 commitment','ok',v_seed_ok,'blocking',true),
        jsonb_build_object('key','top_winner_mirror','label','Top-winner compatibility fields match rank #1','ok',v_top_mirror_ok,'blocking',true),
        jsonb_build_object('key','prize_total','label','Configured prize tiers still equal the event prize total','ok',v_tier_count=e.winner_count and v_tier_total=e.prize_amount,'blocking',true)
      )
    ),
    'verification',jsonb_build_object(
      'status',v_verification_status,
      'verified_at',v_verified_at,
      'verified_by',v_verified_by,
      'note',v_verified_note,
      'stored_fingerprint',v_verified_fingerprint,
      'current_fingerprint',v_fingerprint
    )
  );
end;
$function$;

create or replace function public.admin_get_event_lifecycle_review(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $function$
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;
  return private.lottery_event_lifecycle_review(p_event_id);
end;
$function$;

create or replace function public.admin_publish_lottery_event(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $function$
declare
  e public.lottery_events%rowtype;
  v_review jsonb;
  v_reason text;
  v_headers jsonb;
  v_failed text;
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  v_headers:=coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb;
  v_reason:=nullif(trim(coalesce(v_headers->>'x-admin-reason','')),'');
  if v_reason is null then
    raise exception 'Admin reason is required';
  end if;

  select * into e
  from public.lottery_events
  where id=p_event_id
  for update;

  if not found then raise exception 'Event not found'; end if;
  if e.status<>'draft' then raise exception 'Only draft lotteries can be published'; end if;

  v_review:=private.lottery_event_lifecycle_review(p_event_id);
  if not coalesce((v_review->'publish'->>'ready')::boolean,false) then
    select string_agg(x->>'label',', ')
      into v_failed
    from jsonb_array_elements(v_review->'publish'->'checks') x
    where not coalesce((x->>'ok')::boolean,false)
      and coalesce((x->>'blocking')::boolean,true);
    raise exception 'Publish checklist failed: %',coalesce(v_failed,'unknown blocker');
  end if;

  update public.lottery_events
  set status='published',updated_at=now()
  where id=p_event_id;

  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,old_data,new_data)
  select
    auth.uid(),'publish_lottery_event','lottery_event',p_event_id::text,
    to_jsonb(e),
    to_jsonb(n)||jsonb_build_object('admin_reason',v_reason,'lifecycle_review',v_review->'publish')
  from public.lottery_events n
  where n.id=p_event_id;

  return private.lottery_event_lifecycle_review(p_event_id);
end;
$function$;

create or replace function public.admin_verify_completed_lottery_event(p_event_id uuid,p_note text)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $function$
declare
  e public.lottery_events%rowtype;
  v_review jsonb;
  v_note text;
  v_failed text;
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  v_note:=nullif(trim(coalesce(p_note,'')),'');
  if v_note is null then
    raise exception 'Verification note is required';
  end if;
  if length(v_note)>500 then
    raise exception 'Verification note must be 500 characters or fewer';
  end if;

  select * into e
  from public.lottery_events
  where id=p_event_id
  for update;

  if not found then raise exception 'Event not found'; end if;
  if e.status<>'completed' then raise exception 'Only completed lotteries can be verified'; end if;

  v_review:=private.lottery_event_lifecycle_review(p_event_id);
  if not coalesce((v_review->'post_draw'->>'ready')::boolean,false) then
    select string_agg(x->>'label',', ')
      into v_failed
    from jsonb_array_elements(v_review->'post_draw'->'checks') x
    where not coalesce((x->>'ok')::boolean,false)
      and coalesce((x->>'blocking')::boolean,true);
    raise exception 'Post-draw verification failed: %',coalesce(v_failed,'unknown blocker');
  end if;

  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,new_data)
  values(
    auth.uid(),
    'verify_completed_lottery_event',
    'lottery_event',
    p_event_id::text,
    jsonb_build_object(
      'note',v_note,
      'result_fingerprint',v_review->'post_draw'->>'result_fingerprint',
      'verification_checks',v_review->'post_draw'->'checks',
      'verified_at',clock_timestamp()
    )
  );

  return private.lottery_event_lifecycle_review(p_event_id);
end;
$function$;

revoke all on function private.lottery_event_lifecycle_review(uuid) from public,anon,authenticated;
revoke all on function public.admin_get_event_lifecycle_review(uuid) from public,anon,authenticated;
revoke all on function public.admin_publish_lottery_event(uuid) from public,anon,authenticated;
revoke all on function public.admin_verify_completed_lottery_event(uuid,text) from public,anon,authenticated;

grant execute on function public.admin_get_event_lifecycle_review(uuid) to authenticated;
grant execute on function public.admin_publish_lottery_event(uuid) to authenticated;
grant execute on function public.admin_verify_completed_lottery_event(uuid,text) to authenticated;
