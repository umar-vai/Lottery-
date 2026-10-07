-- Phase 7D native Telegram channel runtime contract.
-- Rollback-only. It validates channel selection, Vault-backed setup metadata,
-- service-only target access, and pairing-code lifecycle without calling Telegram.

begin;

do $phase7d_telegram_contract$
declare
  v_dispatch_token text;
  v_target jsonb;
  v_report jsonb;
  v_code text;
begin
  select decrypted_secret
  into v_dispatch_token
  from vault.decrypted_secrets
  where name='production_alert_dispatch_token'
  limit 1;

  if v_dispatch_token is null then
    raise exception 'Phase 7D Telegram contract requires internal dispatch token';
  end if;

  if (
    select channel
    from private.production_alert_delivery_config
    where id=1
  )<>'telegram' then
    raise exception 'Telegram is not the selected production alert channel';
  end if;

  if (
    select external_enabled
    from private.production_alert_delivery_config
    where id=1
  ) then
    raise exception 'Telegram external delivery must remain disabled before bot/chat activation';
  end if;

  v_code:=private.rotate_production_alert_telegram_pairing_code();

  if v_code !~ '^[A-F0-9]{10}$' then
    raise exception 'Telegram pairing code format drifted: %',v_code;
  end if;

  v_target:=public.service_get_production_alert_delivery_target(v_dispatch_token);

  if v_target->>'channel'<>'telegram' then
    raise exception 'Service target does not return Telegram channel: %',v_target;
  end if;

  if not (v_target ? 'telegram') then
    raise exception 'Telegram service target metadata missing';
  end if;

  v_report:=private.production_alert_delivery_report();

  if not (
    v_report ? 'telegram_bot_configured'
    and v_report ? 'telegram_chat_configured'
    and v_report ? 'telegram_ready'
  ) then
    raise exception 'Telegram setup health missing from delivery report: %',v_report;
  end if;

  if has_function_privilege('anon','public.service_get_production_alert_delivery_target(text)','EXECUTE')
     or has_function_privilege('authenticated','public.service_get_production_alert_delivery_target(text)','EXECUTE')
     or has_function_privilege('anon','public.service_store_production_alert_telegram_chat(text,text,text)','EXECUTE')
     or has_function_privilege('authenticated','public.service_store_production_alert_telegram_chat(text,text,text)','EXECUTE') then
    raise exception 'Telegram service setup RPC is browser executable';
  end if;

  if not has_function_privilege('service_role','public.service_get_production_alert_delivery_target(text)','EXECUTE')
     or not has_function_privilege('service_role','public.service_store_production_alert_telegram_chat(text,text,text)','EXECUTE') then
    raise exception 'Telegram service setup RPC grant is incomplete';
  end if;

  if has_function_privilege('anon','private.set_production_alert_telegram_bot_token(text)','EXECUTE')
     or has_function_privilege('authenticated','private.set_production_alert_telegram_bot_token(text)','EXECUTE')
     or has_function_privilege('service_role','private.set_production_alert_telegram_bot_token(text)','EXECUTE') then
    raise exception 'Operator-only Telegram bot-token helper is externally executable';
  end if;
end
$phase7d_telegram_contract$;

rollback;
