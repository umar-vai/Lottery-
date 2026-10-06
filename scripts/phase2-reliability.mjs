import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const failures=[];
const read=(rel)=>fs.readFileSync(path.join(root,rel),'utf8');
const exists=(rel)=>fs.existsSync(path.join(root,rel));
const fail=(m)=>failures.push(m);

const migration='supabase/migrations/202610061705_phase2_draw_exactly_once.sql';
const test='supabase/tests/phase2_draw_exactly_once.sql';
const reconciliationMigration='supabase/migrations/202610061835_phase2_credit_reconciliation.sql';
const reconciliationTest='supabase/tests/phase2_credit_reconciliation.sql';
const recoveryMigration='supabase/migrations/202610061900_phase2_draw_recovery_ops.sql';
const recoveryTest='supabase/tests/phase2_draw_failure_recovery.sql';
const adminAuditMigration='supabase/migrations/202610061930_phase2_admin_audit_incident_center.sql';
const adminAuditTest='supabase/tests/phase2_admin_audit_incidents.sql';
const performanceRlsMigration='supabase/migrations/202610061945_phase2_performance_rls_cleanup.sql';
const performanceRlsTest='supabase/tests/phase2_performance_rls_cleanup.sql';

if(!exists(migration)) fail('Missing Phase 2 draw reliability migration.');
else {
  const sql=read(migration);
  for(const marker of [
    "if v_event.status='completed' then",
    'for update',
    'balance_ledger_one_prize_credit_per_event_ticket_idx',
    "'prize_credit'"
  ]) if(!sql.toLowerCase().includes(marker.toLowerCase())) fail('Phase 2 migration missing marker: '+marker);
}

if(!exists(test)) fail('Missing Phase 2 draw replay test.');
else {
  const sql=read(test);
  for(const marker of [
    'run_lottery_event_internal',
    'balance_ledger_one_prize_credit_per_event_ticket_idx',
    'completed event changed after repeated execution'
  ]) if(!sql.includes(marker)) fail('Phase 2 draw test missing marker: '+marker);
}

if(!exists(reconciliationMigration)) fail('Missing Phase 2 Draw Credit reconciliation migration.');
else {
  const sql=read(reconciliationMigration);
  for(const marker of [
    'draw_credit_integrity_report',
    'run_draw_credit_integrity_check',
    'admin_get_draw_credit_integrity_report',
    'balance_ledger_one_ticket_purchase_per_ticket_idx',
    'draw-credit-integrity-hourly'
  ]) if(!sql.includes(marker)) fail('Draw Credit reconciliation migration missing marker: '+marker);
}

if(!exists(reconciliationTest)) fail('Missing Phase 2 Draw Credit reconciliation runtime test.');
else {
  const sql=read(reconciliationTest);
  for(const marker of [
    'draw_credit_integrity_report',
    'issue_total',
    'draw-credit-integrity-hourly'
  ]) if(!sql.includes(marker)) fail('Draw Credit reconciliation test missing marker: '+marker);
}

if(!exists(recoveryMigration)) fail('Missing Phase 2 draw recovery migration.');
else {
  const sql=read(recoveryMigration);
  for(const marker of [
    'lottery_draw_runtime_state',
    'record_lottery_draw_failure',
    'record_lottery_draw_success',
    'lottery_operational_health_report',
    'admin_get_lottery_operational_health',
    'admin_retry_due_lottery_events',
    'lottery-operational-health'
  ]) if(!sql.includes(marker)) fail('Draw recovery migration missing marker: '+marker);
}

if(!exists(recoveryTest)) fail('Missing Phase 2 draw failure recovery test.');
else {
  const sql=read(recoveryTest);
  for(const marker of [
    'phase2 simulated prize-ledger interruption',
    'Interrupted draw did not roll back atomically',
    'Draw retry did not recover exactly once',
    'lottery-operational-health'
  ]) if(!sql.includes(marker)) fail('Draw failure recovery test missing marker: '+marker);
}

if(!exists('PHASE-2-DRAW-RECOVERY.md')) fail('Missing Phase 2 draw recovery documentation.');

if(!exists(adminAuditMigration)) fail('Missing Phase 2 canonical admin audit migration.');
else {
  const sql=read(adminAuditMigration);
  for(const marker of [
    'private.admin_change_audit',
    'capture_admin_change_audit',
    'x-admin-reason',
    'admin_get_operations_incident_center',
    'admin_get_admin_change_audit'
  ]) if(!sql.includes(marker)) fail('Admin audit/incident migration missing marker: '+marker);
}

if(!exists(adminAuditTest)) fail('Missing Phase 2 admin audit runtime test.');
else {
  const sql=read(adminAuditTest);
  for(const marker of [
    'Phase 2 audit runtime test',
    'Canonical admin audit did not capture actor/before/after/reason',
    'admin_get_operations_incident_center',
    'admin_get_admin_change_audit'
  ]) if(!sql.includes(marker)) fail('Admin audit runtime test missing marker: '+marker);
}

if(!exists('PHASE-2-ADMIN-AUDIT-INCIDENTS.md')) fail('Missing admin audit / Incident Center documentation.');

if(!exists(performanceRlsMigration)) fail('Missing Phase 2 performance/RLS cleanup migration.');
else {
  const sql=read(performanceRlsMigration);
  for(const marker of [
    'audit_logs_actor_user_id_idx',
    'support_transactions_device_id_idx',
    '(select auth.uid())',
    '(select public.is_admin())',
    'authenticated can read visible or admin draws',
    'users or admins can read profiles'
  ]) if(!sql.includes(marker)) fail('Performance/RLS migration missing marker: '+marker);
}

if(!exists(performanceRlsTest)) fail('Missing Phase 2 performance/RLS runtime test.');
else {
  const sql=read(performanceRlsTest);
  for(const marker of [
    'RLS performance invariant failed',
    'duplicate authenticated SELECT policies',
    'Player lost own-profile SELECT',
    'Admin lost cross-profile SELECT'
  ]) if(!sql.includes(marker)) fail('Performance/RLS test missing marker: '+marker);
}

if(!exists('PHASE-2-PERFORMANCE-RLS.md')) fail('Missing Phase 2 performance/RLS documentation.');





if(!exists('PHASE-2-STRESS-RESULTS.md')) fail('Missing production ticket concurrency probe evidence.');

if(!exists('site-shell.js')) fail('site-shell.js missing.');
else {
  const js=read('site-shell.js');
  for(const marker of [
    'refreshSessionToken',
    'sessionNeedsRefresh',
    "grant_type=refresh_token",
    'visibilitychange',
    'ensureSession:function'
  ]) if(!js.includes(marker)) fail('Global session healing missing marker: '+marker);
  if(/setInterval\(function\(\)\{refresh\(\)\},12000\)/.test(js)) fail('Legacy 12-second auth/user polling remains enabled.');
}

if(!exists('ops-v4.js')) fail('ops-v4.js missing.');
else {
  const js=read('ops-v4.js');
  if(!js.includes('function ensureSession(force)')) fail('Admin session recovery helper missing.');
  if(!js.includes("e.status===401||e.status===403")) fail('Admin protected requests do not retry after auth rejection.');
  if(!js.includes('admin_get_draw_credit_integrity_report')) fail('Admin dashboard does not load Draw Credit integrity report.');
  if(!js.includes('admin_get_lottery_operational_health')) fail('Admin dashboard does not load draw operational health.');
  if(!js.includes('admin_retry_due_lottery_events')) fail('Admin dashboard does not expose guarded due-draw retry.');
  if(!js.includes('admin_get_operations_incident_center')) fail('Admin dashboard does not load Operations Incident Center.');
  if(!js.includes('admin_get_admin_change_audit')) fail('Admin dashboard does not load canonical admin changes.');
  if(!js.includes('x-admin-reason')) fail('Admin RPC helper does not send audit reasons.');
}

if(failures.length){
  console.error('\nPHASE 2 RELIABILITY CHECK FAILED');
  failures.forEach((m,i)=>console.error((i+1)+'. '+m));
  process.exit(1);
}
console.log('PHASE 2 RELIABILITY CHECK PASSED — auth recovery, draw safety, reconciliation, recovery monitoring, canonical admin audit, Incident Center, and Supabase performance/RLS cleanup are present.');
