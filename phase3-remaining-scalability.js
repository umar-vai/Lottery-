(function(){
'use strict';

var BASE='https://mwtlsnneooxmryondrex.supabase.co';
var KEY='sb_publishable_zfXYDH1qSZURp8bRHgnBrQ_7t7-3BMd';
var REF='mwtlsnneooxmryondrex';
var S={
  events:[],eventCursor:null,eventMore:false,eventsLoaded:false,eventBusy:false,
  audit:[],auditCursor:null,auditMore:false,auditLoaded:false,auditBusy:false,
  changes:[],changeCursor:null,changeMore:false,changesLoaded:false,changeBusy:false,changeCount24h:0,
  timers:{}
};

function $(id){return document.getElementById(id)}
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function fmt(v){return v?new Date(v).toLocaleString([], {month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}):'—'}
function session(){try{var x=JSON.parse(localStorage.getItem('sb-'+REF+'-auth-token')||'null');if(x&&x.access_token)return x;if(x&&x.currentSession&&x.currentSession.access_token)return x.currentSession;if(x&&x.session&&x.session.access_token)return x.session}catch(e){}return null}
function ensureSession(force){if(window.Draw01Shell&&window.Draw01Shell.ensureSession)return window.Draw01Shell.ensureSession(!!force);return Promise.resolve(session())}
function req(path,opt,retried){opt=opt||{};return ensureSession(false).then(function(s){if(!s||!s.access_token)throw new Error('Admin session required');var h=Object.assign({},opt.headers||{});h.apikey=KEY;h.Authorization='Bearer '+s.access_token;if(opt.body)h['Content-Type']='application/json';return fetch(BASE+path,Object.assign({},opt,{headers:h})).then(function(r){return r.text().then(function(t){var d=null;try{d=t?JSON.parse(t):null}catch(e){d=t}if(!r.ok){var er=new Error((d&&d.message)||(d&&d.error)||('HTTP '+r.status));er.status=r.status;throw er}return d})})}).catch(function(e){if(!retried&&(e.status===401||e.status===403))return ensureSession(true).then(function(){return req(path,opt,true)});throw e})}
function rest(path,opt){return req('/rest/v1/'+path,opt)}
function rpc(name,args){return rest('rpc/'+name,{method:'POST',body:JSON.stringify(args||{})})}
function toast(m,bad){if(window.Draw01AdminCore&&window.Draw01AdminCore.toast)return window.Draw01AdminCore.toast(m,bad);var t=$('toast');if(!t)return;t.textContent=m;t.className=bad?'err':'';t.style.display='block'}
function debounce(key,fn,ms){clearTimeout(S.timers[key]);S.timers[key]=setTimeout(fn,ms||300)}
function tabButton(name){return document.querySelector('.tabs button[data-tab="'+name+'"]')}

/* Events */
function eventArgs(){
  var c=S.eventCursor||{},status=$('eventStatusFilter')&&$('eventStatusFilter').value||'all';
  return {
    p_status:status==='all'?null:status,
    p_query:($('eventSearch')&&$('eventSearch').value||'').trim(),
    p_limit:40,
    p_cursor_created_at:c.created_at||null,
    p_cursor_id:c.id||null
  }
}
function loadEvents(reset){
  if(S.eventBusy)return Promise.resolve();
  if(reset){S.events=[];S.eventCursor=null;S.eventMore=false}
  S.eventBusy=true;var root=$('eventList');if(reset&&root)root.innerHTML='<div class="sc-loading">Loading lotteries…</div>';
  return rpc('admin_list_lottery_events_page',eventArgs()).then(function(d){
    S.events=S.events.concat(d&&Array.isArray(d.rows)?d.rows:[]);
    S.eventMore=!!(d&&d.has_more);S.eventCursor=d&&d.next_cursor||null;S.eventsLoaded=true;
    if(window.Draw01AdminCore&&window.Draw01AdminCore.setEventRows)window.Draw01AdminCore.setEventRows(S.events);
    renderEvents()
  }).catch(function(e){if(root)root.innerHTML='<div class="sc-error">'+esc(e.message)+'</div>';toast('Lottery page failed: '+e.message,true)}).finally(function(){S.eventBusy=false;syncButtons()})
}
function renderEvents(){
  var root=$('eventList');if(!root)return;
  $('eventSummary').textContent=S.events.length+' loaded'+(S.eventMore?' · more available':' · end');
  if(!S.events.length){root.innerHTML='<div class="empty-sub">No lotteries matched this view.</div>';syncButtons();return}
  root.innerHTML='';
  S.events.forEach(function(e){
    if(window.Draw01AdminCore&&window.Draw01AdminCore.buildEventCard)root.appendChild(window.Draw01AdminCore.buildEventCard(e))
  });
  syncButtons()
}

/* Audit */
function auditArgs(){
  var c=S.auditCursor||{};
  return {
    p_query:($('auditSearch')&&$('auditSearch').value||'').trim(),
    p_action:null,
    p_limit:75,
    p_cursor_created_at:c.created_at||null,
    p_cursor_id:c.id||null
  }
}
function loadAudit(reset){
  if(S.auditBusy)return Promise.resolve();
  if(reset){S.audit=[];S.auditCursor=null;S.auditMore=false}
  S.auditBusy=true;var root=$('auditList');if(reset&&root)root.innerHTML='<div class="sc-loading">Loading audit history…</div>';
  return rpc('admin_list_audit_logs_page',auditArgs()).then(function(d){
    S.audit=S.audit.concat(d&&Array.isArray(d.rows)?d.rows:[]);
    S.auditMore=!!(d&&d.has_more);S.auditCursor=d&&d.next_cursor||null;S.auditLoaded=true;renderAudit()
  }).catch(function(e){if(root)root.innerHTML='<div class="sc-error">'+esc(e.message)+'</div>';toast('Audit page failed: '+e.message,true)}).finally(function(){S.auditBusy=false;syncButtons()})
}
function renderAudit(){
  var root=$('auditList');if(!root)return;
  var summary=$('auditSummary');if(summary)summary.textContent=S.audit.length+' loaded'+(S.auditMore?' · more available':' · end');
  if(!S.audit.length){root.innerHTML='<div class="overview-empty">No audit activity matched this view.</div>';syncButtons();return}
  root.innerHTML='';
  S.audit.forEach(function(a){
    var el=document.createElement('div');el.className='timeline-item';
    el.innerHTML='<i class="timeline-dot"></i><div><strong>'+esc(String(a.action||'activity').replace(/_/g,' '))+'</strong><small>'+esc(a.actor_name||'System')+(a.entity_type?' · '+esc(a.entity_type):'')+(a.entity_id?' · '+esc(a.entity_id):'')+'</small></div><time>'+esc(fmt(a.created_at))+'</time>';
    root.appendChild(el)
  });
  syncButtons()
}

/* Canonical admin changes */
function changeArgs(){
  var c=S.changeCursor||{},table=$('adminChangeTableFilter')&&$('adminChangeTableFilter').value||'all';
  return {
    p_query:($('adminChangeSearch')&&$('adminChangeSearch').value||'').trim(),
    p_table_name:table==='all'?null:table,
    p_limit:50,
    p_cursor_created_at:c.created_at||null,
    p_cursor_id:c.id||null
  }
}
function loadAdminChanges(reset){
  if(S.changeBusy)return Promise.resolve();
  if(reset){S.changes=[];S.changeCursor=null;S.changeMore=false}
  S.changeBusy=true;var root=$('adminChangeList');if(reset&&root)root.innerHTML='<div class="sc-loading">Loading canonical changes…</div>';
  return rpc('admin_list_admin_changes_page',changeArgs()).then(function(d){
    S.changes=S.changes.concat(d&&Array.isArray(d.rows)?d.rows:[]);
    S.changeMore=!!(d&&d.has_more);S.changeCursor=d&&d.next_cursor||null;S.changeCount24h=Number(d&&d.count_24h||0);S.changesLoaded=true;renderAdminChanges()
  }).catch(function(e){if(root)root.innerHTML='<div class="sc-error">'+esc(e.message)+'</div>';toast('Admin change history failed: '+e.message,true)}).finally(function(){S.changeBusy=false;syncButtons()})
}
function renderAdminChanges(){
  var root=$('adminChangeList'),summary=$('adminChangeSummary');if(!root||!summary)return;
  summary.textContent=S.changeCount24h+' changes in last 24h · '+S.changes.length+' loaded'+(S.changeMore?' · more available':'');
  if(!S.changes.length){root.innerHTML='<div class="record-card"><strong>No canonical admin changes matched this view.</strong></div>';syncButtons();return}
  root.innerHTML=S.changes.map(function(x){
    var actor=x.actor_name||x.actor_email||'Admin';
    var before=x.old_data?JSON.stringify(x.old_data):'—',after=x.new_data?JSON.stringify(x.new_data):'—';
    return '<div class="record-card"><div class="record-main"><div class="record-title"><strong>'+esc(String(x.action||'admin change').replace(/_/g,' '))+'</strong><span class="status-pill">'+esc(x.table_name||'record')+'</span></div><div class="record-meta"><span>'+esc(actor)+'</span><span>Reason: '+esc(x.reason||'Not supplied')+'</span><span>Row '+esc(x.row_id||'—')+'</span><span>'+esc(fmt(x.created_at))+'</span></div><details><summary>Before / after</summary><div class="record-meta"><span>Before: '+esc(before)+'</span><span>After: '+esc(after)+'</span></div></details></div></div>'
  }).join('');
  syncButtons()
}

function syncButtons(){
  [['eventLoadMore',S.eventMore,S.eventBusy],['auditLoadMore',S.auditMore,S.auditBusy],['adminChangeLoadMore',S.changeMore,S.changeBusy]].forEach(function(x){
    var b=$(x[0]);if(!b)return;b.hidden=!x[1];b.disabled=!!x[2]
  })
}
function bindTab(name,flag,loader){
  var b=tabButton(name);if(!b)return;
  b.addEventListener('click',function(){setTimeout(function(){if(!S[flag])loader(true)},0)})
}
function bind(){
  bindTab('events','eventsLoaded',loadEvents);
  bindTab('audit','auditLoaded',loadAudit);
  bindTab('incidents','changesLoaded',loadAdminChanges);

  if($('eventStatusFilter'))$('eventStatusFilter').addEventListener('change',function(){loadEvents(true)});
  if($('eventSearch'))$('eventSearch').addEventListener('input',function(){debounce('events',function(){loadEvents(true)},300)});
  if($('eventLoadMore'))$('eventLoadMore').onclick=function(){loadEvents(false)};

  if($('auditSearch'))$('auditSearch').addEventListener('input',function(){debounce('audit',function(){loadAudit(true)},300)});
  if($('auditLoadMore'))$('auditLoadMore').onclick=function(){loadAudit(false)};
  if($('refreshAudit'))$('refreshAudit').onclick=function(){loadAudit(true)};

  if($('adminChangeSearch'))$('adminChangeSearch').addEventListener('input',function(){debounce('changes',function(){loadAdminChanges(true)},300)});
  if($('adminChangeTableFilter'))$('adminChangeTableFilter').addEventListener('change',function(){loadAdminChanges(true)});
  if($('adminChangeLoadMore'))$('adminChangeLoadMore').onclick=function(){loadAdminChanges(false)};
  if($('refreshAdminChanges'))$('refreshAdminChanges').onclick=function(){loadAdminChanges(true)};

  document.addEventListener('draw01:admin-data-changed',function(e){
    var scope=e&&e.detail&&e.detail.scope||'all';
    if(S.eventsLoaded&&(scope==='all'||scope==='events'))loadEvents(true);
    if(S.auditLoaded&&(scope==='all'||scope==='audit'||scope==='events'||scope==='balance'||scope==='players'||scope==='support'))loadAudit(true);
    if(S.changesLoaded&&(scope==='all'||scope==='events'||scope==='balance'||scope==='players'||scope==='support'))loadAdminChanges(true)
  });
  document.addEventListener('draw01:lifecycle-changed',function(){if(S.eventsLoaded)loadEvents(true);if(S.auditLoaded)loadAudit(true);if(S.changesLoaded)loadAdminChanges(true)})
  syncButtons()
}
function boot(){bind();window.Draw01RemainingScalability={loadEvents:loadEvents,loadAudit:loadAudit,loadAdminChanges:loadAdminChanges}}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();