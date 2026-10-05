(function(){
'use strict';
if(window.__plinkoPhysicsInstalled)return;
window.__plinkoPhysicsInstalled=true;

var nativeAnimate=Element.prototype.animate;
var boardReady=false;
var rippleId=0;

function num(v,fallback){
  var n=parseFloat(String(v==null?'':v).replace('%',''));
  return isFinite(n)?n:(fallback||0);
}
function pct(v){return (Math.round(v*1000)/1000)+'%'}
function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
function lerp(a,b,t){return a+(b-a)*t}
function easeGravity(t){return Math.pow(t,1.52)}
function direction(dx){return dx===0?(Math.random()<.5?-1:1):(dx>0?1:-1)}

Element.prototype.animate=function(keyframes,options){
  try{
    if(this&&this.id==='plinkoBall'&&Array.isArray(keyframes)&&keyframes.length>=2){
      var first=keyframes[0]||{},last=keyframes[keyframes.length-1]||{};
      if(first.left!=null&&first.top!=null&&last.left!=null&&last.top!=null){
        var x0=num(first.left,50),y0=num(first.top,5),x1=num(last.left,x0),y1=num(last.top,y0);
        var dx=x1-x0,dy=y1-y0,dir=direction(dx),bucket=y1>=85;
        var arc=bucket?clamp(Math.abs(dx)*.06+.35,.35,1.15):clamp(Math.abs(dx)*.11+.5,.5,1.45);
        var spin=dir*(bucket?65:34);
        var times=bucket?[0,.16,.34,.55,.74,.9,1]:[0,.14,.3,.5,.7,.86,1];
        var frames=times.map(function(t,i){
          var gy=easeGravity(t);
          var side=Math.sin(Math.PI*t)*arc*dir;
          var x=lerp(x0,x1,t)+side;
          var y=lerp(y0,y1,gy);
          var sx=1,sy=1;
          if(i===5){sx=1.09;sy=.91}
          if(i===6){sx=.98;sy=1.02}
          return {offset:t,left:pct(x),top:pct(y),transform:'rotate('+Math.round(spin*t)+'deg) scaleX('+sx+') scaleY('+sy+')'};
        });
        var opt=Object.assign({},options||{});
        var depth=clamp((y1-10)/75,0,1);
        opt.duration=bucket?265:Math.round(174-(depth*48));
        opt.easing='linear';
        return nativeAnimate.call(this,frames,opt);
      }
    }
  }catch(e){}
  return nativeAnimate.call(this,keyframes,options);
};

function makeRipple(peg){
  var board=document.getElementById('plinkoBoard');
  if(!board||!peg)return;
  var br=board.getBoundingClientRect(),pr=peg.getBoundingClientRect();
  var r=document.createElement('i');
  r.className='plinko-impact-ripple';
  r.dataset.ripple=String(++rippleId);
  r.style.left=(pr.left-br.left+pr.width/2)+'px';
  r.style.top=(pr.top-br.top+pr.height/2)+'px';
  board.appendChild(r);
  nativeAnimate.call(r,[
    {transform:'translate(-50%,-50%) scale(.2)',opacity:.62},
    {transform:'translate(-50%,-50%) scale(1.65)',opacity:0}
  ],{duration:230,easing:'cubic-bezier(.2,.7,.2,1)',fill:'forwards'}).finished.finally(function(){r.remove()});
}

function kickPeg(peg){
  if(!peg)return;
  var parts=(peg.id||'').split('-');
  var col=Number(parts[2]||0),dir=(col%2?1:-1);
  nativeAnimate.call(peg,[
    {transform:'translate(0,0) scale(1)'},
    {transform:'translate('+(dir*1.4)+'px,1px) scale(.88)',offset:.25},
    {transform:'translate('+(dir*-1.1)+'px,-.6px) scale(1.26)',offset:.52},
    {transform:'translate(0,0) scale(1)',offset:1}
  ],{duration:180,easing:'cubic-bezier(.25,.75,.25,1)'});
  makeRipple(peg);
}

function settleBucket(bucket){
  if(!bucket)return;
  var idx=Number(bucket.dataset.index||0),tilt=(idx<6?-1:idx>6?1:0)*2.1;
  nativeAnimate.call(bucket,[
    {transform:'translateY(0) rotate(0deg) scaleY(1)'},
    {transform:'translateY(7px) rotate('+tilt+'deg) scaleY(.82)',offset:.23},
    {transform:'translateY(-3px) rotate('+(tilt*-.45)+'deg) scaleY(1.07)',offset:.52},
    {transform:'translateY(1px) rotate('+(tilt*.18)+'deg) scaleY(.98)',offset:.75},
    {transform:'translateY(-4px) rotate(0deg) scaleY(1)',offset:1}
  ],{duration:520,easing:'cubic-bezier(.2,.8,.2,1)',fill:'both'});

  var siblings=Array.prototype.slice.call(bucket.parentElement.children),pos=siblings.indexOf(bucket);
  [-1,1].forEach(function(d){var n=siblings[pos+d];if(!n)return;nativeAnimate.call(n,[{transform:'translateY(0)'},{transform:'translateY(3px)',offset:.3},{transform:'translateY(0)',offset:1}],{duration:360,easing:'ease-out'})});

  var ball=document.getElementById('plinkoBall');
  if(ball){
    nativeAnimate.call(ball,[
      {transform:'translateY(0) scale(1)'},
      {transform:'translateY(8px) scaleX(1.14) scaleY(.82)',offset:.3},
      {transform:'translateY(1px) scaleX(.94) scaleY(1.06)',offset:.58},
      {transform:'translateY(4px) scale(1)',offset:1}
    ],{duration:410,easing:'cubic-bezier(.2,.8,.25,1)',fill:'forwards'});
  }
}

function observeBoard(){
  if(boardReady)return;
  var board=document.getElementById('plinkoBoard');
  if(!board)return;
  boardReady=true;
  board.classList.add('physics-live');

  var observer=new MutationObserver(function(records){
    records.forEach(function(rec){
      if(rec.type!=='attributes'||rec.attributeName!=='class')return;
      var el=rec.target;
      if(el.classList&&el.classList.contains('peg')&&el.classList.contains('hit'))kickPeg(el);
      if(el.classList&&el.classList.contains('plinko-bucket')&&el.classList.contains('hot'))settleBucket(el);
    });
  });
  observer.observe(board,{subtree:true,attributes:true,attributeFilter:['class']});
}

function boot(){observeBoard();if(!boardReady)setTimeout(boot,80)}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
