import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, APP_URL, BACKEND_READY } from './config.js';

const supabase=BACKEND_READY?createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,detectSessionInUrl:true,autoRefreshToken:true}}):null;
const $=id=>document.getElementById(id);
const S={session:null,profile:null,support:0,tickets:[],events:new Map(),referral:null};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=v=>Number(v||0).toLocaleString(undefined,{maximumFractionDigits:2});
const fmt=v=>v?new Date(v).toLocaleString([],{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}):'—';

function statusFor(e){if(!e)return'UNAVAILABLE';if(e.status==='completed')return'COMPLETED';if(e.status==='cancelled')return'CANCELLED';if(e.status==='draft')return'DRAFT';const n=Date.now();if(e.opens_at&&n<new Date(e.opens_at).getTime())return'UPCOMING';if(e.schedule_mode==='manual')return'OPEN';if(e.cutoff_at&&n<new Date(e.cutoff_at).getTime())return'OPEN';if(e.draw_at&&n<new Date(e.draw_at).getTime())return'LOCKED';return'AWAITING DRAW'}
function balls(t){return '<div class="ticket-balls">'+(t.white_numbers||[]).map(n=>`<i>${String(n).padStart(2,'0')}</i>`).join('')+(t.bonus_ball!=null?`<i class="bonus">${String(t.bonus_ball).padStart(2,'0')}</i>`:'')+'</div>'}
function login(){if(!supabase)return;supabase.auth.signInWithOAuth({provider:'google',options:{redirectTo:APP_URL+'profile.html'}})}

async function loadProfile(){
  const uid=S.session?.user?.id;if(!uid)return;
  const [{data:p,error:pe},{data:w}]=await Promise.all([
    supabase.from('profiles').select('id,display_name,nickname,avatar_url,email,role,balance,referral_code,created_at').eq('id',uid).maybeSingle(),
    supabase.from('support_wallets').select('balance').eq('user_id',uid).maybeSingle()
  ]);
  if(pe)throw pe;S.profile=p;S.support=Number(w?.balance||0);
}
async function loadTickets(){
  const {data,error}=await supabase.from('event_tickets').select('id,event_id,white_numbers,bonus_ball,price_paid,is_winner,winner_rank,prize_awarded,created_at').eq('user_id',S.session.user.id).order('created_at',{ascending:false});
  if(error)throw error;S.tickets=data||[];S.events=new Map();
  const ids=[...new Set(S.tickets.map(t=>t.event_id))];if(!ids.length)return;
  const {data:events,error:ee}=await supabase.from('lottery_events').select('id,slug,title,description,status,ticket_price,max_tickets_per_user,schedule_mode,opens_at,cutoff_at,draw_at,completed_at,cover_image_url').in('id',ids);
  if(ee)throw ee;(events||[]).forEach(e=>S.events.set(e.id,e));
}
async function loadReferral(){const {data,error}=await supabase.rpc('get_my_referral_dashboard');if(error)throw error;S.referral=data||{};}

function renderProfile(){
  const p=S.profile;if(!p)return;const m=S.session.user.user_metadata||{};const name=p.display_name||m.full_name||m.name||'Player';
  $('profileName').textContent=name;$('profileNickname').textContent=p.nickname?('@'+p.nickname):'No nickname yet';$('profileEmail').textContent=p.email||S.session.user.email||'';
  $('profileAvatar').src=p.avatar_url||m.avatar_url||`https://ui-avatars.com/api/?name=${encodeURIComponent(name)}`;$('profileCredits').textContent=num(p.balance);$('profileSupport').textContent=num(S.support)+' LP';
  $('editDisplayName').value=p.display_name||'';$('editNickname').value=p.nickname||'';
}
function renderTickets(){
  $('ticketCountPill').textContent=`${S.tickets.length} ticket${S.tickets.length===1?'':'s'}`;const root=$('ticketEvents');if(!S.tickets.length){root.innerHTML='<div class="profile-empty">You have not bought any event tickets yet. Open an event from the homepage to get started.</div>';return}
  const grouped=new Map();S.tickets.forEach(t=>{if(!grouped.has(t.event_id))grouped.set(t.event_id,[]);grouped.get(t.event_id).push(t)});
  const rows=[...grouped.entries()].sort((a,b)=>new Date(b[1][0].created_at)-new Date(a[1][0].created_at));
  root.innerHTML=rows.map(([eid,tickets])=>{const e=S.events.get(eid),st=statusFor(e),spent=tickets.reduce((a,t)=>a+Number(t.price_paid||0),0),wins=tickets.filter(t=>t.is_winner).length;const action=e&&st==='OPEN'?`<a class="buy-more" href="event.html?e=${encodeURIComponent(e.slug)}">Buy more</a>`:(e?`<a class="buy-more" href="event.html?e=${encodeURIComponent(e.slug)}">View event</a>`:'');return `<details class="ticket-event"${rows.length===1?' open':''}><summary><div class="ticket-event-title"><strong>${esc(e?.title||'Event')}</strong><span>${tickets.length} ticket${tickets.length===1?'':'s'} · ${num(spent)} credits spent${wins?` · ${wins} winning ticket${wins===1?'':'s'}`:''}</span></div><div class="ticket-event-actions"><span class="event-status">${esc(st)}</span>${action}</div></summary><div class="ticket-event-body">${tickets.map(t=>`<div class="ticket-row"><div>${balls(t)}</div><div class="ticket-meta"><strong>${t.is_winner?`#${t.winner_rank} WINNER · +${num(t.prize_awarded)} CR`:`Ticket ${esc(String(t.id).slice(0,8))}`}</strong><span>${num(t.price_paid)} CR · ${esc(fmt(t.created_at))}</span></div></div>`).join('')}</div></details>`}).join('');
}
function renderReferral(){
  const r=S.referral||{},code=r.referralCode||S.profile?.referral_code||'—',link=`${APP_URL}?ref=${encodeURIComponent(code)}`;$('referralCode').textContent=code;$('referralLink').value=link;
  $('refTotal').textContent=num(r.totalReferred||0);$('refCredits').textContent=num(r.signupCreditsEarned||0)+' CR';$('refSupportTotal').textContent=num(r.supportPointsGenerated||0)+' LP';$('refSupportReward').textContent=num(r.supportRewardEarned||0)+' LP';
  const people=Array.isArray(r.people)?r.people:[];$('refPeopleCount').textContent=`${people.length} ${people.length===1?'person':'people'}`;const root=$('referredPeople');if(!people.length){root.innerHTML='<div class="profile-empty">No one has joined through your link yet. Share your personal referral link above.</div>';return}
  root.innerHTML=people.map(p=>{const n=p.nickname?`@${p.nickname}`:(p.displayName||'Player');const avatar=p.avatarUrl||`https://ui-avatars.com/api/?name=${encodeURIComponent(n)}`;return `<article class="referred-person"><img src="${esc(avatar)}" alt=""><div><strong>${esc(n)}</strong><span>Joined ${esc(fmt(p.joinedAt))} · ${num(p.supportPoints||0)} referred LP</span></div><b>+${num(p.signupBonus||0)} CR<br>+${num(p.supportReward||0)} LP</b></article>`}).join('');
  window.LovePointsBrand?.apply(document.getElementById('profileApp'));
}
function shareText(){return `Join DRAW//01 with my referral link: ${$('referralLink').value}`}
function bindSharing(){
  $('copyReferral').onclick=async()=>{try{await navigator.clipboard.writeText($('referralLink').value);$('copyReferral').textContent='Copied ✓';setTimeout(()=>$('copyReferral').textContent='Copy',1400)}catch{prompt('Copy your referral link',$('referralLink').value)}};
  $('shareNative').onclick=async()=>{if(navigator.share){try{await navigator.share({title:'DRAW//01',text:'Join DRAW//01 with my referral link.',url:$('referralLink').value});return}catch(e){if(e.name==='AbortError')return}}await navigator.clipboard?.writeText($('referralLink').value)};
  $('shareWhatsApp').onclick=()=>window.open('https://wa.me/?text='+encodeURIComponent(shareText()),'_blank','noopener');
  $('shareFacebook').onclick=()=>window.open('https://www.facebook.com/sharer/sharer.php?u='+encodeURIComponent($('referralLink').value),'_blank','noopener');
}
function bindEdit(){
  $('editProfileBtn').onclick=()=>{$('profileEditMsg').textContent='';$('profileEditDialog').showModal()};$('cancelProfileEdit').onclick=()=>$('profileEditDialog').close();
  $('profileEditForm').onsubmit=async e=>{e.preventDefault();const name=$('editDisplayName').value.trim(),nickname=$('editNickname').value.trim();const btn=e.submitter;btn.disabled=true;btn.textContent='Saving…';$('profileEditMsg').textContent='';try{const {data,error}=await supabase.rpc('update_my_profile',{p_display_name:name,p_nickname:nickname});if(error)throw error;const row=Array.isArray(data)?data[0]:data;if(row){S.profile.display_name=row.display_name;S.profile.nickname=row.nickname}renderProfile();$('profileEditMsg').textContent='Saved';$('profileEditMsg').className='profile-form-msg ok';window.Draw01Shell?.refresh();setTimeout(()=>$('profileEditDialog').close(),450)}catch(err){$('profileEditMsg').textContent=err.message;$('profileEditMsg').className='profile-form-msg'}finally{btn.disabled=false;btn.textContent='Save profile'}};
}
async function refreshAll(){await Promise.all([loadProfile(),loadTickets(),loadReferral()]);renderProfile();renderTickets();renderReferral();window.Draw01Shell?.setBalance(S.profile?.balance||0);window.LovePointsBrand?.apply(document.getElementById('profileApp'))}
async function boot(){
  if(!supabase){$('profileGateText').textContent='Backend is not configured.';return}const {data}=await supabase.auth.getSession();S.session=data.session;window.Draw01Shell?.setSession(S.session);
  if(!S.session){$('profileGateText').textContent='Sign in with Google to open your player profile.';$('profileLogin').hidden=false;$('profileLogin').onclick=login;return}
  try{await refreshAll();$('profileGate').hidden=true;$('profileApp').hidden=false;bindSharing();bindEdit()}catch(e){$('profileGateText').textContent=e.message;$('profileLogin').hidden=true}
}

if(supabase)supabase.auth.onAuthStateChange(async(_event,session)=>{S.session=session;window.Draw01Shell?.setSession(session);if(session&&$('profileApp').hidden){await boot()}});
boot();
