import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, APP_URL, BACKEND_READY } from './config.js';

const supabase = BACKEND_READY ? createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {auth:{persistSession:true,detectSessionInUrl:true,autoRefreshToken:true}}) : null;
const $=id=>document.getElementById(id);
const DRAW_SEGMENT_MS=60000;
const DRAW_START_DELAY_MS=1500;
let session=null,events=[],winnerRows=[];

function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function credits(v){return `${Number(v||0).toLocaleString()} credits`}
function fmt(v){return v?new Date(v).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'Manual'}
function revealEnd(e){if(!e?.completed_at)return 0;return new Date(e.completed_at).getTime()+DRAW_START_DELAY_MS+Math.max(1,Number(e.winner_count||1))*DRAW_SEGMENT_MS}
function revealComplete(e){return e?.status==='completed'&&Date.now()>=revealEnd(e)}
function statusFor(e){if(e.status==='completed')return revealComplete(e)?'COMPLETED':'LIVE DRAW';if(e.status==='cancelled')return'CANCELLED';const n=Date.now();if(e.opens_at&&n<new Date(e.opens_at).getTime())return'UPCOMING';if(e.schedule_mode==='manual')return'OPEN';if(e.cutoff_at&&n<new Date(e.cutoff_at).getTime())return'OPEN';if(e.draw_at&&n<new Date(e.draw_at).getTime())return'LOCKED';return'AWAITING DRAW'}
async function login(){if(!supabase)return;const {error}=await supabase.auth.signInWithOAuth({provider:'google',options:{redirectTo:APP_URL}});if(error)console.error(error)}
async function logout(){if(!supabase)return;await supabase.auth.signOut()}

async function renderAuth(){
  const user=session?.user;
  if($('loginBtn'))$('loginBtn').hidden=!!user;
  if($('accountCard'))$('accountCard').hidden=!user;
  if($('walletStrip'))$('walletStrip').hidden=!user;
  if(!user){if($('walletBalance'))$('walletBalance').textContent='0 credits';window.Draw01Shell?.setSession(null);return}
  window.Draw01Shell?.setSession(session);
  const m=user.user_metadata||{};
  if($('userName'))$('userName').textContent=m.full_name||m.name||user.email?.split('@')[0]||'Player';
  if($('userAvatar'))$('userAvatar').src=m.avatar_url||`https://ui-avatars.com/api/?name=${encodeURIComponent($('userName')?.textContent||'Player')}`;
  const {data}=await supabase.from('profiles').select('balance').eq('id',user.id).maybeSingle();
  if($('walletBalance'))$('walletBalance').textContent=credits(data?.balance||0);
  window.Draw01Shell?.setBalance(data?.balance||0)
}

function card(e){
  const st=statusFor(e),a=document.createElement('a');
  a.className='event-card';a.href=`lottery.html?e=${encodeURIComponent(e.slug)}`;
  const drawLabel=st==='LIVE DRAW'?'Winner reveal live':e.schedule_mode==='manual'?'Admin draw / ম্যানুয়াল':fmt(e.draw_at);
  const cover=e.cover_image_url?`<img src="${esc(e.cover_image_url)}" alt="${esc(e.title)} cover" loading="lazy">`:'<div class="event-cover-placeholder"><span>LOOTERA.WIN</span></div>';
  a.innerHTML=`
    <div class="event-cover">
      ${cover}
      <div class="event-cover-shade"></div>
      <div class="event-card-top"><span class="event-status ${st.toLowerCase().replace(/\s/g,'-')}">${st}</span><span class="event-arrow">↗</span></div>
    </div>
    <div class="event-card-body">
      <h3>${esc(e.title)}</h3>
      <p>${esc(e.description||'লটারির নিয়ম দেখুন, টিকিট নিন এবং ড্র-এর রেজাল্ট ফলো করুন।')}</p>
      <div class="event-metrics">
        <div><span>মোট পুরস্কার</span><strong>${credits(e.prize_amount)}</strong></div>
        <div><span>Winner</span><strong>${e.winner_count||1}</strong></div>
        <div><span>Ticket</span><strong>${credits(e.ticket_price)}</strong></div>
        <div><span>Draw</span><strong>${esc(drawLabel)}</strong></div>
      </div>
    </div>`;
  return a
}

function renderEvents(){
  const visible=events.filter(e=>e.status!=='draft'&&e.status!=='cancelled');
  const active=visible.filter(e=>e.status!=='completed'||!revealComplete(e));
  const completed=visible.filter(e=>e.status==='completed'&&revealComplete(e));
  const activeGrid=$('activeEventsGrid'),completedGrid=$('completedEventsGrid');
  if(activeGrid){activeGrid.replaceChildren();if(!active.length)activeGrid.innerHTML='<div class="events-empty">এই মুহূর্তে কোনো ওপেন বা লাইভ ড্র নেই। নতুন লটারি এলে এখানে দেখা যাবে।</div>';else active.forEach(e=>activeGrid.appendChild(card(e)))}
  if(completedGrid){completedGrid.replaceChildren();if(!completed.length)completedGrid.innerHTML='<div class="events-empty">এখনও কোনো fully revealed completed lottery নেই।</div>';else completed.forEach(e=>completedGrid.appendChild(card(e)))}
  const statuses=visible.map(statusFor);
  if($('openCount'))$('openCount').textContent=statuses.filter(s=>s==='OPEN').length;
  if($('upcomingCount'))$('upcomingCount').textContent=statuses.filter(s=>s==='UPCOMING'||s==='LOCKED'||s==='AWAITING DRAW'||s==='LIVE DRAW').length;
  if($('completedCount'))$('completedCount').textContent=statuses.filter(s=>s==='COMPLETED').length;
  if($('activeEventCount'))$('activeEventCount').textContent=`${active.length} active`;
  if($('completedEventCount'))$('completedEventCount').textContent=`${completed.length} completed`;
}

function aggregateWinners(rows){
  const map=new Map();
  rows.forEach(r=>{
    const key=r.winner_key||r.display_name||r.ticket_ref;
    const cur=map.get(key)||{winner_key:r.winner_key,display_name:r.display_name||'Winner',avatar_url:r.avatar_url||'',total:0,wins:0,bestRank:999,event_title:r.event_title||''};
    cur.total+=Number(r.prize_awarded||0);cur.wins+=1;cur.bestRank=Math.min(cur.bestRank,Number(r.winner_rank||999));if(!cur.event_title&&r.event_title)cur.event_title=r.event_title;map.set(key,cur)
  });
  return [...map.values()].sort((a,b)=>b.total-a.total||a.bestRank-b.bestRank)
}

function winnerMini(w){
  const avatar=w.avatar_url?`<img src="${esc(w.avatar_url)}" alt="${esc(w.display_name)}" loading="lazy">`:`<span class="winner-avatar-fallback">${esc((w.display_name||'W')[0])}</span>`;
  return `<article class="winner-mini">${avatar}<div class="winner-mini-copy"><strong>${esc(w.display_name)}</strong><span><b>${Number(w.total).toLocaleString()} credits</b> · ${w.wins} win${w.wins===1?'':'s'}</span></div><span class="winner-rank-chip">#${w.bestRank}</span></article>`
}

function renderWinnerTicker(){
  const track=$('winnerTrack');if(!track)return;
  const winners=aggregateWinners(winnerRows).slice(0,12);
  if(!winners.length){track.classList.remove('winner-track');track.innerHTML='<div class="winner-empty">লাইভ ড্র পুরোপুরি reveal হওয়ার পর winner এখানে highlight হবে।</div>';return}
  track.className='winner-track';
  const html=winners.map(winnerMini).join('');
  track.innerHTML=html+html;
  if($('heroWinnerText'))$('heroWinnerText').textContent=`${winners.length} জন fully revealed recent winner-এর highlight চলছে`;
}

async function loadWinners(){
  if(!supabase)return;
  const completed=events.filter(e=>e.status==='completed'&&revealComplete(e)).slice(0,12);
  if(!completed.length){winnerRows=[];renderWinnerTicker();return}
  const all=await Promise.all(completed.map(async e=>{
    const {data,error}=await supabase.rpc('get_public_event_winners',{p_event_id:e.id});
    if(error)return[];
    return (data||[]).map(r=>({...r,event_title:e.title,event_slug:e.slug}))
  }));
  winnerRows=all.flat();renderWinnerTicker()
}

async function loadEvents(){
  if(!supabase)return;
  const {data,error}=await supabase.from('lottery_events').select('id,slug,title,description,status,ticket_price,prize_amount,max_tickets_per_user,opens_at,cutoff_at,draw_at,schedule_mode,winner_count,cover_image_url,created_at,completed_at').order('created_at',{ascending:false}).limit(100);
  if(error){if($('activeEventsGrid'))$('activeEventsGrid').innerHTML='<div class="events-empty">লটারিগুলো এখন লোড করা যাচ্ছে না। একটু পরে আবার চেষ্টা করুন।</div>';return}
  events=data||[];renderEvents();await loadWinners()
}

async function handlePending(){if(!supabase)return;const pending=localStorage.getItem('draw01_post_login_event');if(!pending)return;const {data}=await supabase.auth.getSession();if(data.session){localStorage.removeItem('draw01_post_login_event');location.replace(`lottery.html?e=${encodeURIComponent(pending)}`)}}
async function init(){if(!supabase)return;const {data}=await supabase.auth.getSession();session=data.session;window.Draw01Shell?.setSession(session);await renderAuth();await loadEvents();await handlePending();supabase.auth.onAuthStateChange(async(_event,s)=>{session=s;window.Draw01Shell?.setSession(s);await renderAuth()});setInterval(async()=>{renderEvents();await loadWinners()},30000)}
if($('loginBtn'))$('loginBtn').onclick=login;if($('logoutBtn'))$('logoutBtn').onclick=logout;init();
