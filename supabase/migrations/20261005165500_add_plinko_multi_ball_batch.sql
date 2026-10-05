create or replace function public.drop_plinko_batch(
  p_bet_amount numeric,
  p_risk text default 'medium',
  p_ball_count integer default 1,
  p_batch_nonce uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','private','extensions'
as $function$
declare
  v_uid uuid := auth.uid();
  v_count integer := coalesce(p_ball_count,1);
  v_batch uuid := coalesce(p_batch_nonce, gen_random_uuid());
  v_result jsonb;
  v_results jsonb := '[]'::jsonb;
  v_total_payout numeric(18,2) := 0;
  v_total_bet numeric(18,2) := 0;
  v_total_net numeric(18,2) := 0;
  v_balance_after numeric(18,2) := 0;
  v_ball_nonce uuid;
  v_hash text;
  v_all_duplicate boolean := true;
  i integer;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if v_count < 1 or v_count > 25 then raise exception 'Ball count must be between 1 and 25'; end if;
  if p_bet_amount is null or p_bet_amount <= 0 then raise exception 'Invalid bet amount'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text||':'||v_batch::text,0));
  for i in 1..v_count loop
    v_hash := md5(v_batch::text||':'||i::text);
    v_ball_nonce := (substr(v_hash,1,8)||'-'||substr(v_hash,9,4)||'-'||substr(v_hash,13,4)||'-'||substr(v_hash,17,4)||'-'||substr(v_hash,21,12))::uuid;
    v_result := public.drop_plinko(p_bet_amount,p_risk,v_ball_nonce);
    v_results := v_results || jsonb_build_array(v_result || jsonb_build_object('ballNumber',i));
    v_total_payout := v_total_payout + coalesce((v_result->>'payout')::numeric,0);
    v_total_bet := v_total_bet + p_bet_amount;
    v_total_net := v_total_net + coalesce((v_result->>'net')::numeric,0);
    if coalesce((v_result->>'duplicate')::boolean,false) = false then v_all_duplicate := false; end if;
  end loop;
  select balance into v_balance_after from public.profiles where id=v_uid;
  return jsonb_build_object('ok',true,'batchNonce',v_batch,'duplicate',v_all_duplicate,'ballCount',v_count,'betPerBall',p_bet_amount,'totalBet',v_total_bet,'totalPayout',v_total_payout,'net',v_total_net,'balanceAfter',v_balance_after,'results',v_results);
end;
$function$;
revoke all on function public.drop_plinko_batch(numeric,text,integer,uuid) from public, anon;
grant execute on function public.drop_plinko_batch(numeric,text,integer,uuid) to authenticated, service_role;
