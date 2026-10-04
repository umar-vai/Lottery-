(function(){
'use strict';

var BASE='https://mwtlsnneooxmryondrex.supabase.co';
var KEY='sb_publishable_zfXYDH1qSZURp8bRHgnBrQ_7t7-3BMd';
var REF='mwtlsnneooxmryondrex';
var S={session:null,user:null,profile:null,events:[],tickets:[],tiers:[],profiles:[],ledger:[],audit:[],editing:null,balanceUser:null,timer:null};

function $(id){return document.getElementById(id)}
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function credits(v){return Number(v||0).toLocaleString(undefined,{maximumFractionDigits:2})+' cr'}
function fmt(v){return v?new Date(v).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'—'}
function localInput(v){if(!v)return'';var d=new Date(v);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16)}
function slugify(v){return String(v||'').toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'')}
function nullableInt(id){var raw=$(id).value.trim();if(!raw)return null;var n=Number(raw);if(!Number.isInteger(n)||n<1)throw new Error($(id).previousElementSibling?$(id).previousElementSibling.textContent+' must be a positive whole number':'Invalid limit');return n}
function session(){try{var x=JSON.parse(localStorage.getItem('sb-'+REF+'-auth-token')||'null');if(x&&x.access_token)return x;if(x&&x.currentSession&&x.currentSession.access_token)return x.currentSession;if(x&&x.session&&x.session.access_token)return x.session;return null}catch(e){return null}}
function req(path,opt){opt=opt||{};var h=Object.assign({},opt.headers||{});h.apikey=KEY;if(S.session)h.Authorization='Bearer '+S.session.access_token;if(opt.body)h['Content-Type']='application/json';return fetch(BASE+path,Object.assign({},opt,{headers:h})).then(function(r){return r.text().then(function(t){var d;try{d=t?JSON.parse(t):null}catch(e){d=t}if(!r.ok)throw new Error((d&&d.message)||(d&&d.error_description)||(d&&d.error)||('HTTP '+r.status));return d})})}
function rest(path,opt){return req('/rest/v1/'+path,opt)}
function rpc(name,args){return rest('rpc/'+name,{method:'POST',body:JSON.stringify(args||{})})}
function safe(p,fallback){return p.catch(function(e){console.warn(e);return fallback})}
function note(m,e){var t=$('toast');if(!t)return;t.textContent=m;t.className=e?'err':'';t.style.display='block';clearTimeout(t._h);t._h=setTimeout(function(){t.style.display='none'},4200)}
function capacity(v){return v==null?'Unlimited':Number(v).toLocaleString()}

function statusView(e){
  if(!e)return'none';
  if(e.status==='draft'||e.status==='completed'||e.status==='cancelled')return e.status;
  var n=Date.now();
  if(e.opens_at&&n<new Date(e.opens_at).getTime())return'upcoming';
  if(e.schedule_mode==='manual')return'open';
  if(e.cutoff_at&&n<new Date(e.cutoff_at).getTime())return'open';
  if(e.draw_at&&n<new Date(e.draw_at).getTime())return'locked';
  return'awaiting';
}
function statusLabel(e){var s=statusView(e);return s==='awaiting'?'AWAITING DRAW':s.toUpperCase()}
function pmap(){var m={};S.profiles.forEach(function(p){m[p.id]=p});return m}
function emap(){var m={};S.events.forEach(function(e){m[e.id]=e});return m}
function ticketsFor(id){return S.tickets.filter(function(t){return t.event_id===id})}
function ticketCount(id){return ticketsFor(id).length}
function playerCount(id){var x={};ticketsFor(id).forEach(function(t){x[t.user_id]=1});return Object.keys(x).length}
function tiersFor(id){return S.tiers.filter(function(t){return t.event_id===id}).sort(function(a,b){return a.rank-b.rank})}
function prizesFor(id){var p=tiersFor(id).map(function(t){return Number(t.prize_amount||0)});return p.length?p:[0]}
function scheduleLabel(e){return e.schedule_mode==='manual'?'Manual · open until admin draw':fmt(e.draw_at)}
function nextEvent(){return S.events.filter(function(e){return e.status==='published'}).sort(function(a,b){var sa=statusView(a)==='open'?0:statusView(a)==='locked'?1:statusView(a)==='upcoming'?2:3,sb=statusView(b)==='open'?0:statusView(b)==='locked'?1:statusView(b)==='upcoming'?2:3;if(sa!==sb)return sa-sb;if(a.schedule_mode==='manual'&&b.schedule_mode!=='manual')return-1;if(b.schedule_mode==='manual'&&a.schedule_mode!=='manual')return 1;return (a.draw_at?new Date(a.draw_at).getTime():Infinity)-(b.draw_at?new Date(b.draw_at).getTime():Infinity)})[0]||null}
function button(label,cls,fn){var b=document.createElement('button');b.type='button';b.className='btn '+(cls||'ghost')+' compact';b.textContent=label;b.onclick=fn;return b}
function info(k,v){return '<div class="info-card"><span>'+esc(k)+'</span><strong>'+esc(v)+'</strong></div>'}
function numbersHtml(t){var h='<div class="number-chips">';(t.white_numbers||[]).forEach(function(n){h+='<span>'+String(n).padStart(2,'0')+'</span>'});if(t.bonus_ball!=null)h+='<span class="bonus">'+String(t.bonus_ball).padStart(2,'0')+'</span>';return h+'</div>'}

function boot(){
  S.session=session();
  if(!S.session){$('gateMsg').textContent='No active Google session. Sign in on the public site, then return here.';return}
  if(window.Draw01Shell)window.Draw01Shell.setSession(S.session);
  req('/auth/v1/user').then(function(u){
    S.user=u;
    return rest('profiles?select=id,display_name,email,role,balance,avatar_url&id=eq.'+encodeURIComponent(u.id)+'&limit=1');
  }).then(function(rows){
    var p=rows&&rows[0];
    if(!p)throw new Error('Profile not found');
    if(p.role!=='admin')throw new Error('This account is not an admin');
    S.profile=p;
    if(window.Draw01Shell){window.Draw01Shell.setSession(S.session);window.Draw01Shell.setBalance(p.balance||0)}
    $('gate').style.display='none';
    $('app').hidden=false;
    return load();
  }).catch(function(e){$('gateMsg').textContent='Admin check failed: '+e.message;note(e.message,true)})
}

function load(){
  return Promise.all([
    safe(rest('lottery_events?select=*&order=created_at.desc&limit=500'),[]),
    safe(rest('event_tickets?select=id,event_id,user_id,white_numbers,bonus_ball,price_paid,is_winner,winner_rank,prize_awarded,created_at&order=created_at.desc&limit=5000'),[]),
    safe(rest('event_prize_tiers?select=event_id,rank,prize_amount&order=event_id,rank&limit=5000'),[]),
    safe(rest('profiles?select=id,display_name,email,role,balance,created_at&order=created_at.desc&limit=1000'),[]),
    safe(rest('balance_ledger?select=*&order=created_at.desc&limit=2000'),[]),
    safe(rest('audit_logs?select=*&order=created_at.desc&limit=500'),[])
  ]).then(function(x){
    S.events=x[0]||[];S.tickets=x[1]||[];S.tiers=x[2]||[];S.profiles=x[3]||[];S.ledger=x[4]||[];S.audit=x[5]||[];
    render();
  }).catch(function(e){note('Dashboard load failed: '+e.message,true)})
}

function render(){renderStats();renderOverview();renderEvents();renderPlayers();renderLedger();renderAudit();startCountdown()}
function renderStats(){
  var open=S.events.filter(function(e){return statusView(e)==='open'}).length;
  var totalCredits=S.profiles.reduce(function(a,p){return a+Number(p.balance||0)},0);
  var n=nextEvent();
  $('statEvents').textContent=S.events.length;
  $('statOpen').textContent=open;
  $('statTickets').textContent=S.tickets.length;
  $('statPlayers').textContent=S.profiles.length;
  $('statCredits').textContent=Number(totalCredits).toLocaleString(undefined,{maximumFractionDigits:0});
  if(!n){$('statNext').textContent='—';$('statNextMeta').textContent='Not scheduled'}
  else if(n.schedule_mode==='manual'){$('statNext').textContent='MANUAL';$('statNextMeta').textContent=n.title+' · '+ticketCount(n.id)+' tickets'}
  else{$('statNext').textContent='…';$('statNextMeta').textContent=n.title+' · '+fmt(n.draw_at)}
}
function startCountdown(){
  clearInterval(S.timer);
  function tick(){
    var e=nextEvent();
    if(!e){$('statNext').textContent='—';$('statNextMeta').textContent='Not scheduled';return}
    if(e.schedule_mode==='manual'){$('statNext').textContent='MANUAL';$('statNextMeta').textContent=e.title+' · '+ticketCount(e.id)+' tickets';return}
    var target=new Date(e.draw_at).getTime(),sec=Math.max(0,Math.floor((target-Date.now())/1000)),d=Math.floor(sec/86400);sec%=86400;var h=Math.floor(sec/3600);sec%=3600;var m=Math.floor(sec/60),s=sec%60;
    $('statNext').textContent=d?d+'d '+String(h).padStart(2,'0')+'h':h?String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0'):String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');
    $('statNextMeta').textContent=e.title+' · '+fmt(e.draw_at);
  }
  tick();S.timer=setInterval(tick,1000)
}
function renderOverview(){
  var e=nextEvent(),root=$('focusInfo'),actions=$('focusActions'),st=$('focusStatus');actions.innerHTML='';
  if(!e){$('focusTitle').textContent='No published event';st.textContent='—';st.className='status-pill';root.innerHTML='<div class="overview-empty">Create or publish an event to make it available to players.</div>';actions.appendChild(button('+ Create event','primary',openCreate));renderTimeline($('overviewAudit'),S.audit.slice(0,8));return}
  $('focusTitle').textContent=e.title;st.textContent=statusLabel(e);st.className='status-pill '+statusView(e);
  root.innerHTML=[
    info('Ticket price',credits(e.ticket_price)),
    info('Total prizes',credits(e.prize_amount)),
    info('Tickets',ticketCount(e.id)+' / '+capacity(e.max_total_tickets)),
    info('Players',playerCount(e.id)+' / '+capacity(e.max_players)),
    info('Per-player limit',String(e.max_tickets_per_user)),
    info('Winners',String(e.winner_count||1)),
    info('Draw',scheduleLabel(e))
  ].join('');
  appendEventActions(actions,e);renderTimeline($('overviewAudit'),S.audit.slice(0,8));
}

function canRun(e){if(e.status!=='published')return false;if(ticketCount(e.id)<Number(e.winner_count||1))return false;if(e.schedule_mode==='manual')return true;return !e.cutoff_at||Date.now()>=new Date(e.cutoff_at).getTime()}
function appendEventActions(root,e){
  root.appendChild(button('View public page','ghost',function(){window.open('event.html?e='+encodeURIComponent(e.slug),'_blank')}));
  if(e.status!=='completed')root.appendChild(button('Edit','ghost',function(){openEdit(e)}));
  if(e.status==='draft')root.appendChild(button('Publish','primary',function(){changeStatus(e,'published')}));
  if(canRun(e))root.appendChild(button('Run draw','primary',function(){runEvent(e)}));
  if(e.status==='published'||e.status==='draft')root.appendChild(button('Cancel','danger',function(){changeStatus(e,'cancelled')}));
  if((e.status==='draft'||e.status==='cancelled')&&ticketCount(e.id)===0)root.appendChild(button('Delete','danger',function(){deleteEvent(e)}));
}
function prizeTierHtml(e){var ts=tiersFor(e.id);if(!ts.length)return'<div class="empty-sub">No prize tiers configured.</div>';return'<div class="tier-strip">'+ts.map(function(t){return'<div><span>#'+t.rank+'</span><strong>'+credits(t.prize_amount)+'</strong></div>'}).join('')+'</div>'}
function participantHtml(e){
  var ts=ticketsFor(e.id),pm=pmap();if(!ts.length)return'<div class="empty-sub">No tickets in this event yet.</div>';
  var groups={};ts.forEach(function(t){(groups[t.user_id]||(groups[t.user_id]=[])).push(t)});
  return Object.keys(groups).map(function(uid){var p=pm[uid]||{},arr=groups[uid];return'<div class="participant-card"><div class="participant-head"><div><strong>'+esc(p.display_name||p.email||'Player')+'</strong><span>'+arr.length+' ticket'+(arr.length===1?'':'s')+'</span></div><span class="credit-balance">'+credits(p.balance||0)+'</span></div><div class="participant-tickets">'+arr.map(function(t){return'<div class="ticket-line"><div><b>Ticket '+esc(String(t.id).slice(0,8))+'</b>'+(t.is_winner?'<span class="winner-rank">#'+t.winner_rank+' WINNER</span>':'')+'</div>'+numbersHtml(t)+'<div class="ticket-meta"><span>'+credits(t.price_paid)+'</span><span>'+esc(fmt(t.created_at))+'</span>'+(t.is_winner?'<strong>'+credits(t.prize_awarded)+' prize</strong>':'')+'</div></div>'}).join('')+'</div></div>'}).join('')
}
function capacityProgress(current,max){if(max==null)return'<span>'+current+' / Unlimited</span>';var pct=Math.min(100,Math.round((current/Math.max(1,Number(max)))*100));return'<span>'+current+' / '+Number(max).toLocaleString()+'</span><i><b style="width:'+pct+'%"></b></i>'}
function renderEvents(){
  var f=$('eventStatusFilter').value||'all',rows=S.events.filter(function(e){return f==='all'||e.status===f}),root=$('eventList');
  var openIds={};root.querySelectorAll('details[open]').forEach(function(d){openIds[d.dataset.id]=true});
  $('eventSummary').textContent=rows.length+' events · '+S.tickets.length+' tickets';root.innerHTML='';
  if(!rows.length){root.innerHTML='<div class="empty-sub">No events found.</div>';return}
  rows.forEach(function(e){
    var tc=ticketCount(e.id),pc=playerCount(e.id),need=Math.max(0,Number(e.winner_count||1)-tc);
    var d=document.createElement('details');d.className='event-accordion';d.dataset.id=e.id;if(openIds[e.id])d.open=true;
    d.innerHTML='<summary><div class="event-accordion-main"><div class="event-title-line"><strong>'+esc(e.title)+'</strong><span class="status-pill '+statusView(e)+'">'+esc(statusLabel(e))+'</span></div><div class="event-summary-meta"><span>'+tc+' tickets</span><span>'+pc+' players</span><span>'+Number(e.winner_count||1)+' winners</span><span>'+esc(scheduleLabel(e))+'</span></div></div><span class="accordion-chevron">⌄</span></summary>'+
      '<div class="event-accordion-body">'+
        '<div class="capacity-grid"><div class="capacity-card"><small>PLAYERS</small><strong>'+pc+' / '+capacity(e.max_players)+'</strong>'+capacityProgress(pc,e.max_players)+'</div><div class="capacity-card"><small>TOTAL TICKETS</small><strong>'+tc+' / '+capacity(e.max_total_tickets)+'</strong>'+capacityProgress(tc,e.max_total_tickets)+'</div><div class="capacity-card"><small>PER PLAYER</small><strong>'+e.max_tickets_per_user+'</strong><span>Maximum tickets each player can hold</span></div></div>'+
        '<div class="event-detail-grid">'+info('Ticket price',credits(e.ticket_price))+info('Total prizes',credits(e.prize_amount))+info('Winners',String(e.winner_count||1))+info('Number rules',e.white_ball_count+' / '+e.white_ball_max+(e.bonus_ball_enabled?' + 1 / '+e.bonus_ball_max:''))+info('Opens',fmt(e.opens_at))+info('Schedule',e.schedule_mode==='manual'?'Manual / unlimited':'Scheduled')+'</div>'+
        '<div class="section-label">Prize ranking</div>'+prizeTierHtml(e)+
        (need?'<div class="draw-readiness">Need '+need+' more ticket'+(need===1?'':'s')+' before '+e.winner_count+' configured winner'+(e.winner_count===1?'':'s')+' can be drawn.</div>':'<div class="draw-readiness ready">Ticket pool is large enough for this draw.</div>')+
        '<div class="record-actions event-inline-actions" id="act-'+e.id+'"></div>'+
        '<div class="event-pool-head"><div><span class="eyebrow">TICKET POOL</span><h3>'+pc+' players · '+tc+' tickets</h3></div><span>Winners are selected only from these tickets.</span></div><div class="participant-list">'+participantHtml(e)+'</div></div>';
    root.appendChild(d);appendEventActions(d.querySelector('#act-'+e.id),e)
  })
}

function renderPlayers(){
  var root=$('playerList');root.innerHTML='';
  if(!S.profiles.length){root.innerHTML='<div class="record-card"><strong>No users yet</strong></div>';return}
  S.profiles.forEach(function(p){
    var row=document.createElement('div');row.className='record-card';
    var main=document.createElement('div');main.className='record-main';
    main.innerHTML='<div class="record-title"><strong>'+esc(p.display_name||'Player')+'</strong><span class="status-pill">'+esc((p.role||'player').toUpperCase())+'</span></div><div class="record-meta"><span>'+esc(p.email||'')+'</span><span class="credit-balance">'+credits(p.balance)+'</span><span>Joined '+esc(fmt(p.created_at))+'</span></div>';
    var a=document.createElement('div');a.className='record-actions';a.appendChild(button('Set balance','primary',function(){openBalance(p)}));
    var role=document.createElement('select');role.className='role-select';role.innerHTML='<option value="player">Player</option><option value="admin">Admin</option>';role.value=p.role;role.disabled=S.user&&p.id===S.user.id;
    role.onchange=function(){rpc('admin_set_user_role',{p_user_id:p.id,p_role:role.value}).then(function(){note('Role updated');return load()}).catch(function(e){note(e.message,true)})};
    a.appendChild(role);row.appendChild(main);row.appendChild(a);root.appendChild(row)
  })
}
function renderLedger(){
  var sel=$('ledgerUserFilter'),prev=sel.value||'all';sel.innerHTML='<option value="all">All players</option>'+S.profiles.map(function(p){return'<option value="'+p.id+'">'+esc(p.display_name||p.email||'Player')+'</option>'}).join('');
  if(Array.prototype.some.call(sel.options,function(o){return o.value===prev}))sel.value=prev;
  var rows=S.ledger.filter(function(x){return sel.value==='all'||x.user_id===sel.value}),pm=pmap(),em=emap(),root=$('ledgerList');$('ledgerSummary').textContent=rows.length+' entries';root.innerHTML='';
  if(!rows.length){root.innerHTML='<div class="record-card"><strong>No balance movements yet</strong></div>';return}
  rows.forEach(function(x){var p=pm[x.user_id]||{},e=em[x.event_id]||{},r=document.createElement('div');r.className='record-card';var amount=Number(x.amount||0);r.innerHTML='<div class="record-main"><div class="record-title"><strong>'+esc(p.display_name||p.email||'Player')+'</strong><span class="status-pill">'+esc(String(x.entry_type||'entry').replace(/_/g,' ').toUpperCase())+'</span></div><div class="record-meta"><span class="ledger-amount '+(amount>=0?'plus':'minus')+'">'+(amount>=0?'+':'')+credits(amount)+'</span><span>Balance '+credits(x.balance_after)+'</span>'+(e.title?'<span>'+esc(e.title)+'</span>':'')+(x.note?'<span>'+esc(x.note)+'</span>':'')+'<span>'+esc(fmt(x.created_at))+'</span></div></div>';root.appendChild(r)})
}
function renderTimeline(root,rows){root.innerHTML='';var pm=pmap();if(!rows.length){root.innerHTML='<div class="overview-empty">No activity yet.</div>';return}rows.forEach(function(a){var el=document.createElement('div');el.className='timeline-item';el.innerHTML='<i class="timeline-dot"></i><div><strong>'+esc(String(a.action||'activity').replace(/_/g,' '))+'</strong><small>'+esc((pm[a.actor_user_id]||{}).display_name||'System')+(a.entity_type?' · '+a.entity_type:'')+'</small></div><time>'+esc(fmt(a.created_at))+'</time>';root.appendChild(el)})}
function renderAudit(){renderTimeline($('auditList'),S.audit)}

function defaults(){var n=Date.now();return{open:new Date(n+5*60000),cut:new Date(n+65*60000),draw:new Date(n+70*60000)}}
function setLockedFields(locked){['fPrice','fWhiteCount','fWhiteMax','fBonusEnabled','fBonusMax'].forEach(function(id){if($(id))$(id).disabled=!!locked});$('eventFormHint').textContent=locked?'Ticket price and number rules are locked because this event already has tickets. Capacity limits, prizes and schedule may still be increased or adjusted within current usage.':'';$('eventFormHint').className='form-hint'+(locked?' warn':'')}
function syncBonusField(){if(!$('fBonusEnabled').disabled)$('fBonusMax').disabled=!$('fBonusEnabled').checked}
function syncSchedule(){var manual=$('fScheduleMode').value==='manual';document.querySelectorAll('.schedule-only').forEach(function(x){x.style.display=manual?'none':''});$('fCutoff').required=!manual;$('fDraw').required=!manual}
function renderPrizeFields(values){
  var count=Math.max(1,Math.min(100,Number($('fWinnerCount').value)||1)),root=$('winnerPrizeFields'),old=values||Array.from(root.querySelectorAll('input')).map(function(x){return Number(x.value||0)});root.innerHTML='';
  for(var i=0;i<count;i++){var label=document.createElement('label');label.className='winner-prize-field';label.innerHTML='<span>Winner #'+(i+1)+'</span><input type="number" min="0" step="1" value="'+Number(old[i]!=null?old[i]:(i===0?1000:0))+'" data-rank="'+(i+1)+'" required>';root.appendChild(label)}
  root.querySelectorAll('input').forEach(function(x){x.oninput=syncPrizeTotal});syncPrizeTotal()
}
function syncPrizeTotal(){var total=Array.from($('winnerPrizeFields').querySelectorAll('input')).reduce(function(a,x){return a+Number(x.value||0)},0);$('prizeTotal').textContent='Total: '+credits(total)}
function openCreate(){
  S.editing=null;var d=defaults();$('eventModalKicker').textContent='CREATE EVENT';$('eventModalTitle').textContent='New public event';$('saveEventBtn').textContent='Create event';
  $('fTitle').value='';$('fSlug').value='';delete $('fSlug').dataset.touched;$('fDescription').value='';$('fPrice').value=10;$('fLimit').value=5;$('fMaxPlayers').value='';$('fMaxTotalTickets').value='';$('fWhiteCount').value=5;$('fWhiteMax').value=69;$('fBonusEnabled').checked=true;$('fBonusMax').value=26;$('fScheduleMode').value='scheduled';$('fOpen').value=localInput(d.open);$('fCutoff').value=localInput(d.cut);$('fDraw').value=localInput(d.draw);$('fStatus').value='draft';$('fWinnerCount').value=1;
  setLockedFields(false);syncBonusField();syncSchedule();renderPrizeFields([1000]);$('eventDialog').showModal()
}
function openEdit(e){
  S.editing=e;$('eventModalKicker').textContent='EDIT EVENT';$('eventModalTitle').textContent=e.title;$('saveEventBtn').textContent='Save changes';
  $('fTitle').value=e.title||'';$('fSlug').value=e.slug||'';$('fSlug').dataset.touched='1';$('fDescription').value=e.description||'';$('fPrice').value=Number(e.ticket_price);$('fLimit').value=e.max_tickets_per_user;$('fMaxPlayers').value=e.max_players==null?'':e.max_players;$('fMaxTotalTickets').value=e.max_total_tickets==null?'':e.max_total_tickets;$('fWhiteCount').value=e.white_ball_count;$('fWhiteMax').value=e.white_ball_max;$('fBonusEnabled').checked=!!e.bonus_ball_enabled;$('fBonusMax').value=e.bonus_ball_max;$('fScheduleMode').value=e.schedule_mode||'scheduled';$('fOpen').value=localInput(e.opens_at);$('fCutoff').value=localInput(e.cutoff_at);$('fDraw').value=localInput(e.draw_at);$('fStatus').value=e.status==='completed'?'published':e.status;$('fWinnerCount').value=e.winner_count||prizesFor(e.id).length||1;
  setLockedFields(ticketCount(e.id)>0);syncBonusField();syncSchedule();renderPrizeFields(prizesFor(e.id));$('eventDialog').showModal()
}
function formArgs(){
  var manual=$('fScheduleMode').value==='manual';var open=$('fOpen').value?new Date($('fOpen').value):new Date();var cut=manual?null:new Date($('fCutoff').value),draw=manual?null:new Date($('fDraw').value);
  if(!isFinite(open))throw new Error('Opening date is invalid');
  if(!manual&&(!isFinite(cut)||!isFinite(draw)||open>=cut||cut>=draw))throw new Error('Schedule must be: opens → cutoff → draw');
  var maxPlayers=nullableInt('fMaxPlayers'),maxTotal=nullableInt('fMaxTotalTickets');
  var prizes=Array.from($('winnerPrizeFields').querySelectorAll('input')).map(function(x){return Number(x.value||0)});
  if(prizes.some(function(x){return !Number.isFinite(x)||x<0}))throw new Error('Winner prizes must be zero or greater');
  if(maxTotal!=null&&prizes.length>maxTotal)throw new Error('Winner count cannot be greater than Maximum Total Tickets');
  return{
    p_title:$('fTitle').value.trim(),p_slug:$('fSlug').value.trim()||slugify($('fTitle').value),p_description:$('fDescription').value.trim(),
    p_ticket_price:Number($('fPrice').value),p_max_tickets_per_user:Number($('fLimit').value),p_max_players:maxPlayers,p_max_total_tickets:maxTotal,
    p_white_ball_count:Number($('fWhiteCount').value),p_white_ball_max:Number($('fWhiteMax').value),p_bonus_ball_enabled:$('fBonusEnabled').checked,p_bonus_ball_max:Number($('fBonusMax').value||1),
    p_schedule_mode:$('fScheduleMode').value,p_opens_at:open.toISOString(),p_cutoff_at:manual?null:cut.toISOString(),p_draw_at:manual?null:draw.toISOString(),p_winner_prizes:prizes
  }
}
function saveEvent(ev){
  ev.preventDefault();var a;try{a=formArgs()}catch(e){note(e.message,true);return}
  var p;if(S.editing){a.p_event_id=S.editing.id;a.p_status=$('fStatus').value;p=rpc('admin_update_lottery_event_v3',a)}else{a.p_publish=$('fStatus').value==='published';p=rpc('admin_create_lottery_event_v3',a)}
  $('saveEventBtn').disabled=true;
  p.then(function(){$('eventDialog').close();note(S.editing?'Event updated':'Event created');S.editing=null;return load()}).catch(function(e){note(e.message,true)}).finally(function(){$('saveEventBtn').disabled=false})
}
function statusArgs(e,status){return{
  p_event_id:e.id,p_title:e.title,p_slug:e.slug,p_description:e.description||'',p_ticket_price:Number(e.ticket_price),p_max_tickets_per_user:e.max_tickets_per_user,
  p_max_players:e.max_players==null?null:Number(e.max_players),p_max_total_tickets:e.max_total_tickets==null?null:Number(e.max_total_tickets),
  p_white_ball_count:e.white_ball_count,p_white_ball_max:e.white_ball_max,p_bonus_ball_enabled:e.bonus_ball_enabled,p_bonus_ball_max:e.bonus_ball_max,
  p_schedule_mode:e.schedule_mode||'scheduled',p_opens_at:e.opens_at,p_cutoff_at:e.cutoff_at,p_draw_at:e.draw_at,p_winner_prizes:prizesFor(e.id),p_status:status
}}
function changeStatus(e,status){var msg=status==='cancelled'?'Cancel this event? Existing tickets remain recorded.':'Publish this event to the public site?';if(!confirm(msg))return;rpc('admin_update_lottery_event_v3',statusArgs(e,status)).then(function(){note('Event '+status);return load()}).catch(function(x){note(x.message,true)})}
function deleteEvent(e){if(!confirm('Permanently delete this event? This is only allowed when it has no tickets.'))return;rpc('admin_delete_lottery_event',{p_event_id:e.id}).then(function(){note('Event deleted');return load()}).catch(function(x){note(x.message,true)})}
function runEvent(e){
  var tc=ticketCount(e.id),wc=Number(e.winner_count||1);if(tc<wc){note('This event needs at least '+wc+' tickets before drawing '+wc+' winners.',true);return}
  if(!confirm('Run the secure ticket-pool draw now? Winners will be selected only from this event’s '+tc+' existing tickets.'))return;
  rpc('admin_run_lottery_event',{p_event_id:e.id}).then(function(){note('Event draw completed');return load()}).catch(function(x){note(x.message,true)})
}

function openBalance(p){S.balanceUser=p;$('balanceTitle').textContent=p.display_name||'Player';$('balanceEmail').textContent=(p.email||'')+' · Current '+credits(p.balance);$('balanceInput').value=Number(p.balance||0);$('balanceNote').value='';$('balanceDialog').showModal()}
function saveBalance(ev){ev.preventDefault();if(!S.balanceUser)return;var amount=Number($('balanceInput').value);if(!Number.isFinite(amount)||amount<0){note('Balance must be zero or greater',true);return}rpc('admin_set_user_balance',{p_user_id:S.balanceUser.id,p_balance:amount,p_note:$('balanceNote').value.trim()||'Admin balance adjustment'}).then(function(){$('balanceDialog').close();note('Balance updated');return load()}).catch(function(e){note(e.message,true)})}

function bind(){
  document.querySelectorAll('.tabs button').forEach(function(b){b.onclick=function(){document.querySelectorAll('.tabs button').forEach(function(x){x.classList.remove('active')});document.querySelectorAll('.tab').forEach(function(x){x.classList.remove('active')});b.classList.add('active');$(b.dataset.tab).classList.add('active')}});
  $('retryBtn').onclick=boot;
  if($('topCreate'))$('topCreate').onclick=openCreate;
  $('heroCreate').onclick=openCreate;$('createEventBtn').onclick=openCreate;$('refreshOverview').onclick=load;$('refreshAudit').onclick=load;$('eventStatusFilter').onchange=renderEvents;$('ledgerUserFilter').onchange=renderLedger;
  $('closeEventModal').onclick=$('cancelEventModal').onclick=function(){$('eventDialog').close()};$('eventForm').onsubmit=saveEvent;
  $('fTitle').oninput=function(){if(!S.editing&&!$('fSlug').dataset.touched)$('fSlug').value=slugify(this.value)};$('fSlug').oninput=function(){this.dataset.touched='1'};
  $('fBonusEnabled').onchange=syncBonusField;$('fScheduleMode').onchange=syncSchedule;$('fWinnerCount').oninput=function(){renderPrizeFields()};
  $('cancelBalance').onclick=function(){$('balanceDialog').close()};$('balanceForm').onsubmit=saveBalance;
}

bind();boot();
})();