import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const failures=[];
const exists=p=>fs.existsSync(path.join(root,p));
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const fail=m=>failures.push(m);

const lifecycleMigration='supabase/migrations/202610070345_phase5_lifecycle_state_machine.sql';
const legacyFreezeMigration='supabase/migrations/202610070400_phase5_freeze_legacy_powerball_writes.sql';
const runtimeTest='supabase/tests/phase5_production_readiness.sql';

if(!exists(lifecycleMigration)) fail('Missing Phase 5 lifecycle migration.');
else {
  const sql=read(lifecycleMigration);
  for(const marker of [
    'Direct publish is disabled',
    'Direct draft-to-published update is disabled',
    'Published lotteries cannot return to draft',
    'Cancelled lotteries cannot be republished',
    'Winner prize tiers are locked after the first ticket is sold',
    'admin_publish_lottery_event'
  ]) if(!sql.includes(marker)) fail('Lifecycle migration missing marker: '+marker);
}

if(!exists(legacyFreezeMigration)) fail('Missing Phase 5 legacy-write freeze migration.');
else {
  const sql=read(legacyFreezeMigration);
  for(const marker of [
    'revoke insert, update, delete on table public.tickets',
    'users can insert own tickets',
    'users can update own open tickets',
    'Legacy Powerball ticket history'
  ]) if(!sql.includes(marker)) fail('Legacy freeze migration missing marker: '+marker);
}

if(!exists(runtimeTest)) fail('Missing Phase 5 production-readiness runtime test.');
else {
  const sql=read(runtimeTest);
  for(const marker of [
    'SECURITY DEFINER function missing explicit search_path',
    'Authenticated admin SECURITY DEFINER RPC missing is_admin guard',
    'Legacy Powerball tickets remain browser-writable',
    'Direct create-and-publish bypass was accepted',
    'Direct draft-to-published update bypass was accepted',
    'Prize tiers changed after ticket sale',
    'Invalid duplicate-number ticket was accepted',
    'Phase 5 E2E post-draw integrity failed',
    'Support transaction settled more than once'
  ]) if(!sql.includes(marker)) fail('Phase 5 runtime test missing marker: '+marker);
}

if(!exists('ops-v4.js')) fail('Missing current admin client.');
else {
  const js=read('ops-v4.js');
  if(!js.includes('a.p_publish=false')) fail('Admin create flow must force draft creation before guarded publish.');
  if(!js.includes("rpc('admin_publish_lottery_event'")) fail('Admin UI must publish through guarded lifecycle RPC.');
}

const htmlFiles=fs.readdirSync(root).filter(name=>name.endsWith('.html'));
for(const file of htmlFiles){
  const html=read(file);
  if(/<script[^>]+src=["'][^"']*app\.js(?:\?[^"']*)?["']/i.test(html)){
    fail(file+' still loads retired legacy app.js.');
  }
}

const migrationsDir=path.join(root,'supabase','migrations');
if(fs.existsSync(migrationsDir)){
  const later=fs.readdirSync(migrationsDir)
    .filter(name=>name.endsWith('.sql') && name>path.basename(legacyFreezeMigration))
    .sort();
  for(const name of later){
    const sql=fs.readFileSync(path.join(migrationsDir,name),'utf8');
    if(/grant\s+[^;]*(?:insert|update|delete|all)[^;]*on\s+(?:table\s+)?public\.tickets\b[^;]*to\s+[^;]*(?:anon|authenticated)/i.test(sql)){
      fail(name+' reintroduces browser writes on frozen legacy public.tickets.');
    }
    if(/create\s+policy[\s\S]{0,200}?on\s+public\.tickets[\s\S]{0,120}?for\s+(?:insert|update|delete|all)/i.test(sql)){
      fail(name+' reintroduces a write policy on frozen legacy public.tickets.');
    }
  }
}

if(!exists('PHASE-5-PRODUCTION-READINESS.md')) fail('Missing Phase 5 production-readiness report.');

if(failures.length){
  console.error('Phase 5 production-readiness checks failed:');
  failures.forEach(x=>console.error(' - '+x));
  process.exit(1);
}

console.log('Phase 5 production-readiness checks passed.');
