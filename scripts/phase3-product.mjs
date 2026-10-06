import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const failures=[];
const exists=(p)=>fs.existsSync(path.join(root,p));
const read=(p)=>fs.readFileSync(path.join(root,p),'utf8');
const fail=(m)=>failures.push(m);

const migration='supabase/migrations/202610062130_phase3_live_draw_control_room.sql';
const test='supabase/tests/phase3_live_draw_control_room.sql';

if(!exists(migration)) fail('Missing Phase 3 Control Room migration.');
else {
  const sql=read(migration);
  for(const marker of [
    'admin_get_live_draw_control_room',
    'public.is_admin()',
    'lottery_draw_runtime_state',
    'lottery_operational_health_report',
    'draw_credit_integrity_report',
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

for(const file of ['phase3-control-room.js','phase3-control-room.css','PHASE-3-LIVE-DRAW-CONTROL-ROOM.md']){
  if(!exists(file)) fail('Missing Phase 3 artifact: '+file);
}

if(exists('ops-v4.html')){
  const html=read('ops-v4.html');
  if(!html.includes('data-tab="control-room"')) fail('Admin navigation is missing Control Room tab.');
  if(!html.includes('id="control-room"')) fail('Admin page is missing Control Room section.');
  if(!html.includes('phase3-control-room.js')) fail('Admin page does not load Phase 3 Control Room script.');
  if(!html.includes('phase3-control-room.css')) fail('Admin page does not load Phase 3 Control Room styles.');
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

if(failures.length){
  console.error('\nPHASE 3 PRODUCT CHECK FAILED');
  failures.forEach((m,i)=>console.error((i+1)+'. '+m));
  process.exit(1);
}
console.log('PHASE 3 PRODUCT CHECK PASSED — Live Draw Control Room backend, guarded actions, UI, and CI contract are present.');
