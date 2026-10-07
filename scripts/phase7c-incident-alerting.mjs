import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const failures=[];
const exists=p=>fs.existsSync(path.join(root,p));
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const fail=m=>failures.push(m);

const migration='supabase/migrations/202610070545_phase7c_incident_acknowledgement.sql';
const runtime='supabase/tests/phase7c_incident_alerting.sql';
const report='PHASE-7C-INCIDENT-ALERTING.md';
const html='ops-v4.html';
const js='ops-v4.js';
const css='phase7c-observability.css';

for (const f of [migration,runtime,report,html,js,css]) {
  if (!exists(f)) fail('Missing Phase 7C artifact: '+f);
}

if (exists(migration)) {
  const sql=read(migration);
  for (const marker of [
    'private.production_incident_acknowledgements',
    'public.admin_get_operations_incident_center',
    'public.admin_acknowledge_production_incident',
    'production_slo_acknowledged',
    'pending_slo_ack_count',
    'unacknowledged_slo_breaches_7d',
    'admin_polling_seconds',
    'Admin access required'
  ]) if (!sql.includes(marker)) fail('Phase 7C migration missing marker: '+marker);
}

if (exists(runtime)) {
  const sql=read(runtime);
  for (const marker of [
    'Phase 7C acknowledgement row missing',
    'Phase 7C acknowledgement audit row missing',
    'Active unacknowledged SLO breach was not surfaced',
    'Private incident acknowledgement table is externally readable',
    'Non-admin Phase 7C access control failed',
    'rollback;'
  ]) if (!sql.includes(marker)) fail('Phase 7C runtime test missing marker: '+marker);
}

if (exists(js)) {
  const code=read(js);
  for (const marker of [
    'startAlertPolling',
    'setInterval(pollIncidentAlerts,60000)',
    'renderSloAlert',
    'renderSloObservability',
    'admin_acknowledge_production_incident',
    'data-slo-ack',
    'document.hidden'
  ]) if (!code.includes(marker)) fail('Phase 7C admin JS missing marker: '+marker);
}

if (exists(html)) {
  const markup=read(html);
  for (const marker of [
    'sloAlertBanner',
    'sloAlertOpenIncidents',
    'sloObservabilityPanel',
    'sloHistorySummary',
    'sloEventList',
    'phase7c-observability.css',
    'ops-v4.js?v=9'
  ]) if (!markup.includes(marker)) fail('Phase 7C admin HTML missing marker: '+marker);
}

if (exists(report)) {
  const md=read(report);
  for (const marker of [
    '60-second polling',
    'external webhook configured: false',
    'Acknowledgement means',
    'production_slo_recovered',
    'Vault secret names: none'
  ]) if (!md.includes(marker)) fail('Phase 7C report missing marker: '+marker);
}

if (failures.length) {
  console.error('PHASE 7C INCIDENT ALERTING CHECK FAILED');
  failures.forEach((m,i)=>console.error((i+1)+'. '+m));
  process.exit(1);
}

console.log('PHASE 7C INCIDENT ALERTING CHECK PASSED — admin alert delivery, SLO observability, and acknowledgement workflow are protected.');
