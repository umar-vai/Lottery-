import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const failures = [];

function fail(message){ failures.push(message); }
function exists(rel){ return fs.existsSync(path.join(root, rel)); }
function read(rel){ return fs.readFileSync(path.join(root, rel), 'utf8'); }

const profileMigration = 'supabase/migrations/202610061440_phase1_lock_profile_writes.sql';
const adminRpcMigration = 'supabase/migrations/202610061455_phase1_lock_admin_rpc_execute.sql';
const grantsMigration = 'supabase/migrations/202610061520_phase1_least_privilege_table_grants.sql';
const defaultsMigration = 'supabase/migrations/202610061525_phase1_secure_public_defaults.sql';
const dbInvariantTest = 'supabase/tests/phase1_security_invariants.sql';

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

const readOnlyTables = [
  'audit_logs','binance_pay_orders','draw_events','draws','event_prize_tiers',
  'game_settings','games','love_point_payment_providers','plinko_drops',
  'referral_rewards','referrals','slot_spins','support_claim_requests','ticket_results'
];

if (!exists(grantsMigration)) {
  fail('Missing Phase 1 least-privilege table grant migration: ' + grantsMigration);
} else {
  const sql = read(grantsMigration);
  for (const table of readOnlyTables) {
    if (!sql.includes('public.' + table)) {
      fail('Least-privilege migration does not cover public.' + table);
    }
  }
  if (!/revoke\s+insert\s*,\s*update\s*,\s*delete\s*,\s*truncate\s*,\s*references\s*,\s*trigger[\s\S]*from\s+anon\s*,\s*authenticated/i.test(sql)) {
    fail('Least-privilege migration must revoke browser-role write grants.');
  }
}

if (!exists(defaultsMigration)) {
  fail('Missing Phase 1 secure default-privileges migration: ' + defaultsMigration);
} else {
  const sql = read(defaultsMigration);
  if (!/alter\s+default\s+privileges[\s\S]*revoke\s+all\s+on\s+tables\s+from\s+anon\s*,\s*authenticated/i.test(sql)) {
    fail('Future public tables must default to no anon/authenticated grants.');
  }
  if (!/revoke\s+execute\s+on\s+functions\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i.test(sql)) {
    fail('Future public functions must default to no PUBLIC/anon/authenticated EXECUTE.');
  }
}

if (!exists(dbInvariantTest)) {
  fail('Missing database invariant suite: ' + dbInvariantTest);
} else {
  const sql = read(dbInvariantTest);
  for (const marker of [
    'has_table_privilege',
    'has_function_privilege',
    'purchase_event_ticket',
    'run_lottery_event_internal',
    'pg_policies',
    'search_path'
  ]) {
    if (!sql.includes(marker)) fail('Database invariant suite is missing check marker: ' + marker);
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

const migrationsDir = path.join(root, 'supabase', 'migrations');
if (fs.existsSync(migrationsDir)) {
  const laterMigrations = fs.readdirSync(migrationsDir)
    .filter(name => name.endsWith('.sql') && name > path.basename(grantsMigration))
    .sort();

  for (const name of laterMigrations) {
    const source = fs.readFileSync(path.join(migrationsDir, name), 'utf8');
    for (const table of readOnlyTables) {
      const broadWrite = new RegExp(
        'grant\\s+[^;]*(?:\\binsert\\b|\\bupdate\\b|\\bdelete\\b|\\btruncate\\b|\\breferences\\b|\\btrigger\\b|\\ball\\b)[^;]*on\\s+(?:table\\s+)?(?:public\\.)?' +
        table +
        '\\b[^;]*to\\s+[^;]*(?:anon|authenticated)',
        'i'
      );
      if (broadWrite.test(source)) {
        fail(name + ' reintroduces browser write grants on read-only table public.' + table);
      }
    }
  }
}

const liveEdgeFunctions = [
  'support-phone-bridge',
  'support-device-admin',
  'claim-support-points',
  'binance-pay-create-order',
  'binance-pay-webhook',
  'phone-bridge',
  'bridge-device-admin',
  'claim-demo-credit'
];

for (const slug of liveEdgeFunctions) {
  const entry = 'supabase/functions/' + slug + '/index.ts';
  if (!exists(entry)) fail('Missing source-controlled production Edge Function: ' + entry);
}

if (!exists('supabase/functions/PRODUCTION-SNAPSHOT.md')) {
  fail('Missing production Edge Function version/JWT snapshot.');
}

if (failures.length) {
  console.error('\nPHASE 1 SECURITY CHECK FAILED');
  failures.forEach((message, i) => console.error((i + 1) + '. ' + message));
  process.exit(1);
}

console.log('PHASE 1 SECURITY CHECK PASSED — RPC authorization, least-privilege grants, secure defaults, DB invariants, and production Edge Function sources are present.');
