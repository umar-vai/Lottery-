const URL=Deno.env.get('SUPABASE_URL')!;
const KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const enc=new TextEncoder();
type Trace={id:string;start:number;action:string};

function originAllowed(req:Request){
  const o=req.headers.get('origin')||'';
  return !o||o==='https://lootera.win'||o==='https://www.lootera.win'||o==='https://umar-vai.github.io'||o.startsWith('http://localhost:');
}
function cors(req:Request){
  const o=req.headers.get('origin')||'';
  return {
    'Access-Control-Allow-Origin':originAllowed(req)?(o||'https://lootera.win'):'null',
    'Access-Control-Allow-Headers':'authorization,content-type,apikey',
    'Access-Control-Allow-Methods':'POST,OPTIONS',
    'Access-Control-Expose-Headers':'x-support-trace-id',
    'Vary':'Origin'
  };
}
function emit(ctx:Trace,status:number,extra:Record<string,unknown>={}){
  const payload={component:'support-device-admin',event:'request_complete',trace_id:ctx.id,action:ctx.action,status,duration_ms:Math.round(performance.now()-ctx.start),...extra};
  const line=JSON.stringify(payload);
  if(status>=500)console.error(line);else if(status>=400)console.warn(line);else console.log(line);
}
function reply(req:Request,ctx:Trace,data:unknown,status=200,extra:Record<string,unknown>={}){
  emit(ctx,status,extra);
  return new Response(JSON.stringify(data),{status,headers:{...cors(req),'content-type':'application/json','x-support-trace-id':ctx.id}});
}
async function sha(v:string){
  const b=await crypto.subtle.digest('SHA-256',enc.encode(v));
  return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
async function db(path:string,opt:any={}){
  const h={apikey:KEY,Authorization:'Bearer '+KEY,'content-type':'application/json',...(opt.headers||{})};
  const r=await fetch(URL+'/rest/v1/'+path,{...opt,headers:h});
  const t=await r.text();let d:any=null;
  try{d=t?JSON.parse(t):null}catch{d=t}
  if(!r.ok)throw new Error(typeof d==='object'?(d.message||d.details||'Database error'):String(d));
  return d;
}
async function user(req:Request){
  const auth=req.headers.get('authorization')||'';
  if(!auth.startsWith('Bearer '))throw new Error('Authentication required');
  const r=await fetch(URL+'/auth/v1/user',{headers:{apikey:KEY,Authorization:auth}});
  if(!r.ok)throw new Error('Invalid session');
  const u=await r.json();
  const p=await db('profiles?select=id,role&id=eq.'+encodeURIComponent(u.id)+'&limit=1');
  if(!p?.[0]||p[0].role!=='admin')throw new Error('Admin access required');
  return u;
}
function token(){
  const b=new Uint8Array(32);crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

Deno.serve(async(req)=>{
  const ctx:Trace={id:crypto.randomUUID(),start:performance.now(),action:req.method.toLowerCase()};
  if(!originAllowed(req))return reply(req,ctx,{error:'Origin not allowed'},403,{outcome:'cors_denied'});
  if(req.method==='OPTIONS')return new Response('',{headers:cors(req)});
  try{
    if(req.method!=='POST')return reply(req,ctx,{error:'POST required'},405);
    const u=await user(req);
    const body=await req.json().catch(()=>({}));
    ctx.action=String(body.action||'list').slice(0,40);

    if(ctx.action==='list'){
      const devices=await db('support_bridge_devices?select=id,label,enabled,created_at,last_seen_at&order=created_at.desc&limit=100');
      const tx=await db('support_admin_recent?select=id,provider,sender_last4,amount,trx_id,received_at,claimed_at,claimed_by_name&order=received_at.desc&limit=40');
      return reply(req,ctx,{devices,transactions:tx,wallets:[],compatibility_note:'Wallet listing moved to admin_list_support_wallets_page'},200,{device_count:Array.isArray(devices)?devices.length:0,transaction_count:Array.isArray(tx)?tx.length:0});
    }
    if(ctx.action==='create'){
      const label=String(body.label||'Android Phone').trim().slice(0,80);
      if(!label)return reply(req,ctx,{error:'Device label required'},400);
      const plain=token();const hash=await sha(plain);
      const rows=await db('support_bridge_devices',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({label,token_hash:hash,created_by:u.id})});
      return reply(req,ctx,{ok:true,device:rows?.[0],deviceToken:plain},200,{created:true});
    }
    if(ctx.action==='revoke'){
      const id=String(body.id||'');
      if(!id)return reply(req,ctx,{error:'Device id required'},400);
      await db('support_bridge_devices?id=eq.'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({enabled:false})});
      return reply(req,ctx,{ok:true},200,{enabled:false});
    }
    if(ctx.action==='enable'){
      const id=String(body.id||'');
      if(!id)return reply(req,ctx,{error:'Device id required'},400);
      await db('support_bridge_devices?id=eq.'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({enabled:true})});
      return reply(req,ctx,{ok:true},200,{enabled:true});
    }
    if(ctx.action==='adjust_support'){
      const userId=String(body.userId||'');const value=Number(body.newBalance);
      const note=String(body.note||'Admin live adjustment').trim().slice(0,300);
      if(!/^[0-9a-f-]{36}$/i.test(userId))return reply(req,ctx,{error:'Valid user id required'},400);
      if(!Number.isFinite(value)||value<0||value>100000000)return reply(req,ctx,{error:'Support Points must be between 0 and 100,000,000'},400);
      const oldRows=await db('support_wallets?select=balance&user_id=eq.'+encodeURIComponent(userId)+'&limit=1');
      const previous=Number(oldRows?.[0]?.balance||0);
      await db('support_wallets?on_conflict=user_id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify({user_id:userId,balance:value,updated_at:new Date().toISOString()})});
      await db('support_point_adjustments',{method:'POST',body:JSON.stringify({user_id:userId,previous_balance:previous,new_balance:value,actor_user_id:u.id,note})});
      return reply(req,ctx,{ok:true,userId,previousBalance:previous,newBalance:value},200,{adjusted:true});
    }
    return reply(req,ctx,{error:'Unknown action'},400);
  }catch(e){
    const m=e instanceof Error?e.message:String(e);
    const status=/Admin|Authentication|Invalid session/.test(m)?403:500;
    return reply(req,ctx,{error:m},status,{outcome:'error'});
  }
});
