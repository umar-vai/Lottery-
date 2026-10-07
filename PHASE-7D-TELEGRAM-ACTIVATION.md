# Phase 7D — Native Telegram Activation

Date: 2026-10-07

## Selected channel

The production alert destination is now **Telegram**.

The database channel is set to `telegram`, while external delivery remains disabled until setup is complete.

Current setup state:

- Telegram channel selected: yes
- Telegram bot token configured: no
- Telegram chat paired: no
- Telegram delivery enabled: no
- dispatcher cron: active
- current production SLO: healthy

This means the system is safe: no Telegram request is sent automatically before the bot is configured.

## Telegram Bot API

The dispatcher uses Telegram's official Bot API.

Production alerts use:

`sendMessage`

Chat discovery uses:

`getUpdates`

The bot token never belongs in GitHub, frontend JavaScript, HTML, migration files, or audit logs.

## Pairing workflow

The operator flow is:

1. create a bot through Telegram **@BotFather**;
2. copy the bot token;
3. store it with the trusted private helper `private.set_production_alert_telegram_bot_token(...)`;
4. rotate/read the private pairing code;
5. send `/start <PAIRING_CODE>` to the bot from the intended private Telegram account;
6. invoke the dispatcher with action `telegram_discover`;
7. the Edge Function reads recent Telegram updates and accepts only a **private chat** containing the exact pairing code;
8. the chat ID is stored in Supabase Vault under `production_alert_telegram_chat_id`;
9. the bot sends a pairing confirmation;
10. invoke action `telegram_test`;
11. confirm the user received the test alert;
12. explicitly enable external delivery.

The chat ID does not need to be manually discovered by the user.

## Vault secrets

Internal Telegram setup uses these Vault names:

- `production_alert_telegram_bot_token`
- `production_alert_telegram_chat_id`
- `production_alert_telegram_pairing_code`

The pairing code is not a long-term authentication secret; it is a short-lived setup verifier and can be rotated.

## Dispatcher v2

`production-alert-dispatch` version 2 supports:

- generic HTTPS webhook delivery;
- native Telegram delivery;
- Telegram chat discovery;
- Telegram test messages;
- production SLO alert messages;
- recovery messages;
- the existing durable retry/backoff/dead-letter flow.

The Edge Function remains custom-authenticated with the independent Vault dispatch token.

## Telegram production message content

For an active incident, the Telegram alert contains:

- Lootera + severity;
- delivery stage: Initial / Escalation 1 / Escalation 2;
- audit event ID;
- breached signal names;
- current value/threshold when available;
- occurrence time;
- delivery attempt number;
- operator instruction to open the Incident Center and acknowledge.

Recovery sends a separate `Lootera — RECOVERED` message.

## What is still needed

The only unavailable input is the real **BotFather bot token**.

Once the token is provided:

- it is stored directly in Supabase Vault;
- a pairing code is generated;
- the user sends one `/start <code>` message;
- ChatGPT can discover the chat ID server-side;
- a real test message is sent;
- after that succeeds, Telegram delivery can be enabled.

Do not paste the token into GitHub issues, source files, public chats, screenshots, or client-side code.
