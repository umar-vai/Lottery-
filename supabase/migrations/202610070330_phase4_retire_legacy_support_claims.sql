-- Phase 4 follow-up: retire the superseded Support pending-claims implementation.
-- Canonical current flow:
--   service_submit_support_claim(uuid,text,text,text)
--   service_settle_pending_support_claim(text,text)
--   private.settle_support_claim_request(uuid)

do $legacy_support_guard$
begin
  if to_regclass('public.support_pending_claims') is not null
     and exists(select 1 from public.support_pending_claims limit 1) then
    raise exception 'Legacy support_pending_claims contains rows; retirement aborted';
  end if;
end
$legacy_support_guard$;

-- Remove service-role-only wrappers for the superseded 3-argument claim path first.
drop function if exists public.service_settle_pending_support_transaction(uuid);
drop function if exists public.service_submit_support_claim(uuid,text,text);
drop function if exists public.service_claim_support_points(uuid,text,text);

-- Remove the legacy private implementation chain.
drop function if exists private.settle_pending_support_transaction(uuid);
drop function if exists private.submit_support_claim(uuid,text,text);
drop function if exists private.claim_support_points(uuid,text,text);

-- The legacy table is empty and has no incoming FKs/views/current callers.
drop table if exists public.support_pending_claims;

-- Current settlement is reachable only through the service-role public wrapper.
-- Its SECURITY DEFINER private implementation must not be directly executable by
-- browser roles or service_role.
revoke all on function private.settle_support_claim_request(uuid)
  from public, anon, authenticated, service_role;

comment on function public.service_submit_support_claim(uuid,text,text,text) is
  'Canonical Support claim submission service RPC used by claim-support-points Edge Function.';
comment on function public.service_settle_pending_support_claim(text,text) is
  'Canonical Support settlement service RPC used by support-phone-bridge Edge Function.';
comment on function private.settle_support_claim_request(uuid) is
  'Internal Support settlement implementation. Direct browser/service-role EXECUTE revoked; call through canonical service RPCs.';
