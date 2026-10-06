-- Phase 1 — concurrent game request idempotency hardening.
-- Same user + client nonce is serialized before duplicate lookup, so concurrent
-- retries return the committed result instead of racing into a unique violation.

create or replace function public.spin_slot(
  p_bet_amount numeric,
  p_client_nonce uuid default null::uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','private','extensions'
as $function$
declare
  v_uid uuid:=auth.uid(); v_game public.games%rowtype; v_profile public.profiles%rowtype; v_existing public.slot_spins%rowtype;
  v_nonce uuid:=coalesce(p_client_nonce,gen_random_uuid()); s1 text; s2 text; s3 text; v_multiplier numeric(16,4):=0;
  v_payout numeric(16,2):=0; v_after_bet numeric(16,2); v_final numeric(16,2); v_spin_id uuid; v_kind text;
begin
  if not private.platform_feature_enabled('slot') then raise exception 'Slots are temporarily unavailable'; end if;
  if v_uid is null then raise exception 'Authentication required'; end if;

  perform pg_advisory_xact_lock(hashtextextended('slot:'||v_uid::text||':'||v_nonce::text,0));

  select * into v_existing
  from public.slot_spins
  where user_id=v_uid and client_nonce=v_nonce
  limit 1;

  if found then
    return jsonb_build_object(
      'ok',true,'duplicate',true,'spinId',v_existing.id,
      'symbols',jsonb_build_array(v_existing.reel_1,v_existing.reel_2,v_existing.reel_3),
      'multiplier',v_existing.multiplier,'payout',v_existing.payout,'net',v_existing.net_change,
      'balanceBefore',v_existing.balance_before,'balanceAfter',v_existing.balance_after,
      'outcome',v_existing.outcome_kind,'gameVersion',v_existing.game_version
    );
  end if;

  select * into v_game from public.games where slug='classic-slot' and status='active' for share;
  if not found then raise exception 'Slot game is not available'; end if;
  if p_bet_amount is null or not (p_bet_amount=any(v_game.bet_steps)) then raise exception 'Invalid bet amount'; end if;
  if p_bet_amount<v_game.min_bet or p_bet_amount>v_game.max_bet then raise exception 'Bet amount is outside allowed range'; end if;

  select * into v_profile from public.profiles where id=v_uid for update;
  if not found then raise exception 'Player profile not found'; end if;
  if v_profile.balance<p_bet_amount then raise exception 'Insufficient Draw Credits'; end if;

  s1:=private.slot_symbol_v1(private.secure_slot_roll_100());
  s2:=private.slot_symbol_v1(private.secure_slot_roll_100());
  s3:=private.slot_symbol_v1(private.secure_slot_roll_100());

  if s1=s2 and s2=s3 then
    v_multiplier:=case s1 when 'cherry' then 5 when 'lemon' then 8 when 'bell' then 12 when 'bar' then 25 when 'seven' then 60 when 'diamond' then 150 else 0 end;
  elsif s1=s2 or s1=s3 or s2=s3 then v_multiplier:=1;
  else v_multiplier:=0;
  end if;

  v_payout:=round((p_bet_amount*v_multiplier)::numeric,2);
  v_after_bet:=v_profile.balance-p_bet_amount;
  v_final:=v_after_bet+v_payout;
  v_kind:=case when v_multiplier=0 then 'loss' when v_multiplier=1 then 'push' when s1='diamond' and s2='diamond' and s3='diamond' then 'jackpot' else 'win' end;

  update public.profiles set balance=v_final,updated_at=now() where id=v_uid;

  insert into public.slot_spins(
    user_id,game_id,game_version,client_nonce,bet_amount,reel_1,reel_2,reel_3,
    multiplier,payout,net_change,balance_before,balance_after,outcome_kind
  ) values(
    v_uid,v_game.id,v_game.version,v_nonce,p_bet_amount,s1,s2,s3,
    v_multiplier,v_payout,v_payout-p_bet_amount,v_profile.balance,v_final,v_kind
  ) returning id into v_spin_id;

  insert into public.balance_ledger(user_id,amount,balance_after,entry_type,game_spin_id,note)
  values(v_uid,-p_bet_amount,v_after_bet,'game_bet',v_spin_id,'Game Zone · Neon Fortune Slots bet');

  if v_payout>0 then
    insert into public.balance_ledger(user_id,amount,balance_after,entry_type,game_spin_id,note)
    values(v_uid,v_payout,v_final,'game_payout',v_spin_id,'Game Zone · Neon Fortune Slots payout ('||trim(to_char(v_multiplier,'FM999999990.####'))||'x)');
  end if;

  return jsonb_build_object(
    'ok',true,'duplicate',false,'spinId',v_spin_id,
    'symbols',jsonb_build_array(s1,s2,s3),'multiplier',v_multiplier,'payout',v_payout,
    'net',v_payout-p_bet_amount,'balanceBefore',v_profile.balance,'balanceAfter',v_final,
    'outcome',v_kind,'rtp',v_game.rtp,'houseEdge',v_game.house_edge,'gameVersion',v_game.version
  );
end;
$function$;

create or replace function public.drop_plinko(
  p_bet_amount numeric,
  p_risk text default 'medium'::text,
  p_client_nonce uuid default null::uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','private','extensions'
as $function$
declare
  v_uid uuid:=auth.uid(); v_game public.games%rowtype; v_profile public.profiles%rowtype; v_existing public.plinko_drops%rowtype;
  v_nonce uuid:=coalesce(p_client_nonce,gen_random_uuid()); v_risk text:=lower(coalesce(p_risk,'medium')); v_bytes bytea; v_path smallint[]:=array[]::smallint[]; v_bit smallint; v_landing smallint:=0; v_multipliers numeric[]; v_multiplier numeric(16,4); v_rtp numeric(10,6); v_edge numeric(10,6); v_payout numeric(16,2); v_after_bet numeric(16,2); v_final numeric(16,2); v_drop_id uuid; v_kind text; i integer;
begin
  if not private.platform_feature_enabled('plinko') then raise exception 'Plinko is temporarily unavailable'; end if;
  if v_uid is null then raise exception 'Authentication required'; end if;

  perform pg_advisory_xact_lock(hashtextextended('plinko:'||v_uid::text||':'||v_nonce::text,0));

  select * into v_existing
  from public.plinko_drops
  where user_id=v_uid and client_nonce=v_nonce
  limit 1;

  if found then
    return jsonb_build_object(
      'ok',true,'duplicate',true,'dropId',v_existing.id,'path',to_jsonb(v_existing.path),
      'landingIndex',v_existing.landing_index,'risk',v_existing.risk_mode,
      'multiplier',v_existing.multiplier,'payout',v_existing.payout,'net',v_existing.net_change,
      'balanceBefore',v_existing.balance_before,'balanceAfter',v_existing.balance_after,
      'outcome',v_existing.outcome_kind,'gameVersion',v_existing.game_version
    );
  end if;

  select * into v_game from public.games where slug='neon-plinko' and status='active' for share;
  if not found then raise exception 'Plinko game is not available'; end if;
  if p_bet_amount is null or not (p_bet_amount=any(v_game.bet_steps)) then raise exception 'Invalid bet amount'; end if;
  if p_bet_amount<v_game.min_bet or p_bet_amount>v_game.max_bet then raise exception 'Bet amount is outside allowed range'; end if;
  if v_risk not in ('low','medium','high') then raise exception 'Invalid risk mode'; end if;

  select * into v_profile from public.profiles where id=v_uid for update;
  if not found then raise exception 'Player profile not found'; end if;
  if v_profile.balance<p_bet_amount then raise exception 'Insufficient Draw Credits'; end if;

  if v_risk='low' then
    v_multipliers:=array[5,2,1.5,1.2,1.05,0.9,0.65,0.9,1.05,1.2,1.5,2,5]::numeric[];
    v_rtp:=0.939868; v_edge:=0.060132;
  elsif v_risk='high' then
    v_multipliers:=array[150,31.5,8.3,2.5,0.45,0.1,0,0.1,0.45,2.5,8.3,31.5,150]::numeric[];
    v_rtp:=0.941284; v_edge:=0.058716;
  else
    v_multipliers:=array[25,8,3.5,1.8,1.1,0.65,0.25,0.65,1.1,1.8,3.5,8,25]::numeric[];
    v_rtp:=0.938867; v_edge:=0.061133;
  end if;

  v_bytes:=gen_random_bytes(12);
  for i in 0..11 loop
    v_bit:=mod(get_byte(v_bytes,i),2)::smallint;
    v_path:=array_append(v_path,v_bit);
    v_landing:=v_landing+v_bit;
  end loop;

  v_multiplier:=v_multipliers[v_landing+1];
  v_payout:=round((p_bet_amount*v_multiplier)::numeric,2);
  v_after_bet:=v_profile.balance-p_bet_amount;
  v_final:=v_after_bet+v_payout;
  v_kind:=case when v_multiplier=0 then 'loss' when v_multiplier<1 then 'partial' when v_multiplier=1 then 'push' when v_multiplier>=100 then 'jackpot' else 'win' end;

  update public.profiles set balance=v_final,updated_at=now() where id=v_uid;

  insert into public.plinko_drops(
    user_id,game_id,game_version,client_nonce,bet_amount,risk_mode,board_rows,path,
    landing_index,multiplier,payout,net_change,balance_before,balance_after,outcome_kind
  ) values(
    v_uid,v_game.id,v_game.version,v_nonce,p_bet_amount,v_risk,12,v_path,
    v_landing,v_multiplier,v_payout,v_payout-p_bet_amount,v_profile.balance,v_final,v_kind
  ) returning id into v_drop_id;

  insert into public.balance_ledger(user_id,amount,balance_after,entry_type,plinko_drop_id,note)
  values(v_uid,-p_bet_amount,v_after_bet,'game_bet',v_drop_id,'Game Zone · Neon Plinko bet ('||v_risk||')');

  if v_payout>0 then
    insert into public.balance_ledger(user_id,amount,balance_after,entry_type,plinko_drop_id,note)
    values(v_uid,v_payout,v_final,'game_payout',v_drop_id,'Game Zone · Neon Plinko payout ('||trim(to_char(v_multiplier,'FM999999990.####'))||'x · '||v_risk||')');
  end if;

  return jsonb_build_object(
    'ok',true,'duplicate',false,'dropId',v_drop_id,'path',to_jsonb(v_path),
    'landingIndex',v_landing,'risk',v_risk,'multiplier',v_multiplier,'payout',v_payout,
    'net',v_payout-p_bet_amount,'balanceBefore',v_profile.balance,'balanceAfter',v_final,
    'outcome',v_kind,'rtp',v_rtp,'houseEdge',v_edge,'gameVersion',v_game.version
  );
end;
$function$;

revoke all on function public.spin_slot(numeric,uuid) from public, anon;
grant execute on function public.spin_slot(numeric,uuid) to authenticated;

revoke all on function public.drop_plinko(numeric,text,uuid) from public, anon;
grant execute on function public.drop_plinko(numeric,text,uuid) to authenticated;
