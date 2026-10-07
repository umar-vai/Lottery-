-- Phase 4 follow-up: legacy Support claim retirement contract.
begin;

do $phase4_legacy_support$
declare
  f regprocedure;
begin
  if to_regclass('public.support_pending_claims') is not null then
    raise exception 'Legacy support_pending_claims table still exists';
  end if;

  if to_regprocedure('public.service_settle_pending_support_transaction(uuid)') is not null
     or to_regprocedure('public.service_submit_support_claim(uuid,text,text)') is not null
     or to_regprocedure('public.service_claim_support_points(uuid,text,text)') is not null
     or to_regprocedure('private.settle_pending_support_transaction(uuid)') is not null
     or to_regprocedure('private.submit_support_claim(uuid,text,text)') is not null
     or to_regprocedure('private.claim_support_points(uuid,text,text)') is not null then
    raise exception 'One or more legacy Support claim functions still exist';
  end if;

  if to_regprocedure('public.service_submit_support_claim(uuid,text,text,text)') is null
     or to_regprocedure('public.service_settle_pending_support_claim(text,text)') is null
     or to_regprocedure('private.settle_support_claim_request(uuid)') is null then
    raise exception 'Canonical Support claim/settlement functions are missing';
  end if;

  f := 'private.settle_support_claim_request(uuid)'::regprocedure;
  if has_function_privilege('anon',f,'EXECUTE')
     or has_function_privilege('authenticated',f,'EXECUTE')
     or has_function_privilege('service_role',f,'EXECUTE') then
    raise exception 'Private canonical settlement implementation is directly executable';
  end if;

  if not has_function_privilege(
    'service_role',
    'public.service_submit_support_claim(uuid,text,text,text)'::regprocedure,
    'EXECUTE'
  ) then
    raise exception 'Canonical Support submit service-role grant is missing';
  end if;

  if not has_function_privilege(
    'service_role',
    'public.service_settle_pending_support_claim(text,text)'::regprocedure,
    'EXECUTE'
  ) then
    raise exception 'Canonical Support settle service-role grant is missing';
  end if;
end
$phase4_legacy_support$;

rollback;
