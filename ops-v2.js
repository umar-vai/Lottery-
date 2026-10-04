(function(){
'use strict';
var BASE='https://mwtlsnneooxmryondrex.supabase.co',KEY='sb_publishable_zfXYDH1qSZURp8bRHgnBrQ_7t7-3BMd',REF='mwtlsnneooxmryondrex';
var S={session:null,user:null,profile:null,draws:[],tickets:[],profiles:[],settings:null,audit:[],timer:null};
function $(i){return document.getElementById(i)}
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function note(m,e){var t=$('toast');t.textContent=m;t.className=e?'err':'';t.style.display='block';clearTimeout(t._h);t._h=setTimeout(function(){t.style.display='none'},3800)}
function sess(){try{var s=JSON.parse(localStorage.getItem('sb-'+REF+'-auth-token')||'null');if(s&&s.access_token)return s;if(s&&s.currentSession&&s.currentSession.access_token)return s.currentSession;return null}catch(e){return null}}
function req(path,opt){opt=opt||{};var h=opt.headers||{};h.apikey=KEY;if(S.session)h.Authorization='Bearer '+S.session.access_token;if(opt.body)h['Content-Type']='application/json';return fetch(BASE+path,Object.assign({},opt,{headers:h})).then(function(r){return r.text().then(function(tx){var d;try{d=tx?JSON.parse(tx):null}catch(e){d=tx}if(!r.ok)throw new Error((d&&d.message)||(d&&d.error_description)||(d&&d.error)||('HTTP '+r.status));return d})})}
function rest(p,o){return req('/rest/v1/'+p,o)}
function rpc(n,a){return rest('rpc/'+n,{method:'POST',body:JSON.stringify(a||{})})}
function money(v){v=Number(v||0);if(v>=1e9)return '$'+(v/1e9).toFixed(v%1e9?1:0)+'B';if(v>=1e6)return '$'+(v/1e6).toFixed(v%1e6?1:0)+'M';return '$'+v.toLocaleString()}
function fmt(v){return v?new Date(v).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'—'}
function localInput(v){if(!v)return'';var d=new Date(v);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16)}
function iso(v){return v?new Date(v).toISOString():null}
function pmap(){var m={};S.profiles.forEach(function(p){m[p.id]=p});return m}
function dmap(){var m={};S.draws.forEach(function(d){m[d.id]=d});return m}
function count(id){return S.tickets.filter(function(t){return t.draw_id===id}).length}
function active(){var pr={drawing:0,locked:1,open:2,paused:3,scheduled:4};return S.draws.filter(function(d){return pr[d.status]!=null}).sort(function(a,b){return pr[a.status]-pr[b.status]||new Date(a.draw_at)-new Date(b.draw_at)})[0]||null}
function statusLabel(s){return String(s||'—').toUpperCase()}
function btn(label,cls,fn){var b=document.createElement('button');b.type='button';b.textContent=label;b.className='btn '+(cls||'ghost')+' compact';b.onclick=fn;return b}
function run(n,a,msg){return rpc(n,a).then(function(){note(msg||'Updated');return load()}).catch(function(e){note(e.message,true);throw e})}

function boot(){
  S.session=sess();
  if(!S.session){$('gateMsg').textContent='No active Google session found. Open the public site, sign in, then return here.';return}
  req('/auth/v1/user').then(function(u){S.user=u;return rest('profiles?select=id,display_name,email,role&id=eq.'+encodeURIComponent(u.id)+'&limit=1')}).then(function(a){
    var p=a&&a[0];if(!p)throw new Error('Profile not found');if(p.role!=='admin')throw new Error('This account is not an admin');S.profile=p;
    $('adminName').textContent=p.display_name||'Admin';$('adminEmail').textContent=p.email||'';
    $('gate').style.display='none';$('app').hidden=false;return load();
  }).catch(function(e){$('gateMsg').textContent='Admin check failed: '+e.message;note(e.message,true)})
}

function load(){
  return Promise.all([
    rest('draws?select=*&order=draw_number.desc&limit=100'),
    rest('tickets?select=id,user_id,draw_id,white_numbers,powerball,power_play,submitted_at&order=submitted_at.desc&limit=500'),
    rest('profiles?select=id,display_name,email,role,created_at&order=created_at.desc&limit=500'),
    rest('game_settings?select=*&id=eq.1&limit=1'),
    rest('audit_logs?select=*&order=created_at.desc&limit=100')
  ]).then(function(x){S.draws=x[0]||[];S.tickets=x[1]||[];S.profiles=x[2]||[];S.settings=(x[3]||[])[0]||null;S.audit=x[4]||[];render()}).catch(function(e){note('Load failed: '+e.message,true)})
}

function render(){renderStats();renderOverview();renderDraws();renderTickets();renderPlayers();renderSettings();renderAudit();startCountdown()}
function renderStats(){
  var d=active(),paused=!!(S.settings&&S.settings.system_paused);
  $('currentDraw').textContent=d?'#'+d.draw_number:'—';$('currentDrawMeta').textContent=d?(d.title||'Active event'):'No active draw';
  $('drawState').textContent=d?statusLabel(d.status):'—';$('drawStateMeta').textContent=d?fmt(d.draw_at):'Waiting';
  $('ticketCount').textContent=d?count(d.id):0;$('playerCount').textContent=S.profiles.length;$('jackpotStat').textContent=d?money(d.jackpot_amount):'—';
  var sb=$('systemBadge');sb.querySelector('span').textContent=paused?'PAUSED':'LIVE';sb.classList.toggle('paused',paused);
}
function startCountdown(){clearInterval(S.timer);function tick(){var d=active();if(!d){$('countdownStat').textContent='—';$('countdownMeta').textContent='Not scheduled';return}var target=new Date(d.draw_at).getTime(),s=Math.max(0,Math.floor((target-Date.now())/1000)),h=Math.floor(s/3600);s%=3600;var m=Math.floor(s/60),sec=s%60;$('countdownStat').textContent=h?String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+':'+String(sec).padStart(2,'0'):String(m).padStart(2,'0')+':'+String(sec).padStart(2,'0');$('countdownMeta').textContent=fmt(d.draw_at)}tick();S.timer=setInterval(tick,1000)}
function infoCard(k,v){return '<div class="info-card"><span>'+esc(k)+'</span><strong>'+esc(v)+'</strong></div>'}
function renderOverview(){
  var d=active();$('eventTitle').textContent=d?(d.title||('Draw #'+d.draw_number)):'No active draw';var st=$('eventStatus');st.textContent=d?statusLabel(d.status):'—';st.className='status-pill '+(d?d.status:'');
  $('eventInfo').innerHTML=d?[infoCard('Draw number','#'+d.draw_number),infoCard('Jackpot',money(d.jackpot_amount)),infoCard('Ticket cutoff',fmt(d.cutoff_at)),infoCard('Draw time',fmt(d.draw_at)),infoCard('Tickets',String(count(d.id))),infoCard('Power Play',d.power_play_multiplier?d.power_play_multiplier+'X':'Pending')].join(''):'<div class="info-card"><span>Status</span><strong>No active event</strong></div>';
  renderActions(d);renderTimeline($('overviewAudit'),S.audit.slice(0,8));
}
function renderActions(d){var c=$('eventActions');c.innerHTML='';if(!d){c.appendChild(btn('+ Create draw','primary',openCreate));return}if(['open','scheduled'].indexOf(d.status)>=0)c.appendChild(btn('Pause','ghost',function(){run('admin_pause_draw',{p_draw_id:d.id,p_paused:true},'Draw paused')}));if(d.status==='paused')c.appendChild(btn('Resume','primary',function(){run('admin_pause_draw',{p_draw_id:d.id,p_paused:false},'Draw resumed')}));if(['open','scheduled'].indexOf(d.status)>=0)c.appendChild(btn('Lock tickets','warn',function(){if(confirm('Lock ticket submissions now?'))run('admin_lock_draw',{p_draw_id:d.id},'Tickets locked')}));if(['open','locked','scheduled'].indexOf(d.status)>=0)c.appendChild(btn('Run draw now','primary',function(){if(confirm('Run the secure server draw now? Winning numbers cannot be chosen by admin.'))run('admin_run_draw_now',{p_draw_id:d.id},'Secure draw completed')}));if(['draft','scheduled','open','paused'].indexOf(d.status)>=0)c.appendChild(btn('Edit event','ghost',function(){openEdit(d)}));if(['completed','cancelled','drawing'].indexOf(d.status)<0)c.appendChild(btn('Cancel','danger',function(){if(confirm('Cancel this draw?'))run('admin_cancel_draw',{p_draw_id:d.id,p_reason:'Admin cancelled'},'Draw cancelled')}))}

function renderDraws(){
  $('drawSummary').textContent=S.draws.length+' draws';var root=$('drawList');root.innerHTML='';
  if(!S.draws.length){root.innerHTML='<p class="muted-pill">No draws yet.</p>';return}
  S.draws.forEach(function(d){var row=document.createElement('div');row.className='record-card';var left=document.createElement('div');left.className='record-main';left.innerHTML='<div class="record-title"><strong>#'+d.draw_number+' · '+esc(d.title||'Untitled draw')+'</strong><span class="status-pill '+d.status+'">'+statusLabel(d.status)+'</span></div><div class="record-meta"><span>'+esc(fmt(d.draw_at))+'</span><span>'+money(d.jackpot_amount)+'</span><span>'+count(d.id)+' tickets</span></div>';var actions=document.createElement('div');actions.className='record-actions';
    if(['draft','scheduled','open','paused'].indexOf(d.status)>=0)actions.appendChild(btn('Edit','ghost',function(){openEdit(d)}));if(d.status==='draft')actions.appendChild(btn('Publish','primary',function(){run('admin_publish_draft',{p_draw_id:d.id},'Draft published')}));if(['scheduled','open'].indexOf(d.status)>=0)actions.appendChild(btn('Pause','ghost',function(){run('admin_pause_draw',{p_draw_id:d.id,p_paused:true},'Draw paused')}));if(d.status==='paused')actions.appendChild(btn('Resume','primary',function(){run('admin_pause_draw',{p_draw_id:d.id,p_paused:false},'Draw resumed')}));if(['scheduled','open'].indexOf(d.status)>=0)actions.appendChild(btn('Lock','warn',function(){if(confirm('Lock this draw?'))run('admin_lock_draw',{p_draw_id:d.id},'Draw locked')}));if(['scheduled','open','locked'].indexOf(d.status)>=0)actions.appendChild(btn('Run','primary',function(){if(confirm('Run secure draw now?'))run('admin_run_draw_now',{p_draw_id:d.id},'Draw completed')}));if(['completed','cancelled','drawing'].indexOf(d.status)<0)actions.appendChild(btn('Cancel','danger',function(){if(confirm('Cancel this draw?'))run('admin_cancel_draw',{p_draw_id:d.id,p_reason:'Admin cancelled'},'Draw cancelled')}));row.appendChild(left);row.appendChild(actions);root.appendChild(row)
  })
}

function renderTickets(){
  var filter=$('ticketDrawFilter'),prev=filter.value||'all';filter.innerHTML='<option value="all">All draws</option>'+S.draws.map(function(d){return '<option value="'+d.id+'">Draw #'+d.draw_number+'</option>'}).join('');if(Array.prototype.some.call(filter.options,function(o){return o.value===prev}))filter.value=prev;
  var chosen=filter.value||'all',rows=S.tickets.filter(function(t){return chosen==='all'||t.draw_id===chosen}),pm=pmap(),dm=dmap();$('ticketSummary').textContent=rows.length+' tickets';var root=$('ticketList');root.innerHTML='';
  if(!rows.length){root.innerHTML='<div class="record-card"><div class="record-main"><strong>No tickets found</strong><div class="record-meta"><span>Tickets will appear here after submission.</span></div></div></div>';return}
  rows.forEach(function(t){var p=pm[t.user_id]||{},d=dm[t.draw_id]||{},r=document.createElement('div');r.className='record-card';r.innerHTML='<div class="record-main"><div class="record-title"><strong>'+esc(p.display_name||'Player')+'</strong><span class="status-pill">DRAW #'+esc(d.draw_number||'—')+'</span></div><div class="record-meta"><span class="number-line">'+esc((t.white_numbers||[]).map(function(n){return String(n).padStart(2,'0')}).join(' '))+' <b class="pb">+ '+String(t.powerball).padStart(2,'0')+'</b></span><span>'+(t.power_play?'Power Play':'Standard')+'</span></div></div><div class="record-meta"><span>'+esc(fmt(t.submitted_at))+'</span></div>';root.appendChild(r)})
}

function renderPlayers(){
  var root=$('playerList');root.innerHTML='';S.profiles.forEach(function(p){var row=document.createElement('div');row.className='record-card';var left=document.createElement('div');left.className='record-main';left.innerHTML='<div class="record-title"><strong>'+esc(p.display_name||'Player')+'</strong><span class="status-pill">'+esc((p.role||'player').toUpperCase())+'</span></div><div class="record-meta"><span>'+esc(p.email||'')+'</span><span>Joined '+esc(fmt(p.created_at))+'</span></div>';var s=document.createElement('select');s.className='role-select';s.innerHTML='<option value="player">Player</option><option value="admin">Admin</option>';s.value=p.role;s.disabled=S.user&&p.id===S.user.id;s.onchange=function(){run('admin_set_user_role',{p_user_id:p.id,p_role:s.value},'User role updated')};row.appendChild(left);row.appendChild(s);root.appendChild(row)})
}
function renderSettings(){var s=S.settings;if(!s)return;$('sStart').value=Number(s.starting_jackpot);$('sRoll').value=Number(s.rollover_increment);$('sInterval').value=s.draw_interval_minutes;$('sCutoff').value=s.ticket_cutoff_seconds;$('sPower').checked=!!s.power_play_enabled;$('sNext').checked=!!s.auto_create_next_draw;$('sPause').checked=!!s.system_paused}
function renderTimeline(root,items){var pm=pmap();root.innerHTML='';if(!items.length){root.innerHTML='<div class="record-meta"><span>No admin activity yet.</span></div>';return}items.forEach(function(a){var el=document.createElement('div');el.className='timeline-item';el.innerHTML='<i class="timeline-dot"></i><div><strong>'+esc(String(a.action||'activity').replace(/_/g,' '))+'</strong><small>'+esc((pm[a.actor_user_id]||{}).display_name||'System')+(a.entity_type?' · '+esc(a.entity_type):'')+'</small></div><time>'+esc(fmt(a.created_at))+'</time>';root.appendChild(el)})}
function renderAudit(){renderTimeline($('auditList'),S.audit)}

function openCreate(){var now=Date.now(),draw=new Date(now+11*60000),cut=new Date(now+10*60000),open=new Date(now+60000);$('editDrawId').value='';$('drawDialogEyebrow').textContent='CREATE DRAW';$('drawDialogTitle').textContent='New event';$('saveDrawBtn').textContent='Create draw';$('draftWrap').style.display='flex';$('drawTitleInput').value='New Draw';$('drawOpenInput').value=localInput(open);$('drawCutoffInput').value=localInput(cut);$('drawTimeInput').value=localInput(draw);$('drawJackpotInput').value=Number(S.settings&&S.settings.starting_jackpot||20000000);$('drawDraftInput').checked=false;$('drawDialog').showModal()}
function openEdit(d){$('editDrawId').value=d.id;$('drawDialogEyebrow').textContent='EDIT DRAW';$('drawDialogTitle').textContent='Draw #'+d.draw_number;$('saveDrawBtn').textContent='Save changes';$('draftWrap').style.display='none';$('drawTitleInput').value=d.title||'';$('drawOpenInput').value=localInput(d.opens_at);$('drawCutoffInput').value=localInput(d.cutoff_at);$('drawTimeInput').value=localInput(d.draw_at);$('drawJackpotInput').value=Number(d.jackpot_amount);$('drawDialog').showModal()}
function saveDraw(e){e.preventDefault();var id=$('editDrawId').value,args={p_title:$('drawTitleInput').value,p_opens_at:iso($('drawOpenInput').value),p_cutoff_at:iso($('drawCutoffInput').value),p_draw_at:iso($('drawTimeInput').value),p_jackpot:Number($('drawJackpotInput').value)};var promise=id?rpc('admin_update_draw',Object.assign({p_draw_id:id},args)):rpc('admin_create_draw',Object.assign(args,{p_draft:$('drawDraftInput').checked}));promise.then(function(){$('drawDialog').close();note(id?'Draw updated':'Draw created');load()}).catch(function(err){note(err.message,true)})}

function tabTo(id){document.querySelectorAll('.tabs button').forEach(function(x){x.classList.toggle('active',x.getAttribute('data-tab')===id)});document.querySelectorAll('.tab').forEach(function(x){x.classList.toggle('active',x.id===id)});window.scrollTo({top:Math.max(0,$('app').offsetTop-70),behavior:'smooth'})}
function bind(){
  $('retryBtn').onclick=boot;$('newDrawTop').onclick=openCreate;$('heroNewDraw').onclick=openCreate;$('createDrawBtn').onclick=openCreate;$('closeDrawDialog').onclick=function(){$('drawDialog').close()};$('cancelDrawDialog').onclick=function(){$('drawDialog').close()};$('drawForm').onsubmit=saveDraw;
  $('refreshOverview').onclick=function(){load().then(function(){note('Dashboard refreshed')})};$('refreshDraws').onclick=function(){load().then(function(){note('Draws refreshed')})};$('refreshAudit').onclick=function(){load().then(function(){note('Audit refreshed')})};$('ticketDrawFilter').onchange=renderTickets;
  document.querySelectorAll('.tabs button').forEach(function(b){b.onclick=function(){tabTo(b.getAttribute('data-tab'))}});
  $('settingsForm').onsubmit=function(e){e.preventDefault();run('admin_update_game_settings',{p_starting_jackpot:Number($('sStart').value),p_rollover_increment:Number($('sRoll').value),p_draw_interval_minutes:Number($('sInterval').value),p_ticket_cutoff_seconds:Number($('sCutoff').value),p_power_play_enabled:$('sPower').checked,p_auto_create_next_draw:$('sNext').checked,p_system_paused:$('sPause').checked},'Settings saved')};
}
bind();boot();
})();