(function(){
'use strict';
var BASE='https://mwtlsnneooxmryondrex.supabase.co';
var KEY='sb_publishable_zfXYDH1qSZURp8bRHgnBrQ_7t7-3BMd';
function $(id){return document.getElementById(id)}
function pct(v){return (Number(v||0)*100).toFixed(2)+'%'}
fetch(BASE+'/rest/v1/games?select=slug,title,description,status,min_bet,max_bet,bet_steps,rtp,house_edge,version&slug=eq.classic-slot&limit=1',{headers:{apikey:KEY}})
.then(function(r){if(!r.ok)throw new Error('Game catalog unavailable');return r.json()})
.then(function(rows){var g=rows&&rows[0];if(!g)return;$('slotTitle').textContent=g.title;$('slotDescription').textContent=g.description;$('slotRtp').textContent=pct(g.rtp);$('slotEdge').textContent=pct(g.house_edge);$('slotBet').textContent=Number(g.min_bet)+'–'+Number(g.max_bet)+' CR';if(g.status!=='active'){$('slotPlayBtn').removeAttribute('href');$('slotPlayBtn').classList.add('disabled');$('slotPlayBtn').querySelector('span').textContent='Coming soon';$('activeGames').textContent='0'}})
.catch(function(){/* Static card remains usable as fallback. */});
})();
