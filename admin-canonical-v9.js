(function(){
'use strict';

var BASE='https://mwtlsnneooxmryondrex.supabase.co';
var KEY='sb_publishable_zfXYDH1qSZURp8bRHgnBrQ_7t7-3BMd';
var REF='mwtlsnneooxmryondrex';
var wallets=[];
var walletPromise=null;
var openTicketEvents=new Set();

function $(id){return document.getElementById(id)}
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function num(v){return Number(v||0).toLocaleString(undefined,{maximumFractionDigits:2})}
function unpack(x){if(!x)return null;if(x.access_token)return x;if(x.currentSession&&x.currentSession.access_token)return x.currentSession;if(x.session&&x.session.access_token)return x.session;if(x.data&&x.data.session&&x.data.session.access_token)return x.data.session;return null}
function readSession(){try{var keys=['sb-'+REF+'-auth-token'];for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);if(k&&k.indexOf(REF)>=0&&k.indexOf('auth')>=0&&keys.indexOf(k)<0)keys.push(k)}for(var j=0;j<keys.length;j++){var raw=localStorage.getItem(keys[j]);if(!raw)continue;try{var s=unpack(JSON.parse(raw));if(s)return s}catch(e){}}}catch(e){}return null}
function req(body){var s=readSession();if(!s)return Promise.reject(new Error('Admin session required'));return fetch(BASE+'/functions/v1/support-device-admin',{method:'POST',headers:{apikey:KEY,Authorization:'Bearer '+s.access_token,'Content-Type':'application/json'},body:JSON.stringify(body||{})}).then(function(r){return r.text().then(function(t){var d;try{d=t?JSON.parse(t):null}catch(e){d=t}if(!r.ok)throw new Error((d&&d.error)||(d&&d.message)||('HTTP '+r.status));return d})})}
function walletByEmail(email){email=String(email||'').trim().toLowerCase();return wallets.find(function(w){return String(w.email||'').trim().toLowerCase()===email})||null}

function loadWallets(force){
  if(walletPromise&&!force)return walletPromise;
  walletPromise=req({action:'list'}).then(function(d){wallets=d&&d.wallets||[];decoratePlayers();return wallets}).catch(function(e){console.warn('Love Points list unavailable',e);return wallets}).finally(function(){walletPromise=null});
  return walletPromise
}

function editLovePoints(wallet,label,button){
  if(!wallet||!wallet.user_id)return;
  var old=Number(wallet.balance||0);
  var value=prompt('Set Love Points (LP) for '+(label||wallet.display_name||'player')+'\n\nDraw Credits will NOT change.',String(old));
  if(value===null)return;
  var next=Number(String(value).trim());
  if(!Number.isFinite(next)||next<0){alert('Enter a valid Love Points balance.');return}
  var note=prompt('Admin note','Admin LP adjustment from Players');
  if(note===null)return;
  if(button){button.disabled=true;button.textContent='Saving…'}
  req({action:'adjust_support',userId:wallet.user_id,newBalance:next,note:note}).then(function(){
    if(button)button.textContent='Saved ✓';
    if(window.Draw01SupportLive)window.Draw01SupportLive.refresh();
    if(window.Draw01SupportWalletAdmin)window.Draw01SupportWalletAdmin.refresh();
    return loadWallets(true)
  }).catch(function(e){alert(e.message)}).finally(function(){if(button)setTimeout(function(){button.disabled=false;button.textContent='Set Love Points'},700)})
}

function decoratePlayers(){
  var players=$('players');
  if(players){var desc=players.querySelector('.panel-head p');if(desc)desc.textContent="Manage each player's Draw Credits and Love Points (LP) here. Phone Bridge and support transaction tools remain in the Support tab."}
  var root=$('playerList');if(!root)return;
  root.querySelectorAll('.record-card').forEach(function(row){
    var meta=row.querySelector('.record-meta');var actions=row.querySelector('.record-actions');if(!meta||!actions)return;
    var emailNode=meta.querySelector('span');var email=emailNode?emailNode.textContent.trim():'';var wallet=walletByEmail(email);
    var lp=meta.querySelector('.player-love-points');
    if(!lp){lp=document.createElement('span');lp.className='player-love-points';var credit=meta.querySelector('.credit-balance');if(credit)credit.insertAdjacentElement('afterend',lp);else meta.appendChild(lp)}
    lp.textContent='Love Points '+(wallet?num(wallet.balance):'—')+' LP';
    var btn=actions.querySelector('.player-love-point-btn');
    if(!btn){btn=document.createElement('button');btn.type='button';btn.className='btn ghost compact player-love-point-btn';var role=actions.querySelector('select');if(role)actions.insertBefore(btn,role);else actions.appendChild(btn)}
    btn.textContent='Set Love Points';btn.disabled=!wallet;
    btn.onclick=function(){var current=walletByEmail(email);if(!current){loadWallets(true).then(function(){current=walletByEmail(email);if(current)editLovePoints(current,(row.querySelector('.record-title strong')||{}).textContent,btn);else alert('Love Points wallet is not available for this player yet.')});return}editLovePoints(current,(row.querySelector('.record-title strong')||{}).textContent,btn)}
  })
}

function setTicketOpen(section,on){
  var head=section.querySelector('.ticket-event-head');var body=section.querySelector('.participant-list');if(!head||!body)return;
  var key=(section.querySelector('h3')||{}).textContent||'';
  section.classList.toggle('ticket-event-open',!!on);body.hidden=!on;head.setAttribute('aria-expanded',on?'true':'false');
  var chevron=head.querySelector('.ticket-card-chevron');if(chevron)chevron.textContent=on?'⌃':'⌄';
  if(on)openTicketEvents.add(key);else openTicketEvents.delete(key)
}

function enhanceTicketGroups(){
  var root=$('ticketEventList');if(!root)return;
  root.querySelectorAll('.ticket-event-group').forEach(function(section){
    if(section.dataset.v9Accordion==='1')return;
    var head=section.querySelector('.ticket-event-head');var body=section.querySelector('.participant-list');if(!head||!body)return;
    section.dataset.v9Accordion='1';section.classList.add('ticket-event-card');
    var edit=head.querySelector('button');if(edit)edit.remove();
    head.classList.add('ticket-card-summary');head.setAttribute('role','button');head.setAttribute('tabindex','0');
    head.insertAdjacentHTML('beforeend','<span class="ticket-card-chevron" aria-hidden="true">⌄</span>');
    var key=(section.querySelector('h3')||{}).textContent||'';setTicketOpen(section,openTicketEvents.has(key));
    function toggle(){setTicketOpen(section,!section.classList.contains('ticket-event-open'))}
    head.addEventListener('click',toggle);head.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();toggle()}})
  })
}

function installObservers(){
  var playerList=$('playerList');if(playerList&&!playerList.dataset.v9Observed){playerList.dataset.v9Observed='1';new MutationObserver(function(){decoratePlayers()}).observe(playerList,{childList:true})}
  var ticketList=$('ticketEventList');if(ticketList&&!ticketList.dataset.v9Observed){ticketList.dataset.v9Observed='1';new MutationObserver(function(){enhanceTicketGroups()}).observe(ticketList,{childList:true})}
}

function boot(){
  installObservers();decoratePlayers();enhanceTicketGroups();loadWallets(true);
  setTimeout(function(){installObservers();decoratePlayers();enhanceTicketGroups()},500);
  setInterval(function(){if(document.visibilityState!=='hidden')loadWallets(true)},10000)
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
