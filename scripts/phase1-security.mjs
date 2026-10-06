import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const failures = [];

function fail(message){ failures.push(message); }
function exists(rel){ return fs.existsSync(path.join(root, rel)); }
function read(rel){ return fs.readFileSync(path.join(root, rel), 'utf8'); }

const profileMigration = 'supabase/migrations/202610061440_phase1_lock_profile_writes.sql';
const adminRpcMigration = 'supabase/migrations/202610061455_phase1_lock_admin_rpc_execute.sql';

if (!exists(profileMigration)) {
  fail('Missing Phase 1 profile hardening migration: ' + profileMigration);
} else {
  const sql = read(profileMigration);

  if (!/revoke\s+update\s+on\s+table\s+public\.profiles\s+from\s+authenticated/i.test(sql)) {
    fail('Phase 1 migration must revoke table-level UPDATE on public.profiles from authenticated.');
  }

  for (const sensitive of ['balance','role','email','referral_code']) {
    const columnRevoke = new RegExp(
      'revoke\\s+update\\s*\\([\\s\\S]*?\\b' + sensitive + '\\b[\\s\\S]*?\\)\\s+on\\s+table\\s+public\\.profiles\\s+from\\s+authenticated',
      'i'
    );
    if (!columnRevoke.test(sql)) {
      fail('Phase 1 migration must explicitly revoke authenticated UPDATE for profiles.' + sensitive + '.');
    }
  }

  if (!/drop\s+policy\s+if\s+exists\s+["']users can update own profile["']\s+on\s+public\.profiles/i.test(sql)) {
    fail('Legacy own-profile UPDATE policy must be removed.');
  }

  if (!/create\s+or\s+replace\s+function\s+public\.update_my_profile\s*\(/i.test(sql)) {
    fail('Supported profile edit RPC update_my_profile is missing from the hardening migration.');
  }

  if (!/security\s+definer/i.test(sql) || !/set\s+search_path\s*=\s*['"]pg_catalog['"]\s*,\s*['"]public['"]/i.test(sql)) {
    fail('update_my_profile must keep SECURITY DEFINER with an explicit safe search_path.');
  }

  if (!/auth\.uid\s*\(\s*\)/i.test(sql)) {
    fail('update_my_profile must authorize against auth.uid().');
  }

  if (!/revoke\s+all\s+on\s+function\s+public\.update_my_profile\(text,text\)\s+from\s+public\s*,\s*anon/i.test(sql)) {
    fail('update_my_profile must revoke default PUBLIC/anon EXECUTE.');
  }

  if (!/grant\s+execute\s+on\s+function\s+public\.update_my_profile\(text,text\)\s+to\s+authenticated/i.test(sql)) {
    fail('update_my_profile must grant EXECUTE to authenticated clients.');
  }
}

if (!exists(adminRpcMigration)) {
  fail('Missing Phase 1 admin RPC execute hardening migration: ' + adminRpcMigration);
} else {
  const sql = read(adminRpcMigration);
  const adminFunctions = [
    'admin_relaunch_lottery_event\\(uuid\\)',
    'admin_update_completed_event_metadata\\(uuid,text,text,text\\)'
  ];

  for (const fn of adminFunctions) {
    const revoke = new RegExp('revoke\\s+all\\s+on\\s+function\\s+public\\.' + fn + '\\s+from\\s+public\\s*,\\s*anon', 'i');
    const grant = new RegExp('grant\\s+execute\\s+on\\s+function\\s+public\\.' + fn + '\\s+to\\s+authenticated', 'i');
    if (!revoke.test(sql)) fail('Admin RPC must revoke PUBLIC/anon EXECUTE: ' + fn);
    if (!grant.test(sql)) fail('Admin RPC must remain callable by authenticated sessions: ' + fn);
  }
}

if (!exists('profile.js')) {
  fail('profile.js is missing.');
} else {
  const profileJs = read('profile.js');
  if (!/\.rpc\(\s*['"]update_my_profile['"]/.test(profileJs)) {
    fail('profile.js must save profile edits through update_my_profile RPC.');
  }
}

const browserJs = fs.readdirSync(root).filter(name => name.endsWith('.js'));
for (const file of browserJs) {
  const source = read(file);
  if (/\.from\(\s*['"]profiles['"]\s*\)\s*\.update\s*\(/s.test(source)) {
    fail(file + ' directly updates public.profiles from browser code. Use an authorized RPC instead.');
  }
}

if (failures.length) {
  console.error('\nPHASE 1 SECURITY CHECK FAILED');
  failures.forEach((message, i) => console.error((i + 1) + '. ' + message));
  process.exit(1);
}

console.log('PHASE 1 SECURITY CHECK PASSED — profile writes are RPC-only and sensitive admin RPCs are not exposed to anonymous callers.');
