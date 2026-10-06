-- Phase 2 — public API/privacy minimization.
-- Keep the public Winners Hall contract while removing unnecessary profile media
-- and closing trigger-only functions from the Data API execute surface.

drop function if exists public.get_public_event_winners(uuid);

create function public.get_public_event_winners(p_event_id uuid)
returns table(
  winner_key text,
  display_name text,
  ticket_ref text,
  winner_rank integer,
  prize_awarded numeric,
  white_numbers integer[],
  bonus_ball integer
)
language sql
stable
security definer
set search_path to 'pg_catalog','public','private'
as $function$
  select
    private.public_winner_key(t.user_id) as winner_key,
    coalesce(
      nullif(trim(p.nickname),''),
      nullif(trim(p.display_name),''),
      'Player'
    ) as display_name,
    private.public_ticket_ref(t.id) as ticket_ref,
    t.winner_rank,
    t.prize_awarded,
    t.white_numbers,
    t.bonus_ball
  from public.event_tickets t
  join public.lottery_events e on e.id=t.event_id
  left join public.profiles p on p.id=t.user_id
  where t.event_id=p_event_id
    and e.status='completed'
    and t.is_winner=true
  order by t.winner_rank asc,t.created_at asc;
$function$;

revoke all on function public.get_public_event_winners(uuid) from public,anon,authenticated;
grant execute on function public.get_public_event_winners(uuid) to anon,authenticated;

-- These functions are trigger implementation details, not browser RPCs.
revoke execute on function public.prevent_locked_ticket_delete() from public,anon,authenticated;
revoke execute on function public.validate_ticket() from public,anon,authenticated;
