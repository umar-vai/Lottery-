(function(){
'use strict';

var BASE='https://mwtlsnneooxmryondrex.supabase.co';
var KEY='sb_publishable_zfXYDH1qSZURp8bRHgnBrQ_7t7-3BMd';
var REF='mwtlsnneooxmryondrex';
var S={subjects:[],report:null,ticket:null,query:'',searchTimer:null,busy:false,selectedId:null,detailTab:'overview',loaded:false};

function $(id){return document.getElementById(id)}
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function num(v){return Number(v||0).toLocaleString(undefined,{maximumFractionDigits:2})}
function credits(v){return num(v)+' cr'}
function points(v){return num(v)+' LP'}
function fmt(v){return v?new Date(v).toLocaleString([], {month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}):'—'}
function shortId(v){v=String(v||'');return v?((v.length>12?v.slice(0,8)+'…'+v.slice(-4):v)):'—'}
function session(){try{var x=JSON.parse(localStorage.getItem('sb-'+REF+'-auth-token')||'null');if(x&&x.access_token)return x;if(x&&x.currentSession&&x.currentSession.access_token)return x.currentSession;if(x&&x.session&&x.session.access_token)return x.session}catch(e){}return null}
function ensureSession(force){if(window.Draw01Shell&&window.Draw01Shell.ensureSession)return window.Draw01Shell.ensureSession(!!force);return Promise.resolve(session())}
function rpc(name,args,retried){
  return ensureSession(false).then(function(s){
    if(!s||!s.access_token)throw new Error('Admin session required');
    return fetch(BASE+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:KEY,Authorization:'Bearer '+s.access_token,'Content-Type':'application/json'},body:JSON.stringify(args||{})}).then(function(r){
      return r.text().then(function(t){var d=null;try{d=t?JSON.parse(t):null}catch(e){d=t}if(!r.ok){var er=new Error((d&&d.message)||(d&&d.error)||('HTTP '+r.status));er.status=r.status;throw er}return d})
    })
  }).catch(function(e){
    if(!retried&&(e.status===401||e.status===403))return ensureSession(true).then(function(){return rpc(name,args,true)});
    throw e
  })
}
function toast(m,bad){var t=$('toast');if(!t)return;t.textContent=m;t.className=bad?'err':'';t.style.display='block';clearTimeout(t._h);t._h=setTimeout(function(){t.style.display='none'},4500)}
function badge(level,label){return '<span class="inv-badge '+esc(level||'clear')+'">'+esc(label||String(level||'clear').toUpperCase())+'</span>'}
function activateTab(){
  var b=document.querySelector('.tabs button[data-tab="investigations"]');
  if(b&&!b.classList.contains('active'))b.click();
}
function setBusy(on){
  S.busy=!!on;
  ['investigationRefresh','investigationSearchBtn'].forEach(function(id){var el=$(id);if(el)el.disabled=!!on})
}
function activityLabel(s){
  var delta=Number(s.balance_delta||0);
  if(delta!==0)return{level:'attention',text:'BALANCE MISMATCH'};
  if(Number(s.admin_adjustment_count||0)>0)return{level:'watch',text:'ADJUSTED'};
  return{level:'clear',text:'BALANCED'};
}
function renderSubjects(){
  var root=$('investigationSubjects');if(!root)return;
  var rows=S.subjects||[];
  $('investigationResultCount').textContent=rows.length+' result'+(rows.length===1?'':'s');
  if(!rows.length){root.innerHTML='<div class="inv-empty"><strong>No matching player</strong><span>Try name, email, user ID, ticket ID or lottery title.</span></div>';return}
  root.innerHTML=rows.map(function(s){
    var st=activityLabel(s),selected=S.selectedId===s.id?' selected':'';
    return '<button class="inv-subject'+selected+'" type="button" data-inv-player="'+esc(s.id)+'">'+
      '<div class="inv-subject-top"><div><strong>'+esc(s.display_name||s.email||'Player')+'</strong><small>'+esc(s.email||'')+'</small></div>'+badge(st.level,st.text)+'</div>'+
      '<div class="inv-subject-metrics"><span><b>'+credits(s.balance)+'</b>Draw Credits</span><span><b>'+num(s.ticket_count)+'</b>Tickets</span><span><b>'+num(s.game_plays)+'</b>Game plays</span><span><b>'+points(s.support_points)+'</b>Support</span></div>'+
      '<div class="inv-subject-foot"><span>Matched: '+esc(s.matched_by||'profile')+'</span><span>Last '+esc(fmt(s.last_activity_at))+'</span></div>'+
    '</button>'
  }).join('');
  root.querySelectorAll('[data-inv-player]').forEach(function(b){b.onclick=function(){openPlayer(b.getAttribute('data-inv-player'),false)}})
}
function loadSearch(query,keepSelection){
  if(S.busy)return Promise.resolve();
  S.query=String(query==null?($('investigationSearch')&&$('investigationSearch').value||''):query).trim();
  setBusy(true);
  var root=$('investigationSubjects');if(root)root.innerHTML='<div class="inv-loading">Searching investigation subjects…</div>';
  return rpc('admin_search_investigation_subjects',{p_query:S.query,p_limit:30}).then(function(d){
    S.subjects=d&&Array.isArray(d.subjects)?d.subjects:[];
    if(!keepSelection&&S.selectedId&&!S.subjects.some(function(x){return x.id===S.selectedId}))S.selectedId=null;
    renderSubjects();
    S.loaded=true;
    if(!S.selectedId&&S.subjects.length)return openPlayer(S.subjects[0].id,true);
  }).catch(function(e){if(root)root.innerHTML='<div class="inv-error">'+esc(e.message)+'</div>';toast('Investigation search failed: '+e.message,true)}).finally(function(){setBusy(false)})
}
function metric(label,value,meta,cls){return '<article class="inv-metric '+esc(cls||'')+'"><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong>'+(meta?'<small>'+esc(meta)+'</small>':'')+'</article>'}
function signalCard(s){
  return '<article class="inv-signal '+esc(s.level||'info')+'"><div>'+badge(s.level,String(s.level||'info').toUpperCase())+'<strong>'+esc(s.title||s.code)+'</strong></div><p>'+esc(s.detail||'')+'</p>'+(s.evidence?'<code>'+esc(JSON.stringify(s.evidence))+'</code>':'')+'</article>'
}
function balls(t){
  var whites=(t.white_numbers||[]).map(function(n){return'<i>'+esc(n)+'</i>'}).join('');
  var bonus=t.bonus_ball==null?'':'<i class="bonus">'+esc(t.bonus_ball)+'</i>';
  return '<div class="inv-balls">'+whites+bonus+'</div>'
}
function renderOverview(r){
  var d=r.draw_credits||{},l=r.lottery||{},g=r.games||{},sp=r.support_points||{},rf=r.referrals||{};
  return '<div class="inv-section-grid">'+
    '<section class="inv-box"><span class="eyebrow">DRAW CREDIT ACCOUNTING</span><h4>'+ (d.accounting_ok?'Reconciled':'Needs attention') +'</h4><div class="inv-mini-grid">'+
      metric('Current balance',credits(d.balance),'profiles.balance')+
      metric('Ledger total',credits(d.ledger_total),'Sum of Draw Credit ledger')+
      metric('Balance delta',credits(d.balance_delta),d.accounting_ok?'Exact match':'Must be investigated',Number(d.balance_delta)===0?'good':'bad')+
      metric('Admin adjustments',num(d.admin_adjustment_count),credits(d.admin_adjustment_total)+' lifetime')+
    '</div></section>'+
    '<section class="inv-box"><span class="eyebrow">LOTTERY ACCOUNTING</span><h4>'+num(l.ticket_count)+' tickets across '+num(l.event_count)+' lotteries</h4><div class="inv-mini-grid">'+
      metric('Ticket spend',credits(d.ticket_spend),'Purchase debits')+
      metric('Wins',num(l.wins),credits(d.prizes)+' prizes')+
      metric('Purchase mismatches',num(l.ticket_purchase_mismatches),'Must be zero',Number(l.ticket_purchase_mismatches)===0?'good':'bad')+
      metric('Prize mismatches',num(Number(l.winner_prize_mismatches||0)+Number(l.extra_prize_credits||0)),'Must be zero',Number(l.winner_prize_mismatches||0)+Number(l.extra_prize_credits||0)===0?'good':'bad')+
    '</div></section>'+
    '<section class="inv-box inv-domain-separate"><span class="eyebrow">SEPARATE DOMAIN</span><h4>Support Points</h4><p>Support Points stay isolated from lottery Draw Credits and cannot be used for ticket accounting.</p><div class="inv-mini-grid">'+
      metric('Support balance',points(sp.balance),'support_wallets.balance')+
      metric('Settled claims',num(sp.claim_count),points(sp.points_received)+' received')+
      metric('Admin adjustments',num(sp.admin_adjustment_count),'Support-only adjustments')+
    '</div></section>'+
    '<section class="inv-box"><span class="eyebrow">GAME ZONE</span><h4>'+num(Number(g.slot_count||0)+Number(g.plinko_count||0))+' recorded plays</h4><div class="inv-mini-grid">'+
      metric('Slot',num(g.slot_count),num(g.slot_accounting_mismatches)+' mismatch(es)',Number(g.slot_accounting_mismatches)===0?'good':'bad')+
      metric('Plinko',num(g.plinko_count),num(g.plinko_accounting_mismatches)+' mismatch(es)',Number(g.plinko_accounting_mismatches)===0?'good':'bad')+
      metric('Peak velocity',num(g.max_plays_in_one_minute)+'/min','Operational context')+
    '</div></section>'+
    '<section class="inv-box"><span class="eyebrow">REFERRALS</span><h4>Referral relationship</h4><div class="inv-mini-grid">'+
      metric('Referrals sent',num(rf.referrals_sent),points(rf.reward_total)+' rewards')+
      metric('Referred by',shortId(rf.referred_by),rf.referred_by?'Referrer UUID':'No referrer')+
      metric('Self-referral',rf.self_referral?'YES':'NO',rf.self_referral?'Integrity issue':'No issue',rf.self_referral?'bad':'good')+
    '</div></section>'+
  '</div>'
}
function renderTicketsPanel(r){
  var rows=r.tickets||[];if(!rows.length)return'<div class="inv-empty"><strong>No lottery tickets</strong><span>This player has not purchased an event ticket.</span></div>';
  return '<div class="inv-ticket-list">'+rows.map(function(t){
    var ok=t.purchase_ledger_ok&&t.prize_ledger_ok;
    return '<article class="inv-ticket-row"><div class="inv-ticket-copy"><div><strong>'+esc(t.event_title||'Lottery')+'</strong>'+badge(ok?'clear':'attention',ok?'LEDGER OK':'CHECK LEDGER')+'</div><small>'+esc(t.ticket_ref||shortId(t.id))+' · '+esc(fmt(t.created_at))+'</small>'+balls(t)+'</div><div class="inv-ticket-side"><b>'+credits(t.price_paid)+'</b>'+(t.is_winner?'<span class="inv-win">#'+esc(t.winner_rank)+' · '+credits(t.prize_awarded)+'</span>':'<span>Not a winner</span>')+'<button class="btn ghost compact" type="button" data-inv-ticket="'+esc(t.id)+'">Inspect ticket</button></div></article>'
  }).join('')+'</div>'
}
function renderLedgerPanel(r){
  var rows=r.ledger||[];if(!rows.length)return'<div class="inv-empty"><strong>No Draw Credit ledger rows</strong></div>';
  return '<div class="inv-ledger-list">'+rows.map(function(x){
    var amount=Number(x.amount||0);
    return '<article class="inv-ledger-row"><div><strong>'+esc(String(x.entry_type||'entry').replace(/_/g,' '))+'</strong><small>'+esc(fmt(x.created_at))+(x.event_title?' · '+esc(x.event_title):'')+'</small><p>'+esc(x.note||'No note')+'</p></div><div><b class="'+(amount>=0?'plus':'minus')+'">'+(amount>=0?'+':'')+credits(amount)+'</b><span>→ '+credits(x.balance_after)+'</span>'+(x.actor_name?'<small>Actor: '+esc(x.actor_name)+'</small>':'')+'</div></article>'
  }).join('')+'</div>'
}
function renderGamesPanel(r){
  var rows=r.recent_games||[];if(!rows.length)return'<div class="inv-empty"><strong>No recent game activity</strong></div>';
  return '<div class="inv-game-list">'+rows.map(function(g){
    return '<article class="inv-game-row"><div>'+badge(g.kind==='slot'?'watch':'clear',String(g.kind||'game').toUpperCase())+'<strong>'+esc(g.outcome||'result')+'</strong><small>'+esc(fmt(g.created_at))+(g.risk?' · '+esc(g.risk)+' risk':'')+'</small></div><div><b>'+credits(g.bet)+' bet</b><span>'+credits(g.payout)+' payout</span><small>'+((Number(g.net||0)>=0)?'+':'')+credits(g.net)+' net · '+num(g.multiplier)+'x</small></div></article>'
  }).join('')+'</div>'
}
function renderAdminPanel(r){
  var changes=r.admin_changes||[],support=r.support_adjustments||[];
  var a='<section class="inv-admin-sub"><span class="eyebrow">CANONICAL ADMIN CHANGES</span>';
  if(!changes.length)a+='<div class="inv-empty compact"><span>No canonical admin changes matched this player.</span></div>';
  else a+='<div class="inv-admin-list">'+changes.map(function(x){return'<article><div><strong>'+esc(String(x.action||'change').replace(/_/g,' '))+'</strong><small>'+esc(x.table_name||'')+' · '+esc(fmt(x.created_at))+'</small></div><p>'+esc(x.reason||'No reason')+'</p>'+(x.request_ip?'<code>IP '+esc(x.request_ip)+'</code>':'')+'</article>'}).join('')+'</div>';
  a+='</section><section class="inv-admin-sub"><span class="eyebrow">SUPPORT POINT ADJUSTMENTS · SEPARATE DOMAIN</span>';
  if(!support.length)a+='<div class="inv-empty compact"><span>No Support Point adjustments.</span></div>';
  else a+='<div class="inv-admin-list">'+support.map(function(x){return'<article><div><strong>'+points(x.previous_balance)+' → '+points(x.new_balance)+'</strong><small>'+esc(fmt(x.created_at))+(x.actor_name?' · '+esc(x.actor_name):'')+'</small></div><p>'+esc(x.note||'No note')+'</p></article>'}).join('')+'</div>';
  return a+'</section>'
}
function detailPanel(r){
  if(S.detailTab==='tickets')return renderTicketsPanel(r);
  if(S.detailTab==='ledger')return renderLedgerPanel(r);
  if(S.detailTab==='games')return renderGamesPanel(r);
  if(S.detailTab==='admin')return renderAdminPanel(r);
  return renderOverview(r)
}
function renderDetail(){
  var root=$('investigationDetail');if(!root)return;
  var r=S.report;
  if(!r){root.innerHTML='<div class="inv-detail-empty"><strong>Select a player to investigate</strong><span>Search or choose a recent player from the left.</span></div>';return}
  var p=r.profile||{},review=r.review||{},signals=review.signals||[];
  var tabs=[['overview','Overview'],['tickets','Tickets '+(r.lottery&&r.lottery.ticket_count||0)],['ledger','Ledger '+(r.ledger||[]).length],['games','Games'],['admin','Admin trail']];
  root.innerHTML='<div class="inv-detail-head"><div><span class="eyebrow">PLAYER INVESTIGATION</span><h2>'+esc(p.display_name||p.email||'Player')+'</h2><p>'+esc(p.email||'')+' · '+esc(shortId(p.id))+' · '+esc(String(p.role||'player').toUpperCase())+'</p></div>'+badge(review.level,String(review.level||'clear').toUpperCase())+'</div>'+
    '<div class="inv-primary-metrics">'+
      metric('Draw Credits',credits(r.draw_credits&&r.draw_credits.balance),'Authoritative balance',r.draw_credits&&r.draw_credits.accounting_ok?'good':'bad')+
      metric('Support Points',points(r.support_points&&r.support_points.balance),'Separate balance')+
      metric('Lottery tickets',num(r.lottery&&r.lottery.ticket_count),num(r.lottery&&r.lottery.wins)+' winner(s)')+
      metric('Last activity',fmt(p.last_activity_at),'Joined '+fmt(p.created_at))+
    '</div>'+
    '<section class="inv-signals"><div class="inv-section-head"><div><span class="eyebrow">REVIEW SIGNALS</span><h3>'+(signals.length?signals.length+' signal'+(signals.length===1?'':'s'):'No review signals')+'</h3></div><small>Activity signals are context, not fraud determinations.</small></div>'+
      (signals.length?'<div class="inv-signal-grid">'+signals.map(signalCard).join('')+'</div>':'<div class="inv-clear"><strong>Accounting and configured review checks are clear.</strong></div>')+
    '</section>'+
    '<nav class="inv-detail-tabs">'+tabs.map(function(t){return'<button type="button" data-inv-detail-tab="'+t[0]+'" class="'+(S.detailTab===t[0]?'active':'')+'">'+esc(t[1])+'</button>'}).join('')+'</nav>'+
    '<div class="inv-detail-panel">'+detailPanel(r)+'</div>';
  root.querySelectorAll('[data-inv-detail-tab]').forEach(function(b){b.onclick=function(){S.detailTab=b.getAttribute('data-inv-detail-tab');renderDetail()}});
  root.querySelectorAll('[data-inv-ticket]').forEach(function(b){b.onclick=function(){openTicket(b.getAttribute('data-inv-ticket'))}})
}
function openPlayer(id,silent){
  if(!id)return Promise.resolve();
  activateTab();S.selectedId=id;S.detailTab='overview';renderSubjects();
  var root=$('investigationDetail');if(root)root.innerHTML='<div class="inv-loading">Building player accounting investigation…</div>';
  return rpc('admin_get_player_investigation',{p_user_id:id}).then(function(r){S.report=r;renderDetail();if(!silent)toast('Player investigation loaded.')}).catch(function(e){if(root)root.innerHTML='<div class="inv-error">'+esc(e.message)+'</div>';toast('Player investigation failed: '+e.message,true)})
}
function checkRow(c){return'<div class="inv-ticket-check '+(c.ok?'ok':'fail')+'"><i>'+(c.ok?'✓':'!')+'</i><div><strong>'+esc(c.label||c.key)+'</strong>'+(c.detail?'<small>'+esc(c.detail)+'</small>':'')+'</div></div>'}
function renderTicketDialog(t){
  S.ticket=t;var d=$('investigationTicketDialog');if(!d)return;
  var tk=t.ticket||{},p=t.player||{},e=t.event||{};
  $('invTicketTitle').textContent=tk.ticket_ref||shortId(tk.id);
  $('invTicketMeta').textContent=(e.title||'Lottery')+' · '+(p.display_name||p.email||'Player')+' · '+fmt(tk.created_at);
  $('invTicketStatus').innerHTML=badge(t.ok?'clear':'attention',t.ok?'INTEGRITY OK':'ATTENTION');
  $('invTicketNumbers').innerHTML=balls(tk);
  $('invTicketChecks').innerHTML=(t.checks||[]).map(checkRow).join('');
  var led=t.ledger||[];
  $('invTicketLedger').innerHTML=led.length?led.map(function(x){var a=Number(x.amount||0);return'<article><div><strong>'+esc(String(x.entry_type||'entry').replace(/_/g,' '))+'</strong><small>'+esc(fmt(x.created_at))+'</small></div><div><b class="'+(a>=0?'plus':'minus')+'">'+(a>=0?'+':'')+credits(a)+'</b><span>→ '+credits(x.balance_after)+'</span></div><p>'+esc(x.note||'No note')+'</p></article>'}).join(''):'<div class="inv-empty compact">No ticket-linked ledger rows.</div>';
  $('invTicketOpenPlayer').dataset.playerId=p.id||tk.user_id||'';
  if(!d.open)d.showModal()
}
function openTicket(id){
  if(!id)return;activateTab();
  var d=$('investigationTicketDialog');if(d&&!d.open)d.showModal();
  $('invTicketTitle').textContent='Loading ticket…';$('invTicketMeta').textContent='Reading authoritative ticket + ledger state';$('invTicketStatus').innerHTML='';$('invTicketNumbers').innerHTML='';$('invTicketChecks').innerHTML='<div class="inv-loading">Running ticket integrity checks…</div>';$('invTicketLedger').innerHTML='';
  rpc('admin_get_ticket_investigation',{p_ticket_id:id}).then(renderTicketDialog).catch(function(e){$('invTicketChecks').innerHTML='<div class="inv-error">'+esc(e.message)+'</div>';toast('Ticket investigation failed: '+e.message,true)})
}
function bind(){
  var tab=document.querySelector('.tabs button[data-tab="investigations"]');
  if(tab)tab.addEventListener('click',function(){setTimeout(function(){if(!S.loaded)loadSearch('',false)},0)});
  var search=$('investigationSearch');
  if(search){
    search.addEventListener('input',function(){clearTimeout(S.searchTimer);S.searchTimer=setTimeout(function(){loadSearch(search.value,false)},280)});
    search.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();clearTimeout(S.searchTimer);loadSearch(search.value,false)}})
  }
  if($('investigationSearchBtn'))$('investigationSearchBtn').onclick=function(){loadSearch(search&&search.value||'',false)};
  if($('investigationRefresh'))$('investigationRefresh').onclick=function(){loadSearch(S.query,true).then(function(){if(S.selectedId)return openPlayer(S.selectedId,true)})};
  if($('closeInvestigationTicket'))$('closeInvestigationTicket').onclick=function(){$('investigationTicketDialog').close()};
  if($('invTicketOpenPlayer'))$('invTicketOpenPlayer').onclick=function(){var id=this.dataset.playerId;$('investigationTicketDialog').close();if(id)openPlayer(id,false)};
}
function boot(){bind();window.Draw01Investigation={openPlayer:openPlayer,openTicket:openTicket,search:loadSearch}}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();