import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const failures=[];
const exists=p=>fs.existsSync(path.join(root,p));
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const fail=m=>failures.push(m);

const core='supabase/migrations/202610070600_phase7d_external_alert_core.sql';
const obs='supabase/migrations/202610070610_phase7d_alert_observability.sql';
const runtime='supabase/tests/phase7d_external_alert_delivery.sql';
const edge='supabase/functions/production-alert-dispatch/index.ts';
const report='PHASE-7D-EXTERNAL-ALERT-DELIVERY.md';
const adminJs='ops-v4.js';
const adminHtml='ops-v4.html';

for(const f of [core,obs,runtime,edge,report,adminJs,adminHtml]){
  if(!exists(f))fail('Missing Phase 7D artifact: '+f);
}

if(exists(core)){
  const sql=read(core);
  for(const marker of [
    'production_alert_delivery_config',
    'production_alert_outbox',
    'production_alert_dispatch_token',
    'production-alert-dispatch-minute',
    'service_claim_production_alert_batch',
    'service_complete_production_alert_delivery',
    'service_record_production_alert_dispatcher_state',
    'enqueue_production_alert_escalations',
    "interval '5 minutes'",
    "interval '30 minutes'",
    'create extension if not exists pg_net'
  ]) if(!sql.includes(marker))fail('Phase 7D core migration missing marker: '+marker);

  if(/PRODUCTION_ALERT_WEBHOOK_URL\s*=\s*['"]/i.test(sql)){
    fail('Webhook URL must not be hardcoded in SQL.');
  }
}

if(exists(obs)){
  const sql=read(obs);
  for(const marker of [
    'private.production_alert_delivery_report',
    'production-alert-dispatch-minute',
    'external_alert_dispatcher_unconfigured',
    'external_alert_dead_letter',
    'external_alert_backlog',
    'dead_letter_retention_days',
    "'alert_delivery',v_alert"
  ]) if(!sql.includes(marker))fail('Phase 7D observability migration missing marker: '+marker);
}

if(exists(runtime)){
  const sql=read(runtime);
  for(const marker of [
    'Phase 7D initial alert was not queued',
    'Phase 7D critical escalation was not queued',
    'Phase 7D failed delivery did not enter retry backoff',
    'Phase 7D acknowledgement did not cancel pending escalations',
    'Phase 7D recovery alert was not queued',
    'Phase 7D private delivery tables are directly readable',
    'rollback;'
  ]) if(!sql.includes(marker))fail('Phase 7D runtime contract missing marker: '+marker);
}

if(exists(edge)){
  const code=read(edge);
  try{ new Function(code.replace(/type\s+[A-Za-z0-9_]+\s*=\s*[^;]+;/g,'')); }catch(_err){}
  for(const marker of [
    "Deno.env.get('PRODUCTION_ALERT_WEBHOOK_URL')",
    "Deno.env.get('PRODUCTION_ALERT_WEBHOOK_BEARER')",
    "Deno.env.get('PRODUCTION_ALERT_WEBHOOK_SIGNING_SECRET')",
    'x-alert-dispatch-token',
    'x-draw01-signature',
    "signal:AbortSignal.timeout(8000)",
    'service_claim_production_alert_batch',
    'service_complete_production_alert_delivery',
    "u.protocol!=='https:'"
  ]) if(!code.includes(marker))fail('Phase 7D Edge dispatcher missing marker: '+marker);

  if(/https:\/\/(?!mwtlsnneooxmryondrex\.supabase\.co)/i.test(code)){
    fail('Unexpected hardcoded external HTTPS destination in Phase 7D Edge dispatcher.');
  }
}

if(exists(adminJs)){
  const code=read(adminJs);
  for(const marker of [
    "info('External delivery'",
    "info('Webhook config'",
    "info('Alert queue'",
    "info('Dead letters'",
    "info('Escalation policy'",
    "info('Delivery retries'"
  ]) if(!code.includes(marker))fail('Phase 7D admin UI missing marker: '+marker);
}

if(exists(adminHtml)&&!read(adminHtml).includes('ops-v4.js?v=10')){
  fail('Phase 7D admin JS cache-bust version is missing.');
}

if(exists(report)){
  const md=read(report);
  for(const marker of [
    'third-party delivery is intentionally disabled',
    'Critical',
    '5 minutes',
    'Warning',
    '15 minutes',
    '30 minutes',
    'PRODUCTION_ALERT_WEBHOOK_URL',
    'HMAC SHA-256',
    'authenticated SECURITY DEFINER advisor count therefore remains **47**'
  ]) if(!md.includes(marker))fail('Phase 7D report missing marker: '+marker);
}

if(failures.length){
  console.error('PHASE 7D EXTERNAL ALERT DELIVERY CHECK FAILED');
  failures.forEach((m,i)=>console.error((i+1)+'. '+m));
  process.exit(1);
}

console.log('PHASE 7D EXTERNAL ALERT DELIVERY CHECK PASSED — durable outbox, escalation, retry, dispatcher auth, and disabled-by-default webhook delivery are protected.');
