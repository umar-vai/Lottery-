create table if not exists public.draw_secrets (
  draw_id uuid primary key references public.draws(id) on delete cascade,
  seed text not null,
  created_at timestamptz not null default now()
);

alter table public.draw_secrets enable row level security;
revoke all on table public.draw_secrets from anon, authenticated;
grant all on table public.draw_secrets to service_role;

create unique index if not exists one_active_draw_idx
on public.draws ((1))
where status in ('open','locked','drawing');

create or replace function public.prevent_locked_ticket_delete()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  d public.draws%rowtype;
begin
  select * into d from public.draws where id = old.draw_id;
  if d.status <> 'open' or now() >= d.cutoff_at then
    raise exception 'Ticket can no longer be removed';
  end if;
  return old;
end;
$$;

drop trigger if exists prevent_locked_ticket_delete_trigger on public.tickets;
create trigger prevent_locked_ticket_delete_trigger
before delete on public.tickets
for each row execute function public.prevent_locked_ticket_delete();

-- Intentionally no DELETE grant for authenticated users in V1.
-- The draw engine is the only component that can read draw_secrets.
