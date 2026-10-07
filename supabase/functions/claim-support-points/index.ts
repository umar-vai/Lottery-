const URL=Deno.env.get('SUPABASE_URL')!;
const KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const enc=new TextEncoder();
type Trace={id:string;start:number;action:string};

function cors(req:Request){
  const o=req.headers.get('origin')||'';
  const ok=o==='https://umar-vai.github.io'||o.startsWith('http://localhost:');
  return {
    'Access-Control-Allow-Origin':ok?o:'https://umar-vai.github.io',
    'Access-Control-Allow-Headers':'authorization,content-type,apikey',
    'Access-Control-Allow-Methods':'POST,OPTIONS',
    'Access-Control-Expose-Headers':'x-support-trace-id',
    'Vary':'Origin'
  };
}
function emit(ctx:Trace,status:number,extra:Record<string,unknown>={}){
  const payload={component:'claim-support-points',event:'request_complete',trace_id:ctx.id,action:ctx.action,status,duration_ms:Math.round(performance.now()-ctx.start),...extra};
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
function phone(v:string){let n=v.replace(/\D/g,'');if(n.startsWith('8801')&&n.length===13)return n;if(n.startsWith('01')&&n.length===11)return '88'+n;return ''}
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
  return await r.json();
}

Deno.serve(async(req)=>{
  const ctx:Trace={id:crypto.randomUUID(),start:performance.now(),action:'claim'};
  if(req.method==='OPTIONS')return new Response('',{headers:cors(req)});
  try{
    if(req.method!=='POST')return reply(req,ctx,{error:'POST required'},405);
    const u=await user(req);
    const body=await req.json();
    const sender=phone(String(body.senderNumber||''));
    const trx=String(body.trxId||'').trim().toUpperCase();
    if(!sender)return reply(req,ctx,{error:'Enter a valid sender bKash number'},400,{validation:'sender'});
    if(!/^[A-Z0-9]{6,32}$/.test(trx))return reply(req,ctx,{error:'Enter a valid TrxID'},400,{validation:'trx'});
    if(body.acceptedTerms!==true)return reply(req,ctx,{error:'Please accept the Support Points terms'},400,{validation:'terms'});
    const senderHash=await sha(sender);
    const rows=await db('rpc/service_submit_support_claim',{method:'POST',body:JSON.stringify({p_user_id:u.id,p_trx_id:trx,p_sender_hash:senderHash,p_sender_last4:sender.slice(-4)})});
    const result=Array.isArray(rows)?rows[0]:rows;
    const resultStatus=result&&typeof result==='object'?String(result.status||'unknown'):'pending';
    return reply(req,ctx,result||{ok:true,status:'pending'},200,{claim_status:resultStatus});
  }catch(e){
    const m=e instanceof Error?e.message:String(e);
    const status=/Authentication|Invalid session/.test(m)?401:400;
    return reply(req,ctx,{error:m},status,{outcome:'error'});
  }
});
