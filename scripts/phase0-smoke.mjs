import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const failures = [];
const warnings = [];

function fail(message){ failures.push(message); }
function warn(message){ warnings.push(message); }
function exists(rel){ return fs.existsSync(path.join(root, rel)); }
function read(rel){ return fs.readFileSync(path.join(root, rel), 'utf8'); }

const criticalFiles = [
  'index.html',
  'lotteries.html',
  'lottery.html',
  'winners.html',
  'profile.html',
  'love-points.html',
  'ops-v4.html',
  'site-shell.js',
  'site-shell.css',
  'live-logo.js',
  'live-logo.css',
  'event.js',
  'draw-machine.js',
  'draw-machine.css',
  'winner-display-v2.js',
  'winners.js',
  'config.js'
];

for (const rel of criticalFiles) {
  if (!exists(rel)) fail(`Missing critical production file: ${rel}`);
}

const htmlFiles = fs.readdirSync(root).filter(name => name.endsWith('.html'));
const localAssetPattern = /<(?:script|link)\b[^>]*(?:src|href)=["']([^"']+)["'][^>]*>/gi;

for (const html of htmlFiles) {
  const source = read(html);
  let match;
  while ((match = localAssetPattern.exec(source))) {
    const raw = match[1].trim();
    if (!raw || raw.startsWith('#') || /^(?:https?:|data:|mailto:|tel:|javascript:)/i.test(raw)) continue;
    const clean = raw.split('#')[0].split('?')[0].replace(/^\.\//, '');
    if (!clean || clean.endsWith('/')) continue;
    if (!exists(clean)) fail(`${html} references missing local asset/page: ${raw}`);
  }
}

const redirectPages = {
  'event.html': 'lottery.html',
  'events.html': 'lotteries.html',
  'admin.html': 'ops-v4.html',
  'ops-v2.html': 'ops-v4.html',
  'control-panel.html': 'ops-v4.html',
  'game-zone.html': 'lotteries.html',
  'slot.html': 'lotteries.html',
  'plinko.html': 'lotteries.html'
};

for (const [page, target] of Object.entries(redirectPages)) {
  if (!exists(page)) {
    fail(`Missing compatibility route: ${page}`);
    continue;
  }
  if (!exists(target)) fail(`Redirect target does not exist: ${page} -> ${target}`);
  const source = read(page);
  if (!source.includes(target)) fail(`Compatibility route ${page} no longer points to ${target}`);
}

if (exists('site-shell.js')) {
  const shell = read('site-shell.js');
  const canvasCount = (shell.match(/lootera-ball-canvas/g) || []).length;
  if (canvasCount < 2) fail('Animated Lootera logo must remain present in both header and footer.');
  if (!shell.includes('d01-footer-live-brand')) fail('Animated footer logo hook is missing.');
  if (!shell.includes('live-logo.js')) fail('Global shell no longer loads live-logo.js.');
}

if (exists('lottery.html')) {
  const lottery = read('lottery.html');
  for (const marker of ['draw-machine.css', 'event.js']) {
    if (!lottery.includes(marker)) fail(`lottery.html is missing critical draw asset: ${marker}`);
  }
}

if (exists('event.js')) {
  const eventJs = read('event.js');
  if (!eventJs.includes('purchase_event_ticket')) {
    fail('event.js must purchase tickets through the server-authoritative purchase_event_ticket RPC.');
  }
}

const browserJs = fs.readdirSync(root).filter(name => name.endsWith('.js'));
for (const file of browserJs) {
  const source = read(file);
  if (/\.from\(\s*['"]profiles['"]\s*\)\s*\.update\s*\(\s*\{[^}]*\bbalance\b/s.test(source)) {
    fail(`${file} directly updates profiles.balance from browser code. Use a protected RPC.`);
  }
  if (/\.from\(\s*['"]profiles['"]\s*\)\s*\.update\s*\(\s*\{[^}]*\brole\b/s.test(source)) {
    fail(`${file} directly updates profiles.role from browser code. Use a protected admin RPC.`);
  }
  if (/\.from\(\s*['"]event_tickets['"]\s*\)\s*\.insert\s*\(/s.test(source)) {
    fail(`${file} inserts event_tickets directly from browser code. Use purchase_event_ticket RPC.`);
  }
}

const textFiles = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(?:js|mjs|ts|html|css|md|toml|ya?ml|json|sql)$/i.test(entry.name)) textFiles.push(full);
  }
}
walk(root);

const secretPatterns = [
  { label: 'Supabase secret key', re: /sb_secret_[A-Za-z0-9_-]{20,}/g },
  { label: 'Private key material', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { label: 'JWT-like service credential', re: /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g }
];

for (const full of textFiles) {
  const rel = path.relative(root, full);
  const source = fs.readFileSync(full, 'utf8');
  for (const { label, re } of secretPatterns) {
    re.lastIndex = 0;
    if (re.test(source)) fail(`${label} appears committed in ${rel}`);
  }
}

if (exists('winners.js') && exists('winners.html')) {
  const winnersJs = read('winners.js');
  const winnersHtml = read('winners.html');
  if (!winnersJs.includes('get_public_event_winners')) fail('Winners Hall no longer uses get_public_event_winners.');
  if (!winnersHtml.includes('archiveGrid')) fail('Winners Hall archive mount is missing.');
}

if (!exists('.github/workflows/pages.yml')) fail('GitHub Pages deployment workflow is missing.');

for (const w of warnings) console.warn('WARN:', w);

if (failures.length) {
  console.error('\nPHASE 0 SMOKE CHECK FAILED');
  failures.forEach((message, i) => console.error(`${i + 1}. ${message}`));
  process.exit(1);
}

console.log(`PHASE 0 SMOKE CHECK PASSED — ${htmlFiles.length} HTML routes checked, ${criticalFiles.length} critical files verified.`);
