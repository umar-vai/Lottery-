-- Live DRAW//01 scheduler used by the Supabase project.
-- Run after schema.sql and secure_draw.sql.

create extension if not exists pg_cron with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create index if not exists draw_events_draw_id_idx on public.draw_events(draw_id);
create index if not exists ticket_results_draw_id_idx on public.ticket_results(draw_id);
create index if not exists ticket_results_user_id_idx on public.ticket_results(user_id);

update public.game_settings
set ticket_cutoff_seconds = 60,
    updated_at = now()
where id = 1 and ticket_cutoff_seconds < 60;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
revoke all on function public.handle_new_user() from public, anon, authenticated;

create or replace function private.draw_int(p_seed text, p_counter integer, p_max integer)
returns integer
language plpgsql
immutable
strict
set search_path = pg_catalog, extensions
as $$
declare
  d bytea;
  v bigint;
begin
  if p_max <= 0 then raise exception 'p_max must be positive'; end if;
  d := extensions.digest(p_seed || ':' || p_counter::text, 'sha256');
  v := (get_byte(d, 0)::bigint << 24)
     + (get_byte(d, 1)::bigint << 16)
     + (get_byte(d, 2)::bigint << 8)
     + get_byte(d, 3)::bigint;
  return mod(v, p_max)::integer;
end;
$$;

create or replace function private.run_draw_engine()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $$
declare
  s public.game_settings%rowtype;
  d public.draws%rowtype;
  t public.tickets%rowtype;
  seed text;
  commitment text;
  whites integer[];
  pb integer;
  n integer;
  counter integer;
  pp_roll integer;
  multiplier integer;
  white_matches integer;
  pb_match boolean;
  tier text;
  base_prize numeric(18,2);
  final_prize numeric(18,2);
  jackpot_winners integer;
  next_jackpot numeric(18,2);
  next_draw_id uuid;
  completed_count integer := 0;
  locked_count integer := 0;
begin
  select * into s from public.game_settings where id = 1;
  if not found then raise exception 'Missing game settings'; end if;

  for d in
    select * from public.draws
    where status = 'open' and cutoff_at <= now() and draw_at > now()
    order by draw_at for update skip locked
  loop
    select ds.seed into seed from public.draw_secrets ds where ds.draw_id = d.id;
    if seed is null then
      seed := encode(extensions.gen_random_bytes(32), 'hex');
      commitment := encode(extensions.digest(seed, 'sha256'), 'hex');
      insert into public.draw_secrets(draw_id, seed) values (d.id, seed)
      on conflict (draw_id) do nothing;
      update public.draws set status = 'locked', seed_commitment = commitment
      where id = d.id and status = 'open';
      insert into public.draw_events(draw_id, event_type, payload)
      values (d.id, 'DRAW_LOCKED', jsonb_build_object('seed_commitment', commitment));
      locked_count := locked_count + 1;
    end if;
  end loop;

  for d in
    select * from public.draws
    where status in ('open','locked') and draw_at <= now()
    order by draw_at for update skip locked
  loop
    select ds.seed into seed from public.draw_secrets ds where ds.draw_id = d.id;
    if seed is null then
      seed := encode(extensions.gen_random_bytes(32), 'hex');
      commitment := encode(extensions.digest(seed, 'sha256'), 'hex');
      insert into public.draw_secrets(draw_id, seed) values (d.id, seed)
      on conflict (draw_id) do update set seed = excluded.seed;
      update public.draws set seed_commitment = commitment where id = d.id;
    else
      commitment := coalesce(d.seed_commitment, encode(extensions.digest(seed, 'sha256'), 'hex'));
    end if;

    update public.draws set status = 'drawing', seed_commitment = commitment where id = d.id;

    whites := array[]::integer[];
    counter := 0;
    while cardinality(whites) < 5 loop
      n := private.draw_int(seed, counter, 69) + 1;
      counter := counter + 1;
      if not (n = any(whites)) then whites := array_append(whites, n); end if;
    end loop;
    select array_agg(x order by x) into whites from unnest(whites) as x;

    pb := private.draw_int(seed, counter, 26) + 1;
    counter := counter + 1;

    if d.jackpot_amount <= 150000000 then
      pp_roll := private.draw_int(seed, counter, 43);
      multiplier := case
        when pp_roll = 0 then 10
        when pp_roll between 1 and 2 then 5
        when pp_roll between 3 and 5 then 4
        when pp_roll between 6 and 18 then 3
        else 2
      end;
    else
      pp_roll := private.draw_int(seed, counter, 42);
      multiplier := case
        when pp_roll between 0 and 1 then 5
        when pp_roll between 2 and 4 then 4
        when pp_roll between 5 and 17 then 3
        else 2
      end;
    end if;

    jackpot_winners := 0;
    for t in select * from public.tickets where draw_id = d.id loop
      select count(*)::integer into white_matches
      from unnest(t.white_numbers) as x where x = any(whites);
      pb_match := (t.powerball = pb);

      tier := 'NO_PRIZE'; base_prize := 0;
      if white_matches = 5 and pb_match then tier := 'JACKPOT'; base_prize := d.jackpot_amount;
      elsif white_matches = 5 then tier := 'MATCH_5'; base_prize := 1000000;
      elsif white_matches = 4 and pb_match then tier := 'MATCH_4_PB'; base_prize := 50000;
      elsif white_matches = 4 then tier := 'MATCH_4'; base_prize := 100;
      elsif white_matches = 3 and pb_match then tier := 'MATCH_3_PB'; base_prize := 100;
      elsif white_matches = 3 then tier := 'MATCH_3'; base_prize := 7;
      elsif white_matches = 2 and pb_match then tier := 'MATCH_2_PB'; base_prize := 7;
      elsif white_matches = 1 and pb_match then tier := 'MATCH_1_PB'; base_prize := 4;
      elsif white_matches = 0 and pb_match then tier := 'PB_ONLY'; base_prize := 4;
      end if;

      final_prize := base_prize;
      if t.power_play and base_prize > 0 and tier <> 'JACKPOT' then
        if tier = 'MATCH_5' then final_prize := 2000000;
        else final_prize := base_prize * multiplier;
        end if;
      end if;

      insert into public.ticket_results(
        ticket_id, draw_id, user_id, white_matches, powerball_match,
        prize_tier, simulated_prize, power_play_multiplier, simulated_final_prize
      ) values (
        t.id, d.id, t.user_id, white_matches, pb_match,
        tier, base_prize, case when t.power_play then multiplier else null end, final_prize
      )
      on conflict (ticket_id) do update set
        white_matches = excluded.white_matches,
        powerball_match = excluded.powerball_match,
        prize_tier = excluded.prize_tier,
        simulated_prize = excluded.simulated_prize,
        power_play_multiplier = excluded.power_play_multiplier,
        simulated_final_prize = excluded.simulated_final_prize;

      if tier = 'JACKPOT' then jackpot_winners := jackpot_winners + 1; end if;
    end loop;

    update public.draws
    set status = 'completed', white_numbers = whites, powerball = pb,
        power_play_multiplier = multiplier, seed_reveal = seed, completed_at = now()
    where id = d.id;

    insert into public.draw_events(draw_id, event_type, payload)
    values (d.id, 'DRAW_COMPLETED', jsonb_build_object(
      'white_numbers', whites,
      'powerball', pb,
      'power_play_multiplier', multiplier,
      'jackpot_winners', jackpot_winners
    ));

    next_jackpot := case when jackpot_winners > 0 then s.starting_jackpot
                         else d.jackpot_amount + s.rollover_increment end;

    if not exists (select 1 from public.draws where status in ('open','locked','drawing')) then
      insert into public.draws(status, opens_at, cutoff_at, draw_at, jackpot_amount)
      values (
        'open', now(),
        now() + make_interval(mins => s.draw_interval_minutes) - make_interval(secs => s.ticket_cutoff_seconds),
        now() + make_interval(mins => s.draw_interval_minutes),
        next_jackpot
      ) returning id into next_draw_id;
      insert into public.draw_events(draw_id, event_type, payload)
      values (next_draw_id, 'DRAW_OPENED', jsonb_build_object('jackpot_amount', next_jackpot));
    end if;

    completed_count := completed_count + 1;
  end loop;

  return jsonb_build_object('ok', true, 'locked', locked_count, 'completed', completed_count);
end;
$$;

revoke all on function private.draw_int(text, integer, integer) from public, anon, authenticated;
revoke all on function private.run_draw_engine() from public, anon, authenticated;

do $$
declare j record;
begin
  for j in select jobid from cron.job where jobname = 'draw01-engine-every-minute' loop
    perform cron.unschedule(j.jobid);
  end loop;
end $$;

select cron.schedule(
  'draw01-engine-every-minute',
  '* * * * *',
  'select private.run_draw_engine();'
);
