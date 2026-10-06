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



const GM_TAU=Math.PI*2;
const GM_RENDER_BATCH=12;

function gmCompile(gl,type,src){
  const sh=gl.createShader(type);
  gl.shaderSource(sh,src);
  gl.compileShader(sh);
  if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh)||'shader compile failed');
  return sh;
}
function gmProgram(gl,vsSrc,fsSrc){
  const p=gl.createProgram();
  gl.attachShader(p,gmCompile(gl,gl.VERTEX_SHADER,vsSrc));
  gl.attachShader(p,gmCompile(gl,gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(p);
  if(!gl.getProgramParameter(p,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)||'program link failed');
  return p;
}
function gmCreateAtlas(maxNumber,isRed){
  const cellW=256,cellH=128,cols=8,rows=Math.max(1,Math.ceil(maxNumber/cols));
  const c=document.createElement('canvas');
  c.width=cellW*cols;c.height=cellH*rows;
  const x=c.getContext('2d');
  for(let number=1;number<=maxNumber;number++){
    const idx=number-1,col=idx%cols,row=Math.floor(idx/cols);
    const ox=col*cellW,oy=row*cellH;
    for(let px=0;px<cellW;px++){
      const wave=Math.sin((px/cellW)*GM_TAU)*.55+Math.sin((px/cellW)*GM_TAU*3)*.22;
      if(isRed){
        const rr=Math.round(226+wave*8),gg=Math.round(25+wave*3),bb=Math.round(53+wave*5);
        x.fillStyle='rgb('+rr+','+gg+','+bb+')';
      }else{
        const v=Math.round(238+wave*7);
        x.fillStyle='rgb('+v+','+(v+2)+','+(v+4)+')';
      }
      x.fillRect(ox+px,oy,1,cellH);
    }
    x.save();
    x.globalCompositeOperation='screen';
    x.globalAlpha=isRed?.055:.085;
    for(let b=0;b<4;b++){
      const bx=ox+(b+.5)*cellW/4;
      const gr=x.createLinearGradient(bx-21,0,bx+21,0);
      gr.addColorStop(0,'rgba(255,255,255,0)');
      gr.addColorStop(.5,'rgba(255,255,255,.8)');
      gr.addColorStop(1,'rgba(255,255,255,0)');
      x.fillStyle=gr;x.fillRect(bx-21,oy,42,cellH);
    }
    x.restore();
    const drawDecal=(cx)=>{
      const r=27,cy=oy+cellH*.5;
      const dg=x.createRadialGradient(cx-r*.25,cy-r*.28,r*.04,cx,cy,r);
      dg.addColorStop(0,'#ffffff');
      dg.addColorStop(.56,'#fbfcfd');
      dg.addColorStop(1,'#e6ebef');
      x.fillStyle=dg;
      x.beginPath();x.arc(cx,cy,r,0,GM_TAU);x.fill();
      x.lineWidth=2.5;
      x.strokeStyle=isRed?'rgba(255,255,255,.82)':'rgba(112,126,138,.42)';
      x.stroke();
      x.fillStyle='#071019';
      x.font='900 47px Inter, system-ui, -apple-system, Segoe UI, sans-serif';
      x.textAlign='center';x.textBaseline='middle';
      x.fillText(String(number),cx,cy+1.5);
    };
    drawDecal(ox+cellW*.25);
    drawDecal(ox+cellW*.75);
  }
  return {canvas:c,cols,rows};
}

class ChamberBallRenderer{
  constructor(chamber,{bonus=false}={}){
    this.chamber=chamber;this.bonus=bonus;this.ready=false;this.maxNumber=0;
    this.canvas=document.createElement('canvas');
    this.canvas.className='gm-ball-webgl';
    this.canvas.setAttribute('aria-hidden','true');
    chamber.appendChild(this.canvas);
    try{
      this.gl=this.canvas.getContext('webgl',{alpha:true,antialias:true,premultipliedAlpha:true,preserveDrawingBuffer:false})||
        this.canvas.getContext('experimental-webgl',{alpha:true,antialias:true});
      if(!this.gl)return;
      this.init();
      this.ready=true;
      chamber.classList.add('gm-webgl-ready');
    }catch(err){
      console.warn('Draw chamber WebGL renderer unavailable; CSS fallback active.',err);
    }
  }
  init(){
    const gl=this.gl;
    const vs='attribute vec2 a_pos;void main(){gl_Position=vec4(a_pos,0.0,1.0);}';
    const fs=[
      'precision highp float;',
      'uniform vec4 u_ball['+GM_RENDER_BATCH+'];',
      'uniform float u_num['+GM_RENDER_BATCH+'];',
      'uniform float u_count;',
      'uniform sampler2D u_atlas;',
      'uniform vec2 u_grid;',
      'uniform float u_red;',
      'const float PI=3.141592653589793;',
      'vec4 sphere(vec2 frag,vec4 ball,float num){',
      '  vec2 p=(frag-ball.xy)/ball.z;',
      '  float r2=dot(p,p);',
      '  if(r2>=1.0)return vec4(0.0);',
      '  float z=sqrt(max(0.0,1.0-r2));',
      '  vec3 n=normalize(vec3(p.x,p.y,z));',
      '  float c=cos(ball.w),ss=sin(ball.w);',
      '  vec3 local=vec3(c*n.x-ss*n.z,n.y,ss*n.x+c*n.z);',
      '  float u=0.5-atan(local.z,local.x)/(2.0*PI);',
      '  float v=asin(clamp(local.y,-1.0,1.0))/PI+0.5;',
      '  float idx=max(0.0,num-1.0);',
      '  float col=mod(idx,u_grid.x);',
      '  float row=floor(idx/u_grid.x);',
      '  vec2 uv=(vec2(fract(u),v)+vec2(col,row))/u_grid;',
      '  vec3 base=texture2D(u_atlas,uv).rgb;',
      '  vec3 L=normalize(vec3(-0.46,0.67,0.86));',
      '  vec3 V=vec3(0.0,0.0,1.0);',
      '  vec3 H=normalize(L+V);',
      '  float diff=max(dot(n,L),0.0);',
      '  float spec=pow(max(dot(n,H),0.0),54.0);',
      '  float spec2=pow(max(dot(n,normalize(vec3(0.58,0.18,0.80))),0.0),24.0);',
      '  float fres=pow(1.0-max(n.z,0.0),2.5);',
      '  vec3 colr=base*(0.49+0.56*diff);',
      '  colr+=vec3(1.0)*spec*0.92;',
      '  colr+=vec3(0.78,0.86,0.94)*spec2*0.22;',
      '  colr+=mix(vec3(0.12,0.16,0.18),vec3(0.24,0.015,0.025),u_red)*fres;',
      '  float hot=pow(max(dot(n,normalize(vec3(-0.35,0.48,0.80))),0.0),95.0);',
      '  colr+=vec3(1.0)*hot*1.10;',
      '  float edge=sqrt(r2);',
      '  float alpha=1.0-smoothstep(0.965,1.0,edge);',
      '  return vec4(colr,alpha);',
      '}',
      'void main(){',
      '  vec4 outc=vec4(0.0);',
      '  vec2 frag=gl_FragCoord.xy;',
      '  for(int i=0;i<'+GM_RENDER_BATCH+';i++){',
      '    if(float(i)<u_count){',
      '      vec4 s=sphere(frag,u_ball[i],u_num[i]);',
      '      outc=s+outc*(1.0-s.a);',
      '    }',
      '  }',
      '  gl_FragColor=outc;',
      '}'
    ].join('\n');
    this.program=gmProgram(gl,vs,fs);gl.useProgram(this.program);
    const buf=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buf);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
    const a=gl.getAttribLocation(this.program,'a_pos');gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,2,gl.FLOAT,false,0,0);
    this.uBall=gl.getUniformLocation(this.program,'u_ball[0]');
    this.uNum=gl.getUniformLocation(this.program,'u_num[0]');
    this.uCount=gl.getUniformLocation(this.program,'u_count');
    this.uGrid=gl.getUniformLocation(this.program,'u_grid');
    this.uRed=gl.getUniformLocation(this.program,'u_red');
    this.uAtlas=gl.getUniformLocation(this.program,'u_atlas');
    gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.clearColor(0,0,0,0);
  }
  ensureAtlas(maxNumber){
    if(!this.ready||maxNumber<=this.maxNumber)return;
    const gl=this.gl;
    this.maxNumber=maxNumber;
    const atlas=gmCreateAtlas(maxNumber,this.bonus);
    this.grid=[atlas.cols,atlas.rows];
    if(this.texture)gl.deleteTexture(this.texture);
    this.texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,this.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,atlas.canvas);
  }
  resize(){
    const rect=this.chamber.getBoundingClientRect();
    const dpr=Math.min(2,Math.max(1,window.devicePixelRatio||1));
    const w=Math.max(1,Math.round(rect.width*dpr)),h=Math.max(1,Math.round(rect.height*dpr));
    if(this.canvas.width!==w||this.canvas.height!==h){
      this.canvas.width=w;this.canvas.height=h;
      this.canvas.style.width=rect.width+'px';this.canvas.style.height=rect.height+'px';
      this.gl.viewport(0,0,w,h);
    }
    return {w,h,dpr,cssW:rect.width,cssH:rect.height};
  }
  render(balls,radius){
    if(!this.ready||!balls.length)return;
    this.ensureAtlas(Math.max(...balls.map(b=>b.number||1)));
    const gl=this.gl,dim=this.resize();
    gl.useProgram(this.program);gl.clear(gl.COLOR_BUFFER_BIT);
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.uniform1i(this.uAtlas,0);
    gl.uniform2f(this.uGrid,this.grid[0],this.grid[1]);gl.uniform1f(this.uRed,this.bonus?1:0);
    for(let start=0;start<balls.length;start+=GM_RENDER_BATCH){
      const chunk=balls.slice(start,start+GM_RENDER_BATCH);
      const packed=new Float32Array(GM_RENDER_BATCH*4),nums=new Float32Array(GM_RENDER_BATCH);
      chunk.forEach((b,i)=>{
        packed[i*4]=(dim.cssW*.5+b.x)*dim.dpr;
        packed[i*4+1]=(dim.cssH*.5-b.y)*dim.dpr;
        packed[i*4+2]=radius*dim.dpr;
        packed[i*4+3]=b.angle;
        nums[i]=b.number||1;
      });
      gl.uniform4fv(this.uBall,packed);gl.uniform1fv(this.uNum,nums);gl.uniform1f(this.uCount,chunk.length);
      gl.drawArrays(gl.TRIANGLES,0,6);
    }
  }
  destroy(){
    if(!this.gl)return;
    if(this.texture)this.gl.deleteTexture(this.texture);
    this.canvas.remove();
    this.chamber.classList.remove('gm-webgl-ready');
  }
}

class ChamberPhysics {
  constructor(chamber,{bonus=false,reduced=false}={}){
    this.chamber=chamber;
    this.bonus=bonus;
    this.reduced=reduced;
    this.balls=[];
    this.raf=0;
    this.last=0;
    this.visible=true;
    this.chamberRadius=0;
    this.ballRadius=14;
    this.seed=bonus?7.31:3.17;
    this.resizeObserver=null;
    this.intersectionObserver=null;
    this.renderer=new ChamberBallRenderer(chamber,{bonus});
    this.installObservers();
    if(!this.reduced) this.raf=requestAnimationFrame(t=>this.loop(t));
  }

  installObservers(){
    if('ResizeObserver' in window){
      this.resizeObserver=new ResizeObserver(()=>this.updateGeometry(false));
      this.resizeObserver.observe(this.chamber);
    }
    if('IntersectionObserver' in window){
      this.intersectionObserver=new IntersectionObserver(entries=>{
        this.visible=!!(entries[0]&&entries[0].isIntersecting);
      },{threshold:.01});
      this.intersectionObserver.observe(this.chamber);
    }
  }

  setBalls(elements){
    this.balls=Array.from(elements||[]).map((el,i)=>({
      el,
      x:0,y:0,
      vx:0,vy:0,
      angle:(i*.61)%6.283,
      angular:(i%2?-1:1)*(.35+(i%5)*.08),
      number:Number(el.dataset.number||i+1),
      id:i
    }));
    this.updateGeometry(true);
    if(this.reduced) this.render();
  }

  updateGeometry(reset=false){
    const size=Math.max(1,Math.min(this.chamber.clientWidth||0,this.chamber.clientHeight||0));
    if(size<2)return;
    const sample=this.balls[0]?.el;
    const ballSize=sample?Math.max(14,sample.getBoundingClientRect().width||21):21;
    const nextBallR=ballSize/2;
    const nextChamberR=size/2;
    const previous=this.chamberRadius;
    this.ballRadius=nextBallR;
    this.chamberRadius=nextChamberR;
    if(reset||!previous){
      this.seedPositions();
    }else{
      const scale=nextChamberR/previous;
      this.balls.forEach(b=>{b.x*=scale;b.y*=scale;b.vx*=Math.sqrt(scale);b.vy*=Math.sqrt(scale)});
      this.constrainAll();
    }
    this.render();
  }

  seedPositions(){
    const n=this.balls.length;
    if(!n)return;
    const limit=Math.max(8,this.chamberRadius-this.ballRadius-6);
    const spacing=this.ballRadius*1.78;
    const cols=Math.max(4,Math.ceil(Math.sqrt(n*1.9)));
    this.balls.forEach((b,i)=>{
      const row=Math.floor(i/cols),col=i%cols;
      const centered=col-(Math.min(cols,n-row*cols)-1)/2;
      b.x=centered*spacing + Math.sin((i+1)*2.17)*this.ballRadius*.18;
      const floor=Math.sqrt(Math.max(0,limit*limit-b.x*b.x));
      b.y=floor-this.ballRadius*.18-row*spacing*.82;
      b.vx=Math.sin(i*1.93)*2.4;
      b.vy=Math.cos(i*1.37)*1.8;
      b.angle=(i*.83)%6.283;
      b.angular=(i%2?-1:1)*(.28+(i%5)*.07);
    });
    for(let k=0;k<8;k++)this.resolveCollisions(.016,true);
    this.constrainAll();
  }

  loop(now){
    if(!this.reduced&&!document.hidden&&this.visible&&this.balls.length){
      const dt=Math.min(.032,Math.max(.008,(now-(this.last||now-16.7))/1000));
      this.step(dt,now/1000);
      this.render();
    }
    this.last=now;
    this.raf=requestAnimationFrame(t=>this.loop(t));
  }

  step(dt,t){
    const drawing=!!this.chamber.closest('.gm-stage')?.classList.contains('is-drawing');
    const boost=drawing?1.18:1;
    const maxR=Math.max(8,this.chamberRadius-this.ballRadius-5);
    const gravity=(this.bonus?92:98)*boost;
    const maxSpeed=(this.chamberRadius<80?92:132)*boost;
    const drag=Math.exp(-.72*dt);
    const nozzles=this.bonus?[-.34,0,.34]:[-.52,-.18,.18,.52];

    for(const b of this.balls){
      let ax=-b.x*.10;
      let ay=gravity;
      const yNorm=b.y/maxR;
      const bottomFactor=Math.max(0,Math.min(1,(yNorm-.12)/.72));
      let jetLift=0,jetSide=0;

      nozzles.forEach((pos,i)=>{
        const center=pos*maxR;
        const dx=b.x-center;
        const width=maxR*(this.bonus?.30:.25);
        const xInfluence=Math.max(0,1-Math.abs(dx)/width);
        const slow=.5+.5*Math.sin(t*(1.42+i*.07)+i*1.91+this.seed);
        const burst=Math.pow(Math.max(0,Math.sin(t*(2.15+i*.11)+i*2.43+b.id*.13)),2.0);
        const flutter=.74+.26*Math.sin(t*4.1+b.id*1.17+i);
        const force=xInfluence*bottomFactor*(.18+.82*slow)*(.34+.66*burst)*flutter;
        jetLift+=force*(this.bonus?300:330)*boost;
        jetSide+=(-dx/Math.max(1,width))*force*24;
      });

      ay-=jetLift;
      ax+=jetSide;
      ax+=Math.sin(t*2.7+b.id*1.33)*5.2;
      ay+=Math.cos(t*2.1+b.id*.91)*3.8;

      b.vx+=ax*dt;
      b.vy+=ay*dt;
      b.vx*=drag;b.vy*=drag;

      const speed=Math.hypot(b.vx,b.vy);
      if(speed>maxSpeed){const k=maxSpeed/speed;b.vx*=k;b.vy*=k}

      b.x+=b.vx*dt;
      b.y+=b.vy*dt;
      b.angular+=b.vx*.0018;
      b.angle+=b.angular*dt;
      b.angular*=Math.exp(-1.55*dt);
    }

    this.resolveCollisions(dt,false);
    this.constrainAll();
  }
  resolveCollisions(dt,quiet=false){
    const balls=this.balls;
    const minDist=this.ballRadius*2*.94;
    const minDist2=minDist*minDist;
    const restitution=.82;
    for(let i=0;i<balls.length;i++){
      const a=balls[i];
      for(let j=i+1;j<balls.length;j++){
        const b=balls[j];
        let dx=b.x-a.x,dy=b.y-a.y;
        let d2=dx*dx+dy*dy;
        if(d2>=minDist2)continue;
        if(d2<.0001){dx=.01*(j+1);dy=.01*(i+1);d2=dx*dx+dy*dy}
        const d=Math.sqrt(d2),nx=dx/d,ny=dy/d;
        const overlap=minDist-d;
        const correction=overlap*.51;
        a.x-=nx*correction;a.y-=ny*correction;
        b.x+=nx*correction;b.y+=ny*correction;

        if(quiet)continue;
        const rvx=b.vx-a.vx,rvy=b.vy-a.vy;
        const rel=rvx*nx+rvy*ny;
        if(rel<0){
          const impulse=-(1+restitution)*rel*.5;
          a.vx-=impulse*nx;a.vy-=impulse*ny;
          b.vx+=impulse*nx;b.vy+=impulse*ny;
          const tx=-ny,ty=nx;
          const tangent=rvx*tx+rvy*ty;
          a.angular-=tangent*.018;
          b.angular+=tangent*.018;
          const hit=Math.min(1,Math.abs(rel)/80);
          if(hit>.44){
            a.el.classList.remove('gm-impact');b.el.classList.remove('gm-impact');
            void a.el.offsetWidth;
            a.el.classList.add('gm-impact');b.el.classList.add('gm-impact');
            clearTimeout(a.impactTimer);clearTimeout(b.impactTimer);
            a.impactTimer=setTimeout(()=>a.el.classList.remove('gm-impact'),120);
            b.impactTimer=setTimeout(()=>b.el.classList.remove('gm-impact'),120);
          }
        }
      }
    }
  }

  constrainAll(){
    const limit=Math.max(6,this.chamberRadius-this.ballRadius-5);
    const restitution=.70;
    this.balls.forEach(b=>{
      const d=Math.hypot(b.x,b.y)||1;
      if(d<=limit)return;
      const nx=b.x/d,ny=b.y/d;
      b.x=nx*limit;b.y=ny*limit;
      const outward=b.vx*nx+b.vy*ny;
      if(outward>0){
        b.vx-=(1+restitution)*outward*nx;
        b.vy-=(1+restitution)*outward*ny;
        const tangent=b.vx*(-ny)+b.vy*nx;
        b.vx*=ny>.18?.91:.96;
        b.vy*=ny>.18?.84:.94;
        b.angular+=tangent*.010;
      }
    });
  }

  render(){
    this.balls.forEach(b=>{
      b.el.style.transform=`translate3d(${b.x.toFixed(2)}px,${b.y.toFixed(2)}px,0)`;
      b.el.style.setProperty('--spin',`${b.angle.toFixed(3)}rad`);
    });
    this.renderer?.render(this.balls,this.ballRadius);
  }

  destroy(){
    cancelAnimationFrame(this.raf);
    this.resizeObserver?.disconnect();
    this.intersectionObserver?.disconnect();
    this.balls.forEach(b=>clearTimeout(b.impactTimer));
    this.renderer?.destroy();
    this.balls=[];
  }
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
    this.mainPhysics = null;
    this.bonusPhysics = null;
    this.build();
    this.mainPhysics = new ChamberPhysics(this.mainChamber,{bonus:false,reduced:this.reduced});
    this.bonusPhysics = new ChamberPhysics(this.bonusChamber,{bonus:true,reduced:this.reduced});
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
          <div class="gm-chamber-wrap"><div class="gm-neck"></div><div class="gm-base"></div><div class="gm-chamber"><div class="gm-air-ring"></div><div class="gm-air-jets"><i></i><i></i><i></i><i></i></div><div class="gm-glass-caustic"></div><div class="gm-glass-refraction"></div><div class="gm-glass-inner-shadow"></div><div class="gm-glass-reflection"></div><div class="gm-glass-sheen"></div><div class="gm-glass-glint"></div><div class="gm-glass-rim"></div></div></div>
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
            <div class="gm-board-message">The chambers stay active while this lottery is available.</div>
            <div class="gm-actions"><button type="button" class="gm-replay" hidden>Replay full ranked draw</button></div>
          </div>
        </div>
        <div class="gm-machine bonus">
          <div class="gm-chamber-wrap"><div class="gm-neck"></div><div class="gm-base"></div><div class="gm-chamber"><div class="gm-air-ring"></div><div class="gm-air-jets"><i></i><i></i><i></i><i></i></div><div class="gm-glass-caustic"></div><div class="gm-glass-refraction"></div><div class="gm-glass-inner-shadow"></div><div class="gm-glass-reflection"></div><div class="gm-glass-sheen"></div><div class="gm-glass-glint"></div><div class="gm-glass-rim"></div></div></div>
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
          this.message.textContent = 'The lottery is completed. No displayable ranked winner result was stored.';
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
    const compact = window.matchMedia?.('(max-width:430px)').matches;
    const mainBase = clamp(Math.round(Number(this.event.white_ball_max || 30) * .42), 14, compact ? 22 : 30);
    const bonusBase = clamp(Math.round(Number(this.event.bonus_ball_max || 20) * .55), 9, compact ? 12 : 20);
    // Roughly 13% less visual density than the previous chamber so collisions read clearly.
    const mainVisible = Math.max(compact ? 11 : 12, Math.round(mainBase * .87));
    const bonusVisible = Math.max(compact ? 7 : 8, Math.round(bonusBase * .87));
    this.addPool(this.mainChamber, mainVisible, Number(this.event.white_ball_max || 69), false);
    this.mainPhysics?.setBalls(this.mainChamber.querySelectorAll('.gm-ball'));
    if(this.event.bonus_ball_enabled){
      this.bonusMachine.classList.remove('offline');
      this.addPool(this.bonusChamber, bonusVisible, Number(this.event.bonus_ball_max || 26), true);
      this.bonusPhysics?.setBalls(this.bonusChamber.querySelectorAll('.gm-ball'));
      this.bonusMachine.querySelector('.gm-machine-label').textContent = 'Special ball chamber';
    }else{
      this.bonusMachine.classList.add('offline');
      this.bonusPhysics?.setBalls([]);
      this.bonusMachine.querySelector('.gm-machine-label').textContent = 'Special ball disabled';
    }
  }

  addPool(chamber, count, max, bonus){
    const used = new Set();
    for(let i=0;i<count;i++){
      let n = 1 + Math.floor((i * max) / count);
      while(used.has(n) && n < max) n++;
      used.add(n);
      const ball = create('span','gm-ball');
      ball.dataset.number=String(n);
      ball.setAttribute('aria-hidden','true');
      const surface=create('span','gm-ball-surface');
      const print=create('span','gm-ball-print',pad2(n));
      surface.appendChild(print);
      ball.appendChild(surface);
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
      this.message.textContent = 'This lottery was cancelled.';
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
      else this.message.textContent = 'Continuous chamber mixing is active while the lottery remains open.';
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
    this.mainPhysics?.destroy();
    this.bonusPhysics?.destroy();
  }
}
