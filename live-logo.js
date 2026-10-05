(function(){
'use strict';
var initialized=new WeakSet();
var reduced=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function clamp(n,min,max){return Math.max(min,Math.min(max,n))}
function makeRenderer(canvas){
  if(!canvas||initialized.has(canvas))return;
  initialized.add(canvas);
  var ctx=canvas.getContext('2d',{alpha:true});
  if(!ctx)return;
  var brand=canvas.closest('.lootera-live-brand');
  var host=canvas.parentElement;
  var running=true,visible=true,hovered=false,raf=0,lastW=0,lastH=0,start=performance.now();

  function resize(){
    var rect=host.getBoundingClientRect();
    var w=Math.max(1,Math.round(rect.width));
    var h=Math.max(1,Math.round(rect.height));
    if(w===lastW&&h===lastH)return;
    lastW=w;lastH=h;
    var dpr=clamp(window.devicePixelRatio||1,1,2.25);
    canvas.width=Math.round(w*dpr);
    canvas.height=Math.round(h*dpr);
    canvas.style.width=w+'px';
    canvas.style.height=h+'px';
    ctx.setTransform(dpr,0,0,dpr,0,0);
  }

  function drawDecal(cx,cy,r,angle,number,isRed){
    var phases=[angle,angle+Math.PI];
    for(var i=0;i<phases.length;i++){
      var p=phases[i];
      var z=Math.cos(p);
      if(z<=.025)continue;
      var x=cx+Math.sin(p)*r*.50;
      var sx=Math.max(.075,z);
      var rr=r*.45;
      ctx.save();
      ctx.globalAlpha=clamp(.2+z*.9,0,1);
      ctx.translate(x,cy+r*.018);
      ctx.scale(sx,1);

      ctx.shadowColor='rgba(0,0,0,.23)';
      ctx.shadowBlur=Math.max(1,r*.12);
      ctx.shadowOffsetY=r*.04;
      ctx.fillStyle='rgba(252,253,255,.985)';
      ctx.strokeStyle=isRed?'rgba(255,255,255,.86)':'rgba(158,171,183,.46)';
      ctx.lineWidth=Math.max(.65,r*.052);
      ctx.beginPath();ctx.arc(0,0,rr,0,Math.PI*2);ctx.fill();ctx.stroke();
      ctx.shadowColor='transparent';

      var badge=ctx.createRadialGradient(-rr*.28,-rr*.32,rr*.05,0,0,rr);
      badge.addColorStop(0,'rgba(255,255,255,.48)');
      badge.addColorStop(.42,'rgba(255,255,255,.08)');
      badge.addColorStop(1,'rgba(0,0,0,.04)');
      ctx.fillStyle=badge;
      ctx.beginPath();ctx.arc(0,0,rr*.94,0,Math.PI*2);ctx.fill();

      ctx.fillStyle='#071019';
      ctx.font='900 '+Math.round(r*.98)+'px Inter, system-ui, sans-serif';
      ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.fillText(number,0,r*.025);
      ctx.restore();
    }
  }

  function drawBall(cx,cy,r,number,angle,isRed){
    ctx.save();

    /* contact shadow + colored light cast onto the surface */
    ctx.globalAlpha=.76;
    ctx.filter='blur('+Math.max(2.5,r*.30)+'px)';
    ctx.fillStyle=isRed?'rgba(255,38,66,.28)':'rgba(168,255,62,.22)';
    ctx.beginPath();ctx.ellipse(cx,cy+r*.82,r*.78,r*.15,0,0,Math.PI*2);ctx.fill();
    ctx.globalAlpha=.32;
    ctx.fillStyle='rgba(255,255,255,.26)';
    ctx.beginPath();ctx.ellipse(cx,cy+r*.87,r*.54,r*.055,0,0,Math.PI*2);ctx.fill();
    ctx.filter='none';ctx.globalAlpha=1;

    /* dense glossy sphere */
    var g=ctx.createRadialGradient(cx-r*.36,cy-r*.43,r*.025,cx+r*.05,cy+r*.06,r*1.06);
    if(isRed){
      g.addColorStop(0,'#fff0f2');
      g.addColorStop(.08,'#ffadb8');
      g.addColorStop(.23,'#ff667a');
      g.addColorStop(.48,'#ff2946');
      g.addColorStop(.72,'#c90825');
      g.addColorStop(.91,'#78000f');
      g.addColorStop(1,'#3e0007');
    }else{
      g.addColorStop(0,'#ffffff');
      g.addColorStop(.12,'#ffffff');
      g.addColorStop(.36,'#f5f8fa');
      g.addColorStop(.62,'#dde4ea');
      g.addColorStop(.82,'#b5c0ca');
      g.addColorStop(1,'#667480');
    }
    ctx.fillStyle=g;
    ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.fill();

    ctx.save();
    ctx.beginPath();ctx.arc(cx,cy,r-.22,0,Math.PI*2);ctx.clip();

    /* rotating number decals, one on each side */
    drawDecal(cx,cy,r,angle,number,isRed);

    /* glass coat */
    ctx.globalCompositeOperation='screen';
    var sweep=ctx.createLinearGradient(cx-r*.92,cy-r*.9,cx+r*.8,cy+r*.85);
    sweep.addColorStop(0,'rgba(255,255,255,.52)');
    sweep.addColorStop(.18,'rgba(255,255,255,.18)');
    sweep.addColorStop(.42,'rgba(255,255,255,.035)');
    sweep.addColorStop(.63,'rgba(255,255,255,0)');
    sweep.addColorStop(1,'rgba(255,255,255,.08)');
    ctx.fillStyle=sweep;ctx.fillRect(cx-r,cy-r,r*2,r*2);

    var topGloss=ctx.createRadialGradient(cx-r*.33,cy-r*.48,r*.015,cx-r*.23,cy-r*.36,r*.53);
    topGloss.addColorStop(0,'rgba(255,255,255,.98)');
    topGloss.addColorStop(.13,'rgba(255,255,255,.76)');
    topGloss.addColorStop(.38,'rgba(255,255,255,.22)');
    topGloss.addColorStop(1,'rgba(255,255,255,0)');
    ctx.fillStyle=topGloss;
    ctx.beginPath();ctx.ellipse(cx-r*.22,cy-r*.36,r*.43,r*.22,-.54,0,Math.PI*2);ctx.fill();

    /* sharper specular streak for a polished glass/metal feel */
    ctx.globalAlpha=.78;
    ctx.strokeStyle='rgba(255,255,255,.58)';
    ctx.lineWidth=Math.max(.45,r*.045);
    ctx.beginPath();
    ctx.arc(cx-r*.03,cy-r*.02,r*.73,Math.PI*1.08,Math.PI*1.55);
    ctx.stroke();
    ctx.globalAlpha=1;

    /* lower caustic/reflection band */
    var lower=ctx.createLinearGradient(cx,cy-r*.05,cx,cy+r);
    lower.addColorStop(0,'rgba(255,255,255,0)');
    lower.addColorStop(.55,'rgba(255,255,255,.02)');
    lower.addColorStop(.83,'rgba(255,255,255,.12)');
    lower.addColorStop(1,'rgba(255,255,255,.26)');
    ctx.fillStyle=lower;ctx.fillRect(cx-r,cy-r*.05,r*2,r*1.08);

    ctx.globalCompositeOperation='source-over';
    ctx.restore();

    /* outer glass rim + dark inner rim = stronger sphere edge */
    ctx.lineWidth=Math.max(.62,r*.055);
    ctx.strokeStyle=isRed?'rgba(255,225,230,.76)':'rgba(255,255,255,.90)';
    ctx.beginPath();ctx.arc(cx,cy,r-.20,0,Math.PI*2);ctx.stroke();
    ctx.lineWidth=Math.max(.45,r*.032);
    ctx.strokeStyle=isRed?'rgba(103,0,15,.45)':'rgba(72,88,101,.30)';
    ctx.beginPath();ctx.arc(cx,cy,r-.95,0,Math.PI*2);ctx.stroke();

    /* tiny reflected pin-light */
    ctx.fillStyle='rgba(255,255,255,.82)';
    ctx.beginPath();ctx.arc(cx-r*.48,cy-r*.48,Math.max(.55,r*.055),0,Math.PI*2);ctx.fill();

    ctx.restore();
  }

  function render(now){
    resize();
    var w=lastW,h=lastH;
    ctx.clearRect(0,0,w,h);
    var r=Math.min(h*.345,w*.218);
    var cy=h*.47;
    var speed=hovered?1.38:1;
    var t=(now-start)/1000;
    var bob=reduced?0:Math.sin(t*1.55)*h*.010;
    var cx1=w*.285,cx2=w*.715;
    var a1=reduced?0:t*.82*speed;
    var a2=reduced?.50:-t*.72*speed+.50;
    drawBall(cx1,cy+bob,r,'6',a1,false);
    drawBall(cx2,cy-bob*.68,r,'9',a2,true);
    if(brand&&!brand.classList.contains('lootera-logo-ready'))brand.classList.add('lootera-logo-ready');
  }

  function loop(now){
    if(!running)return;
    if(visible&&!document.hidden)render(now);
    raf=requestAnimationFrame(loop);
  }

  function startLoop(){
    if(reduced){render(performance.now());return}
    if(!raf)raf=requestAnimationFrame(loop);
  }
  if(brand){
    brand.addEventListener('pointerenter',function(){hovered=true});
    brand.addEventListener('pointerleave',function(){hovered=false});
  }
  if('IntersectionObserver' in window){
    var io=new IntersectionObserver(function(entries){visible=!!(entries[0]&&entries[0].isIntersecting)},{threshold:.01});
    io.observe(canvas);
  }
  if('ResizeObserver' in window){new ResizeObserver(function(){resize();if(reduced)render(performance.now())}).observe(host)}
  else window.addEventListener('resize',function(){resize();if(reduced)render(performance.now())},{passive:true});
  document.addEventListener('visibilitychange',function(){if(!document.hidden&&reduced)render(performance.now())});
  startLoop();
}

function init(root){
  var scope=root&&root.querySelectorAll?root:document;
  var nodes=scope.querySelectorAll('.lootera-ball-canvas');
  for(var i=0;i<nodes.length;i++)makeRenderer(nodes[i]);
}
function boot(){
  init(document);
  if('MutationObserver' in window){
    new MutationObserver(function(muts){
      for(var i=0;i<muts.length;i++)for(var j=0;j<muts[i].addedNodes.length;j++){
        var n=muts[i].addedNodes[j];
        if(n.nodeType===1){if(n.matches&&n.matches('.lootera-ball-canvas'))makeRenderer(n);else init(n)}
      }
    }).observe(document.documentElement,{childList:true,subtree:true});
  }
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
window.LooteraLiveLogo={init:init};
})();
