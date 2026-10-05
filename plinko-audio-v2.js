(function(){
'use strict';
var state={enabled:true,ctx:null,master:null,comp:null,noise:null,lastResult:''};
function $(s){return document.querySelector(s)}
function getCtx(){
  if(!state.enabled)return null;
  try{
    if(!state.ctx){
      var C=window.AudioContext||window.webkitAudioContext;
      if(!C)return null;
      var ctx=new C();
      var comp=ctx.createDynamicsCompressor();
      comp.threshold.value=-10;comp.knee.value=16;comp.ratio.value=7;comp.attack.value=.003;comp.release.value=.16;
      var master=ctx.createGain();master.gain.value=.72;
      master.connect(comp);comp.connect(ctx.destination);
      state.ctx=ctx;state.comp=comp;state.master=master;
      var len=Math.max(1,Math.floor(ctx.sampleRate*.18));
      var buf=ctx.createBuffer(1,len,ctx.sampleRate),d=buf.getChannelData(0);
      for(var i=0;i<len;i++)d[i]=(Math.random()*2-1)*(1-i/len);
      state.noise=buf;
    }
    if(state.ctx.state==='suspended')state.ctx.resume();
    return state.ctx;
  }catch(e){return null}
}
function panNode(ctx,pan){
  if(ctx.createStereoPanner){var p=ctx.createStereoPanner();p.pan.value=Math.max(-.85,Math.min(.85,pan||0));return p}
  return ctx.createGain();
}
function physicalPegHit(pan,row){
  var ctx=getCtx();if(!ctx)return;
  var t=ctx.currentTime,variation=(Math.random()-.5);
  var p=panNode(ctx,pan),sum=ctx.createGain();sum.gain.value=1;sum.connect(p);p.connect(state.master);

  // Short broadband contact click: gives the impression of hard ball-on-peg contact.
  var n=ctx.createBufferSource();n.buffer=state.noise;
  var bp=ctx.createBiquadFilter();bp.type='bandpass';bp.frequency.value=1900+(row||0)*35+variation*320;bp.Q.value=1.25;
  var ng=ctx.createGain();ng.gain.setValueAtTime(.0001,t);ng.gain.exponentialRampToValueAtTime(.24,t+.002);ng.gain.exponentialRampToValueAtTime(.0001,t+.055);
  n.connect(bp);bp.connect(ng);ng.connect(sum);n.start(t);n.stop(t+.07);

  // Body resonance: very short pitch drop like a dense acrylic/metal peg.
  var o=ctx.createOscillator(),og=ctx.createGain();o.type='sine';
  var base=520+(row||0)*8+variation*55;o.frequency.setValueAtTime(base,t);o.frequency.exponentialRampToValueAtTime(Math.max(180,base*.58),t+.045);
  og.gain.setValueAtTime(.0001,t);og.gain.exponentialRampToValueAtTime(.16,t+.003);og.gain.exponentialRampToValueAtTime(.0001,t+.07);
  o.connect(og);og.connect(sum);o.start(t);o.stop(t+.08);

  // Tiny high transient makes impacts audible on phone speakers.
  var hi=ctx.createOscillator(),hg=ctx.createGain();hi.type='triangle';hi.frequency.value=2600+Math.random()*600;
  hg.gain.setValueAtTime(.05,t);hg.gain.exponentialRampToValueAtTime(.0001,t+.022);hi.connect(hg);hg.connect(sum);hi.start(t);hi.stop(t+.028);
}
function landingThump(pan){
  var ctx=getCtx();if(!ctx)return;var t=ctx.currentTime,p=panNode(ctx,pan);p.connect(state.master);
  var o=ctx.createOscillator(),g=ctx.createGain();o.type='sine';o.frequency.setValueAtTime(155,t);o.frequency.exponentialRampToValueAtTime(70,t+.12);
  g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(.28,t+.004);g.gain.exponentialRampToValueAtTime(.0001,t+.15);o.connect(g);g.connect(p);o.start(t);o.stop(t+.17);
  var n=ctx.createBufferSource(),lp=ctx.createBiquadFilter(),ng=ctx.createGain();n.buffer=state.noise;lp.type='lowpass';lp.frequency.value=1200;ng.gain.setValueAtTime(.16,t);ng.gain.exponentialRampToValueAtTime(.0001,t+.07);n.connect(lp);lp.connect(ng);ng.connect(p);n.start(t);n.stop(t+.08);
}
function tone(freq,start,dur,gain,type){
  var ctx=getCtx();if(!ctx)return;var o=ctx.createOscillator(),g=ctx.createGain();o.type=type||'sine';o.frequency.setValueAtTime(freq,start);g.gain.setValueAtTime(.0001,start);g.gain.exponentialRampToValueAtTime(gain,start+.008);g.gain.exponentialRampToValueAtTime(.0001,start+dur);o.connect(g);g.connect(state.master);o.start(start);o.stop(start+dur+.03)
}
function cheer(big){
  var ctx=getCtx();if(!ctx)return;var t=ctx.currentTime;
  // Upward major chord/riser.
  var notes=big?[392,523.25,659.25,783.99,1046.5]:[392,493.88,587.33,783.99];
  notes.forEach(function(f,i){tone(f,t+i*.075,big?.62:.42,big?.105:.085,i%2?'triangle':'sine')});

  // Crowd-like bright noise swell. It is synthetic but non-verbal and feels like a short cheer.
  var n=ctx.createBufferSource();n.buffer=state.noise;var hp=ctx.createBiquadFilter();hp.type='highpass';hp.frequency.value=650;
  var ng=ctx.createGain();ng.gain.setValueAtTime(.0001,t);ng.gain.exponentialRampToValueAtTime(big?.34:.24,t+.08);ng.gain.setValueAtTime(big?.28:.19,t+(big?.48:.28));ng.gain.exponentialRampToValueAtTime(.0001,t+(big?.95:.62));
  n.connect(hp);hp.connect(ng);ng.connect(state.master);n.start(t);n.stop(t+(big?1:.68));

  // Two punch accents make the celebration feel tied to the visual burst.
  [0,.15].forEach(function(d){var o=ctx.createOscillator(),g=ctx.createGain();o.type='sine';o.frequency.setValueAtTime(big?120:145,t+d);o.frequency.exponentialRampToValueAtTime(62,t+d+.11);g.gain.setValueAtTime(.0001,t+d);g.gain.exponentialRampToValueAtTime(big?.24:.18,t+d+.004);g.gain.exponentialRampToValueAtTime(.0001,t+d+.14);o.connect(g);g.connect(state.master);o.start(t+d);o.stop(t+d+.16)});
}
function elementPan(el){
  try{var r=el.getBoundingClientRect(),b=$('#plinkoBoard').getBoundingClientRect();return ((r.left+r.width/2)-(b.left+b.width/2))/(b.width/2)}catch(e){return 0}
}
function rowFromPeg(el){var m=(el.id||'').match(/^peg-(\d+)-/);return m?Number(m[1]):0}
function observeBoard(){
  var board=$('#plinkoBoard');if(!board)return;
  new MutationObserver(function(ms){ms.forEach(function(m){var el=m.target;if(!(el instanceof Element))return;if(el.classList.contains('peg')&&el.classList.contains('hit'))physicalPegHit(elementPan(el),rowFromPeg(el));if(el.classList.contains('plinko-bucket')&&el.classList.contains('hot'))landingThump(elementPan(el))})}).observe(board,{subtree:true,attributes:true,attributeFilter:['class']});
}
function observeResult(){
  var box=$('#dropResult');if(!box)return;
  function check(){var key=box.className+'|'+box.textContent;if(key===state.lastResult)return;state.lastResult=key;if(box.classList.contains('jackpot'))cheer(true);else if(box.classList.contains('win'))cheer(false)}
  new MutationObserver(check).observe(box,{subtree:true,childList:true,attributes:true,characterData:true,attributeFilter:['class']});
}
function bindToggle(){
  var b=$('#soundToggle');if(!b)return;
  state.enabled=b.getAttribute('aria-pressed')!=='false';
  b.addEventListener('click',function(){setTimeout(function(){state.enabled=b.getAttribute('aria-pressed')!=='false';if(state.enabled){var ctx=getCtx();if(ctx)tone(520,ctx.currentTime,.09,.09,'triangle')}},0)});
}
function unlock(){var ctx=getCtx();if(ctx&&ctx.state==='suspended')ctx.resume()}
function init(){bindToggle();observeBoard();observeResult();document.addEventListener('pointerdown',unlock,{once:true,capture:true});document.addEventListener('touchstart',unlock,{once:true,capture:true})}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
