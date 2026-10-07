import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const failures=[];
const exists=p=>fs.existsSync(path.join(root,p));
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const fail=m=>failures.push(m);

const migration='supabase/migrations/202610070245_phase4_performance_observability.sql';
const runtimeTest='supabase/tests/phase4_performance_observability.sql';

if(!exists(migration)) fail('Missing Phase 4 performance/observability migration.');
else {
  const sql=read(migration);
  for(const marker of [
    'service_only_deny_all',
    'admin_create_lottery_event_v2',
    'admin_update_lottery_event_v2',
    'admin_get_admin_change_audit(integer)',
    'get_platform_features()',
    'get_public_event_winners(uuid)'
  ]) if(!sql.includes(marker)) fail('Phase 4 migration missing marker: '+marker);
}

if(!exists(runtimeTest)) fail('Missing Phase 4 runtime test.');
else {
  const sql=read(runtimeTest);
  for(const marker of [
    'Deprecated RPC remains browser-executable',
    'Keyset pagination RPC contains OFFSET',
    'balance_ledger_created_id_idx'
  ]) if(!sql.includes(marker)) fail('Phase 4 runtime test missing marker: '+marker);
}

if(!exists('support-live.js')) fail('Missing Support live client.');
else {
  const js=read('support-live.js');
  if(!js.includes('FALLBACK_MS=60000')) fail('Support live fallback interval is not hardened.');
  if(!js.includes('draw01:support-points-changed')) fail('Support live event-driven invalidation is missing.');
  if(/setInterval\([^)]*,\s*4000\s*\)/.test(js)||js.includes('},4000)')) fail('Legacy 4-second Support polling remains enabled.');
}

if(!exists('love-points-page.js')) fail('Missing Love Points page client.');
else {
  const js=read('love-points-page.js');
  if(!js.includes('FALLBACK_MS=60000')) fail('Love Points fallback interval is not hardened.');
  if(!js.includes('draw01:support-points-changed')) fail('Love Points mutation-driven refresh is missing.');
  if(/setInterval\([^)]*,\s*8000\s*\)/.test(js)||js.includes('},8000)')) fail('Legacy 8-second Love Points polling remains enabled.');
}

for(const [file,component] of [
  ['supabase/functions/support-device-admin/index.ts','support-device-admin'],
  ['supabase/functions/support-phone-bridge/index.ts','support-phone-bridge'],
  ['supabase/functions/claim-support-points/index.ts','claim-support-points']
]){
  if(!exists(file)){fail('Missing Edge Function source: '+file);continue}
  const src=read(file);
  for(const marker of ["trace_id","duration_ms","x-support-trace-id",component]){
    if(!src.includes(marker)) fail(file+' missing telemetry marker: '+marker);
  }
  for(const forbidden of ['rawSms:', 'senderNumber:', 'x-bridge-token:']){
    if(src.includes(forbidden)) fail(file+' appears to log sensitive request material: '+forbidden);
  }
}

if(failures.length){
  console.error('Phase 4 performance/observability checks failed:');
  failures.forEach(x=>console.error(' - '+x));
  process.exit(1);
}
console.log('Phase 4 performance/observability checks passed.');
