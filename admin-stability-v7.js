(function(){
'use strict';

var BASE='https://mwtlsnneooxmryondrex.supabase.co';
var KEY='sb_publishable_zfXYDH1qSZURp8bRHgnBrQ_7t7-3BMd';
var REF='mwtlsnneooxmryondrex';
var coverMap={};
var coversLoaded=false;

function $(id){ return document.getElementById(id); }
function isOpenDialog(){ return !!document.querySelector('dialog[open]'); }
function overlayVisible(el){ return !!(el && !el.hidden && getComputedStyle(el).display !== 'none'); }
function unpack(x){if(!x)return null;if(x.access_token)return x;if(x.currentSession&&x.currentSession.access_token)return x.currentSession;if(x.session&&x.session.access_token)return x.session;if(x.data&&x.data.session&&x.data.session.access_token)return x.data.session;return null}
function readSession(){try{var keys=['sb-'+REF+'-auth-token'];for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);if(k&&k.indexOf(REF)>=0&&k.indexOf('auth')>=0&&keys.indexOf(k)<0)keys.push(k)}for(var j=0;j<keys.length;j++){var raw=localStorage.getItem(keys[j]);if(!raw)continue;try{var s=unpack(JSON.parse(raw));if(s)return s}catch(e){}}}catch(e){}return null}

function restoreBodyScroll(){
  var backdrop=$('v5Backdrop');
  var modal=$('v5Modal');
  if(!isOpenDialog() && !overlayVisible(backdrop) && !overlayVisible(modal)){
    document.body.style.removeProperty('overflow');
    document.documentElement.style.removeProperty('overflow');
    document.body.classList.remove('admin-scroll-locked');
  }
}

function closeLegacyWorkspace(){
  var backdrop=$('v5Backdrop');
  if(backdrop){
    backdrop.hidden=true;
    backdrop.setAttribute('aria-hidden','true');
  }
  restoreBodyScroll();
}

function closeLegacyModal(){
  var modal=$('v5Modal');
  if(modal){
    modal.hidden=true;
    modal.setAttribute('aria-hidden','true');
  }
  restoreBodyScroll();
}

function markCanonicalEventUI(){
  var list=$('eventList');
  var legacyGrid=$('v5EventGrid');
  if(list){
    list.classList.add('admin-v7-event-list','admin-event-card-grid');
    list.removeAttribute('aria-hidden');
  }
  if(legacyGrid){
    if(legacyGrid.getAttribute('aria-hidden')!=='true')legacyGrid.setAttribute('aria-hidden','true');
    try{ if(!legacyGrid.inert)legacyGrid.inert=true; }catch(_e){}
  }
}

function loadCovers(){
  if(coversLoaded)return Promise.resolve(coverMap);
  coversLoaded=true;
  var s=readSession(),headers={apikey:KEY};if(s&&s.access_token)headers.Authorization='Bearer '+s.access_token;
  return fetch(BASE+'/rest/v1/lottery_events?select=id,cover_image_url,title&order=created_at.desc&limit=500',{headers:headers}).then(function(r){if(!r.ok)throw new Error('Cover metadata unavailable');return r.json()}).then(function(rows){(rows||[]).forEach(function(e){coverMap[e.id]={url:e.cover_image_url||'',title:e.title||''}});enhanceEventAccordions();return coverMap}).catch(function(){return coverMap})
}

function decorateEventCard(details){
  var summary=details.querySelector(':scope > summary');if(!summary)return;
  details.classList.add('admin-event-card');summary.classList.add('admin-event-card-summary');
  var id=details.dataset.id||'',meta=coverMap[id]||{},nextUrl=meta.url||'';
  var cover=summary.querySelector('.admin-event-cover');
  if(!cover){
    cover=document.createElement('div');
    cover.className='admin-event-cover';
    cover.setAttribute('aria-hidden','true');
    summary.insertBefore(cover,summary.firstChild);
  }

  /* Important: only mutate the cover when its source actually changes.
     Rewriting innerHTML/textContent on every observer pass creates an endless
     childList -> observer -> childList loop and freezes the admin page. */
  if(cover.dataset.coverUrl===nextUrl)return;
  cover.dataset.coverUrl=nextUrl;

  if(nextUrl){
    cover.classList.add('has-image');
    cover.style.backgroundImage='linear-gradient(180deg,rgba(3,8,10,.05),rgba(3,8,10,.48)),url("'+String(nextUrl).replace(/"/g,'%22')+'")';
    if(cover.childNodes.length)cover.replaceChildren();
  }else{
    cover.classList.remove('has-image');
    cover.style.removeProperty('background-image');
    var span=document.createElement('span');
    span.innerHTML='GAME<br>ZONE';
    cover.replaceChildren(span);
  }
}

function enhanceEventAccordions(){
  var list=$('eventList');
  if(!list)return;
  list.querySelectorAll('details.event-accordion').forEach(function(details){
    decorateEventCard(details);
    if(details.dataset.v7Enhanced==='1')return;
    details.dataset.v7Enhanced='1';
    details.addEventListener('toggle',function(){
      details.classList.toggle('admin-event-open',details.open);
      if(!details.open)return;
      requestAnimationFrame(function(){
        var top=details.getBoundingClientRect().top;
        if(top<86)details.scrollIntoView({block:'start',behavior:'smooth'});
      });
    });
    details.classList.toggle('admin-event-open',details.open);
  });
}

function installObservers(){
  var list=$('eventList');
  if(list && !list.dataset.v7Observed){
    list.dataset.v7Observed='1';
    /* We only need to know when ops-v4 replaces top-level event rows.
       Do not observe the descendants we decorate ourselves. */
    new MutationObserver(function(){ enhanceEventAccordions(); }).observe(list,{childList:true});
  }

  ['v5Backdrop','v5Modal'].forEach(function(id){
    var el=$(id);if(!el||el.dataset.v7Observed)return;
    el.dataset.v7Observed='1';
    new MutationObserver(function(){
      if(el.hidden || getComputedStyle(el).display==='none')restoreBodyScroll();
    }).observe(el,{attributes:true,attributeFilter:['hidden','style','class']});
  });

  document.querySelectorAll('dialog').forEach(function(d){
    if(d.dataset.v7Observed)return;
    d.dataset.v7Observed='1';
    d.addEventListener('close',restoreBodyScroll);
    d.addEventListener('cancel',function(){ setTimeout(restoreBodyScroll,0); });
  });
}

function recoverFromBrokenOverlay(){
  var backdrop=$('v5Backdrop');
  if(!overlayVisible(backdrop))return;
  var workspace=$('v5Workspace');
  var hasUsefulContent=workspace && workspace.textContent && workspace.textContent.trim().length>20;
  if(!hasUsefulContent){
    closeLegacyWorkspace();
    var toast=$('toast');
    if(toast){
      toast.textContent='Event workspace recovered. Open the event from Events & Tickets.';
      toast.className='err';
      toast.style.display='block';
      clearTimeout(toast._v7Timer);
      toast._v7Timer=setTimeout(function(){toast.style.display='none'},4200);
    }
  }
}

function install(){
  markCanonicalEventUI();
  enhanceEventAccordions();
  installObservers();
  loadCovers();

  if($('v5Backdrop') && overlayVisible($('v5Backdrop'))){
    closeLegacyWorkspace();
  }else{
    restoreBodyScroll();
  }

  document.addEventListener('keydown',function(e){
    if(e.key!=='Escape')return;
    if(overlayVisible($('v5Modal'))){ closeLegacyModal(); return; }
    if(overlayVisible($('v5Backdrop'))){ closeLegacyWorkspace(); return; }
    setTimeout(restoreBodyScroll,0);
  });

  window.addEventListener('error',function(){ setTimeout(recoverFromBrokenOverlay,0); });
  window.addEventListener('unhandledrejection',function(){ setTimeout(recoverFromBrokenOverlay,0); });

  setInterval(function(){
    markCanonicalEventUI();
    enhanceEventAccordions();
    recoverFromBrokenOverlay();
    restoreBodyScroll();
  },3000);
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});
else install();
})();