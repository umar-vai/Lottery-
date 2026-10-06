(function(){
'use strict';
var BASE='https://mwtlsnneooxmryondrex.supabase.co';
var KEY='sb_publishable_zfXYDH1qSZURp8bRHgnBrQ_7t7-3BMd';
var REF='mwtlsnneooxmryondrex';
var S={session:null,summary:null,devices:[],deviceCursor:null,deviceMore:false,deviceBusy:false,transactions:[],txCursor:null,txMore:false,txBusy:false,timer:null};
function $(id){return document.getElementById(id)}
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function unpack(x){if(!x)return null;if(x.access_token)return x;if(x.currentSession&&x.currentSession.access_token)return x.currentSession;if(x.session&&x.session.access_token)return x.session;if(x.data&&x.data.session&&x.data.session.access_token)return x.data.session;return null}
function readSession(){try{var keys=['sb-'+REF+'-auth-token'];for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);if(k&&k.indexOf(REF)>=0&&k.indexOf('auth')>=0&&keys.indexOf(k)<0)keys.push(k)}for(var j=0;j<keys.length;j++){var raw=localStorage.getItem(keys[j]);if(!raw)continue;try{var s=unpack(JSON.parse(raw));if(s)return s}catch(e){}}}catch(e){}return null}
function req(body){S.session=readSession();if(!S.session)return Promise.reject(new Error('Admin session required'));return fetch(BASE+'/functions/v1/support-device-admin',{method:'POST',headers:{apikey:KEY,Authorization:'Bearer '+S.session.access_token,'Content-Type':'application/json'},body:JSON.stringify(body||{})}).then(function(r){return r.text().then(function(t){var d;try{d=t?JSON.parse(t):null}catch(e){d=t}if(!r.ok)throw new Error((d&&d.error)||(d&&d.message)||('HTTP '+r.status));return d})})}
function rpc(name,args){S.session=readSession();if(!S.session)return Promise.reject(new Error('Admin session required'));return fetch(BASE+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:KEY,Authorization:'Bearer '+S.session.access_token,'Content-Type':'application/json'},body:JSON.stringify(args||{})}).then(function(r){return r.text().then(function(t){var d;try{d=t?JSON.parse(t):null}catch(e){d=t}if(!r.ok)throw new Error((d&&d.message)||(d&&d.error)||('HTTP '+r.status));return d})})}
function fmt(v){return v?new Date(v).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'Never'}
function money(v){return '৳'+Number(v||0).toLocaleString(undefined,{maximumFractionDigits:2})}
function num(v){return Number(v||0).toLocaleString(undefined,{maximumFractionDigits:2})}
function suppressCreditRequests(){var box=$('creditAdminBox');if(box)box.remove();var players=$('players');if(players){var p=players.querySelector('.panel-head p'),text="Manage each player's Draw Credits here. Love Points (LP) and phone-bridge tools are kept in the Support tab.";if(p&&p.textContent!==text)p.textContent=text}}
function supportTabClick(button,section){document.querySelectorAll('.tabs button').forEach(function(x){x.classList.remove('active')});document.querySelectorAll('.tab').forEach(function(x){x.classList.remove('active')});button.classList.add('active');section.classList.add('active');load(true);if(window.Draw01SupportWalletAdmin)window.Draw01SupportWalletAdmin.refresh()}
function ensureSupportTab(){
  var tabs=document.querySelector('.tabs'),app=$('app');if(!tabs||!app)return null;
  var section=$('support'),button=tabs.querySelector('[data-tab="support"]');
  if(!section){
    if(!button){button=document.createElement('button');button.type='button';button.dataset.tab='support';button.textContent='Support';button.className='support-tab-button';var ledger=tabs.querySelector('[data-tab="ledger"]');tabs.insertBefore(button,ledger||null)}
    section=document.createElement('section');section.id='support';section.className='tab';section.innerHTML='<div class="support-tab-shell"><div class="support-tab-heading"><div><span class="eyebrow">SUPPORT OPERATIONS</span><h2>Support, Love Points & phone bridge</h2><p>Phone verification, Love Points (LP) and balance summaries live here — separate from Players and lottery operations.</p></div><button id="supportTabRefresh" class="btn ghost compact" type="button">Refresh all</button></div><div class="support-admin-summary"><article><span>Support received</span><strong id="supportSummaryReceived">৳0</strong><small>Verified bridge transfers</small></article><article><span>Love Points</span><strong id="supportSummaryPoints">0 LP</strong><small>Across all players</small></article><article><span>Draw Credits</span><strong id="supportSummaryCredits">0 cr</strong><small>Across all players</small></article><article><span>Linked phones</span><strong id="supportSummaryPhones">0</strong><small>Enabled bridge devices</small></article></div><div id="supportAdminMount"></div></div>';
    var ledgerSection=$('ledger');if(ledgerSection&&ledgerSection.parentNode)ledgerSection.parentNode.insertBefore(section,ledgerSection);else app.appendChild(section)
  }
  if(!button){button=document.createElement('button');button.type='button';button.dataset.tab='support';button.textContent='Support';var ledgerBtn=tabs.querySelector('[data-tab="ledger"]');tabs.insertBefore(button,ledgerBtn||null)}
  if(!button.dataset.supportBound){button.dataset.supportBound='1';button.addEventListener('click',function(){supportTabClick(button,section)})}
  var refresh=$('supportTabRefresh');if(refresh&&!refresh.dataset.supportBound){refresh.dataset.supportBound='1';refresh.onclick=function(){load(true);if(window.Draw01SupportWalletAdmin)window.Draw01SupportWalletAdmin.refresh()}}
  return section
}
function install(){
  suppressCreditRequests();
  var section=ensureSupportTab();if(!section){setTimeout(install,300);return}
  var mount=$('supportAdminMount');if(!mount){setTimeout(install,300);return}
  if(!$('supportAdminPanel')){
    mount.innerHTML='<article id="supportAdminPanel" class="support-admin-panel"><div class="support-admin-head"><div><span class="eyebrow">PHONE BRIDGE · LOVE POINTS</span><h2>Real bKash support verification</h2><p>Support reads are paginated; device and LP mutations remain protected by the server function.</p></div><button id="supportCreateDevice" class="btn primary compact" type="button">+ Link phone</button></div><div id="supportTokenBox" class="support-token" hidden><b>Copy this device token now — it is only shown once.</b><code id="supportTokenValue"></code><div class="support-token-actions"><button id="supportCopyToken" type="button">Copy token</button><a href="bridge.html" target="_blank" rel="noopener">Open Phone Bridge ↗</a></div></div><div class="support-admin-grid"><section class="support-box"><h3>Linked phones</h3><div id="supportDeviceList"><div class="support-admin-empty">Loading devices…</div></div><div class="sc-page-actions"><button id="supportDeviceMore" class="btn ghost compact" type="button" hidden>Load more phones</button></div></section><section class="support-box"><h3>Verified SMS transfers</h3><div class="remaining-page-meta"><input id="supportTxSearch" type="search" autocomplete="off" placeholder="Search TrxID, last 4 or claimant"><select id="supportTxClaimFilter"><option value="">All transfers</option><option value="claimed">Claimed</option><option value="unclaimed">Unclaimed</option></select></div><div id="supportTxList"><div class="support-admin-empty">Loading transfers…</div></div><div class="sc-page-actions"><button id="supportTxMore" class="btn ghost compact" type="button" hidden>Load more transfers</button></div></section></div></article>';
    $('supportCreateDevice').onclick=createDevice;
    $('supportCopyToken').onclick=function(){var t=$('supportTokenValue').textContent;navigator.clipboard&&navigator.clipboard.writeText(t).then(function(){$('supportCopyToken').textContent='Copied ✓';setTimeout(function(){$('supportCopyToken').textContent='Copy token'},1600)})};
    $('supportDeviceMore').onclick=function(){loadDevices(false)};
    $('supportTxMore').onclick=function(){loadTransactions(false)};
    $('supportTxClaimFilter').onchange=function(){loadTransactions(true)};
    $('supportTxSearch').oninput=function(){clearTimeout(S.timer);S.timer=setTimeout(function(){loadTransactions(true)},300)}
  }
  if(window.LovePointsBrand)window.LovePointsBrand.apply(section);
  if(section.classList.contains('active'))load(true)
}
function loadSummary(){
  return rpc('admin_get_support_operations_summary',{}).then(function(d){S.summary=d||{};if($('supportSummaryReceived'))$('supportSummaryReceived').textContent=money(S.summary.support_received);if($('supportSummaryPoints'))$('supportSummaryPoints').textContent=num(S.summary.love_points)+' LP';if($('supportSummaryCredits'))$('supportSummaryCredits').textContent=num(S.summary.draw_credits)+' cr';if($('supportSummaryPhones'))$('supportSummaryPhones').textContent=String(Number(S.summary.enabled_phones||0));return d})
}
function deviceArgs(){var c=S.deviceCursor||{};return{p_limit:50,p_cursor_created_at:c.created_at||null,p_cursor_id:c.id||null}}
function loadDevices(reset){
  if(S.deviceBusy)return Promise.resolve();if(reset){S.devices=[];S.deviceCursor=null;S.deviceMore=false}S.deviceBusy=true;
  return rpc('admin_list_support_devices_page',deviceArgs()).then(function(d){S.devices=S.devices.concat(d&&Array.isArray(d.rows)?d.rows:[]);S.deviceMore=!!(d&&d.has_more);S.deviceCursor=d&&d.next_cursor||null;renderDevices()}).catch(function(e){var dl=$('supportDeviceList');if(dl)dl.innerHTML='<div class="support-admin-empty">'+esc(e.message)+'</div>';throw e}).finally(function(){S.deviceBusy=false;syncMore()})
}
function txArgs(){var c=S.txCursor||{};return{p_query:($('supportTxSearch')&&$('supportTxSearch').value||'').trim(),p_claim_state:($('supportTxClaimFilter')&&$('supportTxClaimFilter').value)||null,p_limit:50,p_cursor_received_at:c.received_at||null,p_cursor_id:c.id||null}}
function loadTransactions(reset){
  if(S.txBusy)return Promise.resolve();if(reset){S.transactions=[];S.txCursor=null;S.txMore=false}S.txBusy=true;
  return rpc('admin_list_support_transactions_page',txArgs()).then(function(d){S.transactions=S.transactions.concat(d&&Array.isArray(d.rows)?d.rows:[]);S.txMore=!!(d&&d.has_more);S.txCursor=d&&d.next_cursor||null;renderTransactions()}).catch(function(e){var tl=$('supportTxList');if(tl)tl.innerHTML='<div class="support-admin-empty">'+esc(e.message)+'</div>';throw e}).finally(function(){S.txBusy=false;syncMore()})
}
function renderDevices(){var dl=$('supportDeviceList');if(!dl)return;dl.innerHTML=S.devices.length?S.devices.map(function(x){return '<div class="support-device"><div><strong>'+esc(x.label)+'</strong><span>'+(x.enabled?'Enabled':'Disabled')+' · Last seen '+esc(fmt(x.last_seen_at))+'</span></div><button data-id="'+esc(x.id)+'" data-action="'+(x.enabled?'revoke':'enable')+'" class="'+(x.enabled?'danger':'')+'">'+(x.enabled?'Disable':'Enable')+'</button></div>'}).join(''):'<div class="support-admin-empty">No linked phone yet.</div>';dl.querySelectorAll('button[data-id]').forEach(function(b){b.onclick=function(){toggleDevice(b.dataset.id,b.dataset.action)}});syncMore()}
function renderTransactions(){var tl=$('supportTxList');if(!tl)return;tl.innerHTML=S.transactions.length?S.transactions.map(function(x){return '<div class="support-tx"><div><strong>TrxID '+esc(x.trx_id)+' · ****'+esc(x.sender_last4)+'</strong><span>'+esc(fmt(x.received_at))+(x.claimed_by_name?' · Claimed by '+esc(x.claimed_by_name):'')+'</span></div><div><b>৳'+esc(Number(x.amount||0).toLocaleString(undefined,{maximumFractionDigits:2}))+'</b><br><em class="'+(x.claimed_at?'':'pending')+'">'+(x.claimed_at?'Claimed':'Unclaimed')+'</em></div></div>'}).join(''):'<div class="support-admin-empty">No transfers matched this view.</div>';syncMore()}
function syncMore(){var d=$('supportDeviceMore'),t=$('supportTxMore');if(d){d.hidden=!S.deviceMore;d.disabled=S.deviceBusy}if(t){t.hidden=!S.txMore;t.disabled=S.txBusy}}
function load(reset){return Promise.all([loadSummary(),loadDevices(reset!==false),loadTransactions(reset!==false)]).then(function(){return S})}
function createDevice(){var label=prompt('Phone label','My Android Phone');if(label===null)return;label=label.trim();if(!label)return;req({action:'create',label:label}).then(function(d){$('supportTokenValue').textContent=d.deviceToken||'';$('supportTokenBox').hidden=false;document.dispatchEvent(new CustomEvent('draw01:admin-data-changed',{detail:{scope:'support'}}));return Promise.all([loadDevices(true),loadSummary()])}).catch(function(e){alert(e.message)})}
function toggleDevice(id,action){req({action:action,id:id}).then(function(){document.dispatchEvent(new CustomEvent('draw01:admin-data-changed',{detail:{scope:'support'}}));return Promise.all([loadDevices(true),loadSummary()])}).catch(function(e){alert(e.message)})}
window.Draw01SupportAdmin={refresh:function(){return load(true)},refreshSummary:loadSummary,refreshTransactions:function(){return loadTransactions(true)},refreshDevices:function(){return loadDevices(true)}};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);else install();
})();