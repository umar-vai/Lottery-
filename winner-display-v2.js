(function(){
'use strict';
var BASE='https://mwtlsnneooxmryondrex.supabase.co';
var KEY='sb_publishable_zfXYDH1qSZURp8bRHgnBrQ_7t7-3BMd';
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function credits(v){return Number(v||0).toLocaleString(undefined,{maximumFractionDigits:2})+' credits'}
function balls(t){var h='<div class="winner-ticket-balls">';(t.white_numbers||[]).forEach(function(n){h+='<span>'+String(n).padStart(2,'0')+'</span>'});if(t.bonus_ball!=null)h+='<span class="bonus">'+String(t.bonus_ball).padStart(2,'0')+'</span>';return h+'</div>'}
async function api(path,opt){opt=opt||{};var headers=Object.assign({'apikey':KEY},opt.headers||{});if(opt.body)headers['Content-Type']='application/json';var r=await fetch(BASE+path,Object.assign({},opt,{headers:headers}));var txt=await r.text();var data=null;try{data=txt?JSON.parse(txt):null}catch(e){data=txt}if(!r.ok)throw new Error((data&&data.message)||(data&&data.error)||('HTTP '+r.status));return data}
async function load(){
  var slug=new URLSearchParams(location.search).get('e');if(!slug)return;
  try{
    var ev=await api('/rest/v1/lottery_events?select=id,status,title&slug=eq.'+encodeURIComponent(slug)+'&limit=1');
    if(!ev||!ev[0]||ev[0].status!=='completed')return;
    var rows=await api('/rest/v1/rpc/get_public_event_winners',{method:'POST',body:JSON.stringify({p_event_id:ev[0].id})});
    if(!Array.isArray(rows)||!rows.length)return;
    var groups={};rows.forEach(function(w){var k=w.user_id||('ticket-'+w.ticket_id);if(!groups[k])groups[k]={name:w.display_name||'Player',avatar:w.avatar_url||'',wins:[]};groups[k].wins.push(w)});
    var root=document.getElementById('resultNumbers');if(!root)return;
    root.innerHTML='<div class="winner-groups">'+Object.keys(groups).map(function(k){var g=groups[k],sum=g.wins.reduce(function(a,x){return a+Number(x.prize_awarded||0)},0);return '<section class="winner-person"><div class="winner-person-head">'+(g.avatar?'<img src="'+esc(g.avatar)+'" alt="">':'')+'<div><strong>'+esc(g.name)+'</strong><span>'+g.wins.length+' winning ticket'+(g.wins.length===1?'':'s')+'</span></div></div><div class="winner-ticket-list">'+g.wins.sort(function(a,b){return Number(a.winner_rank)-Number(b.winner_rank)}).map(function(w){return '<article class="winner-ticket-card"><div class="winner-ticket-top"><strong>#'+Number(w.winner_rank)+' winner</strong><span>'+credits(w.prize_awarded)+'</span></div>'+balls(w)+'</article>'}).join('')+'</div><div class="winner-total">Total prize: '+credits(sum)+'</div></section>'}).join('')+'</div>';
    var meta=document.getElementById('resultMeta');if(meta)meta.textContent=Object.keys(groups).length+' winner'+(Object.keys(groups).length===1?'':'s')+' across '+rows.length+' winning ticket'+(rows.length===1?'':'s')+'.';
  }catch(e){console.warn('Winner identity display:',e)}
}
function start(){setTimeout(load,900);setInterval(load,30000)}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();