-- Phase 7D — make Telegram readiness aware of Edge Function secrets.
-- A successful Telegram delivery proves the Edge dispatcher has a usable bot
-- token even when that token is stored as TELEGRAM_BOT_TOKEN rather than Vault.

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
  v_telegram_bot_vault boolean:=false;
  v_telegram_chat boolean:=false;
  v_telegram_bot_ready boolean:=false;
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
  ) into v_telegram_bot_vault;

  select exists(
    select 1 from vault.secrets
    where name='production_alert_telegram_chat_id'
  ) into v_telegram_chat;

  v_telegram_bot_ready:=v_telegram_bot_vault
    or (
      v_cfg.channel='telegram'
      and coalesce(v_cfg.dispatcher_configured,false)
      and v_cfg.last_delivery_at is not null
    );

  return jsonb_build_object(
    'enabled',coalesce(v_cfg.external_enabled,false),
    'channel',coalesce(v_cfg.channel,'webhook'),
    'dispatcher_configured',coalesce(v_cfg.dispatcher_configured,false),
    'external_webhook_configured',
      case when v_cfg.channel='webhook' then coalesce(v_cfg.dispatcher_configured,false) else false end,
    'telegram_bot_configured',v_telegram_bot_ready,
    'telegram_bot_vault_configured',v_telegram_bot_vault,
    'telegram_chat_configured',v_telegram_chat,
    'telegram_ready',v_telegram_bot_ready and v_telegram_chat,
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
      when v_cfg.channel='telegram' and not v_telegram_bot_ready
        then 'Telegram selected but the dispatcher has not yet verified a usable bot token.'
      when v_cfg.channel='telegram' and not v_telegram_chat
        then 'Telegram bot is usable; chat pairing is still required.'
      when v_cfg.channel='telegram' and not coalesce(v_cfg.external_enabled,false)
        then 'Telegram is paired and verified but external delivery is disabled.'
      when v_cfg.channel='telegram'
        then 'Telegram production alert delivery is enabled and verified.'
      when not coalesce(v_cfg.external_enabled,false)
        then 'External webhook delivery is disabled.'
      when not coalesce(v_cfg.dispatcher_configured,false)
        then 'External delivery is enabled but dispatcher configuration is unverified.'
      else 'External webhook delivery is enabled and dispatcher configuration has been verified.'
    end
  );
end;
$function$;

revoke all on function private.production_alert_delivery_report()
from public,anon,authenticated,service_role;

comment on function private.production_alert_delivery_report() is
  'Phase 7D alert-delivery health report; Telegram readiness accepts a verified Edge Function token path after successful delivery.';
