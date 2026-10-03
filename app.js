const state = {
  ticketWhite: [],
  ticketRed: null,
  pickerWhite: [],
  pickerRed: null,
  drawing: false,
  history: JSON.parse(localStorage.getItem('draw01-history') || '[]')
};

const $ = (id) => document.getElementById(id);
const ticketBalls = $('ticketBalls');
const ticketPowerball = $('ticketPowerball');
const drawBalls = $('drawBalls');
const drawPowerball = $('drawPowerball');
const drawBtn = $('drawBtn');
const chooseBtn = $('chooseBtn');
const quickPickBtn = $('quickPickBtn');
const clearBtn = $('clearBtn');
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
const clearHistoryBtn = $('clearHistoryBtn');

function randomInt(max) {
  if (window.crypto?.getRandomValues) {
    const limit = Math.floor(0x100000000 / max) * max;
    const buf = new Uint32Array(1);
    do window.crypto.getRandomValues(buf); while (buf[0] >= limit);
    return buf[0] % max;
  }
  return Math.floor(Math.random() * max);
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

function renderTicket() {
  ticketBalls.replaceChildren();
  for (let i = 0; i < 5; i++) {
    if (state.ticketWhite[i]) {
      ticketBalls.appendChild(makeBall(state.ticketWhite[i], false, i * 35));
    } else {
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
}

function quickPick() {
  state.ticketWhite = uniqueRandom(5, 69);
  state.ticketRed = randomInt(26) + 1;
  renderTicket();
  resetMatchMessage();
}

function clearTicket() {
  state.ticketWhite = [];
  state.ticketRed = null;
  renderTicket();
  resetMatchMessage();
}

function resetMatchMessage() {
  matchResult.className = 'match-result';
  matchResult.textContent = state.ticketWhite.length === 5 && state.ticketRed
    ? 'Ticket ready. Run a draw to compare.'
    : 'Pick a ticket, then run a draw to compare.';
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
    const n = Number(btn.dataset.value);
    btn.classList.toggle('selected', state.pickerRed === n);
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

function saveTicket() {
  if (state.pickerWhite.length !== 5 || !state.pickerRed) return;
  state.ticketWhite = [...state.pickerWhite];
  state.ticketRed = state.pickerRed;
  renderTicket();
  resetMatchMessage();
  pickerDialog.close();
}

function resetPicker() {
  state.pickerWhite = [];
  state.pickerRed = null;
  syncPickerUI();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runDraw() {
  if (state.drawing) return;
  state.drawing = true;
  drawBtn.disabled = true;
  drawBtn.querySelector('span:first-child').textContent = 'DRAWING…';
  drawBalls.replaceChildren();
  drawPowerball.className = 'ball powerball empty';
  drawPowerball.textContent = 'PB';
  matchResult.className = 'match-result';
  matchResult.textContent = 'Randomizing draw sequence…';

  const white = uniqueRandom(5, 69);
  const red = randomInt(26) + 1;

  for (let i = 0; i < white.length; i++) {
    await sleep(220);
    drawBalls.appendChild(makeBall(white[i]));
  }

  await sleep(280);
  drawPowerball.className = 'ball powerball';
  drawPowerball.textContent = String(red).padStart(2, '0');

  const id = Math.floor(Date.now() / 1000).toString().slice(-6);
  drawId.textContent = `#${id}`;

  compareTicket(white, red);
  saveHistory({ white, red, time: Date.now(), id });

  drawBtn.disabled = false;
  drawBtn.querySelector('span:first-child').textContent = 'RUN DRAW';
  state.drawing = false;
}

function compareTicket(white, red) {
  if (state.ticketWhite.length !== 5 || !state.ticketRed) {
    matchResult.className = 'match-result';
    matchResult.textContent = 'Draw complete. Create a ticket to compare future draws.';
    return;
  }

  const whiteMatches = state.ticketWhite.filter((n) => white.includes(n)).length;
  const redMatch = state.ticketRed === red;
  matchResult.className = `match-result${whiteMatches || redMatch ? ' success' : ''}`;
  matchResult.textContent = `MATCH: ${whiteMatches}/5 white${redMatch ? ' + Powerball' : ''}${!whiteMatches && !redMatch ? ' — no match this draw' : ''}.`;
}

function saveHistory(item) {
  state.history.unshift(item);
  state.history = state.history.slice(0, 6);
  localStorage.setItem('draw01-history', JSON.stringify(state.history));
  renderHistory();
}

function renderHistory() {
  if (!state.history.length) {
    historyList.innerHTML = '<p class="muted">No draws yet.</p>';
    return;
  }

  historyList.replaceChildren();
  state.history.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'history-row';

    const numbers = document.createElement('div');
    numbers.className = 'history-numbers';
    numbers.innerHTML = `${item.white.map((n) => `<span>${String(n).padStart(2, '0')}</span>`).join('')}<span class="history-pb">+ ${String(item.red).padStart(2, '0')}</span>`;

    const time = document.createElement('span');
    time.className = 'history-time';
    time.textContent = new Date(item.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    row.append(numbers, time);
    historyList.appendChild(row);
  });
}

function clearHistory() {
  state.history = [];
  localStorage.removeItem('draw01-history');
  renderHistory();
}

chooseBtn.addEventListener('click', openPicker);
quickPickBtn.addEventListener('click', quickPick);
clearBtn.addEventListener('click', clearTicket);
saveTicketBtn.addEventListener('click', saveTicket);
resetPickerBtn.addEventListener('click', resetPicker);
drawBtn.addEventListener('click', runDraw);
clearHistoryBtn.addEventListener('click', clearHistory);

buildPicker();
renderTicket();
renderHistory();
resetMatchMessage();
