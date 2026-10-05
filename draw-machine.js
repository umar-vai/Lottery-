const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function clamp(n, min, max){ return Math.max(min, Math.min(max, n)); }
function pad2(n){ return String(n).padStart(2, '0'); }
function toTime(v){ const n = v ? new Date(v).getTime() : NaN; return Number.isFinite(n) ? n : null; }
function moneyTime(ms){
  if(ms <= 0) return '00:00';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if(d > 0) return `${d}d ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
  if(h > 0) return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}
function resultFromEvent(event){
  let whites = Array.isArray(event?.winning_numbers) ? event.winning_numbers.map(Number).filter(Number.isFinite) : [];
  let bonus = event?.winning_bonus_ball == null ? null : Number(event.winning_bonus_ball);
  if(!whites.length && Array.isArray(event?.winner_summary) && event.winner_summary.length){
    const first = [...event.winner_summary].sort((a,b)=>Number(a.rank||999)-Number(b.rank||999))[0];
    whites = Array.isArray(first?.white_numbers) ? first.white_numbers.map(Number).filter(Number.isFinite) : [];
    if(bonus == null && first?.bonus_ball != null) bonus = Number(first.bonus_ball);
  }
  return { whites, bonus: Number.isFinite(bonus) ? bonus : null };
}
function stateFor(event, now = Date.now()){
  if(!event) return 'open';
  if(event.status === 'completed') return 'complete';
  if(event.status === 'cancelled') return 'complete';
  const drawAt = toTime(event.draw_at);
  const cutoffAt = toTime(event.cutoff_at);
  if(event.schedule_mode === 'manual') return 'open';
  if(drawAt && now >= drawAt) return 'drawing';
  if(cutoffAt && now >= cutoffAt) return 'locked';
  return 'open';
}
function create(tag, cls, text){
  const el = document.createElement(tag);
  if(cls) el.className = cls;
  if(text != null) el.textContent = text;
  return el;
}
function motionPoint(seed, spread){
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return Math.round(((x - Math.floor(x)) * 2 - 1) * spread);
}

export class EventDrawMachine {
  constructor(mount){
    this.mount = mount;
    this.event = null;
    this.configKey = '';
    this.timeouts = [];
    this.playbackKey = '';
    this.playing = false;
    this.wasWaiting = false;
    this.destroyed = false;
    this.reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false;
    this.build();
    this.tickTimer = window.setInterval(()=>this.tick(), 1000);
  }

  build(){
    this.mount.classList.add('draw-machine-section');
    this.mount.innerHTML = `
      <div class="gm-head">
        <div><span class="gm-kicker">AUTOMATED LIVE DRAW</span><h2>Dual-chamber draw machine</h2><p>Main balls keep mixing continuously. The result sequence starts automatically when the server completes the scheduled draw.</p></div>
        <div class="gm-status" data-state="open"><i></i><span>Preparing</span></div>
      </div>
      <div class="gm-stage">
        <div class="gm-flash"></div>
        <div class="gm-live-pill">Machine online</div>
        <div class="gm-machine main">
          <div class="gm-chamber-wrap"><div class="gm-neck"></div><div class="gm-base"></div><div class="gm-chamber"><div class="gm-air-ring"></div></div></div>
          <div class="gm-machine-label">Main ball chamber</div>
        </div>
        <div class="gm-center">
          <div class="gm-board">
            <div class="gm-board-top"><span class="gm-board-title">DRAW RESULT</span><strong class="gm-countdown">—</strong></div>
            <div class="gm-display"><div class="gm-display-label">Result rail</div><div class="gm-result-rail" aria-live="polite"></div></div>
            <div class="gm-board-message">The chambers stay active while this event is available.</div>
            <div class="gm-actions"><button type="button" class="gm-replay" hidden>Replay draw animation</button></div>
          </div>
        </div>
        <div class="gm-machine bonus">
          <div class="gm-chamber-wrap"><div class="gm-neck"></div><div class="gm-base"></div><div class="gm-chamber"><div class="gm-air-ring"></div></div></div>
          <div class="gm-machine-label">Special ball chamber</div>
        </div>
      </div>`;
    this.stage = this.mount.querySelector('.gm-stage');
    this.status = this.mount.querySelector('.gm-status');
    this.statusText = this.status.querySelector('span');
    this.countdown = this.mount.querySelector('.gm-countdown');
    this.message = this.mount.querySelector('.gm-board-message');
    this.rail = this.mount.querySelector('.gm-result-rail');
    this.mainChamber = this.mount.querySelector('.gm-machine.main .gm-chamber');
    this.bonusMachine = this.mount.querySelector('.gm-machine.bonus');
    this.bonusChamber = this.bonusMachine.querySelector('.gm-chamber');
    this.livePill = this.mount.querySelector('.gm-live-pill');
    this.replay = this.mount.querySelector('.gm-replay');
    this.replay.addEventListener('click', ()=>this.replayDraw());
  }

  setEvent(event, { initial = false } = {}){
    if(this.destroyed || !event) return;
    const previous = this.event;
    this.event = event;
    const key = [event.white_ball_count,event.white_ball_max,event.bonus_ball_enabled,event.bonus_ball_max].join(':');
    if(key !== this.configKey){
      this.configKey = key;
      this.populateChambers();
      this.prepareSlots();
    }
    if(event.status !== 'completed') this.wasWaiting = true;
    this.tick();

    if(event.status === 'completed'){
      const result = resultFromEvent(event);
      const completedAt = toTime(event.completed_at) || Date.now();
      const nextKey = `${event.id}:${event.completed_at || 'completed'}:${result.whites.join(',')}:${result.bonus ?? ''}`;
      if(nextKey !== this.playbackKey){
        this.playbackKey = nextKey;
        const age = Date.now() - completedAt;
        const shouldAnimate = !this.reduced && (this.wasWaiting || age < 90000 || previous?.status !== 'completed');
        if(result.whites.length){
          if(shouldAnimate) this.playSynced(result, completedAt);
          else this.showFinal(result);
        }else{
          this.setStatus('complete','Completed');
          this.message.textContent = 'The event is completed. No displayable ball result was stored for this event.';
        }
      }
    }else if(initial){
      this.clearResult();
    }
  }

  populateChambers(){
    if(!this.event) return;
    this.mainChamber.querySelectorAll('.gm-ball').forEach(x=>x.remove());
    this.bonusChamber.querySelectorAll('.gm-ball').forEach(x=>x.remove());
    const mainVisible = clamp(Math.round(Number(this.event.white_ball_max || 30) * .42), 14, 30);
    const bonusVisible = clamp(Math.round(Number(this.event.bonus_ball_max || 20) * .55), 10, 20);
    this.addPool(this.mainChamber, mainVisible, Number(this.event.white_ball_max || 69), false);
    if(this.event.bonus_ball_enabled){
      this.bonusMachine.classList.remove('offline');
      this.addPool(this.bonusChamber, bonusVisible, Number(this.event.bonus_ball_max || 26), true);
      this.bonusMachine.querySelector('.gm-machine-label').textContent = 'Special ball chamber';
    }else{
      this.bonusMachine.classList.add('offline');
      this.bonusMachine.querySelector('.gm-machine-label').textContent = 'Special ball disabled';
    }
  }

  addPool(chamber, count, max, bonus){
    const used = new Set();
    for(let i=0;i<count;i++){
      let n = 1 + Math.floor((i * max) / count);
      while(used.has(n) && n < max) n++;
      used.add(n);
      const ball = create('span','gm-ball',pad2(n));
      const spread = bonus ? 72 : 82;
      ball.style.setProperty('--x0',`${motionPoint(i+1.1,spread)}px`);
      ball.style.setProperty('--y0',`${motionPoint(i+2.7,spread)}px`);
      ball.style.setProperty('--x1',`${motionPoint(i+4.3,spread)}px`);
      ball.style.setProperty('--y1',`${motionPoint(i+6.1,spread)}px`);
      ball.style.setProperty('--x2',`${motionPoint(i+8.2,spread)}px`);
      ball.style.setProperty('--y2',`${motionPoint(i+10.4,spread)}px`);
      ball.style.setProperty('--x3',`${motionPoint(i+12.5,spread)}px`);
      ball.style.setProperty('--y3',`${motionPoint(i+14.7,spread)}px`);
      ball.style.setProperty('--d',`${(3.8 + ((i * 17) % 22) / 10).toFixed(1)}s`);
      ball.style.setProperty('--delay',`${(-((i * 29) % 50) / 10).toFixed(1)}s`);
      chamber.appendChild(ball);
    }
  }

  prepareSlots(){
    if(!this.event) return;
    this.rail.replaceChildren();
    const count = Number(this.event.white_ball_count || 5);
    for(let i=0;i<count;i++){
      const slot = create('span','gm-result-slot','—');
      slot.dataset.index = String(i);
      this.rail.appendChild(slot);
    }
    if(this.event.bonus_ball_enabled){
      const slot = create('span','gm-result-slot bonus','B');
      slot.dataset.index = 'bonus';
      this.rail.appendChild(slot);
    }
  }

  clearResult(){
    this.cancelScheduled();
    this.playing = false;
    this.stage.classList.remove('is-drawing');
    this.prepareSlots();
    this.replay.hidden = true;
  }

  setStatus(state, label){
    this.status.dataset.state = state;
    this.statusText.textContent = label;
  }

  tick(){
    if(!this.event || this.destroyed) return;
    const now = Date.now();
    const state = stateFor(this.event, now);
    const drawAt = toTime(this.event.draw_at);
    const cutoffAt = toTime(this.event.cutoff_at);
    if(this.playing) return;

    if(this.event.status === 'completed'){
      this.setStatus('complete','Draw complete');
      this.countdown.textContent = 'FINAL';
      this.livePill.textContent = 'Result locked';
      return;
    }
    if(this.event.status === 'cancelled'){
      this.setStatus('complete','Cancelled');
      this.countdown.textContent = 'CANCELLED';
      this.livePill.textContent = 'Machine idle';
      this.message.textContent = 'This event was cancelled.';
      return;
    }
    if(this.event.schedule_mode === 'manual'){
      this.setStatus('open','Manual draw');
      this.countdown.textContent = 'ADMIN';
      this.livePill.textContent = 'Machine online';
      this.message.textContent = 'The chambers remain active. The result sequence will start when the admin completes the draw.';
      return;
    }
    if(state === 'drawing'){
      this.wasWaiting = true;
      this.stage.classList.add('is-drawing');
      this.setStatus('drawing','Drawing');
      this.countdown.textContent = 'LIVE';
      this.livePill.textContent = 'Draw in progress';
      this.message.textContent = 'Ticket sales are closed. The server is finalizing the draw result; the reveal starts automatically as soon as it is locked.';
      return;
    }
    this.stage.classList.remove('is-drawing');
    this.livePill.textContent = 'Machine online';
    if(state === 'locked'){
      this.setStatus('locked','Entries locked');
      this.countdown.textContent = drawAt ? moneyTime(drawAt-now) : 'LOCKED';
      this.message.textContent = 'Entries are locked. Both chambers keep mixing until the scheduled draw begins.';
    }else{
      this.setStatus('open','Draw scheduled');
      this.countdown.textContent = drawAt ? moneyTime(drawAt-now) : '—';
      if(cutoffAt) this.message.textContent = `Continuous chamber mixing is active. Ticket cutoff is ${new Date(cutoffAt).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}.`;
      else this.message.textContent = 'Continuous chamber mixing is active while the event remains open.';
    }
  }

  showFinal(result){
    this.cancelScheduled();
    this.playing = false;
    this.stage.classList.remove('is-drawing');
    this.prepareSlots();
    result.whites.slice(0, Number(this.event.white_ball_count || result.whites.length)).forEach((n,i)=>this.setFinalBall(String(i),n,false));
    if(this.event.bonus_ball_enabled && result.bonus != null) this.setFinalBall('bonus',result.bonus,true);
    this.setStatus('complete','Draw complete');
    this.countdown.textContent = 'FINAL';
    this.livePill.textContent = 'Result locked';
    this.message.textContent = 'The automated draw is complete. The displayed balls are locked to the server result.';
    this.replay.hidden = false;
  }

  playSynced(result, completedAt){
    this.cancelScheduled();
    this.prepareSlots();
    this.playing = true;
    this.stage.classList.add('is-drawing');
    this.setStatus('drawing','Revealing result');
    this.countdown.textContent = 'LIVE';
    this.livePill.textContent = 'Live result reveal';
    this.message.textContent = 'Main balls are being revealed first. The special ball is revealed last.';
    this.replay.hidden = true;

    if(this.reduced){ this.showFinal(result); return; }
    const whiteCount = Number(this.event.white_ball_count || result.whites.length);
    const sequence = result.whites.slice(0,whiteCount).map((n,i)=>({ key:String(i), number:n, bonus:false }));
    if(this.event.bonus_ball_enabled && result.bonus != null) sequence.push({ key:'bonus', number:result.bonus, bonus:true });
    const start = Math.max(completedAt + 650, Date.now() - 15000);
    const gap = 1320;
    const flight = 880;
    const now = Date.now();

    sequence.forEach((item,idx)=>{
      const at = start + idx * gap;
      const doneAt = at + flight;
      if(now >= doneAt){
        this.setFinalBall(item.key,item.number,item.bonus);
      }else if(now >= at){
        this.flyBall(item.key,item.number,item.bonus,Math.max(240,doneAt-now));
      }else{
        this.timeouts.push(window.setTimeout(()=>this.flyBall(item.key,item.number,item.bonus,flight), at-now));
      }
    });
    const finishAt = start + Math.max(0,sequence.length-1)*gap + flight + 450;
    if(now >= finishAt) this.finishReveal(result);
    else this.timeouts.push(window.setTimeout(()=>this.finishReveal(result), finishAt-now));
  }

  replayDraw(){
    if(!this.event || this.event.status !== 'completed') return;
    const result = resultFromEvent(this.event);
    if(!result.whites.length) return;
    this.playSynced(result,Date.now()-300);
  }

  setFinalBall(key, number, bonus){
    const slot = this.rail.querySelector(`.gm-result-slot[data-index="${key}"]`);
    if(!slot) return;
    slot.className = `gm-result-ball${bonus?' bonus':''}`;
    slot.textContent = pad2(number);
  }

  flyBall(key, number, bonus, duration){
    const slot = this.rail.querySelector(`.gm-result-slot[data-index="${key}"]`);
    if(!slot || slot.classList.contains('gm-result-ball')) return;
    if(this.reduced || !Element.prototype.animate){ this.setFinalBall(key,number,bonus); return; }
    const stageRect = this.stage.getBoundingClientRect();
    const source = (bonus ? this.bonusChamber : this.mainChamber).getBoundingClientRect();
    const target = slot.getBoundingClientRect();
    const ball = create('span',`gm-flight${bonus?' bonus':''}`,pad2(number));
    const sx = source.left + source.width/2 - stageRect.left - 23;
    const sy = source.top + source.height/2 - stageRect.top - 23;
    const tx = target.left + target.width/2 - stageRect.left - 23;
    const ty = target.top + target.height/2 - stageRect.top - 23;
    ball.style.left = `${sx}px`;
    ball.style.top = `${sy}px`;
    this.stage.appendChild(ball);
    const dx = tx-sx, dy = ty-sy;
    const arc = bonus ? -54 : -72;
    const animation = ball.animate([
      { transform:'translate3d(0,0,0) rotate(0deg) scale(.78)', opacity:.25 },
      { transform:`translate3d(${dx*.36}px,${dy*.36+arc}px,0) rotate(260deg) scale(1.08)`, opacity:1, offset:.42 },
      { transform:`translate3d(${dx*.76}px,${dy*.76-20}px,0) rotate(620deg) scale(1)`, opacity:1, offset:.78 },
      { transform:`translate3d(${dx}px,${dy}px,0) rotate(900deg) scale(1)`, opacity:1 }
    ],{ duration, easing:'cubic-bezier(.19,.78,.25,1)', fill:'forwards' });
    animation.onfinish=()=>{ ball.remove(); this.setFinalBall(key,number,bonus); };
    animation.oncancel=()=>ball.remove();
  }

  finishReveal(result){
    if(this.destroyed) return;
    result.whites.slice(0,Number(this.event.white_ball_count || result.whites.length)).forEach((n,i)=>this.setFinalBall(String(i),n,false));
    if(this.event.bonus_ball_enabled && result.bonus != null) this.setFinalBall('bonus',result.bonus,true);
    this.playing = false;
    this.stage.classList.remove('is-drawing');
    this.setStatus('complete','Draw complete');
    this.countdown.textContent = 'FINAL';
    this.livePill.textContent = 'Result locked';
    this.message.textContent = 'Reveal complete. The result shown here is the locked server result for this event.';
    this.replay.hidden = false;
  }

  cancelScheduled(){
    this.timeouts.forEach(id=>clearTimeout(id));
    this.timeouts=[];
    this.stage?.querySelectorAll('.gm-flight').forEach(x=>x.remove());
  }

  destroy(){
    this.destroyed = true;
    this.cancelScheduled();
    clearInterval(this.tickTimer);
  }
}
