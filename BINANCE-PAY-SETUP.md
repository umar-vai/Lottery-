# Binance Pay → Love Points (LP) setup

This repository now contains a staged Binance Pay integration for the Love Points support wallet.

**Important:** the integration is intentionally **disabled and hidden by default**. Do not enable it until the Binance merchant account is approved, the API credentials are configured server-side, and the business is permitted to accept Binance Pay in its operating jurisdiction.

## What is already prepared

- `binance_pay_orders` table with per-user RLS and idempotent payment references
- `love_point_payment_providers` configuration row for `binance_pay`
- `service_settle_binance_pay_order(...)` database function that credits Love Points only once
- `binance-pay-create-order` Supabase Edge Function
- `binance-pay-webhook` Supabase Edge Function
- Love Points UI support for a Binance Pay tab, checkout redirect, and combined payment history
- Binance Pay is currently `public_visible=false`, `enabled=false`, and has no conversion rate

## 1. Apply for a Binance Pay Merchant account

Use the Binance Pay Merchant application and complete the required KYC/KYB review. Binance may request business identity, website, business model, entity documents, address, ownership information, and additional compliance clarification.

Describe the website and Love Points accurately during onboarding. Love Points are a separate support balance and must not be described as cash, withdrawable value, or Draw Credits.

## 2. Complete the merchant agreement / approval

Binance Pay merchant API access should only be configured after the merchant account is approved and the relevant merchant agreement is available for the account.

## 3. Create Merchant API credentials

In Binance Merchant Admin Portal → developer/API settings, create:

- API Identity Key
- API Secret Key

Never place either key in GitHub, browser JavaScript, HTML, or public configuration.

## 4. Add the credentials to Supabase secrets

Configure these Edge Function secrets in the Supabase project:

```text
BINANCE_PAY_API_KEY=<your Binance Pay API identity key>
BINANCE_PAY_SECRET_KEY=<your Binance Pay API secret key>
```

The Edge Functions already read those exact environment-variable names.

## 5. Configure the Binance Pay webhook

Use this HTTPS endpoint in the Binance Merchant Admin Portal:

```text
https://mwtlsnneooxmryondrex.supabase.co/functions/v1/binance-pay-webhook
```

The webhook function is intentionally deployed without Supabase JWT verification because Binance does not send a Supabase user token. Instead, it validates the Binance Pay signature and then independently queries Binance for the order before crediting LP.

## 6. Decide the LP conversion rule

The staged integration creates Binance Pay orders in `USDT` by default. The database uses `lp_per_currency_unit` to convert the requested LP amount to the Binance order amount.

Example concept only:

```text
LP requested ÷ LP per USDT = USDT order amount
```

If your policy is `1 BDT = 1 LP`, decide how the BDT↔USDT reference rate will be set and how often it will change. Do not enable the provider until this has been decided and disclosed to users.

## 7. Configure rate and limits

After approval and credentials are ready, update the provider row. Keep it disabled while testing configuration:

```sql
update public.love_point_payment_providers
set order_currency = 'USDT',
    lp_per_currency_unit = <YOUR_APPROVED_RATE>,
    min_lp = 100,
    max_lp = 100000,
    updated_at = now()
where provider = 'binance_pay';
```

## 8. Test before making it public

Recommended order:

1. Confirm Merchant API credentials work.
2. Confirm Create Order returns a real Binance `prepayId` and hosted `checkoutUrl`.
3. Complete one small test payment.
4. Confirm the webhook receives `PAY_SUCCESS`.
5. Confirm the webhook independently queries the order and sees `PAID`.
6. Confirm exactly one `binance_pay_orders` row becomes `paid`.
7. Confirm Love Points are credited exactly once even if Binance retries the webhook.
8. Confirm a user can see the Binance transaction in Love Points history.

## 9. Enable public UI only after successful testing

```sql
update public.love_point_payment_providers
set public_visible = true,
    enabled = true,
    updated_at = now()
where provider = 'binance_pay';
```

To immediately stop new Binance Pay orders without removing data:

```sql
update public.love_point_payment_providers
set enabled = false,
    updated_at = now()
where provider = 'binance_pay';
```

You can separately set `public_visible=false` to hide the Binance Pay tab.

## Security model

- The browser never receives the Binance secret key.
- Order creation happens in a JWT-protected Supabase Edge Function.
- Binance webhook notifications are signature-checked server-side.
- Successful webhook events are verified again through Binance Query Order.
- LP settlement is database-transactional and idempotent.
- Users can only read their own Binance Pay order history through RLS.
- Binance Pay never writes Draw Credits or lottery tickets.

## Current production state

```text
public_visible = false
enabled        = false
currency       = USDT
LP rate        = not configured
```

That state is intentional. The code is ready for merchant credentials and compliance approval, but no live Binance Pay payment can currently be created.
