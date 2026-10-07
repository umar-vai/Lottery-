-- Phase 7G cleanup: remove temporary service probe RPCs after evidence capture.

drop function if exists public.service_phase7g_ticket_probe(text,uuid,text,integer,uuid,uuid,integer);
drop function if exists public.service_phase7g_rate_probe(text,uuid,text,integer,uuid,text,integer);
drop function if exists public.service_phase7g_lock_holder(text,uuid,integer);
drop function if exists public.service_phase7g_lock_waiter(text,uuid,integer);

comment on table private.phase7g_probe_results is
  'Private retained Phase 7G production load/chaos evidence. No browser/service-role direct access.';
comment on function private.phase7g_probe_summary(uuid) is
  'Private summary over retained Phase 7G production load/chaos evidence.';
