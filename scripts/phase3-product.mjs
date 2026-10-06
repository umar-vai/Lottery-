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
const investigationMigration='supabase/migrations/202610062220_phase3_investigation_workspace.sql';
const investigationTest='supabase/tests/phase3_investigation_workspace.sql';
const scalabilityMigration='supabase/migrations/202610062245_phase3_admin_scalability.sql';
const scalabilityTest='supabase/tests/phase3_admin_scalability.sql';
const remainingScalabilityMigration='supabase/migrations/202610061755_phase3_remaining_admin_scalability.sql';
const remainingScalabilityTest='supabase/tests/phase3_remaining_admin_scalability.sql';

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

if(!exists(investigationMigration)) fail('Missing Phase 3 investigation migration.');
else {
  const sql=read(investigationMigration);
  for(const marker of [
    'private.admin_player_investigation_report',
    'admin_search_investigation_subjects',
    'admin_get_player_investigation',
    'admin_get_ticket_investigation',
    'ticket_purchase_ledger_mismatch',
    'game_ledger_mismatch',
    'separate_from_draw_credits',
    'public.is_admin()',
    'revoke all on function public.admin_get_player_investigation(uuid) from public,anon,authenticated',
    'grant execute on function public.admin_get_ticket_investigation(uuid) to authenticated'
  ]) if(!sql.includes(marker)) fail('Investigation migration missing marker: '+marker);
}

if(!exists(investigationTest)) fail('Missing Phase 3 investigation runtime test.');
else {
  const sql=read(investigationTest);
  for(const marker of [
    'Anon can execute investigation RPC',
    'Investigation report did not keep Draw Credits and Support Points separate',
    'Per-player accounting report disagrees with globally clean Draw Credit integrity',
    'Known ticket failed number or purchase-ledger investigation checks',
    'Normal player could execute admin player investigation'
  ]) if(!sql.includes(marker)) fail('Investigation test missing marker: '+marker);
}

if(!exists(scalabilityMigration)) fail('Missing Phase 3 admin scalability migration.');
else {
  const sql=read(scalabilityMigration);
  for(const marker of [
    'admin_get_admin_scalability_snapshot',
    'admin_list_players_page',
    'admin_list_tickets_page',
    'admin_list_balance_ledger_page',
    'admin_list_winner_events_page',
    'profiles_created_id_idx',
    'event_tickets_created_id_idx',
    'balance_ledger_created_id_idx',
    'public.is_admin()',
    'revoke all on function public.admin_list_players_page',
    'grant execute on function public.admin_list_balance_ledger_page'
  ]) if(!sql.includes(marker)) fail('Scalability migration missing marker: '+marker);
}

if(!exists(scalabilityTest)) fail('Missing Phase 3 admin scalability runtime test.');
else {
  const sql=read(scalabilityTest);
  for(const marker of [
    'Anon can execute scalable admin RPC',
    'Scalability snapshot totals do not match authoritative tables',
    'Player keyset pages overlap',
    'Ticket keyset pages overlap',
    'Ledger keyset pages overlap',
    'Normal player could execute scalable admin paging'
  ]) if(!sql.includes(marker)) fail('Scalability test missing marker: '+marker);
}

if(!exists(remainingScalabilityMigration)) fail('Missing Phase 3 remaining admin scalability migration.');
else {
  const sql=read(remainingScalabilityMigration);
  for(const marker of [
    'admin_get_admin_base_focus',
    'admin_get_lottery_event_detail',
    'admin_list_lottery_events_page',
    'admin_list_audit_logs_page',
    'admin_list_admin_changes_page',
    'admin_get_support_operations_summary',
    'admin_list_support_wallets_page',
    'admin_list_support_transactions_page',
    'admin_list_support_devices_page',
    'support_transactions_received_id_idx',
    'public.is_admin()',
    'revoke all on function public.admin_list_support_transactions_page',
    'grant execute on function public.admin_list_audit_logs_page'
  ]) if(!sql.includes(marker)) fail('Remaining scalability migration missing marker: '+marker);
}

if(!exists(remainingScalabilityTest)) fail('Missing Phase 3 remaining admin scalability runtime test.');
else {
  const sql=read(remainingScalabilityTest);
  for(const marker of [
    'Anon can execute remaining scalability RPC',
    'Lottery keyset pages overlap',
    'Audit keyset pages overlap',
    'Support wallet keyset pages overlap',
    'Sensitive support fields leaked',
    'Normal player could execute remaining admin scalability RPC'
  ]) if(!sql.includes(marker)) fail('Remaining scalability test missing marker: '+marker);
}

for(const file of ['phase3-control-room.js','phase3-control-room.css','PHASE-3-LIVE-DRAW-CONTROL-ROOM.md','phase3-lifecycle.js','phase3-lifecycle.css','PHASE-3-GUIDED-LIFECYCLE.md','phase3-investigation.js','phase3-investigation.css','PHASE-3-INVESTIGATION-WORKSPACE.md','phase3-scalability.js','phase3-scalability.css','PHASE-3-ADMIN-SCALABILITY.md','phase3-remaining-scalability.js','phase3-remaining-scalability.css','PHASE-3-REMAINING-ADMIN-SCALABILITY.md']){
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
  if(!html.includes('data-tab="investigations"')) fail('Admin navigation is missing Investigations tab.');
  if(!html.includes('id="investigations"')) fail('Admin page is missing Investigation Workspace section.');
  if(!html.includes('id="investigationTicketDialog"')) fail('Admin page is missing ticket investigation dialog.');
  if(!html.includes('phase3-investigation.js')) fail('Admin page does not load investigation JS.');
  if(!html.includes('phase3-investigation.css')) fail('Admin page does not load investigation styles.');
  if(!html.includes('phase3-scalability.js')) fail('Admin page does not load scalable paging JS.');
  if(!html.includes('phase3-scalability.css')) fail('Admin page does not load scalable paging styles.');
  for(const id of ['playerLoadMore','ticketLoadMore','winnerLoadMore','ledgerLoadMore','playerRoleFilter','ledgerSearch','ledgerTypeFilter']){
    if(!html.includes('id="'+id+'"')) fail('Admin scalable paging control missing: '+id);
  }
  if(!html.includes('phase3-remaining-scalability.js')) fail('Admin page does not load remaining scalability JS.');
  if(!html.includes('phase3-remaining-scalability.css')) fail('Admin page does not load remaining scalability styles.');
  if(!html.includes('support-admin.js')) fail('Admin page does not explicitly load Support admin JS.');
  for(const id of ['eventSearch','eventLoadMore','auditSearch','auditLoadMore','adminChangeSearch','adminChangeTableFilter','adminChangeLoadMore']){
    if(!html.includes('id="'+id+'"')) fail('Remaining scalability control missing: '+id);
  }
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

if(exists('phase3-investigation.js')){
  const js=read('phase3-investigation.js');
  for(const marker of [
    'admin_search_investigation_subjects',
    'admin_get_player_investigation',
    'admin_get_ticket_investigation',
    'Draw01Investigation',
    'separate',
    'data-inv-ticket'
  ]) if(!js.includes(marker)) fail('Investigation JS missing marker: '+marker);
}

if(exists('ops-v4.js')){
  const js=read('ops-v4.js');
  for(const marker of [
    'data-investigate-player',
    'data-investigate-ticket',
    'Draw01Investigation.openPlayer',
    'Draw01Investigation.openTicket'
  ]) if(!js.includes(marker)) fail('Admin investigation integration missing marker: '+marker);
}

if(exists('admin-canonical-v9.js')){
  const js=read('admin-canonical-v9.js');
  if(js.includes("req({action:'list'})")) fail('Players canonical enhancer restored bulk Support Point list preload.');
  if(js.includes('loadWallets(')) fail('Players canonical enhancer restored bulk wallet polling.');
  if(js.includes("setInterval(function(){if(document.visibilityState!=='hidden')loadWallets")) fail('Players canonical enhancer restored periodic bulk wallet polling.');
  for(const marker of ['row.dataset.userId','row.dataset.supportPoints','adjust_support','draw01:admin-data-changed']){
    if(!js.includes(marker)) fail('Canonical paged Love Point integration missing marker: '+marker);
  }
}

if(exists('phase3-scalability.js')){
  const js=read('phase3-scalability.js');
  for(const marker of [
    'admin_list_players_page',
    'admin_list_tickets_page',
    'admin_list_balance_ledger_page',
    'admin_list_winner_events_page',
    'p_cursor_created_at',
    'playerLoadMore',
    'ticketLoadMore',
    'winnerLoadMore',
    'ledgerLoadMore',
    'Draw01ScalableAdmin'
  ]) if(!js.includes(marker)) fail('Scalable admin JS missing marker: '+marker);
}

if(exists('ops-v4.js')){
  const js=read('ops-v4.js');
  if(!js.includes('admin_get_admin_scalability_snapshot')) fail('Base admin does not load scalable dashboard snapshot.');
  for(const forbidden of [
    "event_tickets?select=id,event_id,user_id,white_numbers,bonus_ball,price_paid,is_winner,winner_rank,prize_awarded,created_at&order=created_at.desc&limit=5000",
    "profiles?select=id,display_name,email,role,balance,created_at&order=created_at.desc&limit=1000",
    "balance_ledger?select=*&order=created_at.desc&limit=2000"
  ]) if(js.includes(forbidden)) fail('Large browser preload returned: '+forbidden);
  if(js.includes('renderEvents();renderTickets();renderWinners();renderPlayers();renderLedger();renderAudit()')) fail('Base render still owns scalable data tabs.');
  for(const marker of ['eventStats','Draw01AdminCore','draw01:admin-data-changed']){
    if(!js.includes(marker)) fail('Base scalable integration missing marker: '+marker);
  }
}

if(exists('phase3-remaining-scalability.js')){
  const js=read('phase3-remaining-scalability.js');
  for(const marker of [
    'admin_list_lottery_events_page',
    'admin_list_audit_logs_page',
    'admin_list_admin_changes_page',
    'eventLoadMore',
    'auditLoadMore',
    'adminChangeLoadMore',
    'Draw01RemainingScalability'
  ]) if(!js.includes(marker)) fail('Remaining scalability JS missing marker: '+marker);
}

if(exists('support-admin.js')){
  const js=read('support-admin.js');
  for(const marker of [
    'admin_get_support_operations_summary',
    'admin_list_support_devices_page',
    'admin_list_support_transactions_page',
    'supportDeviceMore',
    'supportTxMore'
  ]) if(!js.includes(marker)) fail('Support admin pagination missing marker: '+marker);
  if(js.includes("action:'list'")) fail('Support admin restored bulk Edge list read.');
}

if(exists('support-wallet-admin.js')){
  const js=read('support-wallet-admin.js');
  for(const marker of ['admin_list_support_wallets_page','supportWalletMore','supportWalletSearch']){
    if(!js.includes(marker)) fail('Support wallet pagination missing marker: '+marker);
  }
  if(js.includes("action:'list'")) fail('Support wallet restored bulk Edge list read.');
  if(js.includes('setInterval(')) fail('Support wallet restored periodic polling.');
}

if(exists('supabase/functions/support-device-admin/index.ts')){
  const js=read('supabase/functions/support-device-admin/index.ts');
  if(js.includes('limit=2000')) fail('Support Edge Function restored 2,000-row compatibility preload.');
  if(!js.includes("compatibility_note:'Wallet listing moved to admin_list_support_wallets_page'")) fail('Support Edge compatibility list is not bounded/documented.');
}

if(exists('ops-v4.js')){
  const js=read('ops-v4.js');
  for(const forbidden of [
    "lottery_events?select=*&order=created_at.desc&limit=500",
    "event_prize_tiers?select=event_id,rank,prize_amount&order=event_id,rank&limit=5000",
    "audit_logs?select=*&order=created_at.desc&limit=500",
    "admin_get_admin_change_audit',{p_limit:150}"
  ]) if(js.includes(forbidden)) fail('Remaining fixed admin preload returned: '+forbidden);
  for(const marker of ['admin_get_admin_base_focus','admin_get_lottery_event_detail','buildEventCard','focusEvent']){
    if(!js.includes(marker)) fail('Base remaining scalability integration missing marker: '+marker);
  }
}

if(failures.length){
  console.error('\nPHASE 3 PRODUCT CHECK FAILED');
  failures.forEach((m,i)=>console.error((i+1)+'. '+m));
  process.exit(1);
}
console.log('PHASE 3 PRODUCT CHECK PASSED — Control Room, lifecycle, investigation, and all admin pagination contracts are present.');
