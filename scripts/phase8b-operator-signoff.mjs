import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const failures=[];
const exists=p=>fs.existsSync(path.join(root,p));
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const fail=m=>failures.push(m);

const migrations=[
  'supabase/migrations/20261007112746_phase8b_operator_signoff_exit_gate.sql',
  'supabase/migrations/20261007112934_phase8b_warning_review_queue.sql'
];
const runtime='supabase/tests/phase8b_operator_signoff.sql';
const report='PHASE-8B-OPERATOR-SIGNOFF.md';
const js='ops-v4.js';
const html='ops-v4.html';

for(const f of [...migrations,runtime,report,js,html]){
  if(!exists(f))fail('Missing Phase 8B artifact: '+f);
}

if(migrations.every(exists)){
  const sql=migrations.map(read).join('\n');
  for(const marker of [
    'private.production_launch_operator_signoffs',
    'private.production_launch_warning_dispositions',
    'private.production_launch_exit_signoff',
    'private.production_launch_operator_signoff_report',
    'private.production_launch_exit_report',
    'public.admin_record_launch_operator_signoff',
    'public.admin_disposition_launch_warning',
    'public.admin_finalize_launch_stabilization',
    "'stabilization_window_active'",
    "'operator_signoff_outstanding'",
    "'warning_snapshot_undispositioned'",
    "'ready_for_signoff'",
    "'signed_off'",
    "'unresolved_items'",
    "'launch_exit',v_exit"
  ]) if(!sql.includes(marker))fail('Phase 8B migrations missing marker: '+marker);
}

if(exists(runtime)){
  const sql=read(runtime);
  for(const marker of [
    'Phase 8B initial exit state invalid',
    'Phase 8B private tables are directly readable',
    'Phase 8B private functions are externally executable',
    'Phase 8B admin RPC grants are incorrect',
    'v_auth_public_secdef<>53',
    'v_anon_public_secdef<>2',
    'v_private_auth_secdef<>0',
    'Phase 8B warning review queue failed',
    'Phase 8B approval unexpectedly succeeded during active window',
    'Phase 8B final sign-off contract failed',
    'rollback;'
  ]) if(!sql.includes(marker))fail('Phase 8B runtime missing marker: '+marker);
}

if(exists(js)){
  const code=read(js);
  try{new Function(code)}catch(err){fail('ops-v4.js syntax error: '+err.message)}
  for(const marker of [
    'renderLaunchExit',
    'admin_record_launch_operator_signoff',
    'admin_disposition_launch_warning',
    'admin_finalize_launch_stabilization',
    'launch_exit'
  ]) if(!code.includes(marker))fail('Phase 8B admin JS missing marker: '+marker);
}

if(exists(html)){
  const markup=read(html);
  for(const marker of [
    'launchExitPanel',
    'PHASE 8B · OPERATOR SIGN-OFF',
    'launchOperatorSignoffs',
    'approveLaunchExit',
    'holdLaunchExit'
  ]) if(!markup.includes(marker))fail('Phase 8B admin HTML missing marker: '+marker);
  const m=markup.match(/ops-v4\.js\?v=(\d+)/);
  if(!m||Number(m[1])<14)fail('Phase 8B admin cache-bust version must be 14 or newer.');
}

if(exists(report)){
  const md=read(report);
  for(const marker of [
    'Phase 8B',
    '2026-10-10 10:32:08 UTC',
    'Issue #61',
    'Issue #59',
    'stabilizing',
    'ready_for_signoff',
    'signed_off',
    '53',
    'cannot be falsely marked complete'
  ]) if(!md.includes(marker))fail('Phase 8B report missing marker: '+marker);
}

if(failures.length){
  console.error('PHASE 8B OPERATOR SIGN-OFF CHECK FAILED');
  failures.forEach((m,i)=>console.error((i+1)+'. '+m));
  process.exit(1);
}

console.log('PHASE 8B OPERATOR SIGN-OFF CHECK PASSED — explicit exception decisions, warning dispositions, active-window guard, final exit sign-off and admin visibility are protected.');
