import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, APP_URL } from './config.js';

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, detectSessionInUrl: true, autoRefreshToken: true },
});

const $ = (id) => document.getElementById(id);
const state = { session:null, profile:null, draws:[], tickets:[], profiles:[], settings:null, audit:[], countdownTimer:null };

function money(v){const n=Number(v||0);if(n>=1e9)return `$${(n/1e9).toFixed(n%1e9?1:0)}B`;if(n>=1e6)return `$${(n/1e6).toFixed(n%1e6?1:0)}M`;return `$${n.toLocaleString()}`}
function fmt(iso){return iso?new Date(iso).toLocaleString():'—'}
function localInput(iso){if(!iso)return'';const d=new Date(iso);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16)}
function isoFromInput(v){return v?new Date(v).toISOString():null}
function statusClass(s){return `status-badge status-${s||'unknown'}`}
function esc(s=''){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function toast(msg,error=false){const el=$('toast');el.textContent=msg;el.className=`toast${error?' error':''}`;el.hidden=false;clearTimeout(el._t);el._t=setTimeout(()=>el.hidden=true,3500)}

async function requireAdmin(){
  const {data:{session}}=await supabase.auth.getSession();
  state.session=session;
  if(!session){$('gateMessage').textContent='Sign in with your Google account. Only approved admin roles can continue.';$('adminLoginBtn').hidden=false;return false}
  const {data:profile,error}=await supabase.from('profiles').select('id,display_name,avatar_url,email,role').eq('id',session.user.id).maybeSingle();
  if(error||!profile){$('gateMessage').textContent='Could not verify your account.';return false}
  state.profile=profile;
  if(profile.role!=='admin'){$('gateMessage').textContent='Access denied. This Google account is not an admin.';return false}
  const meta=session.user.user_metadata||{};
  $('adminName').textContent=profile.display_name||meta.full_name||'Admin';
  $('adminEmail').textContent=profile.email||session.user.email||'';
  $('adminAvatar').src=profile.avatar_url||meta.avatar_url||`https://ui-avatars.com/api/?name=${encodeURIComponent($('adminName').textContent)}`;
  $('authGate').hidden=true;$('adminApp').hidden=false;
  return true;
}

async function loginAdmin(){localStorage.setItem('draw01_admin_redirect','1');const {error}=await supabase.auth.signInWithOAuth({provider:'google',options:{redirectTo:APP_URL}});if(error)toast(error.message,true)}
async function logoutAdmin(){await supabase.auth.signOut();location.href='./'}

async function loadData(){
  const [draws,tickets,profiles,settings,audit]=await Promise.all([
    supabase.from('draws').select('*').order('draw_number',{ascending:false}).limit(100),
    supabase.from('tickets').select('id,user_id,draw_id,white_numbers,powerball,power_play,submitted_at').order('submitted_at',{ascending:false}).limit(500),
    supabase.from('profiles').select('id,display_name,avatar_url,email,role,created_at').order('created_at',{ascending:false}).limit(500),
    supabase.from('game_settings').select('*').eq('id',1).single(),
    supabase.from('audit_logs').select('*').order('created_at',{ascending:false}).limit(100),
  ]);
  for(const r of [draws,tickets,profiles,settings,audit]) if(r.error) console.error(r.error);
  state.draws=draws.data||[];state.tickets=tickets.data||[];state.profiles=profiles.data||[];state.settings=settings.data||null;state.audit=audit.data||[];
  renderAll();
}

function activeDraw(){
  const priority={drawing:0,locked:1,open:2,paused:3,scheduled:4};
  return state.draws.filter(d=>priority[d.status]!==undefined).sort((a,b)=>(priority[a.status]-priority[b.status])||(new Date(a.draw_at)-new Date(b.draw_at)))[0]||null;
}
function ticketCount(drawId){return state.tickets.filter(t=>t.draw_id===drawId).length}
function profileMap(){return new Map(state.profiles.map(p=>[p.id,p]))}
function drawMap(){return new Map(state.draws.map(d=>[d.id,d]))}

function renderOverview(){
  const d=activeDraw();
  $('statJackpot').textContent=d?money(d.jackpot_amount):'—';
  $('statDrawNo').textContent=d?`Draw #${d.draw_number} · ${d.status.toUpperCase()}`:'No active draw';
  $('statTickets').textContent=d?ticketCount(d.id):0;
  $('statPlayers').textContent=state.profiles.length;
  $('currentDrawTitle').textContent=d?(d.title||`Draw #${d.draw_number}`):'No active draw';
  $('currentDrawStatus').textContent=d?d.status.toUpperCase():'—';
  $('currentDrawStatus').className=d?statusClass(d.status):'status-badge';
  $('systemStatusText').textContent=state.settings?.system_paused?'SYSTEM PAUSED':'SYSTEM LIVE';
  const details=$('currentDetails');details.innerHTML='';
  if(d){
    const items=[['Draw number',`#${d.draw_number}`],['Jackpot',money(d.jackpot_amount)],['Opens',fmt(d.opens_at)],['Ticket cutoff',fmt(d.cutoff_at)],['Draw time',fmt(d.draw_at)],['Tickets',ticketCount(d.id)]];
    items.forEach(([k,v])=>details.insertAdjacentHTML('beforeend',`<div class="detail"><span>${k}</span><strong>${esc(v)}</strong></div>`));
  } else details.innerHTML='<div class="detail"><span>Status</span><strong>No active event</strong></div>';
  renderQuickControls(d);
  const completed=state.draws.filter(x=>x.status==='completed').slice(0,5);
  $('recentResults').innerHTML=completed.length?completed.map(x=>`<div class="stack-item"><div><strong>#${x.draw_number}</strong><br><span>${(x.white_numbers||[]).map(n=>String(n).padStart(2,'0')).join(' ')} + ${String(x.powerball||'—').padStart(2,'0')}</span></div><span>${money(x.jackpot_amount)}</span></div>`).join(''):'<div class="stack-item"><span>No results yet.</span></div>';
  updateCountdown();
}

function renderQuickControls(d){
  const box=$('quickControls');box.innerHTML='';if(!d)return;
  const add=(label,cls,fn)=>{const b=document.createElement('button');b.className=cls;b.textContent=label;b.onclick=fn;box.appendChild(b)};
  if(['open','scheduled'].includes(d.status)) add('Pause','secondary-btn',()=>pauseDraw(d.id,true));
  if(d.status==='paused') add('Resume','primary-btn',()=>pauseDraw(d.id,false));
  if(['open','scheduled'].includes(d.status)) add('Lock now','warn-btn',()=>lockDraw(d.id));
  if(['open','locked','scheduled'].includes(d.status)) add('Run draw now','primary-btn',()=>runNow(d.id));
  if(!['completed','drawing','cancelled'].includes(d.status)) add('Cancel','danger-btn',()=>cancelDraw(d.id));
}

function updateCountdown(){
  clearInterval(state.countdownTimer);
  const tick=()=>{const d=activeDraw();if(!d){$('statCountdown').textContent='—';$('statDrawTime').textContent='Not scheduled';return}const target=new Date(d.draw_at).getTime();let s=Math.max(0,Math.floor((target-Date.now())/1000));const h=Math.floor(s/3600);s%=3600;const m=Math.floor(s/60),sec=s%60;$('statCountdown').textContent=h?`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`:`${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;$('statDrawTime').textContent=fmt(d.draw_at)};tick();state.countdownTimer=setInterval(tick,1000)
}

function renderEvents(){
  const body=$('drawsTableBody');body.innerHTML='';
  state.draws.forEach(d=>{
    const tr=document.createElement('tr');
    tr.innerHTML=`<td><strong>#${d.draw_number}</strong><br><span>${esc(d.title||'Untitled draw')}</span></td><td><span class="${statusClass(d.status)}">${d.status.toUpperCase()}</span></td><td>${esc(fmt(d.draw_at))}<br><small>Cutoff ${esc(fmt(d.cutoff_at))}</small></td><td>${money(d.jackpot_amount)}</td><td>${ticketCount(d.id)}</td><td><div class="row-actions" data-actions></div></td>`;
    const actions=tr.querySelector('[data-actions]');
    const btn=(label,cls,fn)=>{const b=document.createElement('button');b.className=cls;b.textContent=label;b.onclick=fn;actions.appendChild(b)};
    if(['draft','scheduled','open','paused'].includes(d.status))btn('Edit','secondary-btn',()=>openEdit(d));
    if(d.status==='draft')btn('Publish','primary-btn',()=>publishDraft(d.id));
    if(['scheduled','open'].includes(d.status))btn('Pause','secondary-btn',()=>pauseDraw(d.id,true));
    if(d.status==='paused')btn('Resume','primary-btn',()=>pauseDraw(d.id,false));
    if(['scheduled','open'].includes(d.status))btn('Lock','warn-btn',()=>lockDraw(d.id));
    if(['scheduled','open','locked'].includes(d.status))btn('Run','primary-btn',()=>runNow(d.id));
    if(!['completed','drawing','cancelled'].includes(d.status))btn('Cancel','danger-btn',()=>cancelDraw(d.id));
    body.appendChild(tr);
  });
}

function renderTickets(){
  const filter=$('ticketDrawFilter');const prev=filter.value;filter.innerHTML='<option value="all">All draws</option>'+state.draws.map(d=>`<option value="${d.id}">Draw #${d.draw_number}</option>`).join('');if([...filter.options].some(o=>o.value===prev))filter.value=prev;
  const pmap=profileMap(),dmap=drawMap();const chosen=filter.value||'all';
  const rows=state.tickets.filter(t=>chosen==='all'||t.draw_id===chosen);
  $('ticketsTableBody').innerHTML=rows.length?rows.map(t=>{const p=pmap.get(t.user_id),d=dmap.get(t.draw_id);return `<tr><td>${esc(p?.display_name||'Player')}<br><small>${esc(p?.email||'')}</small></td><td>#${d?.draw_number||'—'}</td><td class="numbers">${t.white_numbers.map(n=>String(n).padStart(2,'0')).join(' ')} <span class="pb">+ ${String(t.powerball).padStart(2,'0')}</span></td><td>${t.power_play?'Yes':'No'}</td><td>${esc(fmt(t.submitted_at))}</td></tr>`}).join(''):'<tr><td colspan="5">No tickets found.</td></tr>';
}

function renderUsers(){
  $('playerCountLabel').textContent=`${state.profiles.length} users`;
  const body=$('usersTableBody');body.innerHTML='';
  state.profiles.forEach(p=>{const tr=document.createElement('tr');tr.innerHTML=`<td><strong>${esc(p.display_name||'Player')}</strong></td><td>${esc(p.email||'—')}</td><td>${esc(fmt(p.created_at))}</td><td></td>`;const td=tr.lastElementChild;const sel=document.createElement('select');sel.className='role-select';sel.innerHTML='<option value="player">Player</option><option value="admin">Admin</option>';sel.value=p.role;sel.disabled=p.id===state.session.user.id;sel.onchange=()=>setRole(p.id,sel.value);td.appendChild(sel);body.appendChild(tr)});
}

function renderSettings(){const s=state.settings;if(!s)return;$('settingStartingJackpot').value=Number(s.starting_jackpot);$('settingRollover').value=Number(s.rollover_increment);$('settingInterval').value=s.draw_interval_minutes;$('settingCutoff').value=s.ticket_cutoff_seconds;$('settingPowerPlay').checked=s.power_play_enabled;$('settingAutoNext').checked=s.auto_create_next_draw;$('settingSystemPaused').checked=s.system_paused}
function renderAudit(){const pmap=profileMap();$('auditList').innerHTML=state.audit.length?state.audit.map(a=>`<div class="audit-item"><time>${esc(fmt(a.created_at))}</time><div><strong>${esc(a.action.replaceAll('_',' '))}</strong><br><small>${esc(pmap.get(a.actor_user_id)?.display_name||'System')} · ${esc(a.entity_type)} ${esc(a.entity_id||'')}</small></div><small>${a.new_data?.status?esc(a.new_data.status):''}</small></div>`).join(''):'<div class="stack-item"><span>No admin activity yet.</span></div>'}
function renderAll(){renderOverview();renderEvents();renderTickets();renderUsers();renderSettings();renderAudit()}

async function rpc(name,args){const {data,error}=await supabase.rpc(name,args);if(error){toast(error.message,true);throw error}return data}
async function refresh(message){await loadData();if(message)toast(message)}

async function createDraw(e){e.preventDefault();try{await rpc('admin_create_draw',{p_title:$('newTitle').value,p_opens_at:isoFromInput($('newOpensAt').value),p_cutoff_at:isoFromInput($('newCutoffAt').value),p_draw_at:isoFromInput($('newDrawAt').value),p_jackpot:Number($('newJackpot').value),p_draft:$('newDraft').checked});e.target.reset();setCreateDefaults();await refresh('Draw created.')}catch{}}
function openEdit(d){$('editDrawId').value=d.id;$('editDrawHeading').textContent=`Draw #${d.draw_number}`;$('editTitle').value=d.title||'';$('editOpensAt').value=localInput(d.opens_at);$('editCutoffAt').value=localInput(d.cutoff_at);$('editDrawAt').value=localInput(d.draw_at);$('editJackpot').value=Number(d.jackpot_amount);$('editDrawDialog').showModal()}
async function saveEdit(e){e.preventDefault();try{await rpc('admin_update_draw',{p_draw_id:$('editDrawId').value,p_title:$('editTitle').value,p_opens_at:isoFromInput($('editOpensAt').value),p_cutoff_at:isoFromInput($('editCutoffAt').value),p_draw_at:isoFromInput($('editDrawAt').value),p_jackpot:Number($('editJackpot').value)});$('editDrawDialog').close();await refresh('Draw updated.')}catch{}}
async function publishDraft(id){try{await rpc('admin_publish_draft',{p_draw_id:id});await refresh('Draft published.')}catch{}}
async function pauseDraw(id,paused){try{await rpc('admin_pause_draw',{p_draw_id:id,p_paused:paused});await refresh(paused?'Draw paused.':'Draw resumed.')}catch{}}
async function lockDraw(id){if(!confirm('Lock ticket submissions for this draw now?'))return;try{await rpc('admin_lock_draw',{p_draw_id:id});await refresh('Draw locked.')}catch{}}
async function runNow(id){if(!confirm('Run the secure server draw now? Winning numbers are generated by the backend and cannot be chosen by admin.'))return;try{await rpc('admin_run_draw_now',{p_draw_id:id});await refresh('Secure draw completed.')}catch{}}
async function cancelDraw(id){const reason=prompt('Optional cancellation reason:','');if(reason===null)return;try{await rpc('admin_cancel_draw',{p_draw_id:id,p_reason:reason});await refresh('Draw cancelled.')}catch{}}
async function setRole(id,role){try{await rpc('admin_set_user_role',{p_user_id:id,p_role:role});await refresh('User role updated.')}catch{}}
async function saveSettings(e){e.preventDefault();try{await rpc('admin_update_game_settings',{p_starting_jackpot:Number($('settingStartingJackpot').value),p_rollover_increment:Number($('settingRollover').value),p_draw_interval_minutes:Number($('settingInterval').value),p_ticket_cutoff_seconds:Number($('settingCutoff').value),p_power_play_enabled:$('settingPowerPlay').checked,p_auto_create_next_draw:$('settingAutoNext').checked,p_system_paused:$('settingSystemPaused').checked});await refresh('Settings saved.')}catch{}}

function setCreateDefaults(){const now=new Date();const open=new Date(now.getTime()+60000),draw=new Date(now.getTime()+11*60000),cutoff=new Date(draw.getTime()-60000);$('newOpensAt').value=localInput(open.toISOString());$('newCutoffAt').value=localInput(cutoff.toISOString());$('newDrawAt').value=localInput(draw.toISOString());$('newJackpot').value=Number(state.settings?.starting_jackpot||20000000)}
function setupNav(){document.querySelectorAll('.nav-item').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('.nav-item').forEach(x=>x.classList.remove('active'));btn.classList.add('active');document.querySelectorAll('.section').forEach(x=>x.classList.remove('active-section'));$(`section-${btn.dataset.section}`).classList.add('active-section');const labels={overview:['ADMIN OVERVIEW','Control center'],events:['EVENT MANAGEMENT','Draws & events'],tickets:['TICKET OPERATIONS','Submitted tickets'],users:['ACCESS CONTROL','Players & admins'],settings:['SYSTEM SETTINGS','Draw engine'],audit:['AUDIT TRAIL','Admin activity']};$('pageEyebrow').textContent=labels[btn.dataset.section][0];$('pageTitle').textContent=labels[btn.dataset.section][1]}))}

$('adminLoginBtn').addEventListener('click',loginAdmin);$('adminLogoutBtn').addEventListener('click',logoutAdmin);$('createDrawForm').addEventListener('submit',createDraw);$('editDrawForm').addEventListener('submit',saveEdit);$('closeEditDialog').onclick=()=>$('editDrawDialog').close();$('cancelEditBtn').onclick=()=>$('editDrawDialog').close();$('settingsForm').addEventListener('submit',saveSettings);$('ticketDrawFilter').addEventListener('change',renderTickets);$('refreshEventsBtn').onclick=()=>refresh('Events refreshed.');$('refreshAuditBtn').onclick=()=>refresh('Audit log refreshed.');setupNav();

if(await requireAdmin()){await loadData();setCreateDefaults();}
