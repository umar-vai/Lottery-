-- Phase 1 — restrict admin RPC execution to signed-in sessions.
-- These functions already enforce public.is_admin() internally; this removes
-- unnecessary anonymous/PUBLIC execute exposure at the PostgREST boundary.

revoke all on function public.admin_relaunch_lottery_event(uuid) from public, anon;
grant execute on function public.admin_relaunch_lottery_event(uuid) to authenticated;

revoke all on function public.admin_update_completed_event_metadata(uuid,text,text,text) from public, anon;
grant execute on function public.admin_update_completed_event_metadata(uuid,text,text,text) to authenticated;
