-- Phase 5: freeze the retired Powerball ticket write path.
-- Historical rows remain readable to their owners/admins, but browser clients can no
-- longer create or mutate legacy tickets. The current event_tickets path is RPC-only.

revoke insert, update, delete on table public.tickets from anon, authenticated;

drop policy if exists "users can insert own tickets" on public.tickets;
drop policy if exists "users can update own open tickets" on public.tickets;

comment on table public.tickets is
  'Legacy Powerball ticket history. Phase 5 freezes browser writes; current lottery purchases use public.purchase_event_ticket -> public.event_tickets.';
