(function(){
'use strict';

var BASE='https://mwtlsnneooxmryondrex.supabase.co';
var KEY='sb_publishable_zfXYDH1qSZURp8bRHgnBrQ_7t7-3BMd';
var REF='mwtlsnneooxmryondrex';
var S={session:null,user:null,profile:null,focusEvent:null,events:[],tickets:[],tiers:[],profiles:[],ledger:[],audit:[],integrity:null,opsHealth:null,incidents:null,guardrails:null,adminChanges:null,scalability:null,eventStats:{},editing:null,editingCompleted:false,balanceUser:null,timer:null,alertTimer:null,lastSloSeverity:null,playerQuery:'',ticketQuery:''};

function $(id){return document.getElementById(id)}
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function credits(v){return Number(v||0).toLocaleString(undefined,{maximumFractionDigits:2})+' cr'}
function fmt(v){return v?new Date(v).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'—'}
function localInput(v){if(!v)return'';var d=new Date(v);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16)}
function slugify(v){return String(v||'').toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'')}
function normalize(v){return String(v||'').toLowerCase().trim()}
function nullableInt(id){var raw=$(id).value.trim();if(!raw)return null;var n=Number(raw);if(!Number.isInteger(n)||n<1)throw new Error($(id).previousElementSibling?$(id).previousElementSibling.textContent+' must be a positive whole number':'Invalid limit');return n}
function session(){try{var x=JSON.parse(localStorage.getItem('sb-'+REF+'-auth-token')||'null');if(x&&x.access_token)return x;if(x&&x.currentSession&&x.currentSession.access_token)return x.currentSession;if(x&&x.session&&x.session.access_token)return x.session;return null}catch(e){return null}}
function ensureSession(force){if(window.Draw01Shell&&window.Draw01Shell.ensureSession)return window.Draw01Shell.ensureSession(!!force).then(function(s){S.session=s||null;return S.session});S.session=S.session||session();return Promise.resolve(S.session)}
function req(path,opt,retried){opt=opt||{};return ensureSession(false).then(function(){var h=Object.assign({},opt.headers||{});h.apikey=KEY;if(S.session)h.Authorization='Bearer '+S.session.access_token;if(opt.body)h['Content-Type']='application/json';return fetch(BASE+path,Object.assign({},opt,{headers:h})).then(function(r){return r.text().then(function(t){var d;try{d=t?JSON.parse(t):null}catch(e){d=t}if(!r.ok){var er=new Error((d&&d.message)||(d&&d.error_description)||(d&&d.error)||('HTTP '+r.status));er.status=r.status;throw er}return d})})}).catch(function(e){if(!retried&&(e.status===401||e.status===403))return ensureSession(true).then(function(s){if(!s)throw e;return req(path,opt,true)});throw e})}
function rest(path,opt){return req('/rest/v1/'+path,opt)}
function rpc(name,args,reason){var h={};if(reason)h['x-admin-reason']=String(reason).slice(0,500);return rest('rpc/'+name,{method:'POST',headers:h,body:JSON.stringify(args||{})})}
function requireReason(message,suggested){var v=prompt(message,suggested||'');if(v===null)return null;v=String(v).trim();if(!v){note('A reason is required for this admin action.',true);return null}return v.slice(0,500)}
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
function eventStat(id){var e=eventById(id);if(e&&(e.ticket_count!=null||e.player_count!=null))return{ticket_count:Number(e.ticket_count||0),player_count:Number(e.player_count||0),winner_count:Number(e.winner_count||0)};return S.eventStats&&S.eventStats[id]||{}}
function ticketCount(id){return Number(eventStat(id).ticket_count||0)}
function playerCount(id){return Number(eventStat(id).player_count||0)}
function eventById(id){if(S.focusEvent&&S.focusEvent.id===id)return S.focusEvent;return S.events.find(function(e){return e.id===id})||null}
function tiersFor(id){var e=eventById(id),rows=e&&Array.isArray(e.prizes)?e.prizes:[];return rows.slice().sort(function(a,b){return Number(a.rank||0)-Number(b.rank||0)})}
function prizesFor(id){var p=tiersFor(id).map(function(t){return Number(t.prize_amount||0)});return p.length?p:[0]}
function scheduleLabel(e){return e.schedule_mode==='manual'?'Manual · open until admin draw':fmt(e.draw_at)}
function nextEvent(){return S.focusEvent||null}
function button(label,cls,fn){var b=document.createElement('button');b.type='button';b.className='btn '+(cls||'ghost')+' compact';b.textContent=label;b.onclick=fn;return b}
function info(k,v){return '<div class="info-card"><span>'+esc(k)+'</span><strong>'+esc(v)+'</strong></div>'}
function numbersHtml(t){var h='<div class="number-chips">';(t.white_numbers||[]).forEach(function(n){h+='<span>'+String(n).padStart(2,'0')+'</span>'});if(t.bonus_ball!=null)h+='<span class="bonus">'+String(t.bonus_ball).padStart(2,'0')+'</span>';return h+'</div>'}

function boot(){
  S.session=session();
  ensureSession(false).then(function(active){
    if(!active){$('gateMsg').textContent='No active Google session. Sign in on the public site, then return here.';return null}
    if(window.Draw01Shell)window.Draw01Shell.setSession(active);
    return req('/auth/v1/user').then(function(u){
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
    return load().then(function(){startAlertPolling()});
    }).catch(function(e){$('gateMsg').textContent='Admin check failed: '+e.message;note(e.message,true)})
  }).catch(function(e){$('gateMsg').textContent='Session recovery failed: '+e.message;note(e.message,true)})
}

function load(){
  return Promise.all([
    safe(rpc('admin_get_admin_scalability_snapshot',{}),null),
    safe(rpc('admin_get_admin_base_focus',{}),null),
    safe(rpc('admin_get_draw_credit_integrity_report',{}),null),
    safe(rpc('admin_get_lottery_operational_health',{}),null),
    safe(rpc('admin_get_operations_incident_center',{}),null),
    safe(rpc('admin_get_mutation_guardrails',{}),null)
  ]).then(function(x){
    S.scalability=x[0]||null;
    var base=x[1]||{};
    S.focusEvent=base.focus_event||null;
    S.audit=Array.isArray(base.recent_audit)?base.recent_audit:[];
    S.integrity=x[2]||null;S.opsHealth=x[3]||null;S.incidents=x[4]||null;S.guardrails=x[5]||null;
    S.tickets=[];S.ledger=[];S.eventStats=S.scalability&&S.scalability.event_stats||{};S.profiles=S.scalability&&Array.isArray(S.scalability.actor_profiles)?S.scalability.actor_profiles:[];
    render();
  }).catch(function(e){note('Dashboard load failed: '+e.message,true)})
}
function render(){renderStats();renderOverview();renderIntegrity();renderOperationalHealth();renderIncidents();renderLaunchStability();renderLaunchExit();renderMutationGuardrails();renderSloObservability();renderSloAlert();startCountdown()}
function renderStats(){
  var summary=S.scalability&&S.scalability.summary||{},n=nextEvent();
  $('statEvents').textContent=Number(summary.lotteries!=null?summary.lotteries:S.events.length).toLocaleString();
  $('statOpen').textContent=Number(summary.open_events||0).toLocaleString();
  $('statTickets').textContent=Number(summary.tickets||0).toLocaleString();
  $('statPlayers').textContent=Number(summary.players||0).toLocaleString();
  $('statCredits').textContent=Number(summary.draw_credits||0).toLocaleString(undefined,{maximumFractionDigits:0});
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
  if(!e){$('focusTitle').textContent='No published lottery';st.textContent='—';st.className='status-pill';root.innerHTML='<div class="overview-empty">Create or publish a lottery to make it available to players.</div>';actions.appendChild(button('+ Create lottery','primary',openCreate));renderTimeline($('overviewAudit'),S.audit.slice(0,8));return}
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
function renderIntegrity(){
  var st=$('integrityStatus'),root=$('integrityInfo'),r=S.integrity;
  if(!st||!root)return;
  if(!r){
    st.textContent='UNAVAILABLE';st.className='status-pill cancelled';
    root.innerHTML='<div class="overview-empty">Integrity report could not be loaded.</div>';
    return;
  }
  var c=r.counts||{},t=r.totals||{},ok=!!r.ok;
  st.textContent=ok?'HEALTHY':'CHECK';
  st.className='status-pill '+(ok?'completed':'cancelled');
  root.innerHTML=[
    info('Issues',String(Number(r.issue_total||0))),
    info('Balance mismatches',String(Number(c.profile_balance_mismatches||0))),
    info('Ticket ledger issues',String(Number(c.tickets_without_exact_purchase_ledger||0)+Number(c.ticket_purchase_mismatches||0)+Number(c.orphan_ticket_purchase_ledgers||0))),
    info('Prize ledger issues',String(Number(c.winner_prize_ledger_mismatches||0)+Number(c.nonwinner_prize_credits||0))),
    info('Game ledger issues',String(Number(c.slot_bet_mismatches||0)+Number(c.slot_payout_mismatches||0)+Number(c.plinko_bet_mismatches||0)+Number(c.plinko_payout_mismatches||0)+Number(c.malformed_game_ledger_rows||0))),
    info('Checked',fmt(r.checked_at)),
    info('Ledger rows',Number(t.ledger_rows||0).toLocaleString()),
    info('Tickets checked',Number(t.event_tickets||0).toLocaleString())
  ].join('');
}
function refreshIntegrity(){
  var b=$('refreshIntegrity');if(b)b.disabled=true;
  return rpc('admin_get_draw_credit_integrity_report',{}).then(function(r){S.integrity=r;renderIntegrity();note(r&&r.ok?'Integrity check passed':'Integrity check found issues',!(r&&r.ok))}).catch(function(e){note('Integrity check failed: '+e.message,true)}).finally(function(){if(b)b.disabled=false})
}
function renderOperationalHealth(){
  var st=$('opsHealthStatus'),root=$('opsHealthInfo'),hint=$('opsHealthHint'),retry=$('retryDueDraws'),r=S.opsHealth;
  if(!st||!root)return;
  if(!r){
    st.textContent='UNAVAILABLE';st.className='status-pill cancelled';
    root.innerHTML='<div class="overview-empty">Operational health could not be loaded.</div>';
    if(retry)retry.disabled=true;
    return;
  }
  var c=r.cron||{},d=r.draws||{},inc=Array.isArray(r.incidents)?r.incidents:[],ok=!!r.ok;
  st.textContent=ok?'HEALTHY':'ATTENTION';
  st.className='status-pill '+(ok?'completed':'cancelled');
  root.innerHTML=[
    info('Draw cron',c.healthy?'Healthy':'Needs attention'),
    info('Last heartbeat',fmt(c.last_run_at)),
    info('Cron failures · 24h',String(Number(c.failed_runs_24h||0))),
    info('Overdue draws',String(Number(d.overdue_scheduled||0))),
    info('Open incidents',String(Number(d.open_failure_incidents||0))),
    info('Completed · 24h',String(Number(d.completed_24h||0))),
    info('Last completed',fmt(d.last_completed_at)),
    info('Recovery','Next-minute retry')
  ].join('');
  if(hint){
    if(inc.length){
      var first=inc[0]||{};
      hint.textContent='Latest incident: '+(first.title||first.slug||String(first.event_id||'event'))+(first.last_error?' · '+first.last_error:'');
    }else hint.textContent='Automatic health check runs every 5 minutes';
  }
  if(retry)retry.disabled=Number(d.overdue_scheduled||0)===0&&Number(d.open_failure_incidents||0)===0;
}
function refreshOperationalHealth(){
  var b=$('refreshOpsHealth');if(b)b.disabled=true;
  return rpc('admin_get_lottery_operational_health',{}).then(function(r){S.opsHealth=r;renderOperationalHealth();note(r&&r.ok?'Draw operations healthy':'Draw operations need attention',!(r&&r.ok))}).catch(function(e){note('Operational health check failed: '+e.message,true)}).finally(function(){if(b)b.disabled=false})
}
function retryDueDraws(){
  if(!confirm('Retry all scheduled draws that are currently due? Each draw remains transaction-safe and failed attempts roll back.'))return;
  var reason=requireReason('Why are you manually retrying due draws?','Manual recovery retry');
  if(reason===null)return;
  var b=$('retryDueDraws');if(b)b.disabled=true;
  rpc('admin_retry_due_lottery_events',{},reason).then(function(r){S.opsHealth=r;renderOperationalHealth();note(r&&r.ok?'Due draws retried; operations are healthy':'Retry completed; some draw incidents still need attention',!(r&&r.ok));return load()}).catch(function(e){note('Retry failed: '+e.message,true)}).finally(function(){if(b)b.disabled=false})
}
function renderIncidents(){
  var r=S.incidents,st=$('incidentStatus'),sum=$('incidentSummary'),list=$('incidentList');
  if(!st||!sum||!list)return;
  if(!r){st.textContent='UNAVAILABLE';st.className='status-pill cancelled';sum.innerHTML='';list.innerHTML='<div class="record-card"><strong>Incident Center could not be loaded.</strong></div>';return}
  var c=r.counts||{},rows=Array.isArray(r.recent_incidents)?r.recent_incidents:[],ok=!!r.ok;
  st.textContent=ok?'HEALTHY':'ATTENTION';st.className='status-pill '+(ok?'completed':'cancelled');
  sum.innerHTML=[
    info('Open issues',String(Number(r.open_issue_count||0))),
    info('Cron failures · 24h',String(Number(c.cron_failures_24h||0))),
    info('Support failures · 24h',String(Number(c.support_failures_24h||0))),
    info('Payment failures · 24h',String(Number(c.payment_failures_24h||0))),
    info('Credit failures · 24h',String(Number(c.credit_request_failures_24h||0))),
    info('Auth audit events · 24h',String(Number(c.auth_audit_events_24h||0))),
    info('Checked',fmt(r.checked_at))
  ].join('');
  if(!rows.length){list.innerHTML='<div class="record-card"><strong>No application/database incidents in the last 24 hours.</strong></div>';return}
  list.innerHTML=rows.map(function(x){return '<div class="record-card"><div class="record-main"><div class="record-title"><strong>'+esc(x.title||'Incident')+'</strong><span class="status-pill '+(x.severity==='critical'?'cancelled':'locked')+'">'+esc(String(x.severity||'warning').toUpperCase())+'</span></div><div class="record-meta"><span>'+esc(x.category||'system')+'</span><span>'+esc(x.detail||'')+'</span><span>'+esc(fmt(x.created_at))+'</span></div></div></div>'}).join('')
}

function renderLaunchStability(){
  var r=S.incidents||{},l=r.launch_stability||{},current=l.current||{},win=l.window||{},counts=l.state_counts||{},st=$('launchStabilityStatus'),root=$('launchStabilityInfo'),hint=$('launchStabilityHint');
  if(!st||!root)return;
  if(!current.technical_state){
    st.textContent='UNAVAILABLE';st.className='status-pill cancelled';
    root.innerHTML='<div class="overview-empty">Launch stabilization data could not be loaded.</div>';
    if(hint)hint.textContent='Phase 8 launch evidence is unavailable.';
    return
  }
  var state=String(current.technical_state||'blocked'),ready=!!current.technical_ready,op=Array.isArray(current.operator_exceptions)?current.operator_exceptions:[],decision=String(current.launch_decision||'unknown').replace(/_/g,' ');
  st.textContent=state.toUpperCase();
  st.className='status-pill '+(state==='ready'?'completed':state==='warning'?'locked':'cancelled');
  root.innerHTML=[
    info('Technical readiness',ready?'READY':'HOLD'),
    info('Launch decision',decision),
    info('Window',String(win.status||'stabilizing').toUpperCase()),
    info('Window ends',fmt(win.ends_at)),
    info('Snapshots',String(Number(l.snapshot_count||0))),
    info('Ready snapshots',String(Number(counts.ready||0))),
    info('Warning snapshots',String(Number(counts.warning||0))),
    info('Blocked snapshots',String(Number(counts.blocked||0))),
    info('Max connection usage',String(Number(l.max_connection_usage_pct||0).toFixed(2))+'%'),
    info('Max blockers >30s',String(Number(l.max_blocked_sessions_over_30s||0))),
    info('Published lotteries',String(Number(current.published_events||0))),
    info('Operator exceptions',String(op.length))
  ].join('');
  if(hint){
    var labels=op.map(function(x){return '#'+String(x.issue||'?')+' '+String(x.key||'operator exception').replace(/_/g,' ')}).join(' · ');
    hint.textContent=op.length?'Technical state is green; operator sign-off remains for '+labels+'.':'No operator exceptions recorded.';
  }
}

function renderLaunchExit(){
  var r=S.incidents||{},x=r.launch_exit||{},st=$('launchExitStatus'),root=$('launchExitInfo'),hint=$('launchExitHint'),signoffs=$('launchOperatorSignoffs'),warnings=$('launchWarningDispositions'),approve=$('approveLaunchExit'),hold=$('holdLaunchExit');
  if(!st||!root)return;
  if(!x.exit_state){
    st.textContent='UNAVAILABLE';st.className='status-pill cancelled';
    root.innerHTML='<div class="overview-empty">Phase 8B exit data could not be loaded.</div>';
    if(hint)hint.textContent='Operator sign-off report is unavailable.';
    if(approve)approve.disabled=true;if(hold)hold.disabled=true;
    return
  }
  var state=String(x.exit_state||'blocked'),op=x.operator_signoff||{},items=Array.isArray(op.items)?op.items:[],wr=x.warning_review||{},unresolved=Array.isArray(wr.unresolved_items)?wr.unresolved_items:[],finalDecision=x.final_decision||{},reasons=Array.isArray(x.gate_reasons)?x.gate_reasons:[];
  st.textContent=state.replace(/_/g,' ').toUpperCase();
  st.className='status-pill '+(state==='signed_off'||state==='ready_for_signoff'?'completed':state==='stabilizing'?'locked':'cancelled');
  root.innerHTML=[
    info('Exit state',state.replace(/_/g,' ')),
    info('Technical state',String(x.technical_state||'unknown').toUpperCase()),
    info('Pre-signoff ready',x.pre_signoff_ready?'YES':'NO'),
    info('Fully signed off',x.fully_signed_off?'YES':'NO'),
    info('Required decisions',String(Number(op.required_total||0))),
    info('Outstanding decisions',String(Number(op.required_outstanding||0))),
    info('Warning snapshots',String(Number(wr.warning_snapshots||0))),
    info('Warnings unresolved',String(Number(wr.unresolved||0))),
    info('Final decision',String(finalDecision.decision||'pending').toUpperCase()),
    info('Window ends',fmt(x.window&&x.window.ends_at))
  ].join('');

  if(signoffs){
    signoffs.innerHTML=items.map(function(i){
      var status=String(i.status||'outstanding'),required=!!i.required_for_exit,actions='';
      if(required){
        actions='<div class="action-grid">'+
          '<button class="btn primary compact" type="button" data-launch-signoff="'+esc(i.key)+'" data-launch-status="completed">Complete</button>'+
          '<button class="btn ghost compact" type="button" data-launch-signoff="'+esc(i.key)+'" data-launch-status="accepted_risk">Accept risk</button>'+
          '<button class="btn ghost compact" type="button" data-launch-signoff="'+esc(i.key)+'" data-launch-status="deferred">Defer</button>'+
          '<button class="btn danger compact" type="button" data-launch-signoff="'+esc(i.key)+'" data-launch-status="outstanding">Reset</button>'+
        '</div>'
      }
      return '<div class="record-card"><div class="record-main"><div class="record-title"><strong>#'+esc(i.issue||'?')+' · '+esc(String(i.key||'').replace(/_/g,' '))+'</strong><span class="status-pill '+(status==='outstanding'?'locked':status==='conditional'?'': 'completed')+'">'+esc(status.replace(/_/g,' ').toUpperCase())+'</span></div><div class="record-meta"><span>'+esc(i.requirement||'')+'</span>'+(i.note?'<span>Note: '+esc(i.note)+'</span>':'')+(i.decided_at?'<span>'+esc(fmt(i.decided_at))+'</span>':'')+'</div>'+actions+'</div></div>'
    }).join('')||'<div class="record-card"><strong>No operator sign-off items.</strong></div>';
    signoffs.onclick=function(ev){
      var b=ev.target.closest('[data-launch-signoff]');if(!b)return;
      setLaunchOperatorSignoff(b.getAttribute('data-launch-signoff'),b.getAttribute('data-launch-status'))
    }
  }

  if(warnings){
    warnings.innerHTML=unresolved.map(function(w){
      var breaches=Array.isArray(w.breaches)?w.breaches.map(function(b){return String(b.signal||'warning').replace(/_/g,' ')}).join(', '):'warning';
      return '<div class="record-card"><div class="record-main"><div class="record-title"><strong>Warning snapshot #'+esc(w.snapshot_id)+'</strong><span class="status-pill locked">REVIEW</span></div><div class="record-meta"><span>'+esc(fmt(w.captured_at))+'</span><span>'+esc(breaches)+'</span></div><div class="action-grid"><button class="btn primary compact" type="button" data-launch-warning="'+esc(w.snapshot_id)+'">Disposition warning</button></div></div></div>'
    }).join('')||'<div class="record-card"><strong>No unresolved warning snapshots.</strong></div>';
    warnings.onclick=function(ev){
      var b=ev.target.closest('[data-launch-warning]');if(!b)return;
      dispositionLaunchWarning(Number(b.getAttribute('data-launch-warning')))
    }
  }

  if(hint){
    hint.textContent=reasons.length
      ?'Exit gate: '+reasons.map(function(g){return String(g.signal||'gate').replace(/_/g,' ')}).join(' · ')
      :'All exit criteria are clear. Final operator approval may be recorded.'
  }
  if(approve)approve.disabled=!x.pre_signoff_ready||x.fully_signed_off;
  if(hold)hold.disabled=x.fully_signed_off;
}

function setLaunchOperatorSignoff(key,status){
  var label=status==='accepted_risk'?'accepting this risk':status==='deferred'?'deferring this item':status==='completed'?'marking this item complete':'resetting this item to outstanding';
  var reason=status==='outstanding'?'Reset by operator':requireReason('Why are you '+label+'?','Phase 8B operator decision for '+String(key).replace(/_/g,' '));
  if(reason===null)return;
  rpc('admin_record_launch_operator_signoff',{p_key:key,p_status:status,p_note:reason},reason)
    .then(function(){note('Launch operator decision recorded');return refreshIncidents()})
    .catch(function(e){note('Launch sign-off update failed: '+e.message,true)})
}

function dispositionLaunchWarning(id){
  var reason=requireReason('Document the cause and disposition for warning snapshot #'+id+'.','Reviewed Phase 8B warning; cause understood and disposition recorded.');
  if(reason===null)return;
  rpc('admin_disposition_launch_warning',{p_snapshot_id:id,p_note:reason},reason)
    .then(function(){note('Warning snapshot dispositioned');return refreshIncidents()})
    .catch(function(e){note('Warning disposition failed: '+e.message,true)})
}

function finalizeLaunchExit(decision){
  var reason=requireReason(
    decision==='approved'?'Final Phase 8B approval note:':'Why are you holding Phase 8B exit?',
    decision==='approved'?'72-hour stabilization exit criteria reviewed and approved.':'Phase 8B exit held pending operator review.'
  );
  if(reason===null)return;
  rpc('admin_finalize_launch_stabilization',{p_decision:decision,p_note:reason},reason)
    .then(function(){note(decision==='approved'?'Phase 8B signed off':'Phase 8B exit held',decision!=='approved');return refreshIncidents()})
    .catch(function(e){note('Phase 8B final decision failed: '+e.message,true)})
}

function renderMutationGuardrails(){
  var g=S.guardrails,st=$('mutationGuardrailStatus'),root=$('mutationGuardrailInfo'),hint=$('mutationGuardrailHint'),pause=$('pauseUserMutations'),resume=$('resumeUserMutations');
  if(!st||!root)return;
  if(!g){
    st.textContent='UNAVAILABLE';st.className='status-pill cancelled';
    root.innerHTML='<div class="overview-empty">Mutation guardrail state could not be loaded.</div>';
    if(pause)pause.disabled=true;if(resume)resume.disabled=true;
    return
  }
  var master=!!g.master_enabled;
  st.textContent=master?'ENABLED':'PAUSED';st.className='status-pill '+(master?'completed':'cancelled');
  root.innerHTML=[
    info('Master mutations',master?'Enabled':'PAUSED'),
    info('Ticket purchases',g.ticket_purchases_enabled?'Enabled':'Paused'),
    info('Game writes',g.game_writes_enabled?'Enabled':'Paused'),
    info('Support claims',g.support_claims_enabled?'Enabled':'Paused'),
    info('Credit requests',g.credit_requests_enabled?'Enabled':'Paused'),
    info('Referrals',g.referral_writes_enabled?'Enabled':'Paused'),
    info('Payment orders',g.payment_orders_enabled?'Enabled':'Paused'),
    info('Last change',fmt(g.updated_at))
  ].join('');
  if(hint)hint.textContent=g.reason?('Reason: '+g.reason):'Successful user mutations are protected by server-side rate budgets.';
  if(pause)pause.disabled=!master;
  if(resume)resume.disabled=master;
}
function mutationGuardrailArgs(master,reason){
  var g=S.guardrails||{};
  return {
    p_master_enabled:!!master,
    p_ticket_purchases_enabled:g.ticket_purchases_enabled!==false,
    p_game_writes_enabled:g.game_writes_enabled!==false,
    p_support_claims_enabled:g.support_claims_enabled!==false,
    p_credit_requests_enabled:g.credit_requests_enabled!==false,
    p_referral_writes_enabled:g.referral_writes_enabled!==false,
    p_payment_orders_enabled:g.payment_orders_enabled!==false,
    p_reason:reason
  }
}
function setMasterMutationGuardrail(enabled){
  var reason=requireReason(
    enabled?'Why are you resuming user mutations?':'Why are you pausing all user mutations?',
    enabled?'Production recovery verified; resume user mutations':'Emergency production mutation pause'
  );
  if(reason===null)return;
  var pause=$('pauseUserMutations'),resume=$('resumeUserMutations');
  if(pause)pause.disabled=true;if(resume)resume.disabled=true;
  rpc('admin_set_mutation_guardrails',mutationGuardrailArgs(enabled,reason),reason).then(function(r){
    S.guardrails=r;renderMutationGuardrails();
    note(enabled?'User mutations resumed':'All protected user mutations paused',!enabled);
  }).catch(function(e){note('Mutation guardrail update failed: '+e.message,true);renderMutationGuardrails()})
}
function refreshMutationGuardrails(){
  return rpc('admin_get_mutation_guardrails',{}).then(function(r){S.guardrails=r;renderMutationGuardrails();return r})
}

function sloClass(severity){return severity==='critical'?'cancelled':severity==='warning'?'locked':'completed'}
function sloSignals(rows){
  if(!Array.isArray(rows)||!rows.length)return'No active breach signals';
  return rows.slice(0,4).map(function(x){return String(x.signal||x.category||'signal').replace(/_/g,' ')}).join(' · ')
}
function openIncidentsTab(){
  var b=document.querySelector('.tabs button[data-tab="incidents"]');
  if(b)activateTab(b);
  var target=$('sloObservabilityPanel');if(target)target.scrollIntoView({behavior:'smooth',block:'start'})
}
function renderSloAlert(){
  var banner=$('sloAlertBanner');if(!banner)return;
  var r=S.incidents||{},slo=r.production_slo||{},severity=String(slo.severity||'ok'),pending=Number(r.pending_slo_ack_count||0);
  if(severity==='ok'&&pending===0){banner.hidden=true;banner.className='slo-alert-banner glass';return}
  banner.hidden=false;banner.className='slo-alert-banner glass '+(severity==='critical'?'critical':'warning');
  var label=severity==='critical'?'CRITICAL':severity==='warning'?'WARNING':'ACK NEEDED';
  $('sloAlertSeverity').textContent=label;$('sloAlertSeverity').className='status-pill '+sloClass(severity==='ok'?'warning':severity);
  $('sloAlertTitle').textContent=severity==='ok'?'Production incident needs acknowledgement':'Production SLO '+severity;
  var detail=sloSignals(slo.breaches);
  if(pending)detail+=(detail?' · ':'')+pending+' active breach'+(pending===1?'':'es')+' awaiting acknowledgement';
  $('sloAlertDetail').textContent=detail;
  $('sloAlertOpenIncidents').onclick=openIncidentsTab
}
function renderSloObservability(){
  var r=S.incidents||{},slo=r.production_slo,hist=r.slo_history,st=$('sloStatus'),summary=$('sloSummary'),history=$('sloHistorySummary'),eventsRoot=$('sloEventList');
  if(!st||!summary||!history||!eventsRoot)return;
  if(!slo){
    st.textContent='UNAVAILABLE';st.className='status-pill cancelled';
    summary.innerHTML='<div class="overview-empty">Production SLO data could not be loaded.</div>';history.innerHTML='';eventsRoot.innerHTML='';
    return
  }
  var severity=String(slo.severity||'critical'),db=slo.database||{},cron=slo.cron||{},support=slo.support||{},delivery=r.alert_delivery||{};
  st.textContent=severity.toUpperCase();st.className='status-pill '+sloClass(severity);
  summary.innerHTML=[
    info('Connection usage',String(Number(db.connection_usage_pct||0).toFixed(2))+'%'),
    info('Blocked >30s',String(Number(db.blocked_sessions_over_30s||0))),
    info('Idle tx >60s',String(Number(db.idle_in_transaction_over_60s||0))),
    info('Table cache',String(Number(db.table_cache_hit_pct||0).toFixed(2))+'%'),
    info('Index cache',String(Number(db.index_cache_hit_pct||0).toFixed(2))+'%'),
    info('Cron failures · 15m',String(Number(cron.failed_15m||0))),
    info('Missing required cron',String(Number(cron.missing_required_jobs||0))),
    info('Support integrity',Number(support.duplicate_settlements||0)+Number(support.orphan_claims||0)+' issues'),
    info('Pending acknowledgements',String(Number(r.pending_slo_ack_count||0))),
    info('Admin alert polling',(delivery.admin_polling_seconds||60)+'s'),
    info('External delivery',delivery.enabled?'Enabled':'Disabled'),
    info('Alert channel',String(delivery.channel||'webhook').toUpperCase()),
    info('Telegram bot',delivery.channel==='telegram'?(delivery.telegram_bot_configured?'Configured':'Needs token'):(delivery.external_webhook_configured?'Webhook verified':'Webhook not configured')),
    info('Telegram chat',delivery.channel==='telegram'?(delivery.telegram_chat_configured?'Paired':'Needs pairing'):'—'),
    info('Alert queue',String(Number(delivery.pending_count||0))+' pending · '+String(Number(delivery.in_flight_count||0))+' in flight'),
    info('Dead letters',String(Number(delivery.dead_letter_count||0))),
    info('Delivered · 24h',String(Number(delivery.delivered_24h||0))),
    info('Dispatcher cron',delivery.dispatcher_cron_active?'Active':'Missing'),
    info('Last delivery',fmt(delivery.last_delivery_at)),
    info('Checked',fmt(slo.checked_at))
  ].join('');
  var counts=hist&&hist.severity_counts||{};
  history.innerHTML=[
    info('Snapshots · 24h',String(Number(hist&&hist.snapshot_count||0))),
    info('Healthy',String(Number(counts.ok||0))),
    info('Warning',String(Number(counts.warning||0))),
    info('Critical',String(Number(counts.critical||0))),
    info('Unacknowledged · 7d',String(Number(r.unacknowledged_slo_breaches_7d||0))),
    info('Escalation policy','Critical '+String(Number(delivery.critical_escalation_1_minutes||5))+'m · Warning '+String(Number(delivery.warning_escalation_1_minutes||15))+'m · Level 2 '+String(Number(delivery.escalation_2_minutes||30))+'m'),
    info('Delivery retries','Up to '+String(Number(delivery.max_attempts||6))+' attempts')
  ].join('');
  var rows=Array.isArray(r.slo_events)?r.slo_events:[];
  if(!rows.length){eventsRoot.innerHTML='<div class="record-card"><strong>No SLO breach/recovery events in the last 7 days.</strong></div>';return}
  eventsRoot.innerHTML=rows.map(function(x){
    var breach=x.action==='production_slo_breached',sev=String(x.severity||'warning'),signals=sloSignals(x.breaches),ack=x.acknowledged;
    var ackMeta=ack?'<span>Acknowledged by '+esc(x.acknowledged_by_name||x.acknowledged_by_email||'admin')+' · '+esc(fmt(x.acknowledged_at))+'</span><span>'+esc(x.acknowledgement_note||'')+'</span>':'';
    var action=breach&&!ack?'<button type="button" class="btn primary compact" data-slo-ack="'+esc(x.id)+'">Acknowledge</button>':'';
    return '<div class="record-card slo-event-card"><div class="record-main"><div class="record-title"><strong>'+esc(breach?'SLO breach':'SLO recovered')+'</strong><span class="status-pill '+sloClass(sev)+'">'+esc(sev.toUpperCase())+'</span>'+(ack?'<span class="muted-pill">ACKNOWLEDGED</span>':'')+'</div><div class="record-meta"><span>'+esc(signals)+'</span><span>'+esc(fmt(x.created_at))+'</span>'+ackMeta+'</div></div><div class="record-actions slo-event-actions">'+action+'</div></div>'
  }).join('');
  eventsRoot.querySelectorAll('[data-slo-ack]').forEach(function(b){b.onclick=function(){acknowledgeSloIncident(Number(b.getAttribute('data-slo-ack')))}})
}
function acknowledgeSloIncident(id){
  var reason=requireReason('Add an acknowledgement note for this production SLO breach.','Investigating production SLO breach');
  if(reason===null)return;
  rpc('admin_acknowledge_production_incident',{p_audit_log_id:id,p_note:reason},reason).then(function(){
    note('Production incident acknowledged');
    return refreshIncidents()
  }).catch(function(e){note('Acknowledgement failed: '+e.message,true)})
}
function pollIncidentAlerts(){
  if(document.hidden||!S.session)return Promise.resolve();
  return Promise.all([
    rpc('admin_get_operations_incident_center',{}),
    rpc('admin_get_mutation_guardrails',{})
  ]).then(function(x){
    var r=x[0],previous=S.lastSloSeverity,current=String(r&&r.production_slo&&r.production_slo.severity||'ok');
    S.incidents=r;S.guardrails=x[1]||S.guardrails;S.lastSloSeverity=current;
    renderIncidents();renderLaunchStability();renderLaunchExit();renderMutationGuardrails();renderSloObservability();renderSloAlert();
    if(previous&&previous==='ok'&&current!=='ok')note('Production SLO changed to '+current.toUpperCase(),true);
    if(previous&&previous!=='ok'&&current==='ok')note('Production SLO recovered');
  }).catch(function(e){console.warn('Phase 7F operations poll failed',e)})
}
function startAlertPolling(){
  clearInterval(S.alertTimer);
  S.lastSloSeverity=String(S.incidents&&S.incidents.production_slo&&S.incidents.production_slo.severity||'ok');
  S.alertTimer=setInterval(pollIncidentAlerts,60000)
}

function renderAdminChanges(){
  var r=S.adminChanges||{},rows=Array.isArray(r.rows)?r.rows:[],root=$('adminChangeList'),summary=$('adminChangeSummary');
  if(!root||!summary)return;
  summary.textContent=Number(r.count_24h||0)+' changes in last 24h';
  if(!rows.length){root.innerHTML='<div class="record-card"><strong>No canonical admin changes recorded yet.</strong></div>';return}
  root.innerHTML=rows.map(function(x){
    var actor=x.actor_name||x.actor_email||'Admin';
    var before=x.old_data?JSON.stringify(x.old_data):'—',after=x.new_data?JSON.stringify(x.new_data):'—';
    return '<div class="record-card"><div class="record-main"><div class="record-title"><strong>'+esc(String(x.action||'admin change').replace(/_/g,' '))+'</strong><span class="status-pill">'+esc(x.table_name||'record')+'</span></div><div class="record-meta"><span>'+esc(actor)+'</span><span>Reason: '+esc(x.reason||'Not supplied')+'</span><span>Row '+esc(x.row_id||'—')+'</span><span>'+esc(fmt(x.created_at))+'</span></div><details><summary>Before / after</summary><div class="record-meta"><span>Before: '+esc(before)+'</span><span>After: '+esc(after)+'</span></div></details></div></div>'
  }).join('')
}
function refreshIncidents(){
  var b=$('refreshIncidents');if(b)b.disabled=true;
  return Promise.all([rpc('admin_get_operations_incident_center',{}),rpc('admin_get_mutation_guardrails',{})]).then(function(x){var r=x[0];S.incidents=r;S.guardrails=x[1]||S.guardrails;S.lastSloSeverity=String(r&&r.production_slo&&r.production_slo.severity||'ok');renderIncidents();renderLaunchStability();renderLaunchExit();renderMutationGuardrails();renderSloObservability();renderSloAlert();note(r&&r.ok?'Incident Center healthy':'Incident Center found issues',!(r&&r.ok))}).catch(function(e){note('Incident refresh failed: '+e.message,true)}).finally(function(){if(b)b.disabled=false})
}
function refreshAdminChanges(){if(window.Draw01RemainingScalability)return window.Draw01RemainingScalability.loadAdminChanges(true);return Promise.resolve()}

function canRun(e){if(e.status!=='published')return false;if(ticketCount(e.id)<Number(e.winner_count||1))return false;if(e.schedule_mode==='manual')return true;return !e.cutoff_at||Date.now()>=new Date(e.cutoff_at).getTime()}
function lifecycleOpen(e,intent){if(window.Draw01Lifecycle)window.Draw01Lifecycle.open(e,intent);else note('Lifecycle review is still loading. Try again.',true)}
function appendEventActions(root,e){
  root.appendChild(button('View public page','ghost',function(){window.open('lottery.html?e='+encodeURIComponent(e.slug),'_blank')}));
  root.appendChild(button('Edit','ghost',function(){openEdit(e)}));
  if(e.status==='draft')root.appendChild(button('Review & publish','primary',function(){lifecycleOpen(e,'publish')}));
  if(e.status==='published')root.appendChild(button(canRun(e)?'Pre-draw review':'Review readiness',canRun(e)?'primary':'ghost',function(){lifecycleOpen(e,'draw')}));
  if(e.status==='completed')root.appendChild(button('Verify result','primary',function(){lifecycleOpen(e,'verify')}));
  if(e.status==='published'||e.status==='draft')root.appendChild(button('Cancel','danger',function(){changeStatus(e,'cancelled')}));
  if((e.status==='draft'||e.status==='cancelled')&&ticketCount(e.id)===0)root.appendChild(button('Delete','danger',function(){deleteEvent(e)}));
}
function prizeTierHtml(e){var ts=tiersFor(e.id);if(!ts.length)return'<div class="empty-sub">No prize tiers configured.</div>';return'<div class="tier-strip">'+ts.map(function(t){return'<div><span>#'+t.rank+'</span><strong>'+credits(t.prize_amount)+'</strong></div>'}).join('')+'</div>'}
function participantHtml(e,tickets){
  var ts=tickets||ticketsFor(e.id),pm=pmap();if(!ts.length)return'<div class="empty-sub">No tickets in this lottery yet.</div>';
  var groups={};ts.forEach(function(t){(groups[t.user_id]||(groups[t.user_id]=[])).push(t)});
  return Object.keys(groups).map(function(uid){
    var p=pm[uid]||{},arr=groups[uid];
    return '<div class="participant-card"><div class="participant-head"><div><strong>'+esc(p.display_name||p.email||'Player')+'</strong><span>'+esc(p.email||'')+' · '+arr.length+' ticket'+(arr.length===1?'':'s')+'</span></div><div class="participant-head-actions"><span class="credit-balance">'+credits(p.balance||0)+'</span><button class="btn ghost compact inv-inline-action" type="button" data-investigate-player="'+esc(uid)+'">Investigate player</button></div></div><div class="participant-tickets">'+arr.map(function(t){
      return '<div class="ticket-line"><div><b>Ticket '+esc(String(t.id).slice(0,8))+'</b>'+(t.is_winner?'<span class="winner-rank">#'+t.winner_rank+' WINNER</span>':'')+'</div>'+numbersHtml(t)+'<div class="ticket-meta"><span>'+credits(t.price_paid)+'</span><span>'+esc(fmt(t.created_at))+'</span>'+(t.is_winner?'<strong>'+credits(t.prize_awarded)+' prize</strong>':'')+'</div><button class="btn ghost compact inv-inline-action" type="button" data-investigate-ticket="'+esc(t.id)+'">Inspect ticket</button></div>'
    }).join('')+'</div></div>'
  }).join('')
}
function buildEventCard(e){
  var tc=Number(e.ticket_count!=null?e.ticket_count:ticketCount(e.id)),pc=Number(e.player_count!=null?e.player_count:playerCount(e.id)),card=document.createElement('article');
  card.className='admin-event-record-card';card.tabIndex=0;card.setAttribute('role','button');card.setAttribute('aria-label','Edit '+(e.title||'lottery'));card.dataset.eventId=e.id||'';
  card.innerHTML='<div class="admin-event-cover"><span>LOTTERY</span></div><div class="admin-event-card-body"><div class="admin-event-card-top"><span class="status-pill '+statusView(e)+'">'+esc(statusLabel(e))+'</span><small>'+esc(scheduleLabel(e))+'</small></div><h3>'+esc(e.title)+'</h3><p>'+esc(e.description||'No lottery description yet.')+'</p><div class="admin-event-card-metrics"><span><b>'+tc+'</b> tickets</span><span><b>'+pc+'</b> players</span><span><b>'+Number(e.winner_count||1)+'</b> winners</span><span><b>'+credits(e.ticket_price)+'</b> entry</span></div><div class="admin-event-card-actions"></div></div>';
  var cover=card.querySelector('.admin-event-cover');
  if(e.cover_image_url){cover.classList.add('has-image');cover.style.backgroundImage='linear-gradient(180deg,rgba(3,8,10,.03),rgba(3,8,10,.62)),url("'+String(e.cover_image_url).replace(/"/g,'%22')+'")';cover.innerHTML=''}
  var actions=card.querySelector('.admin-event-card-actions');actions.addEventListener('click',function(ev){ev.stopPropagation()});appendEventActions(actions,e);
  card.onclick=function(){openEdit(e)};card.onkeydown=function(ev){if(ev.target!==card)return;if(ev.key==='Enter'||ev.key===' '){ev.preventDefault();openEdit(e)}};
  return card
}
function renderEvents(){
  var f=$('eventStatusFilter').value||'all',rows=S.events.filter(function(e){return f==='all'||e.status===f}),root=$('eventList');
  $('eventSummary').textContent=rows.length+' loaded';root.innerHTML='';
  if(!rows.length){root.innerHTML='<div class="empty-sub">No lotteries found.</div>';return}
  rows.forEach(function(e){root.appendChild(buildEventCard(e))})
}
function ticketMatches(t,e,pm,q){if(!q)return true;var p=pm[t.user_id]||{};return normalize([t.id,e&&e.title,p.display_name,p.email,t.winner_rank].join(' ')).indexOf(q)>=0}
function renderTickets(){
  var filter=$('ticketEventFilter'),root=$('ticketEventList'),pm=pmap(),prev=filter.value||'all';
  filter.innerHTML='<option value="all">All lotteries</option>'+S.events.map(function(e){return'<option value="'+esc(e.id)+'">'+esc(e.title)+'</option>'}).join('');
  if(Array.prototype.some.call(filter.options,function(o){return o.value===prev}))filter.value=prev;
  var selected=filter.value||'all',q=S.ticketQuery,shown=0,groups=[];
  S.events.forEach(function(e){
    if(selected!=='all'&&selected!==e.id)return;
    var ts=ticketsFor(e.id).filter(function(t){return ticketMatches(t,e,pm,q)});if(!ts.length)return;
    shown+=ts.length;groups.push({event:e,tickets:ts})
  });
  $('ticketSummary').textContent=shown+' ticket'+(shown===1?'':'s');root.innerHTML='';
  if(!groups.length){root.innerHTML='<div class="empty-sub">No tickets matched this view.</div>';return}
  groups.forEach(function(g){var e=g.event,section=document.createElement('section');section.className='ticket-event-group';section.innerHTML='<div class="ticket-event-head"><div><span class="eyebrow">'+esc(statusLabel(e))+'</span><h3>'+esc(e.title)+'</h3><p>'+g.tickets.length+' ticket'+(g.tickets.length===1?'':'s')+' shown · '+playerCount(e.id)+' total players</p></div><button class="btn ghost compact" type="button">Edit lottery</button></div><div class="participant-list">'+participantHtml(e,g.tickets)+'</div>';
    var editButton=section.querySelector('.ticket-event-head > button');if(editButton)editButton.onclick=function(){openEdit(e)};
    section.querySelectorAll('[data-investigate-player]').forEach(function(b){b.onclick=function(){if(window.Draw01Investigation)window.Draw01Investigation.openPlayer(b.getAttribute('data-investigate-player'));else note('Investigation workspace is still loading.',true)}});
    section.querySelectorAll('[data-investigate-ticket]').forEach(function(b){b.onclick=function(){if(window.Draw01Investigation)window.Draw01Investigation.openTicket(b.getAttribute('data-investigate-ticket'));else note('Investigation workspace is still loading.',true)}});
    root.appendChild(section)
  })
}

function renderWinners(){
  var root=$('winnerList'),pm=pmap();root.innerHTML='';
  var events=S.events.filter(function(e){return ticketsFor(e.id).some(function(t){return t.is_winner})});
  if(!events.length){root.innerHTML='<div class="empty-sub">No completed-lottery winners yet.</div>';return}
  events.forEach(function(e){var wins=ticketsFor(e.id).filter(function(t){return t.is_winner}).sort(function(a,b){return Number(a.winner_rank||999)-Number(b.winner_rank||999)}),group=document.createElement('section');group.className='winner-admin-event';group.innerHTML='<div class="winner-admin-event-head"><div><span class="eyebrow">RESULT ARCHIVE</span><h3>'+esc(e.title)+'</h3><p>'+wins.length+' winning ticket'+(wins.length===1?'':'s')+' · '+esc(fmt(e.drawn_at||e.draw_at))+'</p></div><span class="status-pill completed">COMPLETED</span></div><div class="winner-admin-grid">'+wins.map(function(t){var p=pm[t.user_id]||{};return'<article class="winner-admin-card"><div class="winner-rank-badge">#'+esc(t.winner_rank||'—')+'</div><div><strong>'+esc(p.display_name||p.email||'Player')+'</strong><span>'+esc(p.email||'')+'</span></div>'+numbersHtml(t)+'<b>'+credits(t.prize_awarded)+' prize</b></article>'}).join('')+'</div>';root.appendChild(group)})
}

function renderPlayers(){
  var root=$('playerList'),q=S.playerQuery,rows=S.profiles.filter(function(p){return !q||normalize([p.display_name,p.email,p.role,p.balance].join(' ')).indexOf(q)>=0});root.innerHTML='';$('playerSummary').textContent=rows.length+' of '+S.profiles.length+' players';
  if(!rows.length){root.innerHTML='<div class="record-card"><strong>No users matched this search</strong></div>';return}
  rows.forEach(function(p){
    var row=document.createElement('div');row.className='record-card';
    var main=document.createElement('div');main.className='record-main';
    main.innerHTML='<div class="record-title"><strong>'+esc(p.display_name||'Player')+'</strong><span class="status-pill">'+esc((p.role||'player').toUpperCase())+'</span></div><div class="record-meta"><span>'+esc(p.email||'')+'</span><span class="credit-balance">'+credits(p.balance)+'</span><span>Joined '+esc(fmt(p.created_at))+'</span></div>';
    var a=document.createElement('div');a.className='record-actions';a.appendChild(button('Investigate','ghost',function(){if(window.Draw01Investigation)window.Draw01Investigation.openPlayer(p.id);else note('Investigation workspace is still loading.',true)}));a.appendChild(button('Set balance','primary',function(){openBalance(p)}));
    var role=document.createElement('select');role.className='role-select';role.innerHTML='<option value="player">Player</option><option value="admin">Admin</option>';role.value=p.role;role.disabled=S.user&&p.id===S.user.id;
    role.onchange=function(){var previous=p.role;var reason=requireReason('Why are you changing this user role?','Role change for '+(p.display_name||p.email||'user'));if(reason===null){role.value=previous;return}rpc('admin_set_user_role',{p_user_id:p.id,p_role:role.value},reason).then(function(){note('Role updated');return load()}).catch(function(e){role.value=previous;note(e.message,true)})};
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
function renderTimeline(root,rows){root.innerHTML='';var pm=pmap();if(!rows.length){root.innerHTML='<div class="overview-empty">No activity yet.</div>';return}rows.forEach(function(a){var el=document.createElement('div');el.className='timeline-item';el.innerHTML='<i class="timeline-dot"></i><div><strong>'+esc(String(a.action||'activity').replace(/_/g,' '))+'</strong><small>'+esc(a.actor_name||(pm[a.actor_user_id]||{}).display_name||'System')+(a.entity_type?' · '+a.entity_type:'')+'</small></div><time>'+esc(fmt(a.created_at))+'</time>';root.appendChild(el)})}
function renderAudit(){renderTimeline($('auditList'),S.audit)}

function defaults(){var n=Date.now();return{open:new Date(n+5*60000),cut:new Date(n+65*60000),draw:new Date(n+70*60000)}}
function setFieldDisabled(ids,disabled){ids.forEach(function(id){if($(id))$(id).disabled=!!disabled})}
function setLockedFields(locked){setFieldDisabled(['fPrice','fWhiteCount','fWhiteMax','fBonusEnabled','fBonusMax'],locked);$('eventFormHint').textContent=locked?'Ticket price and number rules are locked because this lottery already has tickets. Capacity limits, prizes and schedule can still be adjusted within backend safety rules.':'';$('eventFormHint').className='form-hint'+(locked?' warn':'')}
function setCompletedFields(completed){setFieldDisabled(['fPrice','fLimit','fMaxPlayers','fMaxTotalTickets','fWhiteCount','fWhiteMax','fBonusEnabled','fBonusMax','fScheduleMode','fOpen','fCutoff','fDraw','fStatus','fWinnerCount'],completed);$('winnerPrizeFields').querySelectorAll('input').forEach(function(x){x.disabled=completed});if(completed){$('eventFormHint').textContent='This draw is completed. Historical ticket rules, schedule, winners and prizes are locked. You can safely edit the title, slug, description and cover photo.';$('eventFormHint').className='form-hint warn'}}
function resetEventDisabled(){setFieldDisabled(['fPrice','fLimit','fMaxPlayers','fMaxTotalTickets','fWhiteCount','fWhiteMax','fBonusEnabled','fBonusMax','fScheduleMode','fOpen','fCutoff','fDraw','fStatus','fWinnerCount'],false);$('winnerPrizeFields').querySelectorAll('input').forEach(function(x){x.disabled=false})}
function syncBonusField(){if(!$('fBonusEnabled').disabled)$('fBonusMax').disabled=!$('fBonusEnabled').checked}
function syncSchedule(){var manual=$('fScheduleMode').value==='manual';document.querySelectorAll('.schedule-only').forEach(function(x){x.style.display=manual?'none':''});$('fCutoff').required=!manual;$('fDraw').required=!manual}
function renderPrizeFields(values){
  var count=Math.max(1,Math.min(100,Number($('fWinnerCount').value)||1)),root=$('winnerPrizeFields'),old=values||Array.from(root.querySelectorAll('input')).map(function(x){return Number(x.value||0)});root.innerHTML='';
  for(var i=0;i<count;i++){var label=document.createElement('label');label.className='winner-prize-field';label.innerHTML='<span>Winner #'+(i+1)+'</span><input type="number" min="0" step="1" value="'+Number(old[i]!=null?old[i]:(i===0?1000:0))+'" data-rank="'+(i+1)+'" required>';root.appendChild(label)}
  root.querySelectorAll('input').forEach(function(x){x.oninput=syncPrizeTotal});syncPrizeTotal()
}
function syncPrizeTotal(){var total=Array.from($('winnerPrizeFields').querySelectorAll('input')).reduce(function(a,x){return a+Number(x.value||0)},0);$('prizeTotal').textContent='Total: '+credits(total)}
function openCreate(){
  S.editing=null;S.editingCompleted=false;resetEventDisabled();var d=defaults();$('eventModalKicker').textContent='CREATE LOTTERY';$('eventModalTitle').textContent='New public lottery';$('saveEventBtn').textContent='Create lottery';
  $('fTitle').value='';$('fSlug').value='';delete $('fSlug').dataset.touched;$('fDescription').value='';$('fPrice').value=10;$('fLimit').value=5;$('fMaxPlayers').value='';$('fMaxTotalTickets').value='';$('fWhiteCount').value=5;$('fWhiteMax').value=69;$('fBonusEnabled').checked=true;$('fBonusMax').value=26;$('fScheduleMode').value='scheduled';$('fOpen').value=localInput(d.open);$('fCutoff').value=localInput(d.cut);$('fDraw').value=localInput(d.draw);$('fStatus').value='draft';$('fWinnerCount').value=1;
  setLockedFields(false);syncBonusField();syncSchedule();renderPrizeFields([1000]);$('eventDialog').showModal()
}
function openEdit(e){
  S.editing=e;S.editingCompleted=e.status==='completed';resetEventDisabled();$('eventModalKicker').textContent=e.status==='completed'?'EDIT COMPLETED LOTTERY':'EDIT LOTTERY';$('eventModalTitle').textContent=e.title;$('saveEventBtn').textContent='Save changes';
  $('fTitle').value=e.title||'';$('fSlug').value=e.slug||'';$('fSlug').dataset.touched='1';$('fDescription').value=e.description||'';$('fPrice').value=Number(e.ticket_price);$('fLimit').value=e.max_tickets_per_user;$('fMaxPlayers').value=e.max_players==null?'':e.max_players;$('fMaxTotalTickets').value=e.max_total_tickets==null?'':e.max_total_tickets;$('fWhiteCount').value=e.white_ball_count;$('fWhiteMax').value=e.white_ball_max;$('fBonusEnabled').checked=!!e.bonus_ball_enabled;$('fBonusMax').value=e.bonus_ball_max;$('fScheduleMode').value=e.schedule_mode||'scheduled';$('fOpen').value=localInput(e.opens_at);$('fCutoff').value=localInput(e.cutoff_at);$('fDraw').value=localInput(e.draw_at);$('fStatus').value=e.status;$('fWinnerCount').value=e.winner_count||prizesFor(e.id).length||1;
  renderPrizeFields(prizesFor(e.id));setLockedFields(ticketCount(e.id)>0);syncBonusField();syncSchedule();if(S.editingCompleted)setCompletedFields(true);$('eventDialog').showModal()
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
  ev.preventDefault();
  var p,label=S.editing?'Lottery updated':'Lottery created',reason,targetStatus=$('fStatus').value,wantsPublish=targetStatus==='published';
  if(S.editing){
    reason=requireReason('Why are you changing this lottery?',S.editingCompleted?'Completed lottery metadata correction':'Lottery configuration update');
    if(reason===null)return
  }else reason='Created lottery: '+($('fTitle').value.trim()||'Untitled lottery');

  if(S.editingCompleted){
    p=rpc('admin_update_completed_event_metadata',{p_event_id:S.editing.id,p_title:$('fTitle').value.trim(),p_slug:$('fSlug').value.trim()||slugify($('fTitle').value),p_description:$('fDescription').value.trim()},reason)
  }else{
    var a;try{a=formArgs()}catch(e){note(e.message,true);return}
    if(S.editing){
      a.p_event_id=S.editing.id;
      if(wantsPublish&&S.editing.status!=='published'){
        if(S.editing.status!=='draft'){note('Cancelled lotteries cannot be republished. Create or relaunch a fresh draft instead.',true);return}
        a.p_status='draft';
        p=rpc('admin_update_lottery_event_v3',a,reason).then(function(){
          return rpc('admin_publish_lottery_event',{p_event_id:S.editing.id},reason)
        })
      }else{
        a.p_status=targetStatus;
        p=rpc('admin_update_lottery_event_v3',a,reason)
      }
    }else{
      var publishAfterCreate=wantsPublish,title=$('fTitle').value.trim()||'Untitled lottery';
      a.p_publish=false;
      p=rpc('admin_create_lottery_event_v3',a,reason).then(function(id){
        if(!publishAfterCreate)return id;
        return rpc('admin_publish_lottery_event',{p_event_id:id},'Initial publish approved: '+title)
      })
    }
  }

  $('saveEventBtn').disabled=true;
  p.then(function(){$('eventDialog').close();note(label);S.editing=null;S.editingCompleted=false;document.dispatchEvent(new CustomEvent('draw01:admin-data-changed',{detail:{scope:'events'}}));return load()}).catch(function(e){note(e.message,true)}).finally(function(){$('saveEventBtn').disabled=false})
}
function statusArgs(e,status){return{
  p_event_id:e.id,p_title:e.title,p_slug:e.slug,p_description:e.description||'',p_ticket_price:Number(e.ticket_price),p_max_tickets_per_user:e.max_tickets_per_user,
  p_max_players:e.max_players==null?null:Number(e.max_players),p_max_total_tickets:e.max_total_tickets==null?null:Number(e.max_total_tickets),
  p_white_ball_count:e.white_ball_count,p_white_ball_max:e.white_ball_max,p_bonus_ball_enabled:e.bonus_ball_enabled,p_bonus_ball_max:e.bonus_ball_max,
  p_schedule_mode:e.schedule_mode||'scheduled',p_opens_at:e.opens_at,p_cutoff_at:e.cutoff_at,p_draw_at:e.draw_at,p_winner_prizes:prizesFor(e.id),p_status:status
}}
function changeStatus(e,status){var msg=status==='cancelled'?'Cancel this lottery? Existing tickets remain recorded.':'Publish this lottery to the public site?';if(!confirm(msg))return;var reason=requireReason('Why are you '+(status==='cancelled'?'cancelling':'publishing')+' this lottery?',status==='cancelled'?'Lottery cancelled by admin':'Lottery approved for publication');if(reason===null)return;rpc('admin_update_lottery_event_v3',statusArgs(e,status),reason).then(function(){note('Lottery '+status);document.dispatchEvent(new CustomEvent('draw01:admin-data-changed',{detail:{scope:'events'}}));return load()}).catch(function(x){note(x.message,true)})}
function deleteEvent(e){if(!confirm('Permanently delete this lottery? This is only allowed when it has no tickets.'))return;var reason=requireReason('Why are you permanently deleting this lottery?','Unused lottery cleanup');if(reason===null)return;rpc('admin_delete_lottery_event',{p_event_id:e.id},reason).then(function(){note('Lottery deleted');document.dispatchEvent(new CustomEvent('draw01:admin-data-changed',{detail:{scope:'events'}}));return load()}).catch(function(x){note(x.message,true)})}
function runEvent(e){
  var tc=ticketCount(e.id),wc=Number(e.winner_count||1);if(tc<wc){note('This lottery needs at least '+wc+' tickets before drawing '+wc+' winners.',true);return}
  if(!confirm('Run the secure ticket-pool draw now? Winners will be selected only from this lottery’s '+tc+' existing tickets.'))return;
  var reason=requireReason('Why are you manually running this draw?','Manual draw execution');if(reason===null)return;
  rpc('admin_run_lottery_event',{p_event_id:e.id},reason).then(function(){note('Lottery draw completed');document.dispatchEvent(new CustomEvent('draw01:admin-data-changed',{detail:{scope:'events'}}));return load()}).catch(function(x){note(x.message,true)})
}

function openBalance(p){S.balanceUser=p;$('balanceTitle').textContent=p.display_name||'Player';$('balanceEmail').textContent=(p.email||'')+' · Current '+credits(p.balance);$('balanceInput').value=Number(p.balance||0);$('balanceNote').value='';$('balanceDialog').showModal()}
function saveBalance(ev){ev.preventDefault();if(!S.balanceUser)return;var amount=Number($('balanceInput').value),reason=$('balanceNote').value.trim();if(!Number.isFinite(amount)||amount<0){note('Balance must be zero or greater',true);return}if(!reason){note('Admin reason is required.',true);return}rpc('admin_set_user_balance',{p_user_id:S.balanceUser.id,p_balance:amount,p_note:reason},reason).then(function(){$('balanceDialog').close();note('Balance updated');document.dispatchEvent(new CustomEvent('draw01:admin-data-changed',{detail:{scope:'balance',user_id:S.balanceUser.id}}));return load()}).catch(function(e){note(e.message,true)})}

function activateTab(buttonEl){var target=$(buttonEl.dataset.tab);if(!target)return;document.querySelectorAll('.tabs button').forEach(function(x){x.classList.remove('active')});document.querySelectorAll('.tab').forEach(function(x){x.classList.remove('active')});buttonEl.classList.add('active');target.classList.add('active');if(buttonEl.dataset.tab==='support'){if(window.Draw01SupportAdmin)window.Draw01SupportAdmin.refresh();if(window.Draw01SupportWalletAdmin)window.Draw01SupportWalletAdmin.refresh()}}
function bind(){
  document.querySelectorAll('.tabs button').forEach(function(b){b.onclick=function(){activateTab(b)}});
  $('retryBtn').onclick=boot;
  if($('topCreate'))$('topCreate').onclick=openCreate;
  $('heroCreate').onclick=openCreate;$('createEventBtn').onclick=openCreate;$('refreshOverview').onclick=load;$('refreshAudit').onclick=load;if($('refreshIntegrity'))$('refreshIntegrity').onclick=refreshIntegrity;if($('pauseUserMutations'))$('pauseUserMutations').onclick=function(){setMasterMutationGuardrail(false)};if($('resumeUserMutations'))$('resumeUserMutations').onclick=function(){setMasterMutationGuardrail(true)};if($('refreshOpsHealth'))$('refreshOpsHealth').onclick=refreshOperationalHealth;if($('retryDueDraws'))$('retryDueDraws').onclick=retryDueDraws;if($('refreshIncidents'))$('refreshIncidents').onclick=refreshIncidents;if($('approveLaunchExit'))$('approveLaunchExit').onclick=function(){finalizeLaunchExit('approved')};if($('holdLaunchExit'))$('holdLaunchExit').onclick=function(){finalizeLaunchExit('held')};
  $('closeEventModal').onclick=$('cancelEventModal').onclick=function(){$('eventDialog').close()};$('eventForm').onsubmit=saveEvent;
  $('fTitle').oninput=function(){if(!S.editing&&!$('fSlug').dataset.touched)$('fSlug').value=slugify(this.value)};$('fSlug').oninput=function(){this.dataset.touched='1'};
  $('fBonusEnabled').onchange=syncBonusField;$('fScheduleMode').onchange=syncSchedule;$('fWinnerCount').oninput=function(){renderPrizeFields()};
  $('cancelBalance').onclick=function(){$('balanceDialog').close()};$('balanceForm').onsubmit=saveBalance;
  document.addEventListener('draw01:lifecycle-changed',function(){load()});
}

window.Draw01AdminCore={
  openBalance:openBalance,
  openEventData:function(e){if(e)openEdit(e)},
  openEvent:function(id){var e=eventById(id);if(e){openEdit(e);return Promise.resolve(e)}return rpc('admin_get_lottery_event_detail',{p_event_id:id}).then(function(row){openEdit(row);return row}).catch(function(err){note('Lottery detail failed: '+err.message,true);throw err})},
  buildEventCard:buildEventCard,
  setEventRows:function(rows){S.events=Array.isArray(rows)?rows:[]},
  refreshBase:load,
  toast:note,
  currentUserId:function(){return S.user&&S.user.id||null}
};
bind();boot();
})();
