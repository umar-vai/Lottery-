(function(){
'use strict';
var initialized=new WeakSet();
var reduced=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
var TAU=Math.PI*2;

function clamp(n,min,max){return Math.max(min,Math.min(max,n))}

function createBallTexture(number,isRed){
  var c=document.createElement('canvas');
  c.width=512;c.height=256;
  var x=c.getContext('2d');
  var w=c.width,h=c.height;

  /* A very subtle repeating surface variation is baked into the material.
     Because this is part of the texture, the WHOLE surface now visibly rotates
     instead of the number looking like it is floating inside a static shell. */
  for(var i=0;i<w;i++){
    var wave=Math.sin((i/w)*TAU)*.55+Math.sin((i/w)*TAU*3)*.22;
    if(isRed){
      var rr=Math.round(226+wave*8),gg=Math.round(25+wave*3),bb=Math.round(53+wave*5);
      x.fillStyle='rgb('+rr+','+gg+','+bb+')';
    }else{
      var v=Math.round(238+wave*7);
      x.fillStyle='rgb('+v+','+(v+2)+','+(v+4)+')';
    }
    x.fillRect(i,0,1,h);
  }

  /* faint pearlescent material bands; these rotate with the ball texture */
  x.save();
  x.globalCompositeOperation='screen';
  x.globalAlpha=isRed?.055:.085;
  for(var b=0;b<4;b++){
    var bx=(b+.5)*w/4;
    var gr=x.createLinearGradient(bx-42,0,bx+42,0);
    gr.addColorStop(0,'rgba(255,255,255,0)');
    gr.addColorStop(.5,'rgba(255,255,255,.8)');
    gr.addColorStop(1,'rgba(255,255,255,0)');
    x.fillStyle=gr;x.fillRect(bx-42,0,84,h);
  }
  x.restore();

  function decal(cx){
    var r=54;
    /* printed badge sits ON the surface: no floating drop shadow */
    var dg=x.createRadialGradient(cx-r*.25,h*.5-r*.28,r*.04,cx,h*.5,r);
    dg.addColorStop(0,'#ffffff');
    dg.addColorStop(.56,'#fbfcfd');
    dg.addColorStop(1,'#e6ebef');
    x.fillStyle=dg;
    x.beginPath();x.arc(cx,h*.5,r,0,TAU);x.fill();
    x.lineWidth=5;
    x.strokeStyle=isRed?'rgba(255,255,255,.82)':'rgba(112,126,138,.42)';
    x.stroke();
    x.fillStyle='#071019';
    x.font='900 94px Inter, system-ui, -apple-system, Segoe UI, sans-serif';
    x.textAlign='center';x.textBaseline='middle';
    x.fillText(number,cx,h*.5+3);
  }

  /* same number on front and back of the physical sphere */
  decal(w*.25);
  decal(w*.75);
  return c;
}

function compile(gl,type,src){
  var s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);
  if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s)||'Shader compile failed');
  return s;
}
function makeProgram(gl,vsSrc,fsSrc){
  var p=gl.createProgram();
  gl.attachShader(p,compile(gl,gl.VERTEX_SHADER,vsSrc));
  gl.attachShader(p,compile(gl,gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(p);
  if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(p)||'Shader link failed');
  return p;
}
function makeTexture(gl,source){
  var t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,source);
  gl.generateMipmap(gl.TEXTURE_2D);
  return t;
}

function makeRenderer(canvas){
  if(!canvas||initialized.has(canvas))return;
  initialized.add(canvas);
  var brand=canvas.closest('.lootera-live-brand');
  var host=canvas.parentElement;
  var gl;
  try{gl=canvas.getContext('webgl',{alpha:true,antialias:true,premultipliedAlpha:true,preserveDrawingBuffer:false})||canvas.getContext('experimental-webgl',{alpha:true,antialias:true});}catch(e){}
  if(!gl)return; /* HTML fallback remains visible on browsers without WebGL */

  var vs='attribute vec2 a_pos;void main(){gl_Position=vec4(a_pos,0.0,1.0);}';
  var fs=[
    'precision highp float;',
    'uniform vec2 u_resolution;',
    'uniform vec3 u_ball1;',
    'uniform vec3 u_ball2;',
    'uniform float u_angle1;',
    'uniform float u_angle2;',
    'uniform sampler2D u_tex1;',
    'uniform sampler2D u_tex2;',
    'const float PI=3.141592653589793;',
    'vec4 sphere(vec2 frag,vec3 ball,float angle,float which){',
    '  vec2 p=(frag-ball.xy)/ball.z;',
    '  float r2=dot(p,p);',
    '  if(r2>=1.0)return vec4(0.0);',
    '  float z=sqrt(max(0.0,1.0-r2));',
    '  vec3 n=normalize(vec3(p.x,p.y,z));',
    '  float c=cos(angle),s=sin(angle);',
    '  vec3 local=vec3(c*n.x-s*n.z,n.y,s*n.x+c*n.z);',
    '  /* Reverse longitude lookup so the canvas decal is not horizontally mirrored on the visible sphere. */',
    '  float u=0.5-atan(local.z,local.x)/(2.0*PI);',
    '  float v=asin(clamp(local.y,-1.0,1.0))/PI+0.5;',
    '  vec2 uv=vec2(fract(u),v);',
    '  vec4 t1=texture2D(u_tex1,uv);',
    '  vec4 t2=texture2D(u_tex2,uv);',
    '  vec3 base=mix(t1.rgb,t2.rgb,which);',
    '  vec3 L=normalize(vec3(-0.46,0.67,0.86));',
    '  vec3 V=vec3(0.0,0.0,1.0);',
    '  vec3 H=normalize(L+V);',
    '  float diff=max(dot(n,L),0.0);',
    '  float spec=pow(max(dot(n,H),0.0),54.0);',
    '  float spec2=pow(max(dot(n,normalize(vec3(0.58,0.18,0.80))),0.0),24.0);',
    '  float fres=pow(1.0-max(n.z,0.0),2.5);',
    '  vec3 col=base*(0.49+0.56*diff);',
    '  col+=vec3(1.0)*spec*0.92;',
    '  col+=vec3(0.78,0.86,0.94)*spec2*0.22;',
    '  col+=mix(vec3(0.12,0.16,0.18),vec3(0.24,0.015,0.025),which)*fres;',
    '  /* clear glass coat: fixed in scene lighting, over a rotating physical surface */',
    '  float hot=pow(max(dot(n,normalize(vec3(-0.35,0.48,0.80))),0.0),95.0);',
    '  col+=vec3(1.0)*hot*1.10;',
    '  float edge=sqrt(r2);',
    '  float alpha=1.0-smoothstep(0.965,1.0,edge);',
    '  return vec4(col,alpha);',
    '}',
    'void main(){',
    '  vec2 frag=gl_FragCoord.xy;',
    '  vec4 a=sphere(frag,u_ball1,u_angle1,0.0);',
    '  vec4 b=sphere(frag,u_ball2,u_angle2,1.0);',
    '  vec4 outc=b+a*(1.0-b.a);',
    '  gl_FragColor=outc;',
    '}'
  ].join('\n');

  var program;
  try{program=makeProgram(gl,vs,fs);}catch(err){console.warn('Lootera live logo WebGL init failed',err);return;}
  gl.useProgram(program);
  var buf=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buf);
  gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
  var apos=gl.getAttribLocation(program,'a_pos');gl.enableVertexAttribArray(apos);gl.vertexAttribPointer(apos,2,gl.FLOAT,false,0,0);

  var tex1=makeTexture(gl,createBallTexture('6',false));
  var tex2=makeTexture(gl,createBallTexture('9',true));
  gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,tex1);
  gl.uniform1i(gl.getUniformLocation(program,'u_tex1'),0);
  gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,tex2);
  gl.uniform1i(gl.getUniformLocation(program,'u_tex2'),1);

  var uRes=gl.getUniformLocation(program,'u_resolution');
  var uB1=gl.getUniformLocation(program,'u_ball1');
  var uB2=gl.getUniformLocation(program,'u_ball2');
  var uA1=gl.getUniformLocation(program,'u_angle1');
  var uA2=gl.getUniformLocation(program,'u_angle2');

  gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0,0,0,0);

  var visible=true,hovered=false,raf=0,lastW=0,lastH=0,start=performance.now(),dead=false;
  function resize(){
    var rect=host.getBoundingClientRect();
    var cssW=Math.max(1,Math.round(rect.width)),cssH=Math.max(1,Math.round(rect.height));
    var dpr=clamp(window.devicePixelRatio||1,1,2.25);
    var w=Math.max(1,Math.round(cssW*dpr)),h=Math.max(1,Math.round(cssH*dpr));
    if(w===lastW&&h===lastH)return;
    lastW=w;lastH=h;canvas.width=w;canvas.height=h;canvas.style.width=cssW+'px';canvas.style.height=cssH+'px';
    gl.viewport(0,0,w,h);gl.uniform2f(uRes,w,h);
  }
  function render(now){
    resize();
    var w=lastW,h=lastH;
    var r=Math.min(h*.345,w*.218);
    var speed=hovered?1.30:1;
    var t=(now-start)/1000;
    var bob=reduced?0:Math.sin(t*1.45)*h*.008;
    var cy=h*.53;
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform3f(uB1,w*.285,cy-bob,r);
    gl.uniform3f(uB2,w*.715,cy+bob*.68,r);
    gl.uniform1f(uA1,reduced?0:t*.74*speed);
    gl.uniform1f(uA2,reduced?.48:-t*.66*speed+.48);
    gl.drawArrays(gl.TRIANGLES,0,6);
    if(brand&&!brand.classList.contains('lootera-logo-ready'))brand.classList.add('lootera-logo-ready');
  }
  function loop(now){if(dead)return;if(visible&&!document.hidden)render(now);raf=requestAnimationFrame(loop);}
  function onContextLost(event){
    event.preventDefault();
    dead=true;
    cancelAnimationFrame(raf);
    if(brand)brand.classList.remove('lootera-logo-ready');
  }
  function onContextRestored(){
    canvas.removeEventListener('webglcontextlost',onContextLost,false);
    canvas.removeEventListener('webglcontextrestored',onContextRestored,false);
    if(brand)brand.classList.remove('lootera-logo-ready');
    initialized.delete(canvas);
    window.setTimeout(function(){makeRenderer(canvas)},0);
  }
  canvas.addEventListener('webglcontextlost',onContextLost,false);
  canvas.addEventListener('webglcontextrestored',onContextRestored,false);
  if(brand){brand.addEventListener('pointerenter',function(){hovered=true});brand.addEventListener('pointerleave',function(){hovered=false});}
  if('IntersectionObserver' in window)new IntersectionObserver(function(e){visible=!!(e[0]&&e[0].isIntersecting)},{threshold:.01}).observe(canvas);
  if('ResizeObserver' in window)new ResizeObserver(function(){resize();if(reduced)render(performance.now())}).observe(host);
  else window.addEventListener('resize',function(){resize();if(reduced)render(performance.now())},{passive:true});
  if(reduced)render(performance.now());else raf=requestAnimationFrame(loop);
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
        if(n.nodeType===1){if(n.matches&&n.matches('.lootera-ball-canvas'))makeRenderer(n);else init(n);}
      }
    }).observe(document.documentElement,{childList:true,subtree:true});
  }
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
window.LooteraLiveLogo={init:init};
})();
