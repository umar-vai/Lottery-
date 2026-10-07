import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const failures=[];
const exists=p=>fs.existsSync(path.join(root,p));
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const fail=m=>failures.push(m);

const migration='supabase/migrations/202610070500_phase7a_production_slo_monitor.sql';
const runtime='supabase/tests/phase7a_production_slo.sql';
const report='PHASE-7A-PRODUCTION-OPERATIONS.md';
const runbook='RELEASE-ROLLBACK-RUNBOOK.md';

for (const f of [migration,runtime,report,runbook]) {
  if (!exists(f)) fail('Missing Phase 7A artifact: '+f);
}

if (exists(migration)) {
  const sql=read(migration);
  for (const marker of [
    'private.production_slo_report',
    'private.run_production_slo_check',
    'production-slo-every-5-minutes',
    'production_slo_breached',
    'production_slo_recovered',
    'connections_warning_pct',
    'connections_critical_pct',
    'blocked_sessions_over_30s',
    'cache_hit_warning_below_pct'
  ]) if (!sql.includes(marker)) fail('SLO migration missing marker: '+marker);

  if (/grant\s+execute\s+on\s+function\s+private\.(?:production_slo_report|run_production_slo_check)/i.test(sql)) {
    fail('Private Phase 7A SLO functions must not be granted to browser/service API roles.');
  }
}

if (exists(runtime)) {
  const sql=read(runtime);
  for (const marker of [
    'Phase 7A private SLO functions are externally executable',
    'Production SLO cron must exist exactly once and be active',
    'SLO checker/report threshold contract mismatch',
    'rollback;'
  ]) if (!sql.includes(marker)) fail('SLO runtime contract missing marker: '+marker);
}

if (exists(report)) {
  const md=read(report);
  for (const marker of [
    '2,754',
    'HTTP 5xx responses: 0',
    'p95 origin time: 278 ms',
    'connections_warning_pct',
    'rolling 15-minute 5xx rate',
    'production-slo-every-5-minutes'
  ]) if (!md.includes(marker)) fail('Phase 7A report missing marker: '+marker);
}

if (exists(runbook)) {
  const md=read(runbook);
  for (const marker of [
    'Immediate rollback candidates',
    'Frontend rollback',
    'Database rollback',
    'Edge Function rollback',
    'SEV-1',
    'SEV-2',
    'Post-release verification'
  ]) if (!md.includes(marker)) fail('Release/rollback runbook missing marker: '+marker);
}

if (failures.length) {
  console.error('PHASE 7A PRODUCTION OPERATIONS CHECK FAILED');
  failures.forEach((m,i)=>console.error((i+1)+'. '+m));
  process.exit(1);
}

console.log('PHASE 7A PRODUCTION OPERATIONS CHECK PASSED — SLO, monitoring, and rollback contracts are present.');
