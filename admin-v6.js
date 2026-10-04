(function(){
'use strict';
var openWinners=new Set();
var playerQuery='';
function $(id){return document.getElementById(id)}
function normalize(v){return String(v||'').toLowerCase().trim()}
function installPlayerSearch(){
  var players=$('players');if(!players)return;
  var panel=players.querySelector('.panel');var list=$('playerList');if(!panel||!list)return;
  if(!$('v6PlayerSearch')){
    var tools=document.createElement('div');tools.className='v6-player-tools';tools.innerHTML='<div class="v6-search-wrap"><span>⌕</span><input id="v6PlayerSearch" type="search" autocomplete="off" placeholder="Search player by name, email, role or balance…"><button id="v6ClearSearch" type="button" aria-label="Clear search">×</button></div><span id="v6PlayerCount" class="v6-player-count">0 players</span>';
    var head=panel.querySelector('.panel-head');if(head)head.insertAdjacentElement('afterend',tools);else panel.insertBefore(tools,list);
    $('v6PlayerSearch').addEventListener('input',function(){playerQuery=normalize(this.value);filterPlayers()});
    $('v6ClearSearch').addEventListener('click',function(){playerQuery='';$('v6PlayerSearch').value='';filterPlayers();$('v6PlayerSearch').focus()});
  }
  if(!list.dataset.v6Observed){
    list.dataset.v6Observed='1';new MutationObserver(function(){filterPlayers()}).observe(list,{childList:true,subtree:true,characterData:true});
  }
  filterPlayers();
}
function filterPlayers(){
  var list=$('playerList');if(!list)return;var cards=Array.from(list.querySelectorAll('.record-card'));var visible=0;
  cards.forEach(function(card){var hit=!playerQuery||normalize(card.textContent).indexOf(playerQuery)>=0;card.hidden=!hit;if(hit)visible++});
  var count=$('v6PlayerCount');if(count)count.textContent=visible+' of '+cards.length+' players';
  var empty=$('v6PlayerEmpty');if(!visible&&cards.length){if(!empty){empty=document.createElement('div');empty.id='v6PlayerEmpty';empty.className='v6-empty';empty.textContent='No player matched your search.';list.appendChild(empty)}empty.hidden=false}else if(empty)empty.hidden=true;
}
function enhanceWinnerEvent(section){
  if(section.dataset.v6Enhanced)return;var title=section.querySelector(':scope > h3');if(!title)return;
  var key=title.textContent.trim();var other=Array.from(section.children).filter(function(x){return x!==title});var body=document.createElement('div');body.className='v6-winner-body';other.forEach(function(x){body.appendChild(x)});
  var people=body.querySelectorAll('.v5-winner-person').length;var tickets=body.querySelectorAll('.v5-ticket').length;var button=document.createElement('button');button.type='button';button.className='v6-winner-summary';button.setAttribute('aria-expanded','false');button.innerHTML='<span class="v6-winner-summary-copy"><small>COMPLETED EVENT</small><strong></strong><em>'+people+' winner'+(people===1?'':'s')+' · '+tickets+' winning ticket'+(tickets===1?'':'s')+'</em></span><span class="v6-winner-chevron">⌄</span>';button.querySelector('strong').textContent=key;
  title.remove();section.insertBefore(button,section.firstChild);section.appendChild(body);section.dataset.v6Enhanced='1';
  function setOpen(on){section.classList.toggle('v6-open',on);body.hidden=!on;button.setAttribute('aria-expanded',on?'true':'false');if(on)openWinners.add(key);else openWinners.delete(key)}
  setOpen(openWinners.has(key));button.addEventListener('click',function(){setOpen(!section.classList.contains('v6-open'))});
}
function enhanceWinners(){var root=$('v5WinnerList');if(!root)return;root.querySelectorAll('.v5-winner-event').forEach(enhanceWinnerEvent)}
function installWinnerObserver(){var root=$('v5WinnerList');if(!root)return;enhanceWinners();if(root.dataset.v6Observed)return;root.dataset.v6Observed='1';new MutationObserver(function(){enhanceWinners()}).observe(root,{childList:true,subtree:false})}
function boot(){installPlayerSearch();installWinnerObserver();setTimeout(function(){installPlayerSearch();installWinnerObserver()},800);setTimeout(function(){installPlayerSearch();installWinnerObserver()},2200)}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();