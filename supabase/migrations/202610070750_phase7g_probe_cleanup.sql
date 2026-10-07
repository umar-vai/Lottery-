-- Phase 7G cleanup: retire temporary service probe RPCs after evidence capture.
-- Move them out of the exposed public schema and revoke every non-owner role.

alter function public.service_phase7g_ticket_probe(text,uuid,text,integer,uuid,uuid,integer)
  set schema private;
alter function public.service_phase7g_rate_probe(text,uuid,text,integer,uuid,text,integer)
  set schema private;
alter function public.service_phase7g_lock_holder(text,uuid,integer)
  set schema private;
alter function public.service_phase7g_lock_waiter(text,uuid,integer)
  set schema private;

revoke all on function private.service_phase7g_ticket_probe(text,uuid,text,integer,uuid,uuid,integer)
from public,anon,authenticated,service_role;
revoke all on function private.service_phase7g_rate_probe(text,uuid,text,integer,uuid,text,integer)
from public,anon,authenticated,service_role;
revoke all on function private.service_phase7g_lock_holder(text,uuid,integer)
from public,anon,authenticated,service_role;
revoke all on function private.service_phase7g_lock_waiter(text,uuid,integer)
from public,anon,authenticated,service_role;

comment on function private.service_phase7g_ticket_probe(text,uuid,text,integer,uuid,uuid,integer) is
  'RETIRED Phase 7G production probe helper retained privately with no external execution grants.';
comment on function private.service_phase7g_rate_probe(text,uuid,text,integer,uuid,text,integer) is
  'RETIRED Phase 7G production probe helper retained privately with no external execution grants.';
comment on function private.service_phase7g_lock_holder(text,uuid,integer) is
  'RETIRED Phase 7G production probe helper retained privately with no external execution grants.';
comment on function private.service_phase7g_lock_waiter(text,uuid,integer) is
  'RETIRED Phase 7G production probe helper retained privately with no external execution grants.';

comment on table private.phase7g_probe_results is
  'Private retained Phase 7G production load/chaos evidence. No browser/service-role direct access.';
comment on function private.phase7g_probe_summary(uuid) is
  'Private summary over retained Phase 7G production load/chaos evidence.';
