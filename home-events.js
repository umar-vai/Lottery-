import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, APP_URL, BACKEND_READY } from './config.js';

const supabase = BACKEND_READY ? createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: true, detectSessionInUrl: true, autoRefreshToken: true } }) : null;

function credits(value) {
  return `${Number(value || 0).toLocaleString()} credits`;
}
function statusFor(event) {
  if (event.status === 'completed') return 'COMPLETED';
  if (event.status === 'cancelled') return 'CANCELLED';
  const now = Date.now();
  if (now < new Date(event.opens_at).getTime()) return 'UPCOMING';
  if (now < new Date(event.cutoff_at).getTime()) return 'OPEN';
  if (now < new Date(event.draw_at).getTime()) return 'LOCKED';
  return 'AWAITING DRAW';
}
function fmt(value) {
  return new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function ensureStyles() {
  if (document.querySelector('link[data-events-style]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'events-home.css?v=1';
  link.dataset.eventsStyle = '1';
  document.head.appendChild(link);
}
function buildSection() {
  if (document.getElementById('lotteryEventsSection')) return document.getElementById('lotteryEventsSection');
  const hero = document.querySelector('.hero');
  if (!hero) return null;
  const section = document.createElement('section');
  section.id = 'lotteryEventsSection';
  section.className = 'events-hub';
  section.innerHTML = `
    <div class="events-hub-head">
      <div><span class="events-kicker">EVENTS</span><h2>Choose a draw</h2><p>Each event has its own ticket price, ticket limit, prize and draw schedule.</p></div>
      <span class="events-credit-note">Virtual credits only</span>
    </div>
    <div id="lotteryEventsGrid" class="events-grid"><div class="events-empty">Loading events…</div></div>`;
  hero.insertAdjacentElement('afterend', section);
  return section;
}
function card(event) {
  const st = statusFor(event);
  const a = document.createElement('a');
  a.className = 'event-card';
  a.href = `event.html?e=${encodeURIComponent(event.slug)}`;
  a.innerHTML = `
    <div class="event-card-top"><span class="event-status ${st.toLowerCase().replace(/\s/g,'-')}">${st}</span><span class="event-arrow">↗</span></div>
    <h3>${escapeHtml(event.title)}</h3>
    <p>${escapeHtml(event.description || 'Open the event to view rules and build tickets.')}</p>
    <div class="event-metrics">
      <div><span>Prize</span><strong>${credits(event.prize_amount)}</strong></div>
      <div><span>Ticket</span><strong>${credits(event.ticket_price)}</strong></div>
      <div><span>Limit</span><strong>${event.max_tickets_per_user} / player</strong></div>
      <div><span>Draw</span><strong>${fmt(event.draw_at)}</strong></div>
    </div>`;
  return a;
}
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
async function loadEvents() {
  if (!supabase) return;
  const grid = document.getElementById('lotteryEventsGrid');
  const { data, error } = await supabase.from('lottery_events').select('id,slug,title,description,status,ticket_price,prize_amount,max_tickets_per_user,opens_at,cutoff_at,draw_at').order('draw_at', { ascending: true }).limit(24);
  if (error) {
    grid.innerHTML = `<div class="events-empty">Could not load events.</div>`;
    return;
  }
  grid.replaceChildren();
  if (!data?.length) {
    grid.innerHTML = '<div class="events-empty">No public events yet. New events created by admin will appear here.</div>';
    return;
  }
  data.forEach(ev => grid.appendChild(card(ev)));
}
async function handlePostLoginReturn() {
  if (!supabase) return;
  const pending = localStorage.getItem('draw01_post_login_event');
  if (!pending) return;
  const { data } = await supabase.auth.getSession();
  if (data.session) {
    localStorage.removeItem('draw01_post_login_event');
    window.location.replace(`event.html?e=${encodeURIComponent(pending)}`);
  }
}

ensureStyles();
buildSection();
loadEvents();
handlePostLoginReturn();
