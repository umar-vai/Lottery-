import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, BACKEND_READY } from './config.js';

const supabase=BACKEND_READY?createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,detectSessionInUrl:true,autoRefreshToken:true}}):null;
const $=id=>document.getElementById(id);
const DRAW_SEGMENT_MS=60000;
const DRAW_START_DELAY_MS=1500;
let archive=[];

function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function credits(v){return Number(v||0).toLocaleString(undefined,{maximumFractionDigits:2})}
function fmt(v){return v?new Date(v).toLocaleString([], {month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}):'—'}
function revealEnd(e){if(!e?.completed_at)return 0;return new Date(e.completed_at).getTime()+DRAW_START_DELAY_MS+Math.max(1,Number(e.winner_count||1))*DRAW_SEGMENT_MS}
function revealComplete(e){return e?.status==='completed'&&Date.now()>=revealEnd(e)}
function avatar(w){const name=w.display_name||'Winner';return w.avatar_url?`<img class="wh-avatar" src="${esc(w.avatar_url)}" alt="${esc(name)}">`:`<span class="wh-avatar-fallback">${esc(name[0]||'W')}</span>`}
function balls(w){return `<div class="wh-balls">${(w.white_numbers||[]).map(n=>`<span>${String(n).padStart(2,'0')}</span>`).join('')}${w.bonus_ball!=null?`<span class="bonus">${String(w.bonus_ball).padStart(2,'0')}</span>`:''}</div>`}
function normalizeWinner(w){return{...w,winner_rank:Number(w.winner_rank||999),prize_awarded:Number(w.prize_awarded||0)}}

const SAMPLE_NAMES=['Rafi H.','Sadia M.','Tanvir A.','Nabila R.','Mahin S.','Farhan K.','Tanzim N.','Raisa A.','Nafis R.','Maliha T.','Siam H.','Anika F.','Shafin M.','Tasnim J.','Arian S.','Mim R.','Zubair H.','Fariha N.','Adnan K.','Lamisa A.','Sakib R.','Nusrat S.','Rahat M.','Mehnaz T.'];

function sampleNumbers(seed,count=5,max=49){
  const out=[];
  const start=((seed*17+11)%max)+1;
  const step=11; // coprime with 49, so this sequence cannot get stuck in a short cycle
  for(let i=0;i<max&&out.length<count;i++){
    const n=((start-1+i*step)%max)+1;
    out.push(n);
  }
  return out.sort((a,b)=>a-b);
}
function buildSampleHistory(){
  const base=Date.UTC(2026,8,26,14,0,0);
  return Array.from({length:24},(_,i)=>{
    const drawNo=24-i;
    const completedAt=new Date(base-(i*7*86400000)).toISOString();
    const winners=Array.from({length:3},(__,rank)=>{
      const seed=(i+1)*31+(rank+1)*11;
      return normalizeWinner({
        winner_rank:rank+1,
        display_name:SAMPLE_NAMES[(i*3+rank)%SAMPLE_NAMES.length],
        avatar_url:'',
        white_numbers:sampleNumbers(seed),
        bonus_ball:((seed*7)%20)+1,
        prize_awarded:[5000,2500,1000][rank]
      });
    });
    return {
      event:{title:'Lootera Weekly Draw #'+String(drawNo).padStart(2,'0'),completed_at:completedAt,prize_amount:8500},
      winners
    };
  });
}
function sampleCard(item){
  const e=item.event,w=item.winners;
  return `<article class="wh-event wh-sample-event"><div class="wh-event-top"><div class="wh-event-title"><span>COMPLETED LOTTERY</span><span class="wh-demo-badge">SAMPLE</span><h3>${esc(e.title)}</h3></div></div><div class="wh-event-body"><div class="wh-event-meta"><span>${esc(fmt(e.completed_at))}</span><span>${w.length} winners</span><span>${credits(e.prize_amount)} cr prizes</span></div><div class="wh-winner-list">${w.map(x=>`<div class="wh-winner">${avatar(x)}<div class="wh-winner-main"><div class="wh-winner-head"><strong>#${x.winner_rank} · ${esc(x.display_name||'Winner')}</strong><b>${credits(x.prize_awarded)} cr</b></div>${balls(x)}</div></div>`).join('')}</div><div class="wh-sample-footer"><span>Preview winner record</span><span>SAMPLE</span></div></div></article>`;
}
function renderSampleArchive(){
  const root=$('sampleArchiveGrid');if(!root)return;
  root.innerHTML=buildSampleHistory().map(sampleCard).join('');
}

async function eventWinners(e){const {data,error}=await supabase.rpc('get_public_event_winners',{p_event_id:e.id});if(error)return[];return (data||[]).map(normalizeWinner).sort((a,b)=>a.winner_rank-b.winner_rank)}

function renderLive(events){const sec=$('liveRevealSection'),root=$('liveRevealList');if(!events.length){sec.hidden=true;return}sec.hidden=false;root.innerHTML=events.map(e=>{const remain=Math.max(0,revealEnd(e)-Date.now()),m=Math.ceil(remain/60000);return `<a class="wh-live-card" href="lottery.html?e=${encodeURIComponent(e.slug)}"><div><strong>${esc(e.title)}</strong><span>${Number(e.winner_count||1)} ranked winner${Number(e.winner_count||1)===1?'':'s'} · reveal protected</span></div><b>${m>0?`~${m} min left`:'Finishing…'}</b></a>`}).join('')}

function featureHtml(item){const e=item.event,w=item.winners;const cover=e.cover_image_url?`style="background-image:linear-gradient(180deg,rgba(3,8,10,.04),rgba(3,8,10,.46)),url('${esc(e.cover_image_url)}')"`:'';return `<div class="wh-feature-cover" ${cover}></div><div class="wh-feature-copy"><span>${esc(fmt(e.completed_at))}</span><h3>${esc(e.title)}</h3><p>${w.length} winner ticket${w.length===1?'':'s'} · ${credits(e.prize_amount)} credits total configured prizes</p><div class="wh-feature-winners">${w.slice(0,5).map(x=>`<div class="wh-feature-winner">${avatar(x)}<div><strong>${esc(x.display_name||'Winner')}</strong><small>${credits(x.prize_awarded)} credits</small></div><span class="wh-rank">#${x.winner_rank}</span></div>`).join('')}</div></div>`}

function eventCard(item){const e=item.event,w=item.winners;const cover=e.cover_image_url?`style="background-image:linear-gradient(180deg,rgba(3,8,10,.06),rgba(3,8,10,.82)),url('${esc(e.cover_image_url)}')"`:'';return `<article class="wh-event" data-search="${esc((e.title+' '+w.map(x=>x.display_name||'').join(' ')).toLowerCase())}"><div class="wh-event-top" ${cover}><div class="wh-event-title"><span>COMPLETED LOTTERY</span><h3>${esc(e.title)}</h3></div></div><div class="wh-event-body"><div class="wh-event-meta"><span>${esc(fmt(e.completed_at))}</span><span>${w.length} winners</span><span>${credits(e.prize_amount)} cr prizes</span></div><div class="wh-winner-list">${w.map(x=>`<div class="wh-winner">${avatar(x)}<div class="wh-winner-main"><div class="wh-winner-head"><strong>#${x.winner_rank} · ${esc(x.display_name||'Winner')}</strong><b>${credits(x.prize_awarded)} cr</b></div>${balls(x)}</div></div>`).join('')}</div><a class="wh-event-link" href="lottery.html?e=${encodeURIComponent(e.slug)}"><span>Open completed lottery</span><span>↗</span></a></div></article>`}

function renderArchive(){const root=$('archiveGrid'),q=String($('winnerSearch')?.value||'').trim().toLowerCase();const rows=q?archive.filter(x=>(x.search||'').includes(q)):archive;$('archiveCount').textContent=`${rows.length} lotter${rows.length===1?'y':'ies'}`;if(!rows.length){root.innerHTML='<div class="wh-empty">No matching completed winner history.</div>';return}root.innerHTML=rows.map(eventCard).join('')}

function renderStats(){const totalWinners=archive.reduce((a,x)=>a+x.winners.length,0);const totalPrizes=archive.reduce((a,x)=>a+x.winners.reduce((s,w)=>s+Number(w.prize_awarded||0),0),0);$('statEvents').textContent=archive.length.toLocaleString();$('statWinners').textContent=totalWinners.toLocaleString();$('statPrizes').textContent=credits(totalPrizes)}

async function load(){
  if(!supabase){$('archiveGrid').innerHTML='<div class="wh-empty">Winner archive is unavailable.</div>';return}
  const {data,error}=await supabase.from('lottery_events').select('id,slug,title,status,prize_amount,winner_count,cover_image_url,completed_at,created_at').eq('status','completed').order('completed_at',{ascending:false}).limit(250);
  if(error){$('archiveGrid').innerHTML=`<div class="wh-empty">${esc(error.message)}</div>`;return}
  const events=data||[],live=events.filter(e=>!revealComplete(e)),done=events.filter(revealComplete);renderLive(live);
  const rows=await Promise.all(done.map(async e=>({event:e,winners:await eventWinners(e)})));
  archive=rows.filter(x=>x.winners.length).map(x=>({...x,search:(x.event.title+' '+x.winners.map(w=>w.display_name||'').join(' ')).toLowerCase()}));
  renderStats();renderArchive();
  if(archive.length){$('latestSection').hidden=false;$('latestEvent').innerHTML=featureHtml(archive[0]);$('latestEventLink').href=`lottery.html?e=${encodeURIComponent(archive[0].event.slug)}`}
}

$('winnerSearch')?.addEventListener('input',renderArchive);
renderSampleArchive();
load();
setInterval(()=>{const liveEvents=document.querySelectorAll('.wh-live-card');if(liveEvents.length)load()},60000);
