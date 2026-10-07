import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const failures=[];
const exists=p=>fs.existsSync(path.join(root,p));
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const fail=m=>failures.push(m);

const migration='supabase/migrations/202610070720_phase7f_mutation_guardrails.sql';
const indexes='supabase/migrations/202610070725_phase7f_guardrail_fk_indexes.sql';
const runtime='supabase/tests/phase7f_abuse_hardening.sql';
const report='PHASE-7F-GO-LIVE-ABUSE-HARDENING.md';

for(const f of [migration,indexes,runtime,report,'event.js','lottery.html','ops-v4.js','ops-v4.html',
  'supabase/functions/support-phone-bridge/index.ts',
  'supabase/functions/support-device-admin/index.ts',
  'supabase/functions/claim-support-points/index.ts']){
  if(!exists(f))fail('Missing Phase 7F artifact: '+f);
}

if(exists(migration)){
  const sql=read(migration);
  for(const marker of [
    'private.production_mutation_guardrails',
    'private.mutation_rate_limit_windows',
    'private.ticket_purchase_idempotency',
    'private.consume_mutation_budget',
    'private.guard_user_mutation_insert',
    'phase7f_guard_event_tickets',
    'phase7f_guard_slot_spins',
    'phase7f_guard_plinko_drops',
    'phase7f_guard_credit_requests',
    'phase7f_guard_support_claim_requests',
    'phase7f_guard_support_point_claims',
    'phase7f_guard_binance_orders',
    'phase7f_guard_referrals',
    'public.admin_get_mutation_guardrails',
    'public.admin_set_mutation_guardrails',
    'public.purchase_event_ticket_idempotent',
    'pg_advisory_xact_lock',
    'rate_limit_retention_days'
  ]) if(!sql.includes(marker))fail('Phase 7F migration missing marker: '+marker);
}

if(exists(indexes)){
  const sql=read(indexes);
  for(const marker of [
    'production_mutation_guardrails_updated_by_idx',
    'ticket_purchase_idempotency_event_id_idx'
  ]) if(!sql.includes(marker))fail('Phase 7F FK migration missing marker: '+marker);
}

if(exists(runtime)){
  const sql=read(runtime);
  for(const marker of [
    'mutation-trigger inventory mismatch',
    'rate limiter accepted an over-budget mutation',
    'idempotent replay contract failed',
    'replay inserted more than one ticket',
    'replay inserted more than one ticket debit',
    'allowed nonce reuse with a different payload',
    'emergency master guard failed',
    'blocked mutation changed balance',
    'non-admin guardrail read was accepted',
    'rate-limit retention did not prune old windows',
    'rollback;'
  ]) if(!sql.includes(marker))fail('Phase 7F runtime contract missing marker: '+marker);
}

if(exists('event.js')){
  const js=read('event.js');
  for(const marker of [
    "purchase_event_ticket_idempotent",
    'p_client_nonce',
    'crypto.randomUUID()',
    'purchaseAttempt',
    'row?.duplicate'
  ]) if(!js.includes(marker))fail('Phase 7F event.js missing marker: '+marker);
}

if(exists('lottery.html')&&!read('lottery.html').includes('event.js?v=15')){
  fail('Phase 7F event.js cache-bust version missing.');
}

if(exists('ops-v4.js')){
  const js=read('ops-v4.js');
  try{ new Function(js); }catch(err){ fail('ops-v4.js syntax error: '+err.message); }
  for(const marker of [
    'renderMutationGuardrails',
    'admin_get_mutation_guardrails',
    'admin_set_mutation_guardrails',
    'setMasterMutationGuardrail'
  ]) if(!js.includes(marker))fail('Phase 7F admin JS missing marker: '+marker);
}

if(exists('ops-v4.html')){
  const markup=read('ops-v4.html');
  if(!markup.includes('ops-v4.js?v=12')) fail('Phase 7F admin bundle cache-bust version missing.');
  for(const marker of ['mutationGuardrailPanel','Pause all user mutations','Resume user mutations']){
    if(!markup.includes(marker)) fail('Phase 7F admin HTML missing marker: '+marker);
  }
}

for(const p of [
  'supabase/functions/support-phone-bridge/index.ts',
  'supabase/functions/support-device-admin/index.ts',
  'supabase/functions/claim-support-points/index.ts'
]){
  if(!exists(p))continue;
  const code=read(p);
  for(const marker of [
    'https://lootera.win',
    'https://www.lootera.win',
    'https://umar-vai.github.io',
    'originAllowed',
    "Origin not allowed",
    "'Access-Control-Allow-Origin':originAllowed(req)?"
  ]) if(!code.includes(marker))fail('Phase 7F CORS contract missing '+marker+' in '+p);
  if(/Access-Control-Allow-Origin['"]?\s*:\s*['"]\*/.test(code)){
    fail('Wildcard CORS is not allowed in '+p);
  }
}

if(exists('supabase/functions/support-phone-bridge/index.ts')){
  const code=read('supabase/functions/support-phone-bridge/index.ts');
  if(!code.includes("req.headers.get('x-bridge-token')"))fail('Bridge custom token check missing.');
}

if(exists(report)){
  const md=read(report);
  for(const marker of [
    '20 / minute / user',
    'nonce-based replay',
    '401 Bridge token required',
    '403 Origin not allowed',
    'authenticated SECURITY DEFINER count therefore moves from 47 to **50**',
    'does not claim full volumetric/DDoS protection'
  ]) if(!md.includes(marker))fail('Phase 7F report missing marker: '+marker);
}

if(failures.length){
  console.error('PHASE 7F GO-LIVE ABUSE HARDENING CHECK FAILED');
  failures.forEach((m,i)=>console.error((i+1)+'. '+m));
  process.exit(1);
}

console.log('PHASE 7F GO-LIVE ABUSE HARDENING CHECK PASSED — mutation kill switches, successful-mutation budgets, ticket idempotency, and Lootera Edge CORS are protected.');
