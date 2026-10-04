create extension if not exists pgcrypto;

create table if not exists public.game_settings (
  id smallint primary key default 1 check (id = 1),
  white_ball_count smallint not null default 5 check (white_ball_count between 1 and 10),
  white_ball_max smallint not null default 69 check (white_ball_max >= white_ball_count),
  powerball_max smallint not null default 26 check (powerball_max >= 1),
  starting_jackpot numeric(18,2) not null default 20000000,
  rollover_increment numeric(18,2) not null default 10000000,
  draw_interval_minutes integer not null default 10 check (draw_interval_minutes between 1 and 10080),
  ticket_cutoff_seconds integer not null default 30 check (ticket_cutoff_seconds between 0 and 3600),
  updated_at timestamptz not null default now()
);

insert into public.game_settings (id) values (1)
on conflict (id) do nothing;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.draws (
  id uuid primary key default gen_random_uuid(),
  draw_number bigint generated always as identity unique,
  status text not null default 'open' check (status in ('open','locked','drawing','completed','cancelled')),
  opens_at timestamptz not null,
  cutoff_at timestamptz not null,
  draw_at timestamptz not null,
  jackpot_amount numeric(18,2) not null default 20000000,
  white_numbers integer[],
  powerball integer,
  power_play_multiplier smallint,
  seed_commitment text,
  seed_reveal text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  check (cutoff_at <= draw_at),
  check (opens_at <= cutoff_at),
  check (white_numbers is null or cardinality(white_numbers) = 5),
  check (powerball is null or powerball between 1 and 26),
  check (power_play_multiplier is null or power_play_multiplier in (2,3,4,5,10))
);

create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  draw_id uuid not null references public.draws(id) on delete cascade,
  white_numbers integer[] not null,
  powerball integer not null,
  power_play boolean not null default false,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (cardinality(white_numbers) = 5),
  check (powerball between 1 and 26)
);

create index if not exists tickets_user_id_idx on public.tickets(user_id);
create index if not exists tickets_draw_id_idx on public.tickets(draw_id);
create index if not exists draws_status_draw_at_idx on public.draws(status, draw_at);

create table if not exists public.ticket_results (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null unique references public.tickets(id) on delete cascade,
  draw_id uuid not null references public.draws(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  white_matches smallint not null,
  powerball_match boolean not null,
  prize_tier text not null,
  simulated_prize numeric(18,2) not null default 0,
  power_play_multiplier smallint,
  simulated_final_prize numeric(18,2) not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.draw_events (
  id bigint generated always as identity primary key,
  draw_id uuid references public.draws(id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security invoker
set search_path = public
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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.validate_ticket()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  d public.draws%rowtype;
  distinct_count integer;
begin
  select * into d from public.draws where id = new.draw_id;
  if not found then
    raise exception 'Draw not found';
  end if;
  if d.status <> 'open' or now() >= d.cutoff_at then
    raise exception 'Ticket sales are closed for this draw';
  end if;

  select count(distinct x) into distinct_count from unnest(new.white_numbers) as x;
  if cardinality(new.white_numbers) <> 5 or distinct_count <> 5 then
    raise exception 'Choose exactly 5 unique white numbers';
  end if;
  if exists (select 1 from unnest(new.white_numbers) as x where x < 1 or x > 69) then
    raise exception 'White numbers must be between 1 and 69';
  end if;
  if new.powerball < 1 or new.powerball > 26 then
    raise exception 'Powerball must be between 1 and 26';
  end if;

  if (select auth.uid()) is not null then
    new.user_id := (select auth.uid());
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists validate_ticket_before_write on public.tickets;
create trigger validate_ticket_before_write
before insert or update on public.tickets
for each row execute function public.validate_ticket();

alter table public.game_settings enable row level security;
alter table public.profiles enable row level security;
alter table public.draws enable row level security;
alter table public.tickets enable row level security;
alter table public.ticket_results enable row level security;
alter table public.draw_events enable row level security;

revoke all on table public.profiles from anon;
revoke all on table public.tickets from anon;
revoke all on table public.ticket_results from anon;

create policy "public can read game settings"
on public.game_settings for select to anon, authenticated
using (true);

create policy "public can read draws"
on public.draws for select to anon, authenticated
using (true);

create policy "public can read draw events"
on public.draw_events for select to anon, authenticated
using (true);

create policy "users can read own profile"
on public.profiles for select to authenticated
using ((select auth.uid()) = id);

create policy "users can update own profile"
on public.profiles for update to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create policy "users can read own tickets"
on public.tickets for select to authenticated
using ((select auth.uid()) = user_id);

create policy "users can insert own tickets"
on public.tickets for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "users can update own open tickets"
on public.tickets for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "users can read own ticket results"
on public.ticket_results for select to authenticated
using ((select auth.uid()) = user_id);

grant select on public.game_settings, public.draws, public.draw_events to anon, authenticated;
grant select, insert, update on public.tickets to authenticated;
grant select, update on public.profiles to authenticated;
grant select on public.ticket_results to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'draws'
  ) then
    alter publication supabase_realtime add table public.draws;
  end if;
end $$;

insert into public.draws (status, opens_at, cutoff_at, draw_at, jackpot_amount)
select
  'open',
  now(),
  now() + make_interval(mins => greatest(gs.draw_interval_minutes, 1)) - make_interval(secs => gs.ticket_cutoff_seconds),
  now() + make_interval(mins => greatest(gs.draw_interval_minutes, 1)),
  gs.starting_jackpot
from public.game_settings gs
where gs.id = 1
  and not exists (select 1 from public.draws where status in ('open','locked','drawing'));
