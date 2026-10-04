import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, APP_URL, BACKEND_READY } from './config.js';

const state = {
  ticketWhite: [],
  ticketRed: null,
  pickerWhite: [],
  pickerRed: null,
  session: null,
  currentDraw: null,
  latestDraw: null,
  realtimeChannel: null,
};

const supabase = BACKEND_READY
  ? createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: true, detectSessionInUrl: true, autoRefreshToken: true },
    })
  : null;

const $ = (id) => document.getElementById(id);
const ticketBalls = $('ticketBalls');
const ticketPowerball = $('ticketPowerball');
const drawBalls = $('drawBalls');
const drawPowerball = $('drawPowerball');
const chooseBtn = $('chooseBtn');
const quickPickBtn = $('quickPickBtn');
const clearBtn = $('clearBtn');
const submitTicketBtn = $('submitTicketBtn');
const powerPlayToggle = $('powerPlayToggle');
const pickerDialog = $('pickerDialog');
const whiteGrid = $('whiteGrid');
const redGrid = $('redGrid');
const whiteCount = $('whiteCount');
const redCount = $('redCount');
const saveTicketBtn = $('saveTicketBtn');
const resetPickerBtn = $('resetPickerBtn');
const matchResult = $('matchResult');
const drawId = $('drawId');
const historyList = $('historyList');
const myTickets = $('myTickets');
const ticketNotice = $('ticketNotice');
const jackpotValue = $('jackpotValue');
const countdownValue = $('countdownValue');
const drawStatus = $('drawStatus');
const drawScheduleCopy = $('drawScheduleCopy');
const loginBtn = $('loginBtn');
const loginInlineBtn = $('loginInlineBtn');
const logoutBtn = $('logoutBtn');
const accountCard = $('accountCard');
const userAvatar = $('userAvatar');
const userName = $('userName');
const userEmail = $('userEmail');
const loginGate = $('loginGate');
const backendBanner = $('backendBanner');

function randomInt(max) {
  const limit = Math.floor(0x100000000 / max) * max;
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf); while (buf[0] >= limit);
  return buf[0] % max;
}

function uniqueRandom(count, max) {
  const set = new Set();
  while (set.size < count) set.add(randomInt(max) + 1);
  return [...set].sort((a, b) => a - b);
}

function makeBall(number, powerball = false, delay = 0) {
  const el = document.createElement('div');
  el.className = `ball${powerball ? ' powerball' : ''}`;
  el.textContent = String(number).padStart(2, '0');
  el.style.animationDelay = `${delay}ms`;
  return el;
}

function money(value) {
  const n = Number(value || 0);
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(n % 1_000_000_000 ? 1 : 0)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M`;
  return `$${n.toLocaleString()}`;
}

function setNotice(message, type = '') {
  ticketNotice.className = `notice${type ? ` ${type}` : ''}`;
  ticketNotice.textContent = message;
}

function renderTicket() {
  ticketBalls.replaceChildren();
  for (let i = 0; i < 5; i++) {
    if (state.ticketWhite[i]) ticketBalls.appendChild(makeBall(state.ticketWhite[i], false, i * 35));
    else {
      const el = document.createElement('div');
      el.className = 'ball empty';
      el.textContent = '—';
      ticketBalls.appendChild(el);
    }
  }

  if (state.ticketRed) {
    ticketPowerball.className = 'ball powerball';
    ticketPowerball.textContent = String(state.ticketRed).padStart(2, '0');
  } else {
    ticketPowerball.className = 'ball powerball empty';
    ticketPowerball.textContent = 'PB';
  }

  const ready = state.ticketWhite.length === 5 && state.ticketRed;
  submitTicketBtn.disabled = !ready || !isDrawOpen();
  if (ready && isDrawOpen()) setNotice('Ticket ready. Submit it to save it for the current draw.');
}

function quickPick() {
  state.ticketWhite = uniqueRandom(5, 69);
  state.ticketRed = randomInt(26) + 1;
  renderTicket();
}

function clearTicket() {
  state.ticketWhite = [];
  state.ticketRed = null;
  powerPlayToggle.checked = false;
  renderTicket();
  setNotice('Choose 5 white numbers and 1 Powerball.');
}

function buildPicker() {
  whiteGrid.replaceChildren();
  redGrid.replaceChildren();
  for (let n = 1; n <= 69; n++) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'number-btn';
    btn.textContent = n;
    btn.dataset.value = n;
    btn.addEventListener('click', () => toggleWhite(n));
    whiteGrid.appendChild(btn);
  }
  for (let n = 1; n <= 26; n++) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'number-btn';
    btn.textContent = n;
    btn.dataset.value = n;
    btn.addEventListener('click', () => toggleRed(n));
    redGrid.appendChild(btn);
  }
}

function syncPickerUI() {
  [...whiteGrid.children].forEach((btn) => {
    const n = Number(btn.dataset.value);
    const selected = state.pickerWhite.includes(n);
    btn.classList.toggle('selected', selected);
    btn.classList.toggle('locked', state.pickerWhite.length >= 5 && !selected);
  });
  [...redGrid.children].forEach((btn) => {
    btn.classList.toggle('selected', state.pickerRed === Number(btn.dataset.value));
  });
  whiteCount.textContent = `${state.pickerWhite.length} / 5`;
  redCount.textContent = `${state.pickerRed ? 1 : 0} / 1`;
  saveTicketBtn.disabled = !(state.pickerWhite.length === 5 && state.pickerRed);
}

function toggleWhite(n) {
  const idx = state.pickerWhite.indexOf(n);
  if (idx >= 0) state.pickerWhite.splice(idx, 1);
  else if (state.pickerWhite.length < 5) state.pickerWhite.push(n);
  state.pickerWhite.sort((a, b) => a - b);
  syncPickerUI();
}

function toggleRed(n) {
  state.pickerRed = state.pickerRed === n ? null : n;
  syncPickerUI();
}

function openPicker() {
  state.pickerWhite = [...state.ticketWhite];
  state.pickerRed = state.ticketRed;
  syncPickerUI();
  pickerDialog.showModal();
}

function usePickerTicket() {
  if (state.pickerWhite.length !== 5 || !state.pickerRed) return;
  state.ticketWhite = [...state.pickerWhite];
  state.ticketRed = state.pickerRed;
  renderTicket();
  pickerDialog.close();
}

function resetPicker() {
  state.pickerWhite = [];
  state.pickerRed = null;
  syncPickerUI();
}

function isDrawOpen() {
  return Boolean(
    state.currentDraw &&
    state.currentDraw.status === 'open' &&
    new Date(state.currentDraw.cutoff_at).getTime() > Date.now()
  );
}

function renderAuth() {
  const user = state.session?.user;
  const signedIn = Boolean(user);
  loginBtn.hidden = signedIn;
  accountCard.hidden = !signedIn;
  loginGate.hidden = signedIn;
  if (!signedIn) {
    myTickets.innerHTML = '<p class="empty-state">Sign in to see your saved tickets.</p>';
    return;
  }

  const meta = user.user_metadata || {};
  userName.textContent = meta.full_name || meta.name || user.email?.split('@')[0] || 'Player';
  userEmail.textContent = user.email || '';
  userAvatar.src = meta.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(userName.textContent)}`;
  userAvatar.alt = `${userName.textContent} avatar`;
}

async function signInWithGoogle() {
  if (!supabase) {
    setNotice('Backend connection is not configured yet.', 'error');
    return;
  }
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: APP_URL },
  });
  if (error) setNotice(error.message, 'error');
}

async function signOut() {
  if (!supabase) return;
  await supabase.auth.signOut();
}

async function submitTicket() {
  if (!BACKEND_READY || !supabase) {
    setNotice('Supabase backend is not connected yet.', 'error');
    return;
  }
  if (!state.session?.user) {
    await signInWithGoogle();
    return;
  }
  if (!isDrawOpen()) {
    setNotice('Ticket sales are locked for this draw.', 'error');
    return;
  }
  if (state.ticketWhite.length !== 5 || !state.ticketRed) {
    setNotice('Choose exactly 5 white numbers and 1 Powerball.', 'error');
    return;
  }

  submitTicketBtn.disabled = true;
  setNotice('Submitting ticket…');
  const { error } = await supabase.from('tickets').insert({
    user_id: state.session.user.id,
    draw_id: state.currentDraw.id,
    white_numbers: state.ticketWhite,
    powerball: state.ticketRed,
    power_play: powerPlayToggle.checked,
  });

  if (error) {
    setNotice(error.message, 'error');
  } else {
    setNotice(`Ticket confirmed for Draw #${state.currentDraw.draw_number}. You can submit another ticket too.`, 'ok');
    await loadMyTickets();
  }
  renderTicket();
}

function renderDrawBalls(draw) {
  drawBalls.replaceChildren();
  if (!draw?.white_numbers?.length) {
    for (let i = 0; i < 5; i++) {
      const el = document.createElement('div');
      el.className = 'ball empty';
      el.textContent = '—';
      drawBalls.appendChild(el);
    }
    drawPowerball.className = 'ball powerball empty';
    drawPowerball.textContent = 'PB';
    matchResult.textContent = state.currentDraw?.status === 'drawing' ? 'Draw in progress…' : 'Waiting for the next completed server draw.';
    return;
  }

  draw.white_numbers.forEach((n, i) => drawBalls.appendChild(makeBall(n, false, i * 80)));
  drawPowerball.className = 'ball powerball';
  drawPowerball.textContent = String(draw.powerball).padStart(2, '0');
  drawId.textContent = `#${String(draw.draw_number).padStart(6, '0')}`;
  matchResult.className = 'match-result success';
  matchResult.textContent = `Power Play ${draw.power_play_multiplier || '—'}X · Verifiable seed published with this completed draw.`;
}

function renderCurrentDraw() {
  const draw = state.currentDraw;
  if (!draw) {
    jackpotValue.textContent = '$20M';
    drawStatus.textContent = 'NO DRAW';
    drawStatus.className = 'draw-status-pill';
    countdownValue.textContent = '--:--';
    return;
  }

  jackpotValue.textContent = money(draw.jackpot_amount);
  drawStatus.textContent = draw.status.toUpperCase();
  drawStatus.className = `draw-status-pill ${draw.status}`;
  drawScheduleCopy.textContent = `Draw #${draw.draw_number} · ${new Date(draw.draw_at).toLocaleString()}`;
  renderTicket();
}

function updateCountdown() {
  const draw = state.currentDraw;
  if (!draw) return;
  const target = draw.status === 'open' ? new Date(draw.cutoff_at).getTime() : new Date(draw.draw_at).getTime();
  let seconds = Math.max(0, Math.floor((target - Date.now()) / 1000));
  const hours = Math.floor(seconds / 3600);
  seconds %= 3600;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  countdownValue.textContent = hours > 0
    ? `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

  if (draw.status === 'open' && Date.now() >= new Date(draw.cutoff_at).getTime()) {
    drawStatus.textContent = 'LOCKING';
    submitTicketBtn.disabled = true;
  }
}

async function loadCurrentDraw() {
  if (!supabase) return;
  const { data: active, error } = await supabase
    .from('draws')
    .select('*')
    .in('status', ['open', 'locked', 'drawing'])
    .order('draw_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error(error);
    return;
  }
  state.currentDraw = active || null;
  renderCurrentDraw();
  updateCountdown();
}

async function loadLatestResult() {
  if (!supabase) return;
  const { data, error } = await supabase
    .from('draws')
    .select('*')
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return console.error(error);
  state.latestDraw = data || null;
  renderDrawBalls(state.latestDraw);
}

async function loadHistory() {
  if (!supabase) return;
  const { data, error } = await supabase
    .from('draws')
    .select('draw_number,white_numbers,powerball,power_play_multiplier,completed_at,jackpot_amount')
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(8);
  if (error) return console.error(error);

  if (!data?.length) {
    historyList.innerHTML = '<p class="muted">No completed draws yet.</p>';
    return;
  }

  historyList.replaceChildren();
  for (const item of data) {
    const row = document.createElement('div');
    row.className = 'history-row';
    const numbers = document.createElement('div');
    numbers.className = 'history-numbers';
    numbers.innerHTML = `${item.white_numbers.map((n) => `<span>${String(n).padStart(2, '0')}</span>`).join('')}<span class="history-pb">+ ${String(item.powerball).padStart(2, '0')}</span><span class="history-extra">PP ${item.power_play_multiplier}X</span>`;
    const time = document.createElement('span');
    time.className = 'history-time';
    time.textContent = `#${item.draw_number}`;
    row.append(numbers, time);
    historyList.appendChild(row);
  }
}

async function loadMyTickets() {
  if (!supabase || !state.session?.user) return;
  const { data, error } = await supabase
    .from('tickets')
    .select('id,white_numbers,powerball,power_play,submitted_at,draws(draw_number,status,draw_at),ticket_results(white_matches,powerball_match,prize_tier,simulated_final_prize)')
    .order('submitted_at', { ascending: false })
    .limit(12);
  if (error) {
    myTickets.innerHTML = `<p class="empty-state">${error.message}</p>`;
    return;
  }
  if (!data?.length) {
    myTickets.innerHTML = '<p class="empty-state">No tickets yet. Pick numbers above and submit one.</p>';
    return;
  }

  myTickets.replaceChildren();
  for (const ticket of data) {
    const draw = ticket.draws || {};
    const result = Array.isArray(ticket.ticket_results) ? ticket.ticket_results[0] : ticket.ticket_results;
    const card = document.createElement('div');
    card.className = 'my-ticket';
    const resultText = result
      ? `${result.prize_tier.replaceAll('_', ' ')} · ${money(result.simulated_final_prize)}`
      : String(draw.status || 'pending').toUpperCase();
    card.innerHTML = `
      <div class="my-ticket-top"><span>DRAW #${draw.draw_number ?? '—'}${ticket.power_play ? ' · POWER PLAY' : ''}</span><span>${resultText}</span></div>
      <div class="my-ticket-numbers">${ticket.white_numbers.map((n) => String(n).padStart(2, '0')).join('  ')} <span class="pb">+ ${String(ticket.powerball).padStart(2, '0')}</span></div>`;
    myTickets.appendChild(card);
  }
}

async function refreshAll() {
  await Promise.all([loadCurrentDraw(), loadLatestResult(), loadHistory()]);
  if (state.session?.user) await loadMyTickets();
}

function subscribeRealtime() {
  if (!supabase) return;
  if (state.realtimeChannel) supabase.removeChannel(state.realtimeChannel);
  state.realtimeChannel = supabase
    .channel('draws-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'draws' }, async () => {
      await refreshAll();
    })
    .subscribe();
}

async function initBackend() {
  if (!BACKEND_READY || !supabase) {
    backendBanner.hidden = false;
    drawStatus.textContent = 'SETUP';
    renderDrawBalls(null);
    return;
  }

  backendBanner.hidden = true;
  const { data } = await supabase.auth.getSession();
  state.session = data.session;
  renderAuth();
  await refreshAll();
  subscribeRealtime();

  supabase.auth.onAuthStateChange(async (_event, session) => {
    state.session = session;
    renderAuth();
    if (session?.user) await loadMyTickets();
  });
}

chooseBtn.addEventListener('click', openPicker);
quickPickBtn.addEventListener('click', quickPick);
clearBtn.addEventListener('click', clearTicket);
submitTicketBtn.addEventListener('click', submitTicket);
saveTicketBtn.addEventListener('click', usePickerTicket);
resetPickerBtn.addEventListener('click', resetPicker);
loginBtn.addEventListener('click', signInWithGoogle);
loginInlineBtn.addEventListener('click', signInWithGoogle);
logoutBtn.addEventListener('click', signOut);

buildPicker();
renderTicket();
renderAuth();
renderDrawBalls(null);
initBackend();
setInterval(updateCountdown, 1000);
