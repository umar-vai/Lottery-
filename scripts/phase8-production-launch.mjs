import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const failures=[];
const exists=p=>fs.existsSync(path.join(root,p));
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const fail=m=>failures.push(m);

const migration='supabase/migrations/202610070800_phase8_launch_stabilization.sql';
const runtime='supabase/tests/phase8_launch_stabilization.sql';
const report='PHASE-8-PRODUCTION-LAUNCH-STABILIZATION.md';
const js='ops-v4.js';
const html='ops-v4.html';

for(const f of [migration,runtime,report,js,html]){
  if(!exists(f))fail('Missing Phase 8 artifact: '+f);
}

if(exists(migration)){
  const sql=read(migration);
  for(const marker of [
    "join cron.job j on j.jobid=r.jobid and j.active",
    "'missing_required_cron'",
    "'production-slo-snapshot-15m'",
    'private.production_launch_stability_config',
    'private.production_launch_stability_snapshots',
    'private.production_launch_readiness_report',
    'private.capture_production_launch_stability_snapshot',
    'private.production_launch_stability_report',
    "'production-launch-stability-15m'",
    "'*/15 * * * *'",
    "'launch_stability',v_launch",
    'launch_snapshots_deleted',
    "'technical_go_operator_signoff_required'",
    "'offsite_backup_restore_rehearsal'",
    "'retired_edge_stub_physical_deletion'"
  ]) if(!sql.includes(marker))fail('Phase 8 migration missing marker: '+marker);

  const activeCronJoinCount=(sql.match(/join cron\.job j on j\.jobid=r\.jobid and j\.active/g)||[]).length;
  if(activeCronJoinCount<3)fail('Phase 8 migration must scope all current cron failure reads to active cron jobs.');
}

if(exists(runtime)){
  const sql=read(runtime);
  for(const marker of [
    'Phase 8 production SLO is not launch-clean',
    'Phase 8 orphan cron history leaked into current SLO',
    'Phase 8 active cron failure regression failed',
    'Phase 8 missing required cron regression failed',
    'phase8 runtime simulated active cron failure',
    'cron.alter_job',
    'Phase 8 operations incident report is not clean',
    'Phase 8 Draw Credit integrity failed',
    'Phase 8 mutation guardrails are not fully enabled',
    'Phase 8 Telegram delivery is not launch-ready',
    'technical_go_operator_signoff_required',
    'production-launch-stability-15m',
    'Phase 8 private launch tables are directly readable',
    'Phase 8 private launch functions are externally executable',
    'v_public_anon_secdef<>2',
    'v_private_auth_secdef<>0',
    'v_auth_public_secdef<>50',
    'rollback;'
  ]) if(!sql.includes(marker))fail('Phase 8 runtime missing marker: '+marker);
}

if(exists(js)){
  const code=read(js);
  try{new Function(code)}catch(err){fail('ops-v4.js syntax error: '+err.message)}
  for(const marker of [
    'renderLaunchStability',
    'launch_stability',
    'Technical readiness',
    'Launch decision',
    'Operator exceptions'
  ]) if(!code.includes(marker))fail('Phase 8 admin JS missing marker: '+marker);
}

if(exists(html)){
  const markup=read(html);
  for(const marker of [
    'launchStabilityPanel',
    'PHASE 8 · LAUNCH STABILIZATION',
    '72-hour production launch window'
  ]) if(!markup.includes(marker))fail('Phase 8 admin HTML missing marker: '+marker);
  const m=markup.match(/ops-v4\.js\?v=(\d+)/);
  if(!m||Number(m[1])<13)fail('Phase 8 admin cache-bust version must be 13 or newer.');
}

if(exists(report)){
  const md=read(report);
  for(const marker of [
    'technical_go_operator_signoff_required',
    '2026-10-10 10:32:08 UTC',
    '2,586',
    'HTTP 5xx: **0**',
    'p95 origin latency: **378 ms**',
    'Issue #61',
    'Issue #59',
    'no `CNAME` file',
    'does **not** claim that the custom-domain DNS/HTTPS mapping has been independently verified',
    '72-hour exit criteria'
  ]) if(!md.includes(marker))fail('Phase 8 report missing marker: '+marker);
}

if(failures.length){
  console.error('PHASE 8 PRODUCTION LAUNCH STABILIZATION CHECK FAILED');
  failures.forEach((m,i)=>console.error((i+1)+'. '+m));
  process.exit(1);
}

console.log('PHASE 8 PRODUCTION LAUNCH STABILIZATION CHECK PASSED — active-cron SLO filtering, 72-hour launch evidence, technical readiness, admin visibility and operator exceptions are protected.');
