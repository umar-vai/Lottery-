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
    var dpr=clamp(window.devicePixelRatio||1,1,2);
    canvas.width=Math.round(w*dpr);
    canvas.height=Math.round(h*dpr);
    canvas.style.width=w+'px';
    canvas.style.height=h+'px';
    ctx.setTransform(dpr,0,0,dpr,0,0);
  }

  function roundRect(x,y,w,h,r){
    r=Math.min(r,w/2,h/2);
    ctx.beginPath();
    ctx.moveTo(x+r,y);
    ctx.arcTo(x+w,y,x+w,y+h,r);
    ctx.arcTo(x+w,y+h,x,y+h,r);
    ctx.arcTo(x,y+h,x,y,r);
    ctx.arcTo(x,y,x+w,y,r);
    ctx.closePath();
  }

  function drawDecal(cx,cy,r,angle,number,isRed){
    var phases=[angle,angle+Math.PI];
    for(var i=0;i<phases.length;i++){
      var p=phases[i];
      var z=Math.cos(p);
      if(z<=.035)continue;
      var x=cx+Math.sin(p)*r*.48;
      var sx=Math.max(.09,z);
      var rr=r*.47;
      ctx.save();
      ctx.translate(x,cy+r*.015);
      ctx.scale(sx,1);
      ctx.fillStyle=isRed?'rgba(250,252,255,.98)':'rgba(250,252,255,.86)';
      ctx.strokeStyle=isRed?'rgba(255,255,255,.74)':'rgba(135,148,160,.36)';
      ctx.lineWidth=Math.max(.65,r*.045);
      ctx.beginPath();ctx.arc(0,0,rr,0,Math.PI*2);ctx.fill();ctx.stroke();
      ctx.fillStyle='#0a1017';
      ctx.font='900 '+Math.round(r*1.02)+'px Inter, system-ui, sans-serif';
      ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.fillText(number,0,r*.035);
      ctx.restore();
    }
  }

  function drawBall(cx,cy,r,number,angle,isRed){
    ctx.save();
    ctx.globalAlpha=.72;
    ctx.fillStyle=isRed?'rgba(255,59,78,.20)':'rgba(168,255,62,.16)';
    ctx.filter='blur('+Math.max(2,r*.28)+'px)';
    ctx.beginPath();ctx.ellipse(cx,cy+r*.76,r*.76,r*.17,0,0,Math.PI*2);ctx.fill();
    ctx.filter='none';ctx.globalAlpha=1;

    var g=ctx.createRadialGradient(cx-r*.34,cy-r*.42,r*.04,cx,cy,r*1.05);
    if(isRed){
      g.addColorStop(0,'#ffabb4');
      g.addColorStop(.16,'#ff6a7b');
      g.addColorStop(.48,'#ff3149');
      g.addColorStop(.78,'#d50825');
      g.addColorStop(1,'#7c0010');
    }else{
      g.addColorStop(0,'#ffffff');
      g.addColorStop(.24,'#fbfcfd');
      g.addColorStop(.56,'#edf1f4');
      g.addColorStop(.83,'#c9d1d8');
      g.addColorStop(1,'#8b98a3');
    }
    ctx.fillStyle=g;
    ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.fill();
    ctx.save();ctx.beginPath();ctx.arc(cx,cy,r-.35,0,Math.PI*2);ctx.clip();
    drawDecal(cx,cy,r,angle,number,isRed);
    var shine=ctx.createLinearGradient(cx-r,cy-r,cx+r,cy+r);
    shine.addColorStop(0,'rgba(255,255,255,.42)');
    shine.addColorStop(.25,'rgba(255,255,255,.08)');
    shine.addColorStop(.62,'rgba(255,255,255,0)');
    shine.addColorStop(1,'rgba(0,0,0,.16)');
    ctx.fillStyle=shine;ctx.fillRect(cx-r,cy-r,r*2,r*2);
    ctx.fillStyle='rgba(255,255,255,.43)';
    ctx.beginPath();ctx.ellipse(cx-r*.31,cy-r*.42,r*.28,r*.14,-.55,0,Math.PI*2);ctx.fill();
    ctx.restore();
    ctx.lineWidth=Math.max(.55,r*.045);
    ctx.strokeStyle=isRed?'rgba(255,210,215,.52)':'rgba(255,255,255,.78)';
    ctx.beginPath();ctx.arc(cx,cy,r-.25,0,Math.PI*2);ctx.stroke();
    ctx.restore();
  }

  function render(now){
    resize();
    var w=lastW,h=lastH;
    ctx.clearRect(0,0,w,h);
    var r=Math.min(h*.39,w*.235);
    var cy=h*.48;
    var speed=hovered?1.55:1;
    var t=(now-start)/1000;
    var bob=reduced?0:Math.sin(t*1.7)*h*.018;
    var cx1=w*.29,cx2=w*.70;
    var a1=reduced?0:t*1.05*speed;
    var a2=reduced?.52:-t*.90*speed+.52;
    drawBall(cx1,cy+bob,r,'6',a1,false);
    drawBall(cx2,cy-bob*.72,r,'9',a2,true);
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
