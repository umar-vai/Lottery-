create table if not exists public.love_point_payment_providers (
  provider text primary key,
  display_name text not null,
  public_visible boolean not null default false,
  enabled boolean not null default false,
  order_currency text not null default 'USDT',
  lp_per_currency_unit numeric(20,8),
  min_lp numeric(20,2) not null default 100,
  max_lp numeric(20,2) not null default 100000,
  updated_at timestamptz not null default now()
);

insert into public.love_point_payment_providers(provider,display_name,public_visible,enabled,order_currency,lp_per_currency_unit,min_lp,max_lp)
values('binance_pay','Binance Pay',false,false,'USDT',null,100,100000)
on conflict(provider) do nothing;

alter table public.love_point_payment_providers enable row level security;
drop policy if exists love_point_payment_providers_read on public.love_point_payment_providers;
create policy love_point_payment_providers_read on public.love_point_payment_providers for select using (true);
grant select on public.love_point_payment_providers to anon, authenticated;

create table if not exists public.binance_pay_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  merchant_trade_no text not null unique,
  prepay_id text unique,
  binance_transaction_id text unique,
  lp_amount numeric(20,2) not null check (lp_amount > 0),
  order_amount numeric(20,8) not null check (order_amount > 0),
  order_currency text not null,
  status text not null default 'created' check (status in ('created','pending','paid','closed','expired','failed')),
  checkout_url text,
  qrcode_link text,
  deeplink text,
  expire_time_ms bigint,
  raw_create jsonb,
  raw_webhook jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at timestamptz
);

create index if not exists binance_pay_orders_user_created_idx on public.binance_pay_orders(user_id, created_at desc);
create index if not exists binance_pay_orders_status_idx on public.binance_pay_orders(status);

alter table public.binance_pay_orders enable row level security;
drop policy if exists binance_pay_orders_select_own on public.binance_pay_orders;
create policy binance_pay_orders_select_own on public.binance_pay_orders for select using (auth.uid() = user_id);
grant select on public.binance_pay_orders to authenticated;

create or replace function public.service_settle_binance_pay_order(
  p_merchant_trade_no text,
  p_prepay_id text,
  p_transaction_id text,
  p_currency text,
  p_total_fee numeric,
  p_raw jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  o public.binance_pay_orders%rowtype;
  new_balance numeric;
begin
  select * into o
  from public.binance_pay_orders
  where merchant_trade_no = p_merchant_trade_no
  for update;

  if not found then
    return jsonb_build_object('ok',false,'status','unknown_order');
  end if;

  if o.status = 'paid' then
    select balance into new_balance from public.support_wallets where user_id=o.user_id;
    return jsonb_build_object('ok',true,'status','already_paid','lp',o.lp_amount,'balance',coalesce(new_balance,0));
  end if;

  if o.prepay_id is not null and p_prepay_id is not null and o.prepay_id <> p_prepay_id then
    raise exception 'prepay id mismatch';
  end if;
  if upper(o.order_currency) <> upper(coalesce(p_currency,'')) then
    raise exception 'currency mismatch';
  end if;
  if abs(o.order_amount - p_total_fee) > 0.00000001 then
    raise exception 'amount mismatch';
  end if;

  update public.binance_pay_orders
  set status='paid',
      prepay_id=coalesce(prepay_id,p_prepay_id),
      binance_transaction_id=coalesce(p_transaction_id,binance_transaction_id),
      raw_webhook=p_raw,
      paid_at=now(),
      updated_at=now()
  where id=o.id;

  insert into public.support_wallets(user_id,balance,updated_at)
  values(o.user_id,o.lp_amount,now())
  on conflict(user_id) do update
    set balance=public.support_wallets.balance + excluded.balance,
        updated_at=now()
  returning balance into new_balance;

  return jsonb_build_object('ok',true,'status','paid','lp',o.lp_amount,'balance',new_balance);
end;
$$;

revoke all on function public.service_settle_binance_pay_order(text,text,text,text,numeric,jsonb) from public, anon, authenticated;
grant execute on function public.service_settle_binance_pay_order(text,text,text,text,numeric,jsonb) to service_role;
