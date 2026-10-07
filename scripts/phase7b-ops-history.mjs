import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const failures=[];
const exists=p=>fs.existsSync(path.join(root,p));
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const fail=m=>failures.push(m);

const historyMigration='supabase/migrations/202610070515_phase7b_ops_history.sql';
const indexMigration='supabase/migrations/202610070525_phase7b_drop_duplicate_slug_index.sql';
const cronMigration='supabase/migrations/202610070530_phase7b_extend_required_crons.sql';
const runtime='supabase/tests/phase7b_ops_history.sql';
const report='PHASE-7B-OPS-HISTORY.md';

for (const f of [historyMigration,indexMigration,cronMigration,runtime,report]) {
  if (!exists(f)) fail('Missing Phase 7B artifact: '+f);
}

if (exists(historyMigration)) {
  const sql=read(historyMigration);
  for (const marker of [
    'private.production_slo_snapshots',
    'private.capture_production_slo_snapshot',
    'private.production_slo_history_report',
    'private.prune_operational_history',
    'production-slo-snapshot-15m',
    'operational-history-retention-daily',
    "interval '30 days'"
  ]) if (!sql.includes(marker)) fail('Phase 7B history migration missing marker: '+marker);

  if (/grant\s+execute\s+on\s+function\s+private\.(?:capture_production_slo_snapshot|production_slo_history_report|prune_operational_history)/i.test(sql)) {
    fail('Private Phase 7B operational functions must not be granted to API roles.');
  }
}

if (exists(indexMigration)) {
  const sql=read(indexMigration);
  if (!sql.includes('drop index if exists public.lottery_events_slug_idx')) {
    fail('Duplicate lottery slug index removal is missing.');
  }
  if (/drop\s+index[^;]*lottery_events_slug_key/i.test(sql)) {
    fail('Unique lottery slug constraint index must never be dropped.');
  }
}

if (exists(cronMigration)) {
  const sql=read(cronMigration);
  for (const marker of [
    'production-slo-snapshot-15m',
    'operational-history-retention-daily',
    'private.production_slo_report'
  ]) if (!sql.includes(marker)) fail('Phase 7B required-cron migration missing marker: '+marker);
}

if (exists(runtime)) {
  const sql=read(runtime);
  for (const marker of [
    'SLO snapshot capture did not add exactly one row',
    '30-day SLO retention did not prune the old fixture',
    'production-slo-snapshot-15m',
    'operational-history-retention-daily',
    'Private SLO snapshot table is externally readable',
    'Duplicate lottery_events_slug_idx still exists',
    'Phase 7B required cron set is incomplete',
    'Production SLO report does not recognize all Phase 7B required cron jobs',
    'rollback;'
  ]) if (!sql.includes(marker)) fail('Phase 7B runtime test missing marker: '+marker);
}

if (exists(report)) {
  const md=read(report);
  for (const marker of [
    '4,790',
    '2,880 snapshots',
    '21 INFO-level',
    '1,038 recorded scans',
    'Index Scan using lottery_events_slug_key',
    'issue #63'
  ]) if (!md.includes(marker)) fail('Phase 7B report missing marker: '+marker);
}

if (failures.length) {
  console.error('PHASE 7B OPS HISTORY CHECK FAILED');
  failures.forEach((m,i)=>console.error((i+1)+'. '+m));
  process.exit(1);
}

console.log('PHASE 7B OPS HISTORY CHECK PASSED — durable SLO history, retention, and evidence-based cleanup are protected.');
