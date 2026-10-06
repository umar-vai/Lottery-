import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const failures=[];
const exists=(p)=>fs.existsSync(path.join(root,p));
const read=(p)=>fs.readFileSync(path.join(root,p),'utf8');
const fail=(m)=>failures.push(m);

const migration='supabase/migrations/202610062130_phase3_live_draw_control_room.sql';
const test='supabase/tests/phase3_live_draw_control_room.sql';
const lifecycleMigration='supabase/migrations/202610062150_phase3_guided_lifecycle_verification.sql';
const lifecycleTest='supabase/tests/phase3_guided_lifecycle_verification.sql';

if(!exists(migration)) fail('Missing Phase 3 Control Room migration.');
else {
  const sql=read(migration);
  for(const marker of [
    'admin_get_live_draw_control_room',
    'public.is_admin()',
    'lottery_draw_runtime_state',
    'lottery_operational_health_report',
    'draw-credit-integrity-hourly',
    'cron.job_run_details',
    'revoke all on function public.admin_get_live_draw_control_room() from public,anon,authenticated',
    'grant execute on function public.admin_get_live_draw_control_room() to authenticated'
  ]) if(!sql.includes(marker)) fail('Phase 3 migration missing marker: '+marker);
}

if(!exists(test)) fail('Missing Phase 3 Control Room runtime test.');
else {
  const sql=read(test);
  for(const marker of [
    'Anon can execute live draw control room',
    'Control room event count mismatch',
    'Operational health missing',
    'Credit integrity missing'
  ]) if(!sql.includes(marker)) fail('Phase 3 test missing marker: '+marker);
}

if(!exists(lifecycleMigration)) fail('Missing Phase 3 guided lifecycle migration.');
else {
  const sql=read(lifecycleMigration);
  for(const marker of [
    'private.lottery_event_lifecycle_review',
    'admin_get_event_lifecycle_review',
    'admin_publish_lottery_event',
    'admin_verify_completed_lottery_event',
    'verify_completed_lottery_event',
    'result_fingerprint',
    'public.is_admin()',
    'revoke all on function public.admin_get_event_lifecycle_review(uuid) from public,anon,authenticated',
    'grant execute on function public.admin_verify_completed_lottery_event(uuid,text) to authenticated'
  ]) if(!sql.includes(marker)) fail('Guided lifecycle migration missing marker: '+marker);
}

if(!exists(lifecycleTest)) fail('Missing Phase 3 guided lifecycle runtime test.');
else {
  const sql=read(lifecycleTest);
  for(const marker of [
    'Anon can execute Phase 3 lifecycle RPC',
    'Valid rollback-only draft did not pass publish checklist',
    'Existing completed event failed post-draw verification contract',
    'Completed event did not become verified in rollback test',
    'Verification audit row was not written'
  ]) if(!sql.includes(marker)) fail('Guided lifecycle test missing marker: '+marker);
}

for(const file of ['phase3-control-room.js','phase3-control-room.css','PHASE-3-LIVE-DRAW-CONTROL-ROOM.md','phase3-lifecycle.js','phase3-lifecycle.css','PHASE-3-GUIDED-LIFECYCLE.md']){
  if(!exists(file)) fail('Missing Phase 3 artifact: '+file);
}

if(exists('ops-v4.html')){
  const html=read('ops-v4.html');
  if(!html.includes('data-tab="control-room"')) fail('Admin navigation is missing Control Room tab.');
  if(!html.includes('id="control-room"')) fail('Admin page is missing Control Room section.');
  if(!html.includes('phase3-control-room.js')) fail('Admin page does not load Phase 3 Control Room script.');
  if(!html.includes('phase3-control-room.css')) fail('Admin page does not load Phase 3 Control Room styles.');
  if(!html.includes('id="lifecycleDialog"')) fail('Admin page is missing guided lifecycle dialog.');
  if(!html.includes('phase3-lifecycle.js')) fail('Admin page does not load guided lifecycle JS.');
  if(!html.includes('phase3-lifecycle.css')) fail('Admin page does not load guided lifecycle styles.');
}

if(exists('phase3-control-room.js')){
  const js=read('phase3-control-room.js');
  for(const marker of [
    'admin_get_live_draw_control_room',
    'admin_run_lottery_event',
    'admin_retry_due_lottery_events',
    'x-admin-reason',
    'setInterval(function(){if(tabActive())load(false)},5000)'
  ]) if(!js.includes(marker)) fail('Control Room JS missing marker: '+marker);
}

if(exists('phase3-lifecycle.js')){
  const js=read('phase3-lifecycle.js');
  for(const marker of [
    'admin_get_event_lifecycle_review',
    'admin_publish_lottery_event',
    'admin_run_lottery_event',
    'admin_verify_completed_lottery_event',
    'admin_relaunch_lottery_event',
    'draw01:lifecycle-changed',
    'x-admin-reason'
  ]) if(!js.includes(marker)) fail('Guided lifecycle JS missing marker: '+marker);
}

if(exists('ops-v4.js')){
  const js=read('ops-v4.js');
  for(const marker of [
    'Review & publish',
    'Pre-draw review',
    'Verify result',
    'admin_publish_lottery_event',
    'p_publish=false',
    'Draw01Lifecycle',
    'draw01:lifecycle-changed'
  ]) if(!js.includes(marker)) fail('Admin base lifecycle integration missing marker: '+marker);
}

if(failures.length){
  console.error('\nPHASE 3 PRODUCT CHECK FAILED');
  failures.forEach((m,i)=>console.error((i+1)+'. '+m));
  process.exit(1);
}
console.log('PHASE 3 PRODUCT CHECK PASSED — Live Draw Control Room plus guided publish/draw/verify lifecycle contracts are present.');
