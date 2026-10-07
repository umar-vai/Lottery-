-- Phase 7D native Telegram channel activation support.
-- Credentials stay in Supabase Vault. External delivery remains disabled until
-- the bot token is stored, the intended chat is paired, and a test succeeds.

alter table private.production_alert_delivery_config
  drop constraint if exists production_alert_delivery_config_channel_check;

alter table private.production_alert_delivery_config
  add constraint production_alert_delivery_config_channel_check
  check (channel in ('webhook','telegram'));

do $phase7d_telegram_pairing$
declare
  v_code text;
begin
  if not exists(
    select 1 from vault.secrets
    where name='production_alert_telegram_pairing_code'
  ) then
    v_code:=upper(substr(encode(extensions.gen_random_bytes(8),'hex'),1,10));
    perform vault.create_secret(
      v_code,
      'production_alert_telegram_pairing_code',
      'Temporary pairing code used to discover the intended Telegram chat for production alerts.',
      null
    );
  end if;

  update private.production_alert_delivery_config
  set channel='telegram',
      external_enabled=false,
      dispatcher_configured=false,
      last_error='Telegram selected; bot token and chat pairing are required before enablement',
      updated_at=now()
  where id=1;
end
$phase7d_telegram_pairing$;

create or replace function private.set_production_alert_telegram_bot_token(
  p_bot_token text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $function$
declare
  v_token text;
  v_secret_id uuid;
begin
  v_token:=btrim(coalesce(p_bot_token,''));

  if char_length(v_token)<30
     or char_length(v_token)>200
     or position(':' in v_token)=0 then
    raise exception 'Invalid Telegram bot token format';
  end if;

  select id into v_secret_id
  from vault.secrets
  where name='production_alert_telegram_bot_token'
  limit 1;

  if v_secret_id is null then
    perform vault.create_secret(
      v_token,
      'production_alert_telegram_bot_token',
      'Telegram Bot API token for DRAW//01 production alerts.',
      null
    );
  else
    perform vault.update_secret(
      v_secret_id,
      v_token,
      'production_alert_telegram_bot_token',
      'Telegram Bot API token for DRAW//01 production alerts.',
      null
    );
  end if;

  update private.production_alert_delivery_config
  set channel='telegram',
      external_enabled=false,
      dispatcher_configured=false,
      last_error='Telegram bot token stored; chat pairing and delivery test required before enablement',
      updated_at=now()
  where id=1;

  return jsonb_build_object(
    'ok',true,
    'channel','telegram',
    'bot_token_configured',true,
    'external_enabled',false
  );
end;
$function$;

create or replace function private.rotate_production_alert_telegram_pairing_code()
returns text
language plpgsql
security definer
set search_path to 'pg_catalog','public','private','extensions'
as $function$
declare
  v_code text;
  v_secret_id uuid;
begin
  v_code:=upper(substr(encode(extensions.gen_random_bytes(8),'hex'),1,10));

  select id into v_secret_id
  from vault.secrets
  where name='production_alert_telegram_pairing_code'
  limit 1;

  if v_secret_id is null then
    perform vault.create_secret(
      v_code,
      'production_alert_telegram_pairing_code',
      'Temporary pairing code used to discover the intended Telegram chat for production alerts.',
      null
    );
  else
    perform vault.update_secret(
      v_secret_id,
      v_code,
      'production_alert_telegram_pairing_code',
      'Temporary pairing code used to discover the intended Telegram chat for production alerts.',
      null
    );
  end if;

  return v_code;
end;
$function$;

create or replace function public.service_get_production_alert_delivery_target(
  p_dispatch_token text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $function$
declare
  v_channel text;
  v_bot_token text;
  v_chat_id text;
  v_pairing_code text;
begin
  if not private.verify_production_alert_dispatch_token(p_dispatch_token) then
    raise exception 'Invalid production alert dispatch token';
  end if;

  select channel into v_channel
  from private.production_alert_delivery_config
  where id=1;

  if v_channel='telegram' then
    select decrypted_secret into v_bot_token
    from vault.decrypted_secrets
    where name='production_alert_telegram_bot_token'
    limit 1;

    select decrypted_secret into v_chat_id
    from vault.decrypted_secrets
    where name='production_alert_telegram_chat_id'
    limit 1;

    select decrypted_secret into v_pairing_code
    from vault.decrypted_secrets
    where name='production_alert_telegram_pairing_code'
    limit 1;
  end if;

  return jsonb_build_object(
    'channel',coalesce(v_channel,'webhook'),
    'telegram',jsonb_build_object(
      'bot_token',v_bot_token,
      'chat_id',v_chat_id,
      'pairing_code',v_pairing_code,
      'bot_configured',v_bot_token is not null,
      'chat_configured',v_chat_id is not null
    )
  );
end;
$function$;

create or replace function public.service_store_production_alert_telegram_chat(
  p_dispatch_token text,
  p_chat_id text,
  p_chat_label text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $function$
declare
  v_chat text;
  v_secret_id uuid;
begin
  if not private.verify_production_alert_dispatch_token(p_dispatch_token) then
    raise exception 'Invalid production alert dispatch token';
  end if;

  v_chat:=btrim(coalesce(p_chat_id,''));

  if v_chat !~ '^-?[0-9]{1,20}$' then
    raise exception 'Invalid Telegram chat id';
  end if;

  select id into v_secret_id
  from vault.secrets
  where name='production_alert_telegram_chat_id'
  limit 1;

  if v_secret_id is null then
    perform vault.create_secret(
      v_chat,
      'production_alert_telegram_chat_id',
      left('Telegram destination for DRAW//01 production alerts'
        ||case when nullif(btrim(coalesce(p_chat_label,'')),'') is null
          then '' else ': '||btrim(p_chat_label) end,500),
      null
    );
  else
    perform vault.update_secret(
      v_secret_id,
      v_chat,
      'production_alert_telegram_chat_id',
      left('Telegram destination for DRAW//01 production alerts'
        ||case when nullif(btrim(coalesce(p_chat_label,'')),'') is null
          then '' else ': '||btrim(p_chat_label) end,500),
      null
    );
  end if;

  update private.production_alert_delivery_config
  set channel='telegram',
      dispatcher_configured=true,
      last_error='Telegram chat paired; test delivery required before enablement',
      updated_at=now()
  where id=1;

  return jsonb_build_object(
    'ok',true,
    'channel','telegram',
    'chat_configured',true,
    'external_enabled',(
      select external_enabled
      from private.production_alert_delivery_config
      where id=1
    )
  );
end;
$function$;

create or replace function private.production_alert_delivery_report()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','private','cron'
as $function$
declare
  v_cfg private.production_alert_delivery_config%rowtype;
  v_pending bigint:=0;
  v_in_flight bigint:=0;
  v_dead bigint:=0;
  v_delivered_24h bigint:=0;
  v_pending_old bigint:=0;
  v_cron_active boolean:=false;
  v_telegram_bot boolean:=false;
  v_telegram_chat boolean:=false;
begin
  select * into v_cfg
  from private.production_alert_delivery_config
  where id=1;

  select
    count(*) filter(where status='pending'),
    count(*) filter(where status='in_flight'),
    count(*) filter(where status='dead_letter'),
    count(*) filter(where status='delivered' and delivered_at>now()-interval '24 hours'),
    count(*) filter(where status='pending' and next_attempt_at<now()-interval '10 minutes')
  into v_pending,v_in_flight,v_dead,v_delivered_24h,v_pending_old
  from private.production_alert_outbox;

  select exists(
    select 1 from cron.job
    where jobname='production-alert-dispatch-minute' and active
  ) into v_cron_active;

  select exists(
    select 1 from vault.secrets
    where name='production_alert_telegram_bot_token'
  ) into v_telegram_bot;

  select exists(
    select 1 from vault.secrets
    where name='production_alert_telegram_chat_id'
  ) into v_telegram_chat;

  return jsonb_build_object(
    'enabled',coalesce(v_cfg.external_enabled,false),
    'channel',coalesce(v_cfg.channel,'webhook'),
    'dispatcher_configured',coalesce(v_cfg.dispatcher_configured,false),
    'external_webhook_configured',
      case when v_cfg.channel='webhook' then coalesce(v_cfg.dispatcher_configured,false) else false end,
    'telegram_bot_configured',v_telegram_bot,
    'telegram_chat_configured',v_telegram_chat,
    'telegram_ready',v_telegram_bot and v_telegram_chat,
    'warning_escalation_1_minutes',coalesce(v_cfg.warning_escalation_1_minutes,15),
    'critical_escalation_1_minutes',coalesce(v_cfg.critical_escalation_1_minutes,5),
    'escalation_2_minutes',coalesce(v_cfg.escalation_2_minutes,30),
    'max_attempts',coalesce(v_cfg.max_attempts,6),
    'pending_count',v_pending,
    'in_flight_count',v_in_flight,
    'dead_letter_count',v_dead,
    'delivered_24h',v_delivered_24h,
    'pending_over_10m',v_pending_old,
    'dispatcher_cron_active',v_cron_active,
    'last_dispatch_at',v_cfg.last_dispatch_at,
    'last_delivery_at',v_cfg.last_delivery_at,
    'last_error',v_cfg.last_error,
    'external_delivery_note',case
      when v_cfg.channel='telegram' and not v_telegram_bot
        then 'Telegram selected but bot token is not configured.'
      when v_cfg.channel='telegram' and not v_telegram_chat
        then 'Telegram bot token is configured; chat pairing is still required.'
      when v_cfg.channel='telegram' and not coalesce(v_cfg.external_enabled,false)
        then 'Telegram is paired but external delivery is disabled until the test message succeeds and an operator enables it.'
      when v_cfg.channel='telegram'
        then 'Telegram production alert delivery is enabled.'
      when not coalesce(v_cfg.external_enabled,false)
        then 'External webhook delivery is disabled. Configure Edge Function webhook secrets before enabling.'
      when not coalesce(v_cfg.dispatcher_configured,false)
        then 'External delivery is enabled but the Edge dispatcher has not verified webhook configuration.'
      else 'External webhook delivery is enabled and dispatcher configuration has been verified.'
    end
  );
end;
$function$;

revoke all on function private.set_production_alert_telegram_bot_token(text)
from public,anon,authenticated,service_role;

revoke all on function private.rotate_production_alert_telegram_pairing_code()
from public,anon,authenticated,service_role;

revoke all on function public.service_get_production_alert_delivery_target(text)
from public,anon,authenticated,service_role;
grant execute on function public.service_get_production_alert_delivery_target(text)
to service_role;

revoke all on function public.service_store_production_alert_telegram_chat(text,text,text)
from public,anon,authenticated,service_role;
grant execute on function public.service_store_production_alert_telegram_chat(text,text,text)
to service_role;

comment on function private.set_production_alert_telegram_bot_token(text) is
  'Operator-only helper used through trusted SQL tooling to store/rotate the Telegram bot token in Vault.';

comment on function private.rotate_production_alert_telegram_pairing_code() is
  'Operator-only helper that rotates the temporary Telegram pairing code.';

comment on function public.service_get_production_alert_delivery_target(text) is
  'Phase 7D service-role-only delivery target lookup. Returns Telegram secrets only after dispatch-token validation.';

comment on function public.service_store_production_alert_telegram_chat(text,text,text) is
  'Phase 7D service-role-only Telegram chat pairing result writer. Requires dispatch-token validation.';
