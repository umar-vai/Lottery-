(function(){
'use strict';
var BASE='https://mwtlsnneooxmryondrex.supabase.co';
var KEY='sb_publishable_zfXYDH1qSZURp8bRHgnBrQ_7t7-3BMd';
var REF='mwtlsnneooxmryondrex';
var timer=null,decorateTimer=null,playerObserver=null,wallets=[];
function $(id){return document.getElementById(id)}
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function unpack(x){if(!x)return null;if(x.access_token)return x;if(x.currentSession&&x.currentSession.access_token)return x.currentSession;if(x.session&&x.session.access_token)return x.session;if(x.data&&x.data.session&&x.data.session.access_token)return x.data.session;return null}
function readSession(){try{var keys=['sb-'+REF+'-auth-token'];for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);if(k&&k.indexOf(REF)>=0&&k.indexOf('auth')>=0&&keys.indexOf(k)<0)keys.push(k)}for(var j=0;j<keys.length;j++){var raw=localStorage.getItem(keys[j]);if(!raw)continue;try{var s=unpack(JSON.parse(raw));if(s)return s}catch(e){}}}catch(e){}return null}
function req(body){var s=readSession();if(!s)return Promise.reject(new Error('Admin session required'));return fetch(BASE+'/functions/v1/support-device-admin',{method:'POST',headers:{apikey:KEY,Authorization:'Bearer '+s.access_token,'Content-Type':'application/json'},body:JSON.stringify(body||{})}).then(function(r){return r.text().then(function(t){var d;try{d=t?JSON.parse(t):null}catch(e){d=t}if(!r.ok)throw new Error((d&&d.error)||(d&&d.message)||('HTTP '+r.status));return d})})}
function num(v){return Number(v||0).toLocaleString(undefined,{maximumFractionDigits:2})}
function scheduleDecorate(){clearTimeout(decorateTimer);decorateTimer=setTimeout(decoratePlayers,80)}
function install(){
  var playerList=$('playerList'),host=$('supportAdminPanel');
  if(!playerList&&!host){setTimeout(install,300);return}
  if(playerList&&!playerList.dataset.supportWalletObserved){
    playerList.dataset.supportWalletObserved='1';
    playerObserver=new MutationObserver(scheduleDecorate);
    playerObserver.observe(playerList,{childList:true,subtree:true});
  }
  if(host&&!$('supportWalletAdmin')){
    host.insertAdjacentHTML('beforeend','<section id="supportWalletAdmin" class="support-wallet-admin"><div class="support-wallet-head"><div><span class="eyebrow">SUPPORT BALANCES</span><h3>Draw Credits vs Support Points</h3><p>Balances stay separate. Support Points can be adjusted by admins; Draw Credits use the normal Set balance action in Players.</p></div><button id="supportWalletRefresh" type="button">Refresh</button></div><div id="supportWalletList"><div class="support-wallet-empty">Loading balances…</div></div></section>');
    $('supportWalletRefresh').onclick=load;
  }
  if(!timer){load();timer=setInterval(function(){if(document.visibilityState!=='hidden')load()},5000)}
  scheduleDecorate();
  if(!host)setTimeout(install,500);
}
function walletMapByEmail(){var m={};wallets.forEach(function(w){var e=String(w.email||'').trim().toLowerCase();if(e)m[e]=w});return m}
function walletMapByName(){var m={};wallets.forEach(function(w){var n=String(w.display_name||'').trim().toLowerCase();if(n&&!m[n])m[n]=w});return m}
function decoratePlayers(){
  var root=$('playerList');if(!root)return;
  var byEmail=walletMapByEmail(),byName=walletMapByName();
  root.querySelectorAll('.record-card').forEach(function(row){
    var meta=row.querySelector('.record-meta'),title=row.querySelector('.record-title strong');if(!meta)return;
    var first=meta.querySelector('span'),email=String(first?first.textContent:'').trim().toLowerCase();
    var name=String(title?title.textContent:'').trim().toLowerCase();
    var w=byEmail[email]||byName[name];if(!w)return;
    var bal=meta.querySelector('.support-player-balance');
    if(!bal){bal=document.createElement('span');bal.className='support-player-balance';meta.appendChild(bal)}
    var text='Support '+num(w.balance)+' SP';if(bal.textContent!==text)bal.textContent=text;
    var actions=row.querySelector('.record-actions');if(!actions)return;
    var btn=actions.querySelector('.support-player-edit');
    if(!btn){btn=document.createElement('button');btn.type='button';btn.className='btn ghost compact support-player-edit';btn.textContent='Set Support';actions.insertBefore(btn,actions.children[1]||null)}
    btn.dataset.user=w.user_id;btn.dataset.balance=w.balance;btn.dataset.name=w.display_name||w.email||'User';
    btn.onclick=function(){editButton(btn)};
  })
}
function render(list){
  var box=$('supportWalletList');if(!box)return;
  if(!list||!list.length){box.innerHTML='<div class="support-wallet-empty">No players found.</div>';return}
  box.innerHTML=list.map(function(w){return '<article class="support-wallet-row"><div class="support-wallet-user"><strong>'+esc(w.display_name||'User')+'</strong><span>'+esc(w.email||'')+'</span></div><div class="support-wallet-balances"><span class="draw-balance"><small>DRAW CREDIT</small><b>'+esc(num(w.draw_credits))+' cr</b></span><span class="support-balance"><small>SUPPORT</small><b>'+esc(num(w.balance))+' SP</b></span></div><button class="support-edit-btn" data-user="'+esc(w.user_id)+'" data-balance="'+esc(w.balance)+'" data-name="'+esc(w.display_name||'User')+'" type="button">Edit Support</button></article>'}).join('');
  box.querySelectorAll('.support-edit-btn').forEach(function(btn){btn.onclick=function(){editButton(btn)}})
}
function load(){return req({action:'list'}).then(function(d){wallets=d.wallets||[];render(wallets);decoratePlayers();return wallets}).catch(function(e){var box=$('supportWalletList');if(box)box.innerHTML='<div class="support-wallet-empty">'+esc(e.message)+'</div>';throw e})}
function editButton(btn){
  var old=Number(btn.dataset.balance||0);var label=btn.dataset.name||'user';
  var value=prompt('Set Support Points for '+label+'\n\nDraw Credits will NOT change.',String(old));if(value===null)return;
  var n=Number(String(value).trim());if(!Number.isFinite(n)||n<0){alert('Enter a valid Support Points balance.');return}
  var note=prompt('Admin note','Admin Support Points adjustment');if(note===null)return;
  var normalText=btn.classList.contains('support-player-edit')?'Set Support':'Edit Support';btn.disabled=true;btn.textContent='Saving…';
  req({action:'adjust_support',userId:btn.dataset.user,newBalance:n,note:note}).then(function(){btn.textContent='Saved ✓';if(window.Draw01SupportLive)window.Draw01SupportLive.refresh();return load()}).catch(function(e){alert(e.message)}).finally(function(){setTimeout(function(){btn.disabled=false;btn.textContent=normalText},800)})
}
window.Draw01SupportWalletAdmin={refresh:load};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);else install();
})();