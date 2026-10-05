(function(){
'use strict';
var enhanced=false;

function $(id){return document.getElementById(id)}

function closeCredit(){
  var wrap=$('d01CreditWrap'),btn=$('d01CreditBtn');
  if(wrap)wrap.classList.remove('open');
  if(btn)btn.setAttribute('aria-expanded','false');
}

function closeAccount(){
  var card=$('accountCard'),btn=$('d01AccountBtn');
  if(card)card.classList.remove('open');
  if(btn)btn.setAttribute('aria-expanded','false');
}

function normalizeCreditText(){
  var el=$('d01CreditValue');
  if(!el)return;
  var text=String(el.textContent||'0').trim();
  var next=text.replace(/\s*credits?\s*$/i,'').trim()||'0';
  if(text!==next)el.textContent=next;
  var btn=$('d01CreditBtn');
  if(btn)btn.setAttribute('aria-label','Credit balance '+next);
}

function enhance(){
  var nav=document.querySelector('.draw01-global-nav');
  if(!nav)return false;
  if(nav.dataset.navV2==='1')return true;
  nav.dataset.navV2='1';

  var center=nav.querySelector('.d01-nav-center');
  var profileNav=$('profileNavLink');
  if(profileNav)profileNav.remove();
  var live=nav.querySelector('.d01-live');
  if(live)live.remove();

  var admin=$('adminNavLink');
  if(admin&&center)center.appendChild(admin);

  var creditWrap=$('d01CreditWrap');
  var creditBtn=$('d01CreditBtn');
  var creditPopover=$('d01CreditPopover');
  if(creditBtn){
    var label=creditBtn.querySelector('.d01-credit-label');
    if(label)label.remove();
    creditBtn.setAttribute('title','Credits');
  }
  if(creditPopover){
    var intro=creditPopover.querySelector(':scope > span');
    if(intro)intro.remove();
    var duplicateProfile=creditPopover.querySelector('a[href="profile.html"]');
    if(duplicateProfile)duplicateProfile.remove();
  }

  var value=$('d01CreditValue');
  normalizeCreditText();
  if(value&&window.MutationObserver){
    new MutationObserver(normalizeCreditText).observe(value,{childList:true,characterData:true,subtree:true});
  }

  var account=$('accountCard');
  if(account&&!account.dataset.accountV2){
    account.dataset.accountV2='1';
    account.classList.add('d01-account-v2');
    var avatar=$('userAvatar');
    var name=$('userName');
    var logout=$('logoutBtn');

    var toggle=document.createElement('button');
    toggle.type='button';
    toggle.id='d01AccountBtn';
    toggle.className='d01-account-toggle';
    toggle.setAttribute('aria-haspopup','true');
    toggle.setAttribute('aria-expanded','false');
    toggle.setAttribute('aria-label','Open account menu');
    if(avatar)toggle.appendChild(avatar);

    var pop=document.createElement('div');
    pop.id='d01AccountPopover';
    pop.className='d01-account-popover';
    pop.setAttribute('role','menu');

    var meta=document.createElement('div');
    meta.className='d01-account-meta';
    if(name)meta.appendChild(name);
    pop.appendChild(meta);

    var profile=document.createElement('a');
    profile.href='profile.html';
    profile.className='d01-account-menu-link';
    profile.textContent='My Profile & Referrals';
    profile.setAttribute('role','menuitem');
    pop.appendChild(profile);

    if(logout){
      logout.classList.add('d01-account-menu-logout');
      logout.setAttribute('role','menuitem');
      pop.appendChild(logout);
    }

    account.appendChild(toggle);
    account.appendChild(pop);

    toggle.addEventListener('click',function(e){
      e.stopPropagation();
      var willOpen=!account.classList.contains('open');
      closeCredit();
      account.classList.toggle('open',willOpen);
      toggle.setAttribute('aria-expanded',willOpen?'true':'false');
    });

    profile.addEventListener('click',closeAccount);
  }

  if(creditBtn){
    creditBtn.addEventListener('click',function(){
      closeAccount();
      setTimeout(normalizeCreditText,0);
    });
  }

  document.addEventListener('click',function(e){
    var accountCard=$('accountCard');
    if(accountCard&&!accountCard.contains(e.target))closeAccount();
  });
  document.addEventListener('keydown',function(e){
    if(e.key==='Escape'){
      closeCredit();
      closeAccount();
    }
  });

  return true;
}

function boot(){
  if(enhance())enhanced=true;
  if(!enhanced){
    var tries=0;
    var timer=setInterval(function(){
      tries++;
      if(enhance()||tries>20){clearInterval(timer);enhanced=true}
    },100);
  }
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);
else boot();
})();