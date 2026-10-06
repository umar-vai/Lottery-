-- Phase 1 — least-privilege grants for Data API tables.
-- RLS remains enabled, but read-only-by-design tables should not also carry
-- broad write privileges for anon/authenticated roles.

revoke insert, update, delete, truncate, references, trigger
on table
  public.audit_logs,
  public.binance_pay_orders,
  public.draw_events,
  public.draws,
  public.event_prize_tiers,
  public.game_settings,
  public.games,
  public.love_point_payment_providers,
  public.plinko_drops,
  public.referral_rewards,
  public.referrals,
  public.slot_spins,
  public.support_claim_requests,
  public.ticket_results
from anon, authenticated;

-- Public catalog/history reads that intentionally work logged out.
grant select on table
  public.draw_events,
  public.draws,
  public.event_prize_tiers,
  public.game_settings,
  public.games,
  public.love_point_payment_providers
to anon, authenticated;

-- Signed-in read paths. RLS still limits each row set.
grant select on table
  public.audit_logs,
  public.binance_pay_orders,
  public.plinko_drops,
  public.referral_rewards,
  public.referrals,
  public.slot_spins,
  public.support_claim_requests,
  public.ticket_results
to authenticated;

-- Anonymous visitors do not need these account/admin datasets at all.
revoke all on table
  public.audit_logs,
  public.binance_pay_orders,
  public.plinko_drops,
  public.referral_rewards,
  public.referrals,
  public.slot_spins,
  public.support_claim_requests,
  public.ticket_results
from anon;

-- Legacy Powerball tickets still intentionally support authenticated
-- INSERT/UPDATE. Remove unrelated destructive/schema-adjacent privileges.
revoke delete, truncate, references, trigger
on table public.tickets
from authenticated;
