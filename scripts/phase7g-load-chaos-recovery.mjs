import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const failures=[];
const exists=p=>fs.existsSync(path.join(root,p));
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const fail=m=>failures.push(m);

const harness='supabase/migrations/202610070740_phase7g_probe_harness.sql';
const cleanup='supabase/migrations/202610070750_phase7g_probe_cleanup.sql';
const rateCleanup='supabase/migrations/202610070755_phase7g_rate_window_cleanup.sql';
const runtime='supabase/tests/phase7g_load_chaos_recovery.sql';
const report='PHASE-7G-LOAD-CHAOS-RECOVERY.md';
const dispatcher='supabase/functions/production-alert-dispatch/index.ts';

for(const f of [harness,cleanup,rateCleanup,runtime,report,dispatcher]){
  if(!exists(f))fail('Missing Phase 7G artifact: '+f);
}

if(exists(harness)){
  const sql=read(harness);
  for(const marker of [
    'private.phase7g_probe_results',
    'service_phase7g_ticket_probe',
    'service_phase7g_rate_probe',
    'service_phase7g_lock_holder',
    'service_phase7g_lock_waiter',
    'PHASE7G_ROLLBACK_OK',
    'phase7g_probe_summary',
    'grant execute on function public.service_phase7g_ticket_probe'
  ]) if(!sql.includes(marker))fail('Phase 7G harness missing marker: '+marker);
}

if(exists(cleanup)){
  const sql=read(cleanup);
  for(const marker of [
    'set schema private',
    'private.service_phase7g_ticket_probe',
    'private.service_phase7g_rate_probe',
    'private.service_phase7g_lock_holder',
    'private.service_phase7g_lock_waiter',
    'from public,anon,authenticated,service_role'
  ]) if(!sql.includes(marker))fail('Phase 7G cleanup missing marker: '+marker);
}

if(exists(rateCleanup)&&!read(rateCleanup).includes("bucket like 'phase7g-%'")){
  fail('Phase 7G synthetic rate-window cleanup is missing.');
}

if(exists(runtime)){
  const sql=read(runtime);
  for(const marker of [
    'total_requests',
    'failure_count',
    'residue_count',
    "ticket-12",
    'Synthetic Phase 7G rate-limit window residue exists',
    'Phase 7G probe RPC remains in public schema',
    'Retired Phase 7G private probe RPC has external execute privilege',
    'connection_usage_pct',
    'Telegram alert delivery unhealthy after Phase 7G',
    'rollback;'
  ]) if(!sql.includes(marker))fail('Phase 7G runtime contract missing marker: '+marker);
}

if(exists(dispatcher)){
  const code=read(dispatcher);
  if(code.includes('phase7g_suite'))fail('Temporary Phase 7G dispatcher action must not remain in production source.');
  if(code.includes('service_phase7g_ticket_probe'))fail('Temporary Phase 7G probe RPC call must not remain in dispatcher source.');
}

if(exists(report)){
  const md=read(report);
  for(const marker of [
    'total probe requests: **39**',
    'p95 | Max',
    '793.56 ms',
    'allowed: **5**',
    'rate-limited: **7**',
    '250.75 ms',
    'mutation residue: **0**',
    'connection usage: **26.67%**',
    'cron failures in the last 15 minutes: **0**',
    'public `service_phase7g_*` RPC count: 0',
    'p95 < 1,000 ms',
    'did **not** perform a live global mutation-kill-switch outage'
  ]) if(!md.includes(marker))fail('Phase 7G report missing marker: '+marker);
}

if(failures.length){
  console.error('PHASE 7G LOAD / CHAOS / RECOVERY CHECK FAILED');
  failures.forEach((m,i)=>console.error((i+1)+'. '+m));
  process.exit(1);
}

console.log('PHASE 7G LOAD / CHAOS / RECOVERY CHECK PASSED — bounded load evidence, rollback integrity, rate contention, lock timeout, and probe cleanup are protected.');
