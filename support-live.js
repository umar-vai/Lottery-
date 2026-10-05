(function(){
'use strict';
var BASE='https://mwtlsnneooxmryondrex.supabase.co';
var KEY='sb_publishable_zfXYDH1qSZURp8bRHgnBrQ_7t7-3BMd';
var REF='mwtlsnneooxmryondrex';
var timer=null,userId=null,last=-1,loadingSupport=false;
function unpack(x){if(!x)return null;if(x.access_token)return x;if(x.currentSession&&x.currentSession.access_token)return x.currentSession;if(x.session&&x.session.access_token)return x.session;if(x.data&&x.data.session&&x.data.session.access_token)return x.data.session;return null}
function readSession(){try{var keys=['sb-'+REF+'-auth-token'];for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);if(k&&k.indexOf(REF)>=0&&k.indexOf('auth')>=0&&keys.indexOf(k)<0)keys.push(k)}for(var j=0;j<keys.length;j++){var raw=localStorage.getItem(keys[j]);if(!raw)continue;try{var s=unpack(JSON.parse(raw));if(s)return s}catch(e){}}}catch(e){}return null}
function api(path,token){return fetch(BASE+path,{headers:{apikey:KEY,Authorization:'Bearer '+token}}).then(function(r){return r.text().then(function(t){var d;try{d=t?JSON.parse(t):null}catch(e){d=null}if(!r.ok)throw new Error('HTTP '+r.status);return d})})}
function fmt(v){return Number(v||0).toLocaleString(undefined,{maximumFractionDigits:2})+' LP'}
function ensureSupportAssets(){
  if(!document.querySelector('link[data-lp-support-fallback]')){var l=document.createElement('link');l.rel='stylesheet';l.href='support-center.css?v=6';l.setAttribute('data-lp-support-fallback','1');document.head.appendChild(l)}
}
function openSupport(){
  ensureSupportAssets();
  if(window.Draw01SupportCenter&&typeof window.Draw01SupportCenter.open==='function'){window.Draw01SupportCenter.open();return}
  if(loadingSupport)return;loadingSupport=true;
  var s=document.createElement('script');s.src='support-center.js?v=6';s.defer=true;s.setAttribute('data-lp-support-fallback','1');
  s.onload=function(){loadingSupport=false;if(window.Draw01SupportCenter&&typeof window.Draw01SupportCenter.open==='function')window.Draw01SupportCenter.open()};
  s.onerror=function(){loadingSupport=false;console.warn('Love Points center failed to load')};
  document.head.appendChild(s);
}
function bindSupportButton(){
  var b=document.getElementById('d01SupportBtn');if(!b)return;
  if(b.dataset.lpBound==='1')return;
  b.dataset.lpBound='1';
  b.onclick=function(e){e.preventDefault();e.stopPropagation();var wrap=document.getElementById('d01CreditWrap');if(wrap)wrap.classList.remove('open');var c=document.getElementById('d01CreditBtn');if(c)c.setAttribute('aria-expanded','false');openSupport()};
}
function ensure(){var btn=document.getElementById('d01CreditBtn');if(!btn)return false;var n=document.getElementById('d01SupportInline');if(!n){n=document.createElement('span');n.id='d01SupportInline';n.className='d01-support-inline';n.title='Love Points are separate from Draw Credits and cannot be used for tickets, odds or prizes.';n.textContent='0 LP';btn.appendChild(n)}bindSupportButton();return true}
function paint(v){last=Number(v||0);if(!ensure())return;var n=document.getElementById('d01SupportInline');if(n)n.textContent=fmt(last);var b=document.getElementById('d01SupportBtn');if(b)b.textContent='♥ Love Points · '+fmt(last)}
function refresh(){var s=readSession();if(!s||!s.access_token){userId=null;paint(0);return Promise.resolve()}var token=s.access_token;var getUser=userId?Promise.resolve({id:userId}):api('/auth/v1/user',token);return getUser.then(function(u){userId=u&&u.id?u.id:null;if(!userId)throw new Error('No user');return api('/rest/v1/support_wallets?select=balance&user_id=eq.'+encodeURIComponent(userId)+'&limit=1',token)}).then(function(rows){paint(rows&&rows[0]?rows[0].balance:0)}).catch(function(){paint(0)})}
function start(){ensure();refresh();clearInterval(timer);timer=setInterval(function(){if(document.visibilityState!=='hidden'){ensure();refresh()}},4000)}
window.Draw01SupportLive={refresh:refresh,getBalance:function(){return last},open:openSupport};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){setTimeout(start,150)});else setTimeout(start,150);
})();