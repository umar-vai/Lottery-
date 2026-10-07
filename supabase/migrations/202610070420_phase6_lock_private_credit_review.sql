-- Phase 6: make the public credit-review RPC the only browser-callable entrypoint.
-- The private helper remains SECURITY DEFINER for the internal mutation logic, but
-- browser/service roles no longer receive direct EXECUTE on private.review_credit_request.

create or replace function public.admin_review_credit_request(
  p_request_id uuid,
  p_approve boolean,
  p_note text default null
)
returns public.credit_requests
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $function$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  return private.review_credit_request(p_request_id,p_approve,p_note);
end;
$function$;

revoke all on function private.review_credit_request(uuid,boolean,text)
from public, anon, authenticated, service_role;

revoke all on function public.admin_review_credit_request(uuid,boolean,text)
from public, anon, service_role;

grant execute on function public.admin_review_credit_request(uuid,boolean,text)
to authenticated;

comment on function public.admin_review_credit_request(uuid,boolean,text) is
  'Canonical admin credit-request review RPC. Phase 6 keeps the private helper non-browser-callable.';
