(function(){
'use strict';
var BASE='https://mwtlsnneooxmryondrex.supabase.co';
var KEY='sb_publishable_zfXYDH1qSZURp8bRHgnBrQ_7t7-3BMd';
var REF='mwtlsnneooxmryondrex';
var timer=null,wallets=[];
function $(id){return document.getElementById(id)}
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[c]})}
function unpack(x){if(!x)return null;if(x.access_token)return x;if(x.currentSession&&x.currentSession.access_token)return x.currentSession;if(x.session&&x.session.access_token)return x.session;if(x.data&&x.data.session&&x.data.session.access_token)return x.data.session;return null}
function readSession(){try{var keys=['sb-'+REF+'-auth-token'];for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);if(k&&k.indexOf(REF)>=0&&k.indexOf('auth')>=0&&keys.indexOf(k)<0)keys.push(k)}for(var j=0;j<keys.length;j++){var raw=localStorage.getItem(keys[j]);if(!raw)continue;try{var s=unpack(JSON.parse(raw));if(s)return s}catch(e){}}}catch(e){}return null}
function req(body){var s=readSession();if(!s)return Promise.reject(new Error('Admin session required'));return fetch(BASE+'/functions/v1/support-device-admin',{method:'POST',headers:{apikey:KEY,Authorization:'Bearer '+s.access_token,'Content-Type':'application/json'},body:JSON.stringify(body||{})}).then(function(r){return r.text().then(function(t){var d;try{d=t?JSON.parse(t):null}catch(e){d=t}if(!r.ok)throw new Error((d&&d.error)||(d&&d.message)||('HTTP '+r.status));return d})})}
function num(v){return Number(v||0).toLocaleString(undefined,{maximumFractionDigits:2})}
function install(){
  var host=$('supportAdminPanel');
  if(!host){setTimeout(install,300);return}
  if(!$('supportWalletAdmin')){
    host.insertAdjacentHTML('beforeend','<section id="supportWalletAdmin" class="support-wallet-admin"><div class="support-wallet-head"><div><span class="eyebrow">LOVE POINT BALANCES</span><h3>Draw Credits vs Love Points (LP)</h3><p>Balances stay separate. LP can be adjusted here; Draw Credits remain managed from the Players tab.</p></div><button id="supportWalletRefresh" type="button">Refresh</button></div><div id="supportWalletList"><div class="support-wallet-empty">Loading balances…</div></div></section>');
    $('supportWalletRefresh').onclick=load;
  }
  var players=$('players');if(players){var p=players.querySelector('.panel-head p');if(p)p.textContent="Manage each player's Draw Credits here. Love Points (LP) are managed only from the Support tab."}
  if(!timer){load();timer=setInterval(function(){if(document.visibilityState!=='hidden')load()},5000)}
}
function render(list){
  var box=$('supportWalletList');if(!box)return;
  var totalSupport=(list||[]).reduce(function(a,w){return a+Number(w.balance||0)},0);
  var totalCredits=(list||[]).reduce(function(a,w){return a+Number(w.draw_credits||0)},0);
  if($('supportSummaryPoints'))$('supportSummaryPoints').textContent=num(totalSupport)+' LP';
  if($('supportSummaryCredits'))$('supportSummaryCredits').textContent=num(totalCredits)+' cr';
  if(!list||!list.length){box.innerHTML='<div class="support-wallet-empty">No players found.</div>';return}
  box.innerHTML=list.map(function(w){return '<article class="support-wallet-row"><div class="support-wallet-user"><strong>'+esc(w.display_name||'User')+'</strong><span>'+esc(w.email||'')+'</span></div><div class="support-wallet-balances"><span class="draw-balance"><small>DRAW CREDIT</small><b>'+esc(num(w.draw_credits))+' cr</b></span><span class="support-balance"><small>LOVE POINT</small><b>'+esc(num(w.balance))+' LP</b></span></div><button class="support-edit-btn" data-user="'+esc(w.user_id)+'" data-balance="'+esc(w.balance)+'" data-name="'+esc(w.display_name||'User')+'" type="button">Edit LP</button></article>'}).join('');
  box.querySelectorAll('.support-edit-btn').forEach(function(btn){btn.onclick=function(){editButton(btn)}})
}
function load(){return req({action:'list'}).then(function(d){wallets=d.wallets||[];render(wallets);return wallets}).catch(function(e){var box=$('supportWalletList');if(box)box.innerHTML='<div class="support-wallet-empty">'+esc(e.message)+'</div>';throw e})}
function editButton(btn){
  var old=Number(btn.dataset.balance||0);var label=btn.dataset.name||'user';
  var value=prompt('Set Love Points (LP) for '+label+'\n\nDraw Credits will NOT change.',String(old));if(value===null)return;
  var n=Number(String(value).trim());if(!Number.isFinite(n)||n<0){alert('Enter a valid LP balance.');return}
  var note=prompt('Admin note','Admin LP adjustment');if(note===null)return;
  btn.disabled=true;btn.textContent='Saving…';
  req({action:'adjust_support',userId:btn.dataset.user,newBalance:n,note:note}).then(function(){btn.textContent='Saved ✓';if(window.Draw01SupportLive)window.Draw01SupportLive.refresh();return load()}).catch(function(e){alert(e.message)}).finally(function(){setTimeout(function(){btn.disabled=false;btn.textContent='Edit LP'},800)})
}
window.Draw01SupportWalletAdmin={refresh:load};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);else install();
})();