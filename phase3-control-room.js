
(function(){
'use strict';

var BASE='https://mwtlsnneooxmryondrex.supabase.co';
var KEY='sb_publishable_zfXYDH1qSZURp8bRHgnBrQ_7t7-3BMd';
var REF='mwtlsnneooxmryondrex';
var S={data:null,poll:null,tick:null,busy:false,lastLoad:0};

function $(id){return document.getElementById(id)}
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function num(v){return Number(v||0).toLocaleString(undefined,{maximumFractionDigits:1})}
function credits(v){return num(v)+' cr'}
function fmt(v){return v?new Date(v).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'—'}
function session(){try{var x=JSON.parse(localStorage.getItem('sb-'+REF+'-auth-token')||'null');if(x&&x.access_token)return x;if(x&&x.currentSession&&x.currentSession.access_token)return x.currentSession;if(x&&x.session&&x.session.access_token)return x.session}catch(e){}return null}
function ensureSession(force){if(window.Draw01Shell&&window.Draw01Shell.ensureSession)return window.Draw01Shell.ensureSession(!!force);return Promise.resolve(session())}
function rpc(name,args,reason,retried){
  return ensureSession(false).then(function(s){
    if(!s||!s.access_token)throw new Error('Admin session required');
    var h={apikey:KEY,Authorization:'Bearer '+s.access_token,'Content-Type':'application/json'};
    if(reason)h['x-admin-reason']=String(reason).slice(0,500);
    return fetch(BASE+'/rest/v1/rpc/'+name,{method:'POST',headers:h,body:JSON.stringify(args||{})}).then(function(r){
      return r.text().then(function(t){var d=null;try{d=t?JSON.parse(t):null}catch(e){d=t}if(!r.ok){var er=new Error((d&&d.message)||(d&&d.error)||('HTTP '+r.status));er.status=r.status;throw er}return d})
    });
  }).catch(function(e){
    if(!retried&&(e.status===401||e.status===403))return ensureSession(true).then(function(){return rpc(name,args,reason,true)});
    throw e;
  });
}
function toast(m,bad){var t=$('toast');if(!t)return;t.textContent=m;t.className=bad?'err':'';t.style.display='block';clearTimeout(t._h);t._h=setTimeout(function(){t.style.display='none'},4200)}
function tabActive(){var el=$('control-room');return !!(el&&el.classList.contains('active')&&!document.hidden)}
function stateLabel(s){return String(s||'unknown').replace(/_/g,' ').toUpperCase()}
function pct(v){if(v==null||!Number.isFinite(Number(v)))return null;return Math.max(0,Math.min(100,Number(v)))}
function bar(label,current,max,p){var right=max==null?num(current)+' / ∞':num(current)+' / '+num(max);var width=p==null?0:pct(p);return '<div class="cr-bar-card"><div class="cr-bar-top"><span>'+esc(label)+'</span><strong>'+esc(right)+'</strong></div>'+(p==null?'<div class="cr-bar"><i style="width:0%"></i></div>':'<div class="cr-bar"><i style="width:'+width+'%"></i></div>')+'</div>'}
function targetFor(e){
  if(e.state==='upcoming')return{label:'Opens in',at:e.opens_at};
  if(e.state==='open'&&e.schedule_mode!=='manual')return{label:'Sales close in',at:e.cutoff_at};
  if(e.state==='locked')return{label:'Draw in',at:e.draw_at};
  if(e.state==='due')return{label:'Draw status',text:'DUE NOW'};
  if(e.state==='open'&&e.schedule_mode==='manual')return{label:'Draw mode',text:e.can_draw_now?'MANUAL DRAW READY':'WAITING FOR TICKETS'};
  if(e.state==='completed')return{label:'Completed',text:fmt(e.completed_at)};
  if(e.state==='draft')return{label:'Lifecycle',text:'DRAFT'};
  if(e.state==='cancelled')return{label:'Lifecycle',text:'CANCELLED'};
  return{label:'Status',text:stateLabel(e.state)};
}
function remaining(at){
  if(!at)return'—';
  var ms=new Date(at).getTime()-Date.now();
  if(ms<=0)return'00:00:00';
  var s=Math.floor(ms/1000),d=Math.floor(s/86400);s%=86400;var h=Math.floor(s/3600);s%=3600;var m=Math.floor(s/60),x=s%60;
  var hh=String(h).padStart(2,'0'),mm=String(m).padStart(2,'0'),ss=String(x).padStart(2,'0');
  return(d?d+'d ':'')+hh+':'+mm+':'+ss;
}
function healthCard(label,ok,primary,secondary){var cls=ok===true?'good':ok===false?'bad':'warn';return '<article class="cr-health-card '+cls+'"><span>'+esc(label)+'</span><strong>'+esc(primary)+'</strong><small>'+esc(secondary||'')+'</small></article>'}
function renderHealth(){
  if(!S.data)return;
  var h=S.data.operational_health||{},c=S.data.credit_integrity||{},cron=h.cron||{},draws=h.draws||{};
  var html='';
  html+=healthCard('Draw worker',!!h.ok,h.ok?'HEALTHY':'ATTENTION',cron.last_status?('Last run '+String(cron.last_status).toLowerCase()):'No run status');
  html+=healthCard('Draw Credit',!!c.ok,c.ok?'RECONCILED':'ISSUES',num(c.issue_total||0)+' integrity issue(s)');
  html+=healthCard('Overdue draws',Number(draws.overdue_scheduled||0)===0,numberText(draws.overdue_scheduled||0),Number(draws.open_failure_incidents||0)+' open failure incident(s)');
  html+=healthCard('Cron failures / 24h',Number(cron.failed_runs_24h||0)===0,numberText(cron.failed_runs_24h||0),cron.last_run_at?('Last '+fmt(cron.last_run_at)):'No recent run');
  $('controlRoomHealth').innerHTML=html;
  var os=$('controlRoomOpsState');if(os){os.textContent=h.ok?'SYSTEM HEALTHY':'ATTENTION';os.className='status-pill '+(h.ok?'open':'cancelled')}
}
function numberText(v){return Number(v||0).toLocaleString()}
function renderSummary(){
  var s=S.data&&S.data.summary||{};
  var items=[
    ['Published',s.published_events||0],['Open',s.open_events||0],['Due',s.due_events||0],
    ['All tickets',s.tickets||0],['Players',s.players||0],['Failures',s.events_with_failures||0]
  ];
  $('controlRoomSummary').innerHTML=items.map(function(x){return '<div class="cr-summary-item"><span>'+esc(x[0])+'</span><strong>'+numberText(x[1])+'</strong></div>'}).join('');
  var retry=$('controlRoomRetryDue');if(retry)retry.disabled=!(Number(s.due_events||0)>0);
}
function eventCard(e){
  var t=targetFor(e),run=e.runtime||{},attention=Number(run.consecutive_failures||0)>0;
  var stateClass=attention?'attention':(e.state||'');
  var countdown=t.text||remaining(t.at);
  var action='';
  if(e.can_draw_now)action+='<button class="btn primary compact" data-cr-draw="'+esc(e.id)+'">Draw now</button>';
  else if(e.state==='due'&&Number(e.ticket_count||0)===0)action+='<button class="btn ghost compact" disabled>No tickets to draw</button>';
  if(e.slug&&e.status!=='draft'&&e.status!=='cancelled')action+='<a class="btn ghost compact" target="_blank" rel="noopener" href="./lottery.html?e='+encodeURIComponent(e.slug)+'">Public page ↗</a>';
  action+='<button class="btn ghost compact" data-cr-manage="'+esc(e.id)+'">Manage lottery</button>';
  var runtime=attention?'<div class="cr-runtime"><strong>Draw incident:</strong> '+esc(run.last_error||'Unknown draw error')+(run.last_failed_at?' · '+esc(fmt(run.last_failed_at)):'')+'</div>':'';
  return '<article class="cr-event '+esc(stateClass)+'" data-event-id="'+esc(e.id)+'">'+
    '<div class="cr-event-head"><div class="cr-event-title"><span class="eyebrow">'+esc(e.schedule_mode==='manual'?'MANUAL DRAW':'SCHEDULED DRAW')+'</span><h3>'+esc(e.title)+'</h3><small>'+esc(e.slug||'')+' · '+credits(e.prize_amount)+' prize pool</small></div><span class="cr-state '+esc(stateClass)+'">'+stateLabel(attention?'attention':e.state)+'</span></div>'+
    '<div class="cr-countdown"><span>'+esc(t.label)+'</span><strong data-cr-countdown="'+esc(t.at||'')+'" data-static="'+esc(t.text||'')+'">'+esc(countdown)+'</strong></div>'+
    '<div class="cr-metrics">'+
      '<div class="cr-metric"><span>Tickets</span><strong>'+numberText(e.ticket_count)+'</strong></div>'+
      '<div class="cr-metric"><span>Players</span><strong>'+numberText(e.player_count)+'</strong></div>'+
      '<div class="cr-metric"><span>Ticket credits</span><strong>'+credits(e.ticket_credits)+'</strong></div>'+
      '<div class="cr-metric"><span>Winner progress</span><strong>'+numberText(e.selected_winners)+' / '+numberText(e.winner_count)+'</strong></div>'+
      '<div class="cr-metric"><span>Draw time</span><strong>'+esc(e.schedule_mode==='manual'?'Manual':fmt(e.draw_at))+'</strong></div>'+
    '</div>'+
    '<div class="cr-capacity">'+bar('Ticket capacity',e.ticket_count,e.max_total_tickets,e.ticket_fill_pct)+bar('Player capacity',e.player_count,e.max_players,e.player_fill_pct)+'</div>'+
    runtime+
    '<div class="cr-event-actions">'+action+'</div>'+
  '</article>';
}
function renderEvents(){
  var root=$('controlRoomEvents');if(!root)return;
  var events=S.data&&Array.isArray(S.data.events)?S.data.events:[];
  if(!events.length){root.innerHTML='<div class="cr-empty">No lottery events yet.</div>';return}
  root.innerHTML=events.map(eventCard).join('');
  root.querySelectorAll('[data-cr-draw]').forEach(function(b){b.onclick=function(){drawNow(b.getAttribute('data-cr-draw'))}});
  root.querySelectorAll('[data-cr-manage]').forEach(function(b){b.onclick=function(){openManagement()}});
}
function render(){if(!S.data)return;renderHealth();renderSummary();renderEvents();tickCountdowns();var stamp=$('controlRoomStamp');if(stamp)stamp.textContent='Updated '+fmt(S.data.generated_at)}
function tickCountdowns(){
  document.querySelectorAll('[data-cr-countdown]').forEach(function(el){var st=el.getAttribute('data-static');if(st){el.textContent=st;return}var at=el.getAttribute('data-cr-countdown');el.textContent=remaining(at)})
}
function openManagement(){var b=document.querySelector('.tabs button[data-tab="events"]');if(b)b.click()}
function load(force){
  if(S.busy)return Promise.resolve();
  if(!force&&!tabActive()&&Date.now()-S.lastLoad<15000)return Promise.resolve();
  S.busy=true;var btn=$('controlRoomRefresh');if(btn)btn.disabled=true;
  return rpc('admin_get_live_draw_control_room',{}).then(function(d){S.data=d||{};S.lastLoad=Date.now();render()}).catch(function(e){toast('Control Room load failed: '+e.message,true)}).finally(function(){S.busy=false;if(btn)btn.disabled=false});
}
function drawNow(id){
  var e=(S.data&&S.data.events||[]).find(function(x){return x.id===id});if(!e)return;
  if(!confirm('Run the draw now for "'+e.title+'"? This selects and credits winners from the current ticket pool.'))return;
  var reason=prompt('Admin reason for running this draw now:','Control Room manual draw');
  if(reason===null)return;reason=String(reason||'').trim();if(!reason){toast('Admin reason is required.',true);return}
  rpc('admin_run_lottery_event',{p_event_id:id},reason).then(function(){toast('Draw completed. Refreshing Control Room.');return load(true)}).catch(function(err){toast('Draw failed: '+err.message,true)});
}
function retryDue(){
  if(!confirm('Retry all due scheduled lottery draws now?'))return;
  var reason=prompt('Admin reason for retrying due draws:','Control Room recovery retry');
  if(reason===null)return;reason=String(reason||'').trim();if(!reason){toast('Admin reason is required.',true);return}
  var b=$('controlRoomRetryDue');if(b)b.disabled=true;
  rpc('admin_retry_due_lottery_events',{},reason).then(function(){toast('Due draw retry finished.');return load(true)}).catch(function(e){toast('Retry failed: '+e.message,true)}).finally(function(){if(b)b.disabled=false});
}
function bind(){
  var refresh=$('controlRoomRefresh');if(refresh)refresh.onclick=function(){load(true)};
  var retry=$('controlRoomRetryDue');if(retry)retry.onclick=retryDue;
  var tab=document.querySelector('.tabs button[data-tab="control-room"]');if(tab)tab.addEventListener('click',function(){setTimeout(function(){load(true)},0)});
  document.addEventListener('visibilitychange',function(){if(!document.hidden&&tabActive())load(true)});
}
function boot(){
  bind();
  clearInterval(S.poll);clearInterval(S.tick);
  S.poll=setInterval(function(){if(tabActive())load(false)},5000);
  S.tick=setInterval(function(){if(tabActive())tickCountdowns()},1000);
  setTimeout(function(){if(!$('app')||!$('app').hidden)load(true)},900);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
