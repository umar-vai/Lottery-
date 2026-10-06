-- Phase 3 guided lifecycle / verification runtime contract.
begin;

do $phase3_lifecycle_auth$
declare
  f regprocedure;
begin
  foreach f in array array[
    'public.admin_get_event_lifecycle_review(uuid)'::regprocedure,
    'public.admin_publish_lottery_event(uuid)'::regprocedure,
    'public.admin_verify_completed_lottery_event(uuid,text)'::regprocedure
  ]
  loop
    if has_function_privilege('anon',f,'EXECUTE') then
      raise exception 'Anon can execute Phase 3 lifecycle RPC: %',f;
    end if;
    if not has_function_privilege('authenticated',f,'EXECUTE') then
      raise exception 'Authenticated EXECUTE grant missing: %',f;
    end if;
    if position('public.is_admin()' in pg_get_functiondef(f))=0 then
      raise exception 'Phase 3 lifecycle RPC missing is_admin guard: %',f;
    end if;
  end loop;

  if has_function_privilege('authenticated','private.lottery_event_lifecycle_review(uuid)'::regprocedure,'EXECUTE') then
    raise exception 'Authenticated can execute private lifecycle helper';
  end if;
end
$phase3_lifecycle_auth$;

do $phase3_lifecycle_runtime$
declare
  v_admin uuid;
  v_completed uuid;
  v_draft uuid:=gen_random_uuid();
  v_review jsonb;
  v_verify jsonb;
begin
  select id into v_admin from public.profiles where role='admin' limit 1;
  if v_admin is null then raise exception 'Phase 3 lifecycle test requires an admin'; end if;

  select id into v_completed
  from public.lottery_events
  where status='completed'
  order by completed_at desc nulls last
  limit 1;
  if v_completed is null then raise exception 'Phase 3 lifecycle test requires a completed event'; end if;

  insert into public.lottery_events(
    id,slug,title,description,status,ticket_price,prize_amount,prize_mode,max_tickets_per_user,
    max_players,max_total_tickets,white_ball_count,white_ball_max,bonus_ball_enabled,bonus_ball_max,
    opens_at,cutoff_at,draw_at,created_by,schedule_mode,winner_count
  ) values(
    v_draft,'phase3-lifecycle-test-'||substr(v_draft::text,1,8),'Phase 3 Lifecycle Test','Rollback-only test',
    'draft',10,100,'ranked',5,null,10,5,69,true,26,
    now()-interval '1 minute',now()+interval '30 minutes',now()+interval '31 minutes',v_admin,'scheduled',1
  );
  insert into public.event_prize_tiers(event_id,rank,prize_amount) values(v_draft,1,100);

  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_admin,'role','authenticated')::text,true);
  perform set_config('request.headers',jsonb_build_object('x-admin-reason','Phase 3 rollback-only publish test')::text,true);
  execute 'set local role authenticated';

  v_review:=public.admin_get_event_lifecycle_review(v_draft);
  if not coalesce((v_review->'publish'->>'ready')::boolean,false) then
    raise exception 'Valid rollback-only draft did not pass publish checklist: %',v_review;
  end if;

  perform public.admin_publish_lottery_event(v_draft);
  if (select status from public.lottery_events where id=v_draft)<>'published' then
    raise exception 'Guided publish did not publish rollback-only draft';
  end if;

  v_review:=public.admin_get_event_lifecycle_review(v_completed);
  if not coalesce((v_review->'post_draw'->>'ready')::boolean,false) then
    raise exception 'Existing completed event failed post-draw verification contract: %',v_review;
  end if;

  v_verify:=public.admin_verify_completed_lottery_event(v_completed,'Phase 3 rollback-only verification test');
  if v_verify->'verification'->>'status'<>'verified' then
    raise exception 'Completed event did not become verified in rollback test: %',v_verify;
  end if;

  if not exists (
    select 1 from public.audit_logs
    where action='verify_completed_lottery_event'
      and entity_id=v_completed::text
      and actor_user_id=v_admin
  ) then
    raise exception 'Verification audit row was not written';
  end if;

  execute 'reset role';
end
$phase3_lifecycle_runtime$;

rollback;
