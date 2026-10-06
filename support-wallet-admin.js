(function(){
'use strict';
var BASE='https://mwtlsnneooxmryondrex.supabase.co';
var KEY='sb_publishable_zfXYDH1qSZURp8bRHgnBrQ_7t7-3BMd';
var REF='mwtlsnneooxmryondrex';
var wallets=[],cursor=null,more=false,busy=false,timer=null;
function $(id){return document.getElementById(id)}
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[c]})}
function unpack(x){if(!x)return null;if(x.access_token)return x;if(x.currentSession&&x.currentSession.access_token)return x.currentSession;if(x.session&&x.session.access_token)return x.session;if(x.data&&x.data.session&&x.data.session.access_token)return x.data.session;return null}
function readSession(){try{var keys=['sb-'+REF+'-auth-token'];for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);if(k&&k.indexOf(REF)>=0&&k.indexOf('auth')>=0&&keys.indexOf(k)<0)keys.push(k)}for(var j=0;j<keys.length;j++){var raw=localStorage.getItem(keys[j]);if(!raw)continue;try{var s=unpack(JSON.parse(raw));if(s)return s}catch(e){}}}catch(e){}return null}
function edge(body){var s=readSession();if(!s)return Promise.reject(new Error('Admin session required'));return fetch(BASE+'/functions/v1/support-device-admin',{method:'POST',headers:{apikey:KEY,Authorization:'Bearer '+s.access_token,'Content-Type':'application/json'},body:JSON.stringify(body||{})}).then(function(r){return r.text().then(function(t){var d;try{d=t?JSON.parse(t):null}catch(e){d=t}if(!r.ok)throw new Error((d&&d.error)||(d&&d.message)||('HTTP '+r.status));return d})})}
function rpc(name,args){var s=readSession();if(!s)return Promise.reject(new Error('Admin session required'));return fetch(BASE+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:KEY,Authorization:'Bearer '+s.access_token,'Content-Type':'application/json'},body:JSON.stringify(args||{})}).then(function(r){return r.text().then(function(t){var d;try{d=t?JSON.parse(t):null}catch(e){d=t}if(!r.ok)throw new Error((d&&d.message)||(d&&d.error)||('HTTP '+r.status));return d})})}
function num(v){return Number(v||0).toLocaleString(undefined,{maximumFractionDigits:2})}
function install(){
  var host=$('supportAdminPanel');if(!host){setTimeout(install,300);return}
  if(!$('supportWalletAdmin')){
    host.insertAdjacentHTML('beforeend','<section id="supportWalletAdmin" class="support-wallet-admin"><div class="support-wallet-head"><div><span class="eyebrow">LOVE POINT BALANCES</span><h3>Draw Credits vs Love Points (LP)</h3><p>Player balances load in server pages. LP remains separate from Draw Credits.</p></div><button id="supportWalletRefresh" type="button">Refresh</button></div><div class="remaining-page-meta"><input id="supportWalletSearch" type="search" autocomplete="off" placeholder="Search name, email or user ID"></div><div id="supportWalletList"><div class="support-wallet-empty">Loading balances…</div></div><div class="sc-page-actions"><button id="supportWalletMore" class="btn ghost compact" type="button" hidden>Load more balances</button></div></section>');
    $('supportWalletRefresh').onclick=function(){load(true)};
    $('supportWalletMore').onclick=function(){load(false)};
    $('supportWalletSearch').oninput=function(){clearTimeout(timer);timer=setTimeout(function(){load(true)},300)}
  }
  var players=$('players');if(players){var p=players.querySelector('.panel-head p');if(p)p.textContent="Manage each player's Draw Credits and Love Points (LP) here. Phone Bridge and support transactions remain in the Support tab."}
  load(true)
}
function args(){var c=cursor||{};return{p_query:($('supportWalletSearch')&&$('supportWalletSearch').value||'').trim(),p_limit:50,p_cursor_created_at:c.created_at||null,p_cursor_user_id:c.user_id||null}}
function render(){
  var box=$('supportWalletList');if(!box)return;
  if(!wallets.length){box.innerHTML='<div class="support-wallet-empty">No players matched this view.</div>';syncMore();return}
  box.innerHTML=wallets.map(function(w){return '<article class="support-wallet-row"><div class="support-wallet-user"><strong>'+esc(w.display_name||'User')+'</strong><span>'+esc(w.email||'')+'</span></div><div class="support-wallet-balances"><span class="draw-balance"><small>DRAW CREDIT</small><b>'+esc(num(w.draw_credits))+' cr</b></span><span class="support-balance"><small>LOVE POINT</small><b>'+esc(num(w.balance))+' LP</b></span></div><button class="support-edit-btn" data-user="'+esc(w.user_id)+'" data-balance="'+esc(w.balance)+'" data-name="'+esc(w.display_name||'User')+'" type="button">Edit LP</button></article>'}).join('');
  box.querySelectorAll('.support-edit-btn').forEach(function(btn){btn.onclick=function(){editButton(btn)}});syncMore()
}
function syncMore(){var b=$('supportWalletMore');if(!b)return;b.hidden=!more;b.disabled=busy}
function load(reset){
  if(busy)return Promise.resolve(wallets);if(reset){wallets=[];cursor=null;more=false}busy=true;
  return rpc('admin_list_support_wallets_page',args()).then(function(d){wallets=wallets.concat(d&&Array.isArray(d.rows)?d.rows:[]);more=!!(d&&d.has_more);cursor=d&&d.next_cursor||null;render();return wallets}).catch(function(e){var box=$('supportWalletList');if(box)box.innerHTML='<div class="support-wallet-empty">'+esc(e.message)+'</div>';throw e}).finally(function(){busy=false;syncMore()})
}
function editButton(btn){
  var old=Number(btn.dataset.balance||0),label=btn.dataset.name||'user';
  var value=prompt('Set Love Points (LP) for '+label+'\n\nDraw Credits will NOT change.',String(old));if(value===null)return;
  var n=Number(String(value).trim());if(!Number.isFinite(n)||n<0){alert('Enter a valid LP balance.');return}
  var note=prompt('Admin reason','Admin LP adjustment');if(note===null)return;note=String(note).trim();if(!note){alert('A reason is required.');return}
  btn.disabled=true;btn.textContent='Saving…';
  edge({action:'adjust_support',userId:btn.dataset.user,newBalance:n,note:note}).then(function(){btn.textContent='Saved ✓';document.dispatchEvent(new CustomEvent('draw01:admin-data-changed',{detail:{scope:'support'}}));if(window.Draw01SupportLive)window.Draw01SupportLive.refresh();if(window.Draw01SupportAdmin)window.Draw01SupportAdmin.refreshSummary();return load(true)}).catch(function(e){alert(e.message)}).finally(function(){setTimeout(function(){btn.disabled=false;btn.textContent='Edit LP'},800)})
}
window.Draw01SupportWalletAdmin={refresh:function(){return load(true)}};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);else install();
})();