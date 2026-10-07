import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root=process.cwd();
const failures=[];
const exists=p=>fs.existsSync(path.join(root,p));
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const fail=m=>failures.push(m);

const migration='supabase/migrations/202610070700_phase7e_private_fk_indexes.sql';
const runtime='supabase/tests/phase7e_security_dr.sql';
const backup='scripts/export-offsite-backup.sh';
const restore='scripts/restore-offsite-backup.sh';
const verify='scripts/verify-restored-database.sql';
const report='PHASE-7E-SECURITY-DR-CLOSURE.md';

for(const f of [migration,runtime,backup,restore,verify,report]){
  if(!exists(f))fail('Missing Phase 7E artifact: '+f);
}

if(exists(migration)){
  const sql=read(migration);
  for(const marker of [
    'production_alert_delivery_config_updated_by_idx',
    'production_incident_acknowledgements_acknowledged_by_idx'
  ]) if(!sql.includes(marker))fail('Phase 7E migration missing marker: '+marker);
}

if(exists(runtime)){
  const sql=read(runtime);
  for(const marker of [
    'Google-only/no-password accounts',
    'Authenticated direct private SECURITY DEFINER exposure detected',
    'Anonymous SECURITY DEFINER allowlist drifted',
    'pg_net advisor classification changed',
    'Production SLO not healthy',
    'Telegram production alert delivery is not healthy',
    'rollback;'
  ]) if(!sql.includes(marker))fail('Phase 7E runtime contract missing marker: '+marker);
}

if(exists(backup)){
  const sh=read(backup);
  for(const marker of [
    'BACKUP_AGE_RECIPIENT',
    'ALLOW_PLAINTEXT_BACKUP',
    'history_schema.sql',
    'history_data.sql',
    'ARCHIVE_SHA256SUMS',
    'refusing to write production backups inside the Git repository',
    'Storage object bytes are NOT included'
  ]) if(!sh.includes(marker))fail('Phase 7E backup script missing marker: '+marker);
}

if(exists(restore)){
  const sh=read(restore);
  for(const marker of [
    'LOOTERA_RESTORE_REHEARSAL',
    'refusing to restore into Lootera production',
    'session_replication_role = replica',
    'cron.unschedule',
    'external_enabled=false',
    'verify-restored-database.sql'
  ]) if(!sh.includes(marker))fail('Phase 7E restore script missing marker: '+marker);
}

if(exists(verify)){
  const sql=read(verify);
  for(const marker of [
    'Critical Lootera tables are missing after restore',
    'A critical public table lost RLS after restore',
    'Authenticated role can execute private SECURITY DEFINER functions after restore',
    'Draw Credit integrity failed after restore',
    'cron jobs were not unscheduled',
    'external alerts remain enabled'
  ]) if(!sql.includes(marker))fail('Phase 7E restore verification missing marker: '+marker);
}

if(exists(report)){
  const md=read(report);
  for(const marker of [
    'Email/password users: 0',
    'Pro Plan and above',
    'relocatable: **false**',
    'no invocation for any retired stub',
    'A real encrypted off-site backup and a real restore rehearsal still require'
  ]) if(!md.includes(marker))fail('Phase 7E report missing marker: '+marker);
}

for(const sh of [backup,restore]){
  if(exists(sh)){
    try{ execFileSync('bash',['-n',path.join(root,sh)],{stdio:'pipe'}); }
    catch(err){ fail('Shell syntax check failed for '+sh+': '+String(err.stderr||err.message)); }
  }
}

// Prevent accidental recommit of a Telegram BotFather token into source-controlled text.
const tokenPattern=/\b\d{7,12}:[A-Za-z0-9_-]{30,}\b/g;
const scanExt=new Set(['.js','.mjs','.ts','.html','.md','.sql','.sh','.json','.yml','.yaml','.css']);
function walk(dir){
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    if(['.git','node_modules'].includes(entry.name))continue;
    const full=path.join(dir,entry.name);
    if(entry.isDirectory())walk(full);
    else if(scanExt.has(path.extname(entry.name))){
      const content=fs.readFileSync(full,'utf8');
      if(tokenPattern.test(content))fail('Possible Telegram bot token committed in '+path.relative(root,full));
      tokenPattern.lastIndex=0;
    }
  }
}
walk(root);

if(failures.length){
  console.error('PHASE 7E SECURITY + DR CHECK FAILED');
  failures.forEach((m,i)=>console.error((i+1)+'. '+m));
  process.exit(1);
}

console.log('PHASE 7E SECURITY + DR CHECK PASSED — security exceptions classified, encrypted backup guard and restore rehearsal controls are protected.');
