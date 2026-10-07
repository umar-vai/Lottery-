import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const failures=[];
const exists=p=>fs.existsSync(path.join(root,p));
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const fail=m=>failures.push(m);

const migration='supabase/migrations/202610070420_phase6_lock_private_credit_review.sql';
const creditTest='supabase/tests/phase6_credit_review_boundary.sql';
const supportDr='supabase/tests/phase6_support_disaster_recovery.sql';
const lotteryDr='supabase/tests/phase2_disaster_recovery_drill.sql';
const backup='scripts/export-offsite-backup.sh';
const report='PHASE-6-RESILIENCE-DR.md';

for (const f of [migration,creditTest,supportDr,lotteryDr,backup,report]) {
  if (!exists(f)) fail('Missing Phase 6 resilience artifact: '+f);
}

if (exists(migration)) {
  const sql=read(migration);
  for (const marker of [
    'security definer',
    "set search_path to 'pg_catalog','public','private'",
    'revoke all on function private.review_credit_request(uuid,boolean,text)',
    'grant execute on function public.admin_review_credit_request(uuid,boolean,text)',
    'Admin access required'
  ]) if (!sql.toLowerCase().includes(marker.toLowerCase())) fail('Credit boundary migration missing marker: '+marker);
}

if (exists(creditTest)) {
  const sql=read(creditTest);
  for (const marker of [
    'has_function_privilege',
    'Private credit review helper remains directly executable',
    'Non-admin was able to review a credit request',
    'balance_ledger',
    'rollback;'
  ]) if (!sql.includes(marker)) fail('Credit boundary test missing marker: '+marker);
}

if (exists(supportDr)) {
  const sql=read(supportDr);
  for (const marker of [
    'support_wallets',
    'support_transactions',
    'support_claim_requests',
    'support_point_claims',
    'Support DR restore mismatch',
    'duplicate transaction settlement',
    'rollback;'
  ]) if (!sql.includes(marker)) fail('Support DR test missing marker: '+marker);
}

if (exists(backup)) {
  const sh=read(backup);
  for (const marker of [
    'umask 077',
    'SUPABASE_DB_URL',
    'supabase db dump',
    '--role-only',
    '--data-only',
    'SHA256SUMS'
  ]) if (!sh.includes(marker)) fail('Backup helper missing marker: '+marker);

  if (!sh.includes('Storage bucket objects are NOT contained')
      && !sh.includes('Storage object bytes are NOT included')) {
    fail('Backup helper must explicitly state that Storage object bytes are not included.');
  }

  if (/SUPABASE_DB_URL\s*=\s*['"][^$]/.test(sh)) {
    fail('Backup helper must never hardcode a database connection string.');
  }
}

if (exists(report)) {
  const md=read(report);
  for (const marker of [
    'Free plan',
    'Storage',
    '0.01344/hour',
    '47 minutes',
    'off-site',
    'restore rehearsal'
  ]) if (!md.includes(marker)) fail('Phase 6 report missing marker: '+marker);
}

if (failures.length) {
  console.error('PHASE 6 RESILIENCE CHECK FAILED');
  failures.forEach((m,i)=>console.error((i+1)+'. '+m));
  process.exit(1);
}

console.log('PHASE 6 RESILIENCE CHECK PASSED — recovery drills, privileged boundary, backup helper, and runbook are present.');
