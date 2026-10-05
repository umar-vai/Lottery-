(function(){
'use strict';

function $(id){ return document.getElementById(id); }
function isOpenDialog(){ return !!document.querySelector('dialog[open]'); }
function overlayVisible(el){ return !!(el && !el.hidden && getComputedStyle(el).display !== 'none'); }

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
    list.classList.add('admin-v7-event-list');
    list.removeAttribute('aria-hidden');
  }
  if(legacyGrid){
    legacyGrid.setAttribute('aria-hidden','true');
    try{ legacyGrid.inert=true; }catch(_e){}
  }
}

function enhanceEventAccordions(){
  var list=$('eventList');
  if(!list)return;
  list.querySelectorAll('details.event-accordion').forEach(function(details){
    if(details.dataset.v7Enhanced==='1')return;
    details.dataset.v7Enhanced='1';
    details.addEventListener('toggle',function(){
      if(!details.open)return;
      requestAnimationFrame(function(){
        var top=details.getBoundingClientRect().top;
        if(top<86)details.scrollIntoView({block:'start',behavior:'smooth'});
      });
    });
  });
}

function installObservers(){
  var list=$('eventList');
  if(list && !list.dataset.v7Observed){
    list.dataset.v7Observed='1';
    new MutationObserver(function(){ enhanceEventAccordions(); }).observe(list,{childList:true,subtree:true});
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
      toast.textContent='Event workspace recovered. Open the event from the stable Events & Tickets list.';
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

  /* A previous failed V5 workspace can leave body overflow locked. Start clean. */
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

  /* Compatibility watchdog: several historical admin modules can manipulate body overflow.
     Only clear it when there is genuinely no active modal/overlay. */
  setInterval(function(){
    markCanonicalEventUI();
    enhanceEventAccordions();
    recoverFromBrokenOverlay();
    restoreBodyScroll();
  },1500);
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});
else install();
})();
