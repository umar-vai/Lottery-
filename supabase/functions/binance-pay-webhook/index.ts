const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BINANCE_KEY = Deno.env.get('BINANCE_PAY_API_KEY') || '';
const BINANCE_SECRET = Deno.env.get('BINANCE_PAY_SECRET_KEY') || '';
const BINANCE_HOST = 'https://bpay.binanceapi.com';
const encoder = new TextEncoder();

function response(returnCode: 'SUCCESS' | 'FAIL', returnMessage: string | null = null) {
  return new Response(JSON.stringify({ returnCode, returnMessage }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

async function hmacSha512Hex(secret: string, payload: string) {
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return Array.from(new Uint8Array(sig)).map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

function randomAlphaNum(length: number) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, b => chars[b % chars.length]).join('');
}

async function binanceRequest(path: string, body: Record<string, unknown>) {
  const timestamp = String(Date.now());
  const nonce = randomAlphaNum(32);
  const raw = JSON.stringify(body);
  const signature = await hmacSha512Hex(BINANCE_SECRET, `${timestamp}\n${nonce}\n${raw}\n`);
  const r = await fetch(`${BINANCE_HOST}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'BinancePay-Timestamp': timestamp,
      'BinancePay-Nonce': nonce,
      'BinancePay-Certificate-SN': BINANCE_KEY,
      'BinancePay-Signature': signature,
    },
    body: raw,
  });
  const text = await r.text();
  let data: any;
  try { data = text ? JSON.parse(text) : null; } catch { data = { status: 'FAIL', errorMessage: text }; }
  if (!r.ok || data?.status !== 'SUCCESS' || !data?.data) {
    throw new Error(data?.errorMessage || data?.code || `Binance Pay HTTP ${r.status}`);
  }
  return data;
}

async function db(path: string, init: RequestInit = {}) {
  const headers = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'content-type': 'application/json',
    ...(init.headers || {}),
  } as Record<string, string>;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers });
  const text = await r.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!r.ok) throw new Error(data?.message || data?.details || String(data) || 'Database error');
  return data;
}

async function rpc(name: string, args: Record<string, unknown>) {
  return await db(`rpc/${name}`, { method: 'POST', body: JSON.stringify(args) });
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return response('FAIL', 'POST required');
  try {
    if (!BINANCE_KEY || !BINANCE_SECRET) return response('FAIL', 'Merchant credentials not configured');

    const raw = await req.text();
    const timestamp = req.headers.get('BinancePay-Timestamp') || '';
    const nonce = req.headers.get('BinancePay-Nonce') || '';
    const signature = (req.headers.get('BinancePay-Signature') || '').toUpperCase();
    if (!timestamp || !nonce || !signature) return response('FAIL', 'Missing Binance Pay signature headers');

    const expected = await hmacSha512Hex(BINANCE_SECRET, `${timestamp}\n${nonce}\n${raw}\n`);
    if (!safeEqual(expected, signature)) return response('FAIL', 'Invalid Binance Pay signature');

    const event = JSON.parse(raw || '{}');
    if (event.bizType !== 'PAY') return response('SUCCESS', null);

    let payload: any = {};
    try { payload = typeof event.data === 'string' ? JSON.parse(event.data) : (event.data || {}); } catch { payload = {}; }
    const merchantTradeNo = String(payload.merchantTradeNo || '').trim();
    if (!merchantTradeNo) return response('FAIL', 'Missing merchantTradeNo');

    if (event.bizStatus === 'PAY_SUCCESS') {
      // Defense in depth: independently query Binance before crediting LP.
      const queried = await binanceRequest('/binancepay/openapi/order/query', { merchantTradeNo });
      const order = queried.data;
      if (order.status !== 'PAID') return response('FAIL', `Order is ${order.status || 'not paid'}`);

      const result = await rpc('service_settle_binance_pay_order', {
        p_merchant_trade_no: merchantTradeNo,
        p_prepay_id: String(order.prepayId || event.bizIdStr || event.bizId || ''),
        p_transaction_id: String(order.transactionId || payload.transactionId || ''),
        p_currency: String(order.currency || payload.currency || ''),
        p_total_fee: Number(order.totalFee ?? payload.totalFee ?? 0),
        p_raw: event,
      });
      const settled = Array.isArray(result) ? result[0] : result;
      if (settled?.ok !== true) return response('FAIL', settled?.status || 'Unable to settle order');
      return response('SUCCESS', null);
    }

    if (event.bizStatus === 'PAY_CLOSED') {
      await db(`binance_pay_orders?merchant_trade_no=eq.${encodeURIComponent(merchantTradeNo)}&status=neq.paid`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ status: 'closed', raw_webhook: event, updated_at: new Date().toISOString() }),
      });
      return response('SUCCESS', null);
    }

    return response('SUCCESS', null);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('binance-pay-webhook', message);
    return response('FAIL', message.slice(0, 240));
  }
});
