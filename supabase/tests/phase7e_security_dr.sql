-- Phase 7E security + recovery readiness runtime contract.
-- Read-only/rollback-only against production.

begin;

do $phase7e_security_dr$
declare
  v_private_auth_secdef bigint;
  v_anon_secdef text[];
  v_password_users bigint;
  v_non_google_identities bigint;
  v_slo jsonb;
  v_delivery jsonb;
  v_pg_net_relocatable boolean;
begin
  if to_regclass('private.production_alert_delivery_config_updated_by_idx') is null then
    raise exception 'Phase 7E FK index missing: production_alert_delivery_config_updated_by_idx';
  end if;

  if to_regclass('private.production_incident_acknowledgements_acknowledged_by_idx') is null then
    raise exception 'Phase 7E FK index missing: production_incident_acknowledgements_acknowledged_by_idx';
  end if;

  select count(*) into v_password_users
  from auth.users
  where coalesce(encrypted_password,'')<>'';

  select count(*) into v_non_google_identities
  from auth.identities
  where provider<>'google';

  if v_password_users<>0 or v_non_google_identities<>0 then
    raise exception 'Lootera Auth contract changed; expected Google-only/no-password accounts. password_users %, non_google_identities %',
      v_password_users,v_non_google_identities;
  end if;

  select count(*) into v_private_auth_secdef
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private'
    and p.prosecdef
    and has_function_privilege('authenticated',p.oid,'EXECUTE');

  if v_private_auth_secdef<>0 then
    raise exception 'Authenticated direct private SECURITY DEFINER exposure detected: %',v_private_auth_secdef;
  end if;

  select array_agg(p.proname order by p.proname)
  into v_anon_secdef
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.prosecdef
    and has_function_privilege('anon',p.oid,'EXECUTE');

  if v_anon_secdef is distinct from array['get_platform_features','get_public_event_winners']::text[] then
    raise exception 'Anonymous SECURITY DEFINER allowlist drifted: %',v_anon_secdef;
  end if;

  if has_table_privilege('anon','private.production_alert_outbox','SELECT')
     or has_table_privilege('authenticated','private.production_alert_outbox','SELECT')
     or has_table_privilege('service_role','private.production_alert_outbox','SELECT')
     or has_table_privilege('anon','private.production_alert_delivery_config','SELECT')
     or has_table_privilege('authenticated','private.production_alert_delivery_config','SELECT')
     or has_table_privilege('service_role','private.production_alert_delivery_config','SELECT') then
    raise exception 'Private alert tables became directly readable';
  end if;

  select v.relocatable
  into v_pg_net_relocatable
  from pg_extension e
  join pg_available_extension_versions v
    on v.name=e.extname and v.version=e.extversion
  where e.extname='pg_net';

  if coalesce(v_pg_net_relocatable,true) then
    raise exception 'Phase 7E pg_net advisor classification changed; re-review extension placement';
  end if;

  v_slo:=private.production_slo_report();
  if not coalesce((v_slo->>'ok')::boolean,false)
     or coalesce(v_slo->>'severity','critical')<>'ok'
     or coalesce((v_slo->'cron'->>'missing_required_jobs')::integer,-1)<>0 then
    raise exception 'Production SLO not healthy during Phase 7E verification: %',v_slo;
  end if;

  v_delivery:=private.production_alert_delivery_report();
  if coalesce(v_delivery->>'channel','')<>'telegram'
     or not coalesce((v_delivery->>'enabled')::boolean,false)
     or not coalesce((v_delivery->>'telegram_ready')::boolean,false)
     or coalesce((v_delivery->>'dead_letter_count')::integer,-1)<>0 then
    raise exception 'Telegram production alert delivery is not healthy: %',v_delivery;
  end if;
end
$phase7e_security_dr$;

rollback;
