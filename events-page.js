import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, BACKEND_READY } from './config.js';

const supabase=BACKEND_READY?createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,detectSessionInUrl:true,autoRefreshToken:true}}):null;
const $=id=>document.getElementById(id);
const DRAW_SEGMENT_MS=60000;
const DRAW_START_DELAY_MS=1500;
let events=[];
let category=['open','upcoming','completed'].includes(new URLSearchParams(location.search).get('view'))?new URLSearchParams(location.search).get('view'):'open';

function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function credits(v){return `${Number(v||0).toLocaleString()} credits`}
function fmt(v){return v?new Date(v).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'Manual'}
function revealEnd(e){if(!e?.completed_at)return 0;return new Date(e.completed_at).getTime()+DRAW_START_DELAY_MS+Math.max(1,Number(e.winner_count||1))*DRAW_SEGMENT_MS}
function revealComplete(e){return e?.status==='completed'&&Date.now()>=revealEnd(e)}
function statusFor(e){
  if(e.status==='completed')return revealComplete(e)?'COMPLETED':'LIVE DRAW';
  if(e.status==='cancelled')return'CANCELLED';
  const n=Date.now();
  if(e.opens_at&&n<new Date(e.opens_at).getTime())return'UPCOMING';
  if(e.schedule_mode==='manual')return'OPEN';
  if(e.cutoff_at&&n<new Date(e.cutoff_at).getTime())return'OPEN';
  if(e.draw_at&&n<new Date(e.draw_at).getTime())return'LOCKED';
  return'AWAITING DRAW'
}
function bucket(e){const s=statusFor(e);if(s==='OPEN')return'open';if(s==='COMPLETED')return'completed';return'upcoming'}
function card(e){
  const st=statusFor(e),a=document.createElement('a');
  a.className='event-card';a.href=`lottery.html?e=${encodeURIComponent(e.slug)}`;
  const drawLabel=st==='LIVE DRAW'?'Winner reveal live':e.schedule_mode==='manual'?'Admin draw / ম্যানুয়াল':fmt(e.draw_at);
  const cover=e.cover_image_url?`<img src="${esc(e.cover_image_url)}" alt="${esc(e.title)} cover" loading="lazy">`:'<div class="event-cover-placeholder"><span>LOOTERA.WIN</span></div>';
  a.innerHTML=`<div class="event-cover">${cover}<div class="event-cover-shade"></div><div class="event-card-top"><span class="event-status ${st.toLowerCase().replace(/\s/g,'-')}">${st}</span><span class="event-arrow">↗</span></div></div><div class="event-card-body"><h3>${esc(e.title)}</h3><p>${esc(e.description||'লটারির নিয়ম, ticket এবং result বিস্তারিত দেখুন।')}</p><div class="event-metrics"><div><span>মোট পুরস্কার</span><strong>${credits(e.prize_amount)}</strong></div><div><span>Winner</span><strong>${Number(e.winner_count||1)}</strong></div><div><span>Ticket</span><strong>${credits(e.ticket_price)}</strong></div><div><span>Draw</span><strong>${esc(drawLabel)}</strong></div></div></div>`;
  return a
}
function copyFor(type){
  if(type==='completed')return['COMPLETED LOTTERIES','শেষ হওয়া ড্র ও রেজাল্ট','Completed lottery খুলে winner, rank এবং winning ticket result দেখতে পারবেন।'];
  if(type==='upcoming')return['UPCOMING / LOCKED','পরবর্তী ও লক হওয়া লটারি','Upcoming lottery আগে থেকে দেখুন। Locked, awaiting draw এবং live reveal lottery-ও এই category-তে থাকবে।'];
  return['OPEN LOTTERIES','এখন যেগুলোতে অংশ নিতে পারেন','Open lottery-তে এখনই virtual Draw Credit ব্যবহার করে ticket নেওয়া যায়।']
}
function render(){
  const visible=events.filter(e=>e.status!=='draft'&&e.status!=='cancelled');
  const counts={open:0,upcoming:0,completed:0};visible.forEach(e=>counts[bucket(e)]++);
  $('openEventCount').textContent=counts.open;$('upcomingEventCount').textContent=counts.upcoming;$('completedEventCount').textContent=counts.completed;
  document.querySelectorAll('[data-event-category]').forEach(b=>{const on=b.dataset.eventCategory===category;b.classList.toggle('active',on);b.setAttribute('aria-pressed',on?'true':'false')});
  const [k,t,c]=copyFor(category);$('eventsCategoryKicker').textContent=k;$('eventsCategoryTitle').textContent=t;$('eventsCategoryCopy').textContent=c;
  const rows=visible.filter(e=>bucket(e)===category),grid=$('eventsPageGrid');$('eventsVisibleCount').textContent=`${rows.length} lotter${rows.length===1?'y':'ies'}`;grid.replaceChildren();
  if(!rows.length){const empty=document.createElement('div');empty.className='events-empty';empty.textContent=category==='open'?'এই মুহূর্তে কোনো Open lottery নেই।':category==='completed'?'এখনও কোনো completed lottery নেই।':'এই মুহূর্তে কোনো Upcoming / Locked lottery নেই।';grid.appendChild(empty);return}
  rows.forEach(e=>grid.appendChild(card(e)))
}
function selectCategory(next){if(next===category)return;category=next;history.replaceState(null,'',`lotteries.html?view=${encodeURIComponent(category)}`);const grid=$('eventsPageGrid');grid.classList.add('is-switching');setTimeout(()=>{render();grid.classList.remove('is-switching')},90)}
async function load(){
  if(!supabase){$('eventsPageGrid').innerHTML='<div class="events-empty">Lottery backend is not configured.</div>';return}
  const {data,error}=await supabase.from('lottery_events').select('id,slug,title,description,status,ticket_price,prize_amount,max_tickets_per_user,opens_at,cutoff_at,draw_at,schedule_mode,winner_count,cover_image_url,created_at,completed_at').order('created_at',{ascending:false}).limit(250);
  if(error){$('eventsPageGrid').innerHTML='<div class="events-empty">লটারিগুলো এখন লোড করা যাচ্ছে না। একটু পরে আবার চেষ্টা করুন।</div>';return}
  events=data||[];render()
}
document.querySelectorAll('[data-event-category]').forEach(b=>b.addEventListener('click',()=>selectCategory(b.dataset.eventCategory)));
load();setInterval(render,30000);
