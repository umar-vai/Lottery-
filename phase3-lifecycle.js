(function(){
'use strict';

var BASE='https://mwtlsnneooxmryondrex.supabase.co';
var KEY='sb_publishable_zfXYDH1qSZURp8bRHgnBrQ_7t7-3BMd';
var REF='mwtlsnneooxmryondrex';
var L={id:null,title:'',intent:null,review:null,busy:false};

function $(id){return document.getElementById(id)}
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function fmt(v){return v?new Date(v).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'—'}
function num(v){return Number(v||0).toLocaleString(undefined,{maximumFractionDigits:2})}
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
function toast(m,bad){var t=$('toast');if(!t)return;t.textContent=m;t.className=bad?'err':'';t.style.display='block';clearTimeout(t._h);t._h=setTimeout(function(){t.style.display='none'},4500)}
function emit(action,detail){document.dispatchEvent(new CustomEvent('draw01:lifecycle-changed',{detail:Object.assign({action:action,event_id:L.id},detail||{})}))}
function lifecycleIntent(r){
  if(L.intent)return L.intent;
  var s=r&&r.event&&r.event.status;
  if(s==='draft')return'publish';
  if(s==='published')return'draw';
  if(s==='completed')return'verify';
  return'review';
}
function stepState(r){
  var e=r.event||{},verified=r.verification&&r.verification.status==='verified';
  var idx=0;
  if(e.status==='draft')idx=1;
  else if(e.status==='published'){
    if(e.state==='upcoming')idx=2;
    else if(e.state==='open')idx=2;
    else idx=3;
  }else if(e.status==='completed')idx=verified?6:5;
  else if(e.status==='cancelled')idx=0;
  return idx;
}
function renderSteps(r){
  var e=r.event||{},idx=stepState(r);
  var labels=['Configure','Publish','Open',e.schedule_mode==='manual'?'Atomic lock':'Lock','Draw','Verify'];
  return labels.map(function(label,i){
    var cls=i<idx?'done':(i===idx?'current':'future');
    if(idx>=6)cls='done';
    return '<div class="lc-step '+cls+'"><i>'+(cls==='done'?'✓':(i+1))+'</i><span>'+esc(label)+'</span></div>';
  }).join('');
}
function renderChecks(checks){
  return (checks||[]).map(function(c){
    return '<div class="lc-check '+(c.ok?'ok':'fail')+'"><i>'+(c.ok?'✓':'!')+'</i><div><strong>'+esc(c.label||c.key)+'</strong>'+(c.detail?'<small>'+esc(c.detail)+'</small>':'')+'</div></div>';
  }).join('');
}
function summaryCards(r){
  var e=r.event||{};
  return [
    ['State',String(e.state||e.status||'—').toUpperCase()],
    ['Tickets',num(e.ticket_count)+' / '+num(e.winner_count)+' winners'],
    ['Players',num(e.player_count)],
    ['Prize pool',num(e.prize_amount)+' cr'],
    ['Mode',String(e.schedule_mode||'—').toUpperCase()],
    ['Draw',e.schedule_mode==='manual'?'Manual':fmt(e.draw_at)]
  ].map(function(x){return '<div class="lc-metric"><span>'+esc(x[0])+'</span><strong>'+esc(x[1])+'</strong></div>'}).join('');
}
function actionConfig(r){
  var intent=lifecycleIntent(r),e=r.event||{},v=r.verification||{};
  if(intent==='publish'||e.status==='draft')return{
    kind:'publish',title:'Publish readiness',copy:'A lottery becomes public only after every blocking configuration check passes.',
    checks:r.publish&&r.publish.checks||[],ready:!!(r.publish&&r.publish.ready),
    button:'Publish lottery',note:'Admin reason',placeholder:'Why is this lottery ready to publish?'
  };
  if(intent==='draw'||e.status==='published')return{
    kind:'draw',title:'Pre-draw checklist',
    copy:r.draw&&r.draw.manual_override?'Ticket sales are locked. This would be a manual override before the scheduled draw time.':(e.schedule_mode==='manual'?'The draw transaction uses the event row lock as the atomic ticket-sales boundary.':'The draw can run only after the ticket cutoff and all accounting checks pass.'),
    checks:r.draw&&r.draw.checks||[],ready:!!(r.draw&&r.draw.ready),
    button:r.draw&&r.draw.manual_override?'Run manual override draw':'Run secure draw now',
    note:'Draw execution reason',placeholder:'Why are you running this draw now?'
  };
  if(e.status==='completed')return{
    kind:'verify',title:'Post-draw verification',
    copy:v.status==='verified'?'This result fingerprint matches the last verified snapshot. You can re-verify or relaunch it as a fresh draft.':'Verification checks winners, ranks, prize ledgers, public summary and cryptographic commitment without rewriting history.',
    checks:r.post_draw&&r.post_draw.checks||[],ready:!!(r.post_draw&&r.post_draw.ready),
    button:v.status==='verified'?'Re-verify result':'Verify completed result',
    note:v.status==='verified'?'Verification / relaunch note':'Verification note',
    placeholder:v.status==='verified'?'Reason for re-verification or relaunch':'What did you confirm during result review?'
  };
  return{kind:'review',title:'Lifecycle review',copy:'This lottery has no guided mutation available in its current state.',checks:[],ready:false,button:'No action available',note:'Admin note',placeholder:''};
}
function verificationBadge(r){
  var v=r.verification||{},s=v.status||'unverified';
  return '<span class="lc-verification '+esc(s)+'">'+esc(String(s).replace(/_/g,' ').toUpperCase())+'</span>';
}
function render(r){
  L.review=r;
  var e=r.event||{},cfg=actionConfig(r),v=r.verification||{};
  $('lifecycleKicker').textContent='GUIDED LOTTERY LIFECYCLE';
  $('lifecycleTitle').textContent=e.title||L.title||'Lottery review';
  $('lifecycleMeta').textContent=(e.slug||'')+' · '+String(e.schedule_mode||'').toUpperCase()+' · '+String(r.next_action||'review').replace(/_/g,' ').toUpperCase();
  $('lifecycleVerification').innerHTML=verificationBadge(r);
  $('lifecycleSteps').innerHTML=renderSteps(r);
  $('lifecycleMetrics').innerHTML=summaryCards(r);
  $('lifecycleActionTitle').textContent=cfg.title;
  $('lifecycleActionCopy').textContent=cfg.copy;
  $('lifecycleChecks').innerHTML=renderChecks(cfg.checks);
  var blockers=(cfg.checks||[]).filter(function(c){return c.blocking!==false&&!c.ok}).length;
  var banner=$('lifecycleBanner');
  banner.className='lc-banner '+(cfg.ready?'ready':'blocked');
  banner.innerHTML=cfg.ready?'<strong>Ready</strong><span>All blocking checks passed.</span>':'<strong>'+blockers+' blocker'+(blockers===1?'':'s')+'</strong><span>Resolve the failed checks before continuing.</span>';
  $('lifecycleNoteLabel').textContent=cfg.note;
  $('lifecycleNote').placeholder=cfg.placeholder;
  $('lifecycleNoteWrap').hidden=cfg.kind==='review';
  var primary=$('lifecyclePrimary');
  primary.textContent=cfg.button;
  primary.disabled=!cfg.ready||cfg.kind==='review';
  primary.dataset.kind=cfg.kind;
  var relaunch=$('lifecycleRelaunch');
  relaunch.hidden=!(e.status==='completed'&&v.status==='verified');
  if(v.verified_at)$('lifecycleVerifiedMeta').textContent='Last verified '+fmt(v.verified_at)+(v.note?' · '+v.note:'');
  else $('lifecycleVerifiedMeta').textContent='';
}
function setBusy(on){
  L.busy=!!on;
  ['lifecyclePrimary','lifecycleRelaunch','lifecycleRefresh'].forEach(function(id){var el=$(id);if(el)el.disabled=!!on});
}
function refreshReview(){
  if(!L.id)return Promise.reject(new Error('No lottery selected'));
  setBusy(true);
  return rpc('admin_get_event_lifecycle_review',{p_event_id:L.id}).then(function(r){render(r);return r}).finally(function(){setBusy(false)});
}
function openLifecycle(eventOrId,intent){
  var ev=typeof eventOrId==='object'&&eventOrId?eventOrId:{id:eventOrId};
  L.id=ev.id;L.title=ev.title||'';L.intent=intent||null;L.review=null;
  if(!L.id){toast('Lottery ID is missing.',true);return}
  $('lifecycleTitle').textContent=L.title||'Loading lottery review…';
  $('lifecycleMeta').textContent='Checking server-authoritative lifecycle state…';
  $('lifecycleSteps').innerHTML='';
  $('lifecycleMetrics').innerHTML='';
  $('lifecycleChecks').innerHTML='<div class="lc-loading">Loading checklist…</div>';
  $('lifecycleBanner').className='lc-banner';
  $('lifecycleBanner').innerHTML='<strong>Checking</strong><span>Reading current event, ticket and ledger state.</span>';
  $('lifecycleNote').value='';
  $('lifecycleRelaunch').hidden=true;
  $('lifecyclePrimary').disabled=true;
  $('lifecycleDialog').showModal();
  refreshReview().catch(function(e){toast('Lifecycle review failed: '+e.message,true);$('lifecycleChecks').innerHTML='<div class="lc-error">'+esc(e.message)+'</div>'});
}
function requireNote(){
  var note=String($('lifecycleNote').value||'').trim();
  if(!note){toast('An admin note is required for this action.',true);$('lifecycleNote').focus();return null}
  if(note.length>500){toast('Keep the admin note within 500 characters.',true);return null}
  return note;
}
function primaryAction(){
  if(L.busy||!L.review)return;
  var kind=this.dataset.kind,note=requireNote();if(note===null)return;
  var e=L.review.event||{};
  if(kind==='publish'){
    if(!confirm('Publish "'+e.title+'"? Players may be able to buy tickets as soon as its opening time is reached.'))return;
    setBusy(true);
    rpc('admin_publish_lottery_event',{p_event_id:L.id},note).then(function(r){
      L.intent='draw';$('lifecycleNote').value='';render(r);toast('Lottery published through the guided checklist.');emit('publish');
    }).catch(function(err){toast('Publish failed: '+err.message,true)}).finally(function(){setBusy(false)});
    return;
  }
  if(kind==='draw'){
    if(!confirm('Run the secure ticket-pool draw for "'+e.title+'"? Winner credits and historical results will be written atomically.'))return;
    setBusy(true);
    rpc('admin_run_lottery_event',{p_event_id:L.id},note).then(function(){
      L.intent='verify';$('lifecycleNote').value='';toast('Draw completed. Running post-draw review…');emit('draw');
      return rpc('admin_get_event_lifecycle_review',{p_event_id:L.id});
    }).then(function(r){render(r)}).catch(function(err){toast('Draw failed: '+err.message,true)}).finally(function(){setBusy(false)});
    return;
  }
  if(kind==='verify'){
    setBusy(true);
    rpc('admin_verify_completed_lottery_event',{p_event_id:L.id,p_note:note},note).then(function(r){
      $('lifecycleNote').value='';render(r);toast('Completed result verified and fingerprinted.');emit('verify');
    }).catch(function(err){toast('Verification failed: '+err.message,true)}).finally(function(){setBusy(false)});
  }
}
function relaunch(){
  if(L.busy||!L.review)return;
  if((L.review.verification||{}).status!=='verified'){toast('Verify the completed result before relaunching.',true);return}
  var note=requireNote();if(note===null)return;
  var e=L.review.event||{};
  if(!confirm('Relaunch "'+e.title+'" as a fresh draft? Historical tickets and winners stay untouched.'))return;
  setBusy(true);
  rpc('admin_relaunch_lottery_event',{p_event_id:L.id},note).then(function(newId){
    toast('Fresh draft created. Historical result remains unchanged.');
    emit('relaunch',{new_event_id:newId});
    $('lifecycleDialog').close();
    var tab=document.querySelector('.tabs button[data-tab="events"]');if(tab)tab.click();
  }).catch(function(err){toast('Relaunch failed: '+err.message,true)}).finally(function(){setBusy(false)});
}
function bind(){
  if(!$('lifecycleDialog'))return;
  $('closeLifecycleModal').onclick=$('lifecycleClose').onclick=function(){$('lifecycleDialog').close()};
  $('lifecycleRefresh').onclick=function(){refreshReview().catch(function(e){toast(e.message,true)})};
  $('lifecyclePrimary').onclick=primaryAction;
  $('lifecycleRelaunch').onclick=relaunch;
}
function boot(){bind();window.Draw01Lifecycle={open:openLifecycle,refresh:refreshReview}}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();