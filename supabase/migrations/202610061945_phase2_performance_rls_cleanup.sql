-- Phase 2 — Supabase performance/RLS advisor cleanup.
-- Scope: covering FK indexes, RLS initPlan optimization, and duplicate SELECT policy consolidation.

-- 1) Cover foreign keys reported by the Supabase advisor.
create index if not exists audit_logs_actor_user_id_idx
  on public.audit_logs(actor_user_id);

create index if not exists balance_ledger_actor_user_id_idx
  on public.balance_ledger(actor_user_id);

create index if not exists credit_requests_reviewed_by_idx
  on public.credit_requests(reviewed_by);

create index if not exists lottery_events_created_by_idx
  on public.lottery_events(created_by);

create index if not exists platform_controls_updated_by_idx
  on public.platform_controls(updated_by);

create index if not exists referral_rewards_referred_user_id_idx
  on public.referral_rewards(referred_user_id);

create index if not exists support_bridge_devices_created_by_idx
  on public.support_bridge_devices(created_by);

create index if not exists support_claim_requests_transaction_id_idx
  on public.support_claim_requests(transaction_id);

create index if not exists support_pending_claims_transaction_id_idx
  on public.support_pending_claims(transaction_id);

create index if not exists support_point_adjustments_actor_user_id_idx
  on public.support_point_adjustments(actor_user_id);

create index if not exists support_transactions_device_id_idx
  on public.support_transactions(device_id);

-- 2) RLS initPlan optimization.
-- Wrapping auth helpers in SELECT lets Postgres evaluate them once per statement.

drop policy if exists "support_pending_select_own" on public.support_pending_claims;
create policy "support_pending_select_own"
on public.support_pending_claims
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "support_claim_requests_select_own" on public.support_claim_requests;
create policy "support_claim_requests_select_own"
on public.support_claim_requests
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "users can read own slot spins" on public.slot_spins;
create policy "users can read own slot spins"
on public.slot_spins
for select
to authenticated
using (
  user_id = (select auth.uid())
  or (select public.is_admin())
);

drop policy if exists "users can read own plinko drops" on public.plinko_drops;
create policy "users can read own plinko drops"
on public.plinko_drops
for select
to authenticated
using (
  user_id = (select auth.uid())
  or (select public.is_admin())
);

drop policy if exists "binance_pay_orders_select_own" on public.binance_pay_orders;
create policy "binance_pay_orders_select_own"
on public.binance_pay_orders
for select
to authenticated
using ((select auth.uid()) = user_id);

-- 3) Consolidate duplicate permissive SELECT policies.
-- Preserve the exact effective access rules while making each role evaluate one policy.

drop policy if exists "admins can read all draws" on public.draws;
drop policy if exists "public can read visible draws" on public.draws;

create policy "anon can read visible draws"
on public.draws
for select
to anon
using (status <> 'draft');

create policy "authenticated can read visible or admin draws"
on public.draws
for select
to authenticated
using (
  status <> 'draft'
  or (select public.is_admin())
);

drop policy if exists "admins can read all profiles" on public.profiles;
drop policy if exists "users can read own profile" on public.profiles;

create policy "users or admins can read profiles"
on public.profiles
for select
to authenticated
using (
  id = (select auth.uid())
  or (select public.is_admin())
);

drop policy if exists "admins can read all ticket results" on public.ticket_results;
drop policy if exists "users can read own ticket results" on public.ticket_results;

create policy "users or admins can read ticket results"
on public.ticket_results
for select
to authenticated
using (
  user_id = (select auth.uid())
  or (select public.is_admin())
);

drop policy if exists "admins can read all tickets" on public.tickets;
drop policy if exists "users can read own tickets" on public.tickets;

create policy "users or admins can read tickets"
on public.tickets
for select
to authenticated
using (
  user_id = (select auth.uid())
  or (select public.is_admin())
);
