(function(){
'use strict';

var BASE='https://mwtlsnneooxmryondrex.supabase.co';
var KEY='sb_publishable_zfXYDH1qSZURp8bRHgnBrQ_7t7-3BMd';
var REF='mwtlsnneooxmryondrex';
var S={
  events:[],eventsLoaded:false,
  players:[],playerCursor:null,playerMore:false,playersLoaded:false,playerBusy:false,
  tickets:[],ticketCursor:null,ticketMore:false,ticketsLoaded:false,ticketBusy:false,
  winners:[],winnerCursor:null,winnerMore:false,winnersLoaded:false,winnerBusy:false,
  ledger:[],ledgerCursor:null,ledgerMore:false,ledgerLoaded:false,ledgerBusy:false,
  timers:{}
};

function $(id){return document.getElementById(id)}
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function credits(v){return Number(v||0).toLocaleString(undefined,{maximumFractionDigits:2})+' cr'}
function points(v){return Number(v||0).toLocaleString(undefined,{maximumFractionDigits:2})+' LP'}
function fmt(v){return v?new Date(v).toLocaleString([], {month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}):'—'}
function normalize(v){return String(v||'').trim()}
function session(){try{var x=JSON.parse(localStorage.getItem('sb-'+REF+'-auth-token')||'null');if(x&&x.access_token)return x;if(x&&x.currentSession&&x.currentSession.access_token)return x.currentSession;if(x&&x.session&&x.session.access_token)return x.session}catch(e){}return null}
function ensureSession(force){if(window.Draw01Shell&&window.Draw01Shell.ensureSession)return window.Draw01Shell.ensureSession(!!force);return Promise.resolve(session())}
function req(path,opt,retried){opt=opt||{};return ensureSession(false).then(function(s){if(!s||!s.access_token)throw new Error('Admin session required');var h=Object.assign({},opt.headers||{});h.apikey=KEY;h.Authorization='Bearer '+s.access_token;if(opt.body)h['Content-Type']='application/json';return fetch(BASE+path,Object.assign({},opt,{headers:h})).then(function(r){return r.text().then(function(t){var d=null;try{d=t?JSON.parse(t):null}catch(e){d=t}if(!r.ok){var er=new Error((d&&d.message)||(d&&d.error)||('HTTP '+r.status));er.status=r.status;throw er}return d})})}).catch(function(e){if(!retried&&(e.status===401||e.status===403))return ensureSession(true).then(function(){return req(path,opt,true)});throw e})}
function rest(path,opt){return req('/rest/v1/'+path,opt)}
function rpc(name,args,reason){var h={};if(reason)h['x-admin-reason']=String(reason).slice(0,500);return rest('rpc/'+name,{method:'POST',headers:h,body:JSON.stringify(args||{})})}
function toast(m,bad){if(window.Draw01AdminCore&&window.Draw01AdminCore.toast){window.Draw01AdminCore.toast(m,bad);return}var t=$('toast');if(!t)return;t.textContent=m;t.className=bad?'err':'';t.style.display='block';clearTimeout(t._h);t._h=setTimeout(function(){t.style.display='none'},4200)}
function debounce(key,fn,ms){clearTimeout(S.timers[key]);S.timers[key]=setTimeout(fn,ms||300)}
function coreRefresh(){if(window.Draw01AdminCore&&window.Draw01AdminCore.refreshBase)window.Draw01AdminCore.refreshBase()}
function numbersHtml(t){var h='<div class="number-chips">';(t.white_numbers||[]).forEach(function(n){h+='<span>'+String(n).padStart(2,'0')+'</span>'});if(t.bonus_ball!=null)h+='<span class="bonus">'+String(t.bonus_ball).padStart(2,'0')+'</span>';return h+'</div>'}
function currentAdminId(){return window.Draw01AdminCore&&window.Draw01AdminCore.currentUserId?window.Draw01AdminCore.currentUserId():null}

function tabButton(name){return document.querySelector('.tabs button[data-tab="'+name+'"]')}
function openTab(name){var b=tabButton(name);if(b)b.click()}

function loadEvents(){
  if(S.eventsLoaded)return Promise.resolve(S.events);
  return rest('lottery_events?select=id,title,slug,status,created_at&order=created_at.desc&limit=500').then(function(rows){
    S.events=rows||[];S.eventsLoaded=true;
    var sel=$('ticketEventFilter'),prev=sel&&sel.value||'all';
    if(sel){sel.innerHTML='<option value="all">All lotteries</option>'+S.events.map(function(e){return'<option value="'+esc(e.id)+'">'+esc(e.title)+'</option>'}).join('');if(Array.from(sel.options).some(function(o){return o.value===prev}))sel.value=prev}
    return S.events
  })
}

/* Players */
function playerArgs(){
  var c=S.playerCursor||{};
  return {
    p_query:normalize($('playerSearch')&&$('playerSearch').value),
    p_role:($('playerRoleFilter')&&$('playerRoleFilter').value)||null,
    p_limit:50,
    p_cursor_created_at:c.created_at||null,
    p_cursor_id:c.id||null
  }
}
function loadPlayers(reset){
  if(S.playerBusy)return Promise.resolve();
  if(reset){S.players=[];S.playerCursor=null;S.playerMore=false}
  S.playerBusy=true;var root=$('playerList');if(reset&&root)root.innerHTML='<div class="sc-loading">Loading players…</div>';
  return rpc('admin_list_players_page',playerArgs()).then(function(d){
    var rows=d&&Array.isArray(d.rows)?d.rows:[];
    S.players=S.players.concat(rows);S.playerMore=!!(d&&d.has_more);S.playerCursor=d&&d.next_cursor||null;S.playersLoaded=true;
    renderPlayers()
  }).catch(function(e){if(root)root.innerHTML='<div class="sc-error">'+esc(e.message)+'</div>';toast('Player page failed: '+e.message,true)}).finally(function(){S.playerBusy=false;syncButtons()})
}
function renderPlayers(){
  var root=$('playerList');if(!root)return;
  $('playerSummary').textContent=S.players.length+' loaded'+(S.playerMore?' · more available':' · end');
  if(!S.players.length){root.innerHTML='<div class="record-card"><strong>No users matched this search</strong></div>';syncButtons();return}
  root.innerHTML='';
  S.players.forEach(function(p){
    var row=document.createElement('div');row.className='record-card';
    var main=document.createElement('div');main.className='record-main';
    main.innerHTML='<div class="record-title"><strong>'+esc(p.display_name||p.email||'Player')+'</strong><span class="status-pill">'+esc(String(p.role||'player').toUpperCase())+'</span></div><div class="record-meta"><span>'+esc(p.email||'')+'</span><span class="credit-balance">'+credits(p.balance)+'</span><span>'+points(p.support_points)+' support</span><span>Joined '+esc(fmt(p.created_at))+'</span></div>';
    var actions=document.createElement('div');actions.className='record-actions';
    actions.appendChild(makeButton('Investigate','ghost',function(){if(window.Draw01Investigation)window.Draw01Investigation.openPlayer(p.id);else toast('Investigation workspace is still loading.',true)}));
    actions.appendChild(makeButton('Ledger','ghost',function(){openLedgerForPlayer(p)}));
    actions.appendChild(makeButton('Set balance','primary',function(){if(window.Draw01AdminCore&&window.Draw01AdminCore.openBalance)window.Draw01AdminCore.openBalance(p);else toast('Balance editor unavailable.',true)}));
    var role=document.createElement('select');role.className='role-select';role.innerHTML='<option value="player">Player</option><option value="admin">Admin</option>';role.value=p.role||'player';role.disabled=currentAdminId()===p.id;
    role.onchange=function(){
      var previous=p.role,next=role.value,reason=prompt('Why are you changing this user role?','Role change for '+(p.display_name||p.email||'user'));
      if(reason===null||!String(reason).trim()){role.value=previous;toast('A reason is required for role changes.',true);return}
      role.disabled=true;
      rpc('admin_set_user_role',{p_user_id:p.id,p_role:next},String(reason).trim()).then(function(){p.role=next;toast('Role updated');renderPlayers();coreRefresh();document.dispatchEvent(new CustomEvent('draw01:admin-data-changed',{detail:{scope:'players'}}))}).catch(function(e){role.value=previous;toast('Role update failed: '+e.message,true)}).finally(function(){role.disabled=currentAdminId()===p.id})
    };
    actions.appendChild(role);row.appendChild(main);row.appendChild(actions);root.appendChild(row)
  });
  syncButtons()
}
function openLedgerForPlayer(p){
  openTab('ledger');
  var search=$('ledgerSearch');if(search)search.value=p.email||p.id;
  loadLedger(true)
}

/* Tickets */
function ticketArgs(){
  var c=S.ticketCursor||{},eventValue=$('ticketEventFilter')&&$('ticketEventFilter').value||'all';
  return {
    p_event_id:eventValue==='all'?null:eventValue,
    p_query:normalize($('ticketSearch')&&$('ticketSearch').value),
    p_limit:75,
    p_cursor_created_at:c.created_at||null,
    p_cursor_id:c.id||null
  }
}
function loadTickets(reset){
  if(S.ticketBusy)return Promise.resolve();
  if(reset){S.tickets=[];S.ticketCursor=null;S.ticketMore=false}
  S.ticketBusy=true;var root=$('ticketEventList');if(reset&&root)root.innerHTML='<div class="sc-loading">Loading tickets…</div>';
  return loadEvents().then(function(){return rpc('admin_list_tickets_page',ticketArgs())}).then(function(d){
    var rows=d&&Array.isArray(d.rows)?d.rows:[];
    S.tickets=S.tickets.concat(rows);S.ticketMore=!!(d&&d.has_more);S.ticketCursor=d&&d.next_cursor||null;S.ticketsLoaded=true;renderTickets()
  }).catch(function(e){if(root)root.innerHTML='<div class="sc-error">'+esc(e.message)+'</div>';toast('Ticket page failed: '+e.message,true)}).finally(function(){S.ticketBusy=false;syncButtons()})
}
function renderTickets(){
  var root=$('ticketEventList');if(!root)return;
  $('ticketSummary').textContent=S.tickets.length+' loaded'+(S.ticketMore?' · more available':' · end');
  if(!S.tickets.length){root.innerHTML='<div class="empty-sub">No tickets matched this view.</div>';syncButtons();return}
  var groups=[],map={};
  S.tickets.forEach(function(t){
    var key=t.event_id;
    if(!map[key]){map[key]={id:key,title:t.event_title||'Lottery',status:t.event_status||'',tickets:[]};groups.push(map[key])}
    map[key].tickets.push(t)
  });
  root.innerHTML='';
  groups.forEach(function(g){
    var section=document.createElement('section');section.className='ticket-event-group';
    var users={};g.tickets.forEach(function(t){users[t.user_id]=1});
    section.innerHTML='<div class="ticket-event-head"><div><span class="eyebrow">'+esc(String(g.status||'').toUpperCase())+'</span><h3>'+esc(g.title)+'</h3><p>'+g.tickets.length+' loaded ticket'+(g.tickets.length===1?'':'s')+' · '+Object.keys(users).length+' loaded player'+(Object.keys(users).length===1?'':'s')+'</p></div><button class="btn ghost compact" type="button" data-edit-event="'+esc(g.id)+'">Edit lottery</button></div><div class="participant-list"></div>';
    var list=section.querySelector('.participant-list'),byUser={},order=[];
    g.tickets.forEach(function(t){if(!byUser[t.user_id]){byUser[t.user_id]=[];order.push(t.user_id)}byUser[t.user_id].push(t)});
    order.forEach(function(uid){
      var arr=byUser[uid],p=arr[0],card=document.createElement('div');card.className='participant-card';
      card.innerHTML='<div class="participant-head"><div><strong>'+esc(p.player_name||p.player_email||'Player')+'</strong><span>'+esc(p.player_email||'')+' · '+arr.length+' loaded ticket'+(arr.length===1?'':'s')+'</span></div><div class="participant-head-actions"><span class="credit-balance">'+credits(p.player_balance)+'</span><button class="btn ghost compact inv-inline-action" type="button" data-player="'+esc(uid)+'">Investigate player</button></div></div><div class="participant-tickets">'+arr.map(function(t){return'<div class="ticket-line"><div><b>Ticket '+esc(String(t.id).slice(0,8))+'</b>'+(t.is_winner?'<span class="winner-rank">#'+esc(t.winner_rank)+' WINNER</span>':'')+'</div>'+numbersHtml(t)+'<div class="ticket-meta"><span>'+credits(t.price_paid)+'</span><span>'+esc(fmt(t.created_at))+'</span>'+(t.is_winner?'<strong>'+credits(t.prize_awarded)+' prize</strong>':'')+'</div><button class="btn ghost compact inv-inline-action" type="button" data-ticket="'+esc(t.id)+'">Inspect ticket</button></div>'}).join('')+'</div>';
      list.appendChild(card)
    });
    var edit=section.querySelector('[data-edit-event]');if(edit)edit.onclick=function(){if(window.Draw01AdminCore&&window.Draw01AdminCore.openEvent)window.Draw01AdminCore.openEvent(g.id);else toast('Lottery editor unavailable.',true)};
    section.querySelectorAll('[data-player]').forEach(function(b){b.onclick=function(){if(window.Draw01Investigation)window.Draw01Investigation.openPlayer(b.getAttribute('data-player'))}});
    section.querySelectorAll('[data-ticket]').forEach(function(b){b.onclick=function(){if(window.Draw01Investigation)window.Draw01Investigation.openTicket(b.getAttribute('data-ticket'))}});
    root.appendChild(section)
  });
  syncButtons()
}

/* Winners */
function winnerArgs(){
  var c=S.winnerCursor||{};
  return {p_limit:10,p_cursor_completed_at:c.completed_at||null,p_cursor_event_id:c.event_id||null}
}
function loadWinners(reset){
  if(S.winnerBusy)return Promise.resolve();
  if(reset){S.winners=[];S.winnerCursor=null;S.winnerMore=false}
  S.winnerBusy=true;var root=$('winnerList');if(reset&&root)root.innerHTML='<div class="sc-loading">Loading winner history…</div>';
  return rpc('admin_list_winner_events_page',winnerArgs()).then(function(d){
    S.winners=S.winners.concat(d&&Array.isArray(d.rows)?d.rows:[]);S.winnerMore=!!(d&&d.has_more);S.winnerCursor=d&&d.next_cursor||null;S.winnersLoaded=true;renderWinners()
  }).catch(function(e){if(root)root.innerHTML='<div class="sc-error">'+esc(e.message)+'</div>';toast('Winner history failed: '+e.message,true)}).finally(function(){S.winnerBusy=false;syncButtons()})
}
function renderWinners(){
  var root=$('winnerList');if(!root)return;
  var summary=$('winnerSummary');if(summary)summary.textContent=S.winners.length+' event'+(S.winners.length===1?'':'s')+' loaded'+(S.winnerMore?' · more available':' · end');
  if(!S.winners.length){root.innerHTML='<div class="empty-sub">No completed-lottery winners yet.</div>';syncButtons();return}
  root.innerHTML=S.winners.map(function(e){
    var wins=e.winners||[];
    return '<section class="winner-admin-event"><div class="winner-admin-event-head"><div><span class="eyebrow">RESULT ARCHIVE</span><h3>'+esc(e.title||'Lottery')+'</h3><p>'+wins.length+' winning ticket'+(wins.length===1?'':'s')+' · '+esc(fmt(e.completed_at||e.draw_at))+'</p></div><span class="status-pill completed">COMPLETED</span></div><div class="winner-admin-grid">'+wins.map(function(t){return'<article class="winner-admin-card"><div class="winner-rank-badge">#'+esc(t.winner_rank||'—')+'</div><div><strong>'+esc(t.player_name||t.player_email||'Player')+'</strong><span>'+esc(t.player_email||'')+'</span></div>'+numbersHtml(t)+'<b>'+credits(t.prize_awarded)+' prize</b><button class="btn ghost compact sc-winner-ticket" type="button" data-ticket="'+esc(t.ticket_id)+'">Inspect</button></article>'}).join('')+'</div></section>'
  }).join('');
  root.querySelectorAll('[data-ticket]').forEach(function(b){b.onclick=function(){if(window.Draw01Investigation)window.Draw01Investigation.openTicket(b.getAttribute('data-ticket'))}});
  syncButtons()
}

/* Ledger */
function ledgerArgs(){
  var c=S.ledgerCursor||{},type=$('ledgerTypeFilter')&&$('ledgerTypeFilter').value||'all';
  return {
    p_user_id:null,
    p_entry_type:type==='all'?null:type,
    p_query:normalize($('ledgerSearch')&&$('ledgerSearch').value),
    p_limit:75,
    p_cursor_created_at:c.created_at||null,
    p_cursor_id:c.id||null
  }
}
function loadLedger(reset){
  if(S.ledgerBusy)return Promise.resolve();
  if(reset){S.ledger=[];S.ledgerCursor=null;S.ledgerMore=false}
  S.ledgerBusy=true;var root=$('ledgerList');if(reset&&root)root.innerHTML='<div class="sc-loading">Loading Draw Credit ledger…</div>';
  return rpc('admin_list_balance_ledger_page',ledgerArgs()).then(function(d){
    S.ledger=S.ledger.concat(d&&Array.isArray(d.rows)?d.rows:[]);S.ledgerMore=!!(d&&d.has_more);S.ledgerCursor=d&&d.next_cursor||null;S.ledgerLoaded=true;renderLedger()
  }).catch(function(e){if(root)root.innerHTML='<div class="sc-error">'+esc(e.message)+'</div>';toast('Ledger page failed: '+e.message,true)}).finally(function(){S.ledgerBusy=false;syncButtons()})
}
function renderLedger(){
  var root=$('ledgerList');if(!root)return;
  $('ledgerSummary').textContent=S.ledger.length+' loaded'+(S.ledgerMore?' · more available':' · end');
  if(!S.ledger.length){root.innerHTML='<div class="record-card"><strong>No balance movements matched this view</strong></div>';syncButtons();return}
  root.innerHTML='';
  S.ledger.forEach(function(x){
    var r=document.createElement('div');r.className='record-card';var amount=Number(x.amount||0);
    r.innerHTML='<div class="record-main"><div class="record-title"><strong>'+esc(x.player_name||x.player_email||'Player')+'</strong><span class="status-pill">'+esc(String(x.entry_type||'entry').replace(/_/g,' ').toUpperCase())+'</span></div><div class="record-meta"><span class="ledger-amount '+(amount>=0?'plus':'minus')+'">'+(amount>=0?'+':'')+credits(amount)+'</span><span>Balance '+credits(x.balance_after)+'</span>'+(x.event_title?'<span>'+esc(x.event_title)+'</span>':'')+(x.actor_name?'<span>Actor '+esc(x.actor_name)+'</span>':'')+(x.note?'<span>'+esc(x.note)+'</span>':'')+'<span>'+esc(fmt(x.created_at))+'</span></div></div><div class="record-actions"><button class="btn ghost compact" type="button" data-player="'+esc(x.user_id)+'">Investigate</button></div>';
    var b=r.querySelector('[data-player]');if(b)b.onclick=function(){if(window.Draw01Investigation)window.Draw01Investigation.openPlayer(x.user_id)};
    root.appendChild(r)
  });
  syncButtons()
}

function makeButton(label,cls,fn){var b=document.createElement('button');b.type='button';b.className='btn '+(cls||'ghost')+' compact';b.textContent=label;b.onclick=fn;return b}
function syncButtons(){
  var pairs=[
    ['playerLoadMore',S.playerMore,S.playerBusy],
    ['ticketLoadMore',S.ticketMore,S.ticketBusy],
    ['winnerLoadMore',S.winnerMore,S.winnerBusy],
    ['ledgerLoadMore',S.ledgerMore,S.ledgerBusy]
  ];
  pairs.forEach(function(x){var b=$(x[0]);if(!b)return;b.hidden=!x[1];b.disabled=!!x[2]})
}
function bindTab(name,loader,flag){
  var b=tabButton(name);if(!b)return;
  b.addEventListener('click',function(){setTimeout(function(){if(!S[flag])loader(true)},0)})
}
function bind(){
  bindTab('players',loadPlayers,'playersLoaded');
  bindTab('tickets',loadTickets,'ticketsLoaded');
  bindTab('winners',loadWinners,'winnersLoaded');
  bindTab('ledger',loadLedger,'ledgerLoaded');

  if($('playerSearch'))$('playerSearch').addEventListener('input',function(){debounce('players',function(){loadPlayers(true)},300)});
  if($('playerRoleFilter'))$('playerRoleFilter').addEventListener('change',function(){loadPlayers(true)});
  if($('playerLoadMore'))$('playerLoadMore').onclick=function(){loadPlayers(false)};

  if($('ticketEventFilter'))$('ticketEventFilter').addEventListener('change',function(){loadTickets(true)});
  if($('ticketSearch'))$('ticketSearch').addEventListener('input',function(){debounce('tickets',function(){loadTickets(true)},300)});
  if($('ticketLoadMore'))$('ticketLoadMore').onclick=function(){loadTickets(false)};
  if($('refreshTickets'))$('refreshTickets').onclick=function(){loadTickets(true)};

  if($('winnerLoadMore'))$('winnerLoadMore').onclick=function(){loadWinners(false)};
  if($('refreshWinners'))$('refreshWinners').onclick=function(){loadWinners(true)};

  if($('ledgerSearch'))$('ledgerSearch').addEventListener('input',function(){debounce('ledger',function(){loadLedger(true)},300)});
  if($('ledgerTypeFilter'))$('ledgerTypeFilter').addEventListener('change',function(){loadLedger(true)});
  if($('ledgerLoadMore'))$('ledgerLoadMore').onclick=function(){loadLedger(false)};

  document.addEventListener('draw01:admin-data-changed',function(e){
    var scope=e&&e.detail&&e.detail.scope||'all';
    if(S.playersLoaded&&(scope==='all'||scope==='players'||scope==='balance'))loadPlayers(true);
    if(S.ledgerLoaded&&(scope==='all'||scope==='balance'||scope==='ledger'))loadLedger(true);
  });
  document.addEventListener('draw01:lifecycle-changed',function(){
    S.eventsLoaded=false;
    if(S.ticketsLoaded)loadTickets(true);
    if(S.winnersLoaded)loadWinners(true);
  });

  loadEvents().catch(function(){});
  syncButtons()
}
function boot(){bind();window.Draw01ScalableAdmin={loadPlayers:loadPlayers,loadTickets:loadTickets,loadWinners:loadWinners,loadLedger:loadLedger}}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();