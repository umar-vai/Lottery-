-- Phase 3 — Live Draw Control Room aggregate.
-- Admin-only, read-only operational payload for the browser control room.

create or replace function public.admin_get_live_draw_control_room()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $function$
declare
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  with event_stats as (
    select
      e.id,e.slug,e.title,e.status,e.schedule_mode,e.opens_at,e.cutoff_at,e.draw_at,e.completed_at,
      e.ticket_price,e.prize_amount,e.winner_count,e.winning_ticket_count,e.max_tickets_per_user,
      e.max_players,e.max_total_tickets,
      coalesce(ts.ticket_count,0)::integer as ticket_count,
      coalesce(ts.player_count,0)::integer as player_count,
      coalesce(ts.ticket_credits,0)::numeric as ticket_credits,
      coalesce(ts.selected_winners,0)::integer as selected_winners,
      case
        when e.status in ('draft','completed','cancelled') then e.status
        when now() < e.opens_at then 'upcoming'
        when e.schedule_mode='manual' then 'open'
        when e.cutoff_at is not null and now() < e.cutoff_at then 'open'
        when e.draw_at is not null and now() < e.draw_at then 'locked'
        else 'due'
      end as derived_state,
      case
        when e.status='published'
          and now() >= e.opens_at
          and coalesce(ts.ticket_count,0)>0
          and (e.schedule_mode='manual' or (e.schedule_mode='scheduled' and e.draw_at is not null and now() >= e.draw_at))
        then true else false
      end as can_draw_now,
      case when e.max_total_tickets is null or e.max_total_tickets=0 then null
           else round((coalesce(ts.ticket_count,0)::numeric/e.max_total_tickets::numeric)*100,1) end as ticket_fill_pct,
      case when e.max_players is null or e.max_players=0 then null
           else round((coalesce(ts.player_count,0)::numeric/e.max_players::numeric)*100,1) end as player_fill_pct,
      rs.consecutive_failures,rs.total_failures,rs.last_failed_at,rs.last_error_state,rs.last_error,
      rs.last_succeeded_at,rs.last_attempt_at,
      case
        when e.status='published' and coalesce(rs.consecutive_failures,0)>0 then 'attention'
        when e.status='published' and e.schedule_mode='scheduled' and e.draw_at is not null and now() >= e.draw_at then 'due'
        when e.status='published' then 'healthy'
        when e.status='completed' then 'complete'
        else 'neutral'
      end as health_state
    from public.lottery_events e
    left join lateral (
      select count(*) as ticket_count,count(distinct t.user_id) as player_count,
             coalesce(sum(t.price_paid),0) as ticket_credits,
             count(*) filter(where t.is_winner) as selected_winners
      from public.event_tickets t
      where t.event_id=e.id
    ) ts on true
    left join private.lottery_draw_runtime_state rs on rs.event_id=e.id
  ),
  ranked as (
    select es.*,
      case es.derived_state
        when 'due' then 0 when 'open' then 1 when 'locked' then 2 when 'upcoming' then 3
        when 'draft' then 4 when 'completed' then 5 else 6 end as sort_priority
    from event_stats es
  )
  select jsonb_build_object(
    'generated_at',now(),
    'summary',jsonb_build_object(
      'total_events',(select count(*) from ranked),
      'published_events',(select count(*) from ranked where status='published'),
      'open_events',(select count(*) from ranked where derived_state='open'),
      'due_events',(select count(*) from ranked where derived_state='due'),
      'completed_events',(select count(*) from ranked where status='completed'),
      'tickets',(select coalesce(sum(ticket_count),0) from ranked),
      'players',(select count(*) from public.profiles),
      'events_with_failures',(select count(*) from ranked where coalesce(consecutive_failures,0)>0)
    ),
    'events',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',id,'slug',slug,'title',title,'status',status,'state',derived_state,'health',health_state,
        'schedule_mode',schedule_mode,'opens_at',opens_at,'cutoff_at',cutoff_at,'draw_at',draw_at,'completed_at',completed_at,
        'ticket_price',ticket_price,'prize_amount',prize_amount,'winner_count',winner_count,
        'selected_winners',selected_winners,'winning_ticket_count',winning_ticket_count,
        'ticket_count',ticket_count,'player_count',player_count,'ticket_credits',ticket_credits,
        'max_tickets_per_user',max_tickets_per_user,'max_players',max_players,'max_total_tickets',max_total_tickets,
        'ticket_fill_pct',ticket_fill_pct,'player_fill_pct',player_fill_pct,'can_draw_now',can_draw_now,
        'runtime',jsonb_build_object(
          'consecutive_failures',coalesce(consecutive_failures,0),'total_failures',coalesce(total_failures,0),
          'last_failed_at',last_failed_at,'last_error_state',last_error_state,'last_error',last_error,
          'last_succeeded_at',last_succeeded_at,'last_attempt_at',last_attempt_at
        )
      ) order by sort_priority,
        case when status='completed' then completed_at end desc nulls last,
        coalesce(draw_at,opens_at) asc)
      from ranked
    ),'[]'::jsonb),
    'operational_health',private.lottery_operational_health_report(),
    'credit_integrity',private.draw_credit_integrity_report()
  ) into v_result;

  return v_result;
end
$function$;

revoke all on function public.admin_get_live_draw_control_room() from public,anon,authenticated;
grant execute on function public.admin_get_live_draw_control_room() to authenticated;
