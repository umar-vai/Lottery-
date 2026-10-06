-- Phase 2 public API/privacy minimization runtime test.
begin;

do $phase2_privacy$
declare
  v_event uuid;
  v_features jsonb;
  v_count bigint;
  v_result_type text;
  v_row jsonb;
begin
  if has_column_privilege('anon','public.lottery_events','created_by','SELECT')
     or has_column_privilege('authenticated','public.lottery_events','created_by','SELECT') then
    raise exception 'Browser roles can still read lottery_events.created_by';
  end if;

  if not has_column_privilege('anon','public.lottery_events','id','SELECT')
     or not has_column_privilege('authenticated','public.lottery_events','winner_summary','SELECT') then
    raise exception 'Safe lottery-event columns lost browser read access';
  end if;

  select pg_get_function_result(p.oid) into v_result_type
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='get_public_event_winners'
    and pg_get_function_identity_arguments(p.oid)='p_event_id uuid';

  if v_result_type is null
     or v_result_type ilike '%user_id%'
     or v_result_type ilike '%ticket_id%'
     or v_result_type not ilike '%winner_key%'
     or v_result_type not ilike '%ticket_ref%' then
    raise exception 'Public winner RPC still exposes internal identifiers: %',v_result_type;
  end if;

  if exists (
    select 1
    from public.lottery_events e
    cross join lateral jsonb_array_elements(coalesce(e.winner_summary,'[]'::jsonb)) x
    where x ? 'ticket_id' or x ? 'user_id'
  ) then
    raise exception 'Stored winner_summary still contains raw internal IDs';
  end if;

  if exists (
    select 1
    from public.lottery_events e
    cross join lateral jsonb_array_elements(coalesce(e.winner_summary,'[]'::jsonb)) x
    where e.status='completed'
      and jsonb_array_length(coalesce(e.winner_summary,'[]'::jsonb))>0
      and (
        coalesce(x->>'ticket_ref','') !~ '^[0-9A-F]{12}$'
        or coalesce(x->>'winner_key','') !~ '^[0-9a-f]{20}$'
      )
  ) then
    raise exception 'Public winner_summary references are missing or malformed';
  end if;

  select id into v_event
  from public.lottery_events
  where status='completed'
  order by completed_at desc nulls last
  limit 1;

  if v_event is not null then
    perform set_config('request.jwt.claim.sub','',true);
    perform set_config('request.jwt.claims','{"role":"anon"}',true);
    execute 'set local role anon';

    select count(*) into v_count
    from public.get_public_event_winners(v_event);

    if v_count>0 then
      select to_jsonb(w) into v_row
      from public.get_public_event_winners(v_event) w
      limit 1;

      if v_row ? 'user_id' or v_row ? 'ticket_id'
         or coalesce(v_row->>'winner_key','') !~ '^[0-9a-f]{20}$'
         or coalesce(v_row->>'ticket_ref','') !~ '^[0-9A-F]{12}$' then
        raise exception 'Anon winner response contains unsafe identifiers: %',v_row;
      end if;
    end if;

    select public.get_platform_features() into v_features;
    if v_features ? 'configured'
       or v_features ? 'updatedAt'
       or not (v_features ? 'master')
       or not (v_features ? 'events')
       or not (v_features ? 'gameZone')
       or not (v_features ? 'slot')
       or not (v_features ? 'plinko') then
      raise exception 'Public feature response exposes internal config metadata: %',v_features;
    end if;

    select count(*) into v_count
    from public.love_point_payment_providers
    where not public_visible or not enabled;

    if v_count<>0 then
      raise exception 'Anon can see hidden/disabled payment providers';
    end if;

    execute 'reset role';
  end if;

  if has_function_privilege('anon','private.public_winner_key(uuid)','EXECUTE')
     or has_function_privilege('authenticated','private.public_winner_key(uuid)','EXECUTE')
     or has_function_privilege('anon','private.public_ticket_ref(uuid)','EXECUTE')
     or has_function_privilege('authenticated','private.public_ticket_ref(uuid)','EXECUTE') then
    raise exception 'Browser role can execute private identifier helpers';
  end if;
end
$phase2_privacy$;

rollback;
