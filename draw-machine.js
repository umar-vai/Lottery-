const WINNER_SEGMENT_MS = 60000;
const DRAW_START_DELAY_MS = 1500;
const BALL_PRELUDE_MS = 5000;
const BALL_WINDOW_MS = 37000;
const BALL_FLIGHT_MS = 3800;
const WINNER_DECLARE_MS = 48000;

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
function normalizeWinner(w, index){
  const rank = Number(w?.rank ?? w?.winner_rank ?? (index + 1));
  const whites = Array.isArray(w?.white_numbers) ? w.white_numbers.map(Number).filter(Number.isFinite) : [];
  const bonusRaw = w?.bonus_ball;
  const bonus = bonusRaw == null ? null : Number(bonusRaw);
  return {
    rank: Number.isFinite(rank) ? rank : index + 1,
    prize: Number(w?.prize ?? w?.prize_awarded ?? 0),
    white_numbers: whites,
    bonus_ball: Number.isFinite(bonus) ? bonus : null,
    ticket_id: w?.ticket_id || null,
    user_id: w?.user_id || null
  };
}
function winnersFromEvent(event){
  let winners = Array.isArray(event?.winner_summary) ? event.winner_summary.map(normalizeWinner).filter(w=>w.white_numbers.length) : [];
  if(!winners.length){
    const whites = Array.isArray(event?.winning_numbers) ? event.winning_numbers.map(Number).filter(Number.isFinite) : [];
    const bonusRaw = event?.winning_bonus_ball;
    const bonus = bonusRaw == null ? null : Number(bonusRaw);
    if(whites.length) winners = [{rank:1,prize:Number(event?.prize_amount||0),white_numbers:whites,bonus_ball:Number.isFinite(bonus)?bonus:null,ticket_id:null,user_id:null}];
  }
  return winners.sort((a,b)=>b.rank-a.rank);
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
    this.revealedRanks = new Set();
    this.sequence = [];
    this.activeRank = null;
    this.build();
    this.tickTimer = window.setInterval(()=>this.tick(), 1000);
  }

  build(){
    this.mount.classList.add('draw-machine-section');
    this.mount.innerHTML = `
      <div class="gm-head">
        <div><span class="gm-kicker">AUTOMATED LIVE DRAW</span><h2>Ranked dual-chamber draw</h2><p>Every winner gets a full suspense reveal. The lowest prize position is drawn first and #1 is revealed last.</p></div>
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
            <div class="gm-board-top"><span class="gm-board-title">LIVE DRAW</span><strong class="gm-countdown">—</strong></div>
            <div class="gm-position-banner">
              <span class="gm-position-kicker">DRAWING POSITION</span>
              <strong class="gm-position-rank">WAITING</strong>
              <small class="gm-position-prize"></small>
            </div>
            <div class="gm-display"><div class="gm-display-label">Result rail</div><div class="gm-result-rail" aria-live="polite"></div></div>
            <div class="gm-declare" hidden><span>WINNER CONFIRMED</span><strong></strong></div>
            <div class="gm-board-message">The chambers stay active while this event is available.</div>
            <div class="gm-actions"><button type="button" class="gm-replay" hidden>Replay full ranked draw</button></div>
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
    this.positionRank = this.mount.querySelector('.gm-position-rank');
    this.positionPrize = this.mount.querySelector('.gm-position-prize');
    this.declareBox = this.mount.querySelector('.gm-declare');
    this.declareText = this.declareBox.querySelector('strong');
    this.replay.addEventListener('click', ()=>this.replayDraw());
  }

  emit(type, detail={}){
    this.mount.dispatchEvent(new CustomEvent(`gmdraw:${type}`, {detail, bubbles:true}));
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
      const winners = winnersFromEvent(event);
      const completedAt = toTime(event.completed_at) || Date.now();
      const signature = winners.map(w=>`${w.rank}:${w.white_numbers.join('.')}:${w.bonus_ball ?? ''}`).join('|');
      const nextKey = `${event.id}:${event.completed_at || 'completed'}:${signature}`;
      if(nextKey !== this.playbackKey){
        this.playbackKey = nextKey;
        const revealEnd = completedAt + DRAW_START_DELAY_MS + winners.length * WINNER_SEGMENT_MS;
        const shouldAnimate = !this.reduced && winners.length && (this.wasWaiting || Date.now() < revealEnd || previous?.status !== 'completed');
        if(winners.length){
          if(shouldAnimate) this.playRankedSequence(winners, completedAt);
          else this.showFinal(winners);
        }else{
          this.setStatus('complete','Completed');
          this.message.textContent = 'The event is completed. No displayable ranked winner result was stored.';
          this.emit('complete',{winners:[]});
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
      ball.style.setProperty('--d',`${(7.2 + ((i * 17) % 35) / 10).toFixed(1)}s`);
      ball.style.setProperty('--delay',`${(-((i * 29) % 80) / 10).toFixed(1)}s`);
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
    this.revealedRanks.clear();
    this.activeRank = null;
    this.stage.classList.remove('is-drawing','winner-declared');
    this.prepareSlots();
    this.positionRank.textContent = 'WAITING';
    this.positionPrize.textContent = '';
    this.declareBox.hidden = true;
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
      this.message.textContent = 'The chambers remain active. The ranked reveal starts when the admin completes the draw.';
      return;
    }
    if(state === 'drawing'){
      this.wasWaiting = true;
      this.stage.classList.add('is-drawing');
      this.setStatus('drawing','Drawing');
      this.countdown.textContent = 'LIVE';
      this.livePill.textContent = 'Draw in progress';
      this.message.textContent = 'Ticket sales are closed. The server is locking the winner order; the dramatic ranked reveal starts automatically.';
      return;
    }
    this.stage.classList.remove('is-drawing','winner-declared');
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

  playRankedSequence(winners, completedAt, {replay=false}={}){
    this.cancelScheduled();
    this.sequence = winners.slice().sort((a,b)=>b.rank-a.rank);
    this.revealedRanks.clear();
    this.playing = true;
    this.stage.classList.add('is-drawing');
    this.stage.classList.remove('winner-declared');
    this.setStatus('drawing','Ranked reveal');
    this.countdown.textContent = 'LIVE';
    this.livePill.textContent = 'Ranked reveal starting';
    this.positionRank.textContent = 'GET READY';
    this.positionPrize.textContent = `${this.sequence.length} winner${this.sequence.length===1?'':'s'} · #${this.sequence[0].rank} first, #1 last`;
    this.message.textContent = 'One full suspense sequence is reserved for every winner position.';
    this.declareBox.hidden = true;
    this.replay.hidden = true;
    this.prepareSlots();
    this.emit('reset',{winners:this.sequence,segmentMs:WINNER_SEGMENT_MS,totalMs:this.sequence.length*WINNER_SEGMENT_MS});

    if(this.reduced){ this.showFinal(this.sequence); return; }

    const start = replay ? Date.now() + 1200 : completedAt + DRAW_START_DELAY_MS;
    const now = Date.now();
    this.sequence.forEach((winner,index)=>{
      const segmentStart = start + index * WINNER_SEGMENT_MS;
      const segmentEnd = segmentStart + WINNER_SEGMENT_MS;
      if(now >= segmentEnd){
        this.markRevealed(winner,index,true);
      }else if(now >= segmentStart){
        this.startWinnerSegment(winner,index,segmentStart,now);
      }else{
        this.timeouts.push(window.setTimeout(()=>this.startWinnerSegment(winner,index,segmentStart,Date.now()), Math.max(0,segmentStart-now)));
      }
    });

    const finishAt = start + this.sequence.length * WINNER_SEGMENT_MS;
    if(now >= finishAt) this.finishSequence();
    else this.timeouts.push(window.setTimeout(()=>this.finishSequence(), Math.max(0,finishAt-now)));
  }

  startWinnerSegment(winner,index,segmentStart,now=Date.now()){
    if(this.destroyed || !this.playing) return;
    this.activeRank = winner.rank;
    this.stage.classList.add('is-drawing');
    this.stage.classList.remove('winner-declared');
    this.prepareSlots();
    this.declareBox.hidden = true;
    this.positionRank.textContent = `POSITION #${winner.rank}`;
    this.positionPrize.textContent = winner.prize > 0 ? `${Number(winner.prize).toLocaleString()} credits prize` : 'Ranked winner draw';
    this.setStatus('drawing',`Drawing #${winner.rank}`);
    this.countdown.textContent = `#${winner.rank}`;
    this.livePill.textContent = `Position #${winner.rank} · ${index+1}/${this.sequence.length}`;
    this.message.textContent = `Hold tight — position #${winner.rank} is being drawn now. Every ball will arrive one by one.`;
    this.emit('rankstart',{winner,index,total:this.sequence.length});

    const items = winner.white_numbers.slice(0,Number(this.event.white_ball_count||winner.white_numbers.length)).map((number,i)=>({key:String(i),number,bonus:false}));
    if(this.event.bonus_ball_enabled && winner.bonus_ball != null) items.push({key:'bonus',number:winner.bonus_ball,bonus:true});
    const firstAt = segmentStart + BALL_PRELUDE_MS;
    const lastStart = segmentStart + BALL_PRELUDE_MS + BALL_WINDOW_MS;
    const gap = items.length > 1 ? BALL_WINDOW_MS/(items.length-1) : 0;

    items.forEach((item,idx)=>{
      const at = items.length > 1 ? firstAt + idx*gap : firstAt + BALL_WINDOW_MS*.45;
      const doneAt = at + BALL_FLIGHT_MS;
      if(now >= doneAt){
        this.setFinalBall(item.key,item.number,item.bonus);
      }else if(now >= at){
        this.flyBall(item.key,item.number,item.bonus,Math.max(500,doneAt-now));
      }else if(at <= lastStart + 10){
        this.timeouts.push(window.setTimeout(()=>this.flyBall(item.key,item.number,item.bonus,BALL_FLIGHT_MS), Math.max(0,at-now)));
      }
    });

    const declareAt = segmentStart + WINNER_DECLARE_MS;
    if(now >= declareAt) this.declareWinner(winner,index);
    else this.timeouts.push(window.setTimeout(()=>this.declareWinner(winner,index), Math.max(0,declareAt-now)));
  }

  markRevealed(winner,index,silent=false){
    if(this.revealedRanks.has(winner.rank)) return;
    this.revealedRanks.add(winner.rank);
    this.emit('rankreveal',{winner,index,total:this.sequence.length,silent});
  }

  declareWinner(winner,index){
    if(this.destroyed || !this.playing || this.activeRank !== winner.rank) return;
    winner.white_numbers.slice(0,Number(this.event.white_ball_count||winner.white_numbers.length)).forEach((n,i)=>this.setFinalBall(String(i),n,false));
    if(this.event.bonus_ball_enabled && winner.bonus_ball != null) this.setFinalBall('bonus',winner.bonus_ball,true);
    this.stage.classList.add('winner-declared');
    this.declareBox.hidden = false;
    this.declareText.textContent = `POSITION #${winner.rank}`;
    this.setStatus('drawing',`#${winner.rank} confirmed`);
    this.livePill.textContent = `Winner #${winner.rank} confirmed`;
    this.message.textContent = winner.prize > 0
      ? `Position #${winner.rank} is locked — ${Number(winner.prize).toLocaleString()} credits. Next position begins automatically.`
      : `Position #${winner.rank} is locked. The next position begins automatically.`;
    this.markRevealed(winner,index,false);
  }

  showFinal(winners){
    this.cancelScheduled();
    this.sequence = winners.slice().sort((a,b)=>b.rank-a.rank);
    this.revealedRanks = new Set(this.sequence.map(w=>w.rank));
    this.playing = false;
    this.stage.classList.remove('is-drawing');
    this.stage.classList.add('winner-declared');
    const top = this.sequence.slice().sort((a,b)=>a.rank-b.rank)[0];
    this.prepareSlots();
    if(top){
      top.white_numbers.slice(0,Number(this.event.white_ball_count||top.white_numbers.length)).forEach((n,i)=>this.setFinalBall(String(i),n,false));
      if(this.event.bonus_ball_enabled && top.bonus_ball != null) this.setFinalBall('bonus',top.bonus_ball,true);
      this.positionRank.textContent = 'POSITION #1';
      this.positionPrize.textContent = top.prize > 0 ? `${Number(top.prize).toLocaleString()} credits · final winner` : 'Final winner';
      this.declareBox.hidden = false;
      this.declareText.textContent = 'POSITION #1';
    }
    this.setStatus('complete','Draw complete');
    this.countdown.textContent = 'FINAL';
    this.livePill.textContent = 'All positions revealed';
    this.message.textContent = 'The full ranked reveal is complete. Every displayed winner is now public.';
    this.replay.hidden = false;
    this.emit('reset',{winners:this.sequence,segmentMs:WINNER_SEGMENT_MS,totalMs:this.sequence.length*WINNER_SEGMENT_MS,historical:true});
    this.sequence.forEach((winner,index)=>this.emit('rankreveal',{winner,index,total:this.sequence.length,silent:true}));
    this.emit('complete',{winners:this.sequence});
  }

  replayDraw(){
    if(!this.event || this.event.status !== 'completed') return;
    const winners = winnersFromEvent(this.event);
    if(!winners.length) return;
    this.playRankedSequence(winners,Date.now(),{replay:true});
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
    const arc = bonus ? -70 : -92;
    const animation = ball.animate([
      { transform:'translate3d(0,0,0) rotate(0deg) scale(.72)', opacity:.18 },
      { transform:`translate3d(${dx*.22}px,${dy*.22+arc*.78}px,0) rotate(190deg) scale(1.08)`, opacity:1, offset:.28 },
      { transform:`translate3d(${dx*.58}px,${dy*.58+arc}px,0) rotate(520deg) scale(1.04)`, opacity:1, offset:.60 },
      { transform:`translate3d(${dx*.84}px,${dy*.84-26}px,0) rotate(820deg) scale(1)`, opacity:1, offset:.84 },
      { transform:`translate3d(${dx}px,${dy}px,0) rotate(1080deg) scale(1)`, opacity:1 }
    ],{ duration, easing:'cubic-bezier(.12,.72,.2,1)', fill:'forwards' });
    animation.onfinish=()=>{ ball.remove(); this.setFinalBall(key,number,bonus); };
    animation.oncancel=()=>ball.remove();
  }

  finishSequence(){
    if(this.destroyed || !this.sequence.length) return;
    this.sequence.forEach((winner,index)=>this.markRevealed(winner,index,true));
    const top = this.sequence.slice().sort((a,b)=>a.rank-b.rank)[0];
    this.playing = false;
    this.activeRank = null;
    this.stage.classList.remove('is-drawing');
    this.stage.classList.add('winner-declared');
    if(top){
      this.prepareSlots();
      top.white_numbers.slice(0,Number(this.event.white_ball_count||top.white_numbers.length)).forEach((n,i)=>this.setFinalBall(String(i),n,false));
      if(this.event.bonus_ball_enabled && top.bonus_ball != null) this.setFinalBall('bonus',top.bonus_ball,true);
      this.positionRank.textContent = 'POSITION #1';
      this.positionPrize.textContent = top.prize > 0 ? `${Number(top.prize).toLocaleString()} credits · final winner` : 'Final winner';
      this.declareBox.hidden = false;
      this.declareText.textContent = 'POSITION #1';
    }
    this.setStatus('complete','Draw complete');
    this.countdown.textContent = 'FINAL';
    this.livePill.textContent = 'All positions revealed';
    this.message.textContent = 'Ranked reveal complete — the full winner board is now unlocked.';
    this.replay.hidden = false;
    this.emit('complete',{winners:this.sequence});
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
