const URL=Deno.env.get('SUPABASE_URL')!;
const KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const enc=new TextEncoder();
type Trace={id:string;start:number;action:string};

function cors(req:Request){
  const o=req.headers.get('origin')||'';
  const ok=o==='https://umar-vai.github.io'||o.startsWith('http://localhost:');
  return {
    'Access-Control-Allow-Origin':ok?o:'https://umar-vai.github.io',
    'Access-Control-Allow-Headers':'content-type,x-bridge-token',
    'Access-Control-Allow-Methods':'POST,OPTIONS',
    'Access-Control-Expose-Headers':'x-support-trace-id',
    'Vary':'Origin'
  };
}
function emit(ctx:Trace,event:string,status:number,extra:Record<string,unknown>={}){
  const payload={component:'support-phone-bridge',event,trace_id:ctx.id,action:ctx.action,status,duration_ms:Math.round(performance.now()-ctx.start),...extra};
  const line=JSON.stringify(payload);
  if(status>=500)console.error(line);else if(status>=400)console.warn(line);else console.log(line);
}
function reply(req:Request,ctx:Trace,data:unknown,status=200,extra:Record<string,unknown>={}){
  emit(ctx,'request_complete',status,extra);
  return new Response(JSON.stringify(data),{status,headers:{...cors(req),'content-type':'application/json','x-support-trace-id':ctx.id}});
}
async function sha(v:string){
  const b=await crypto.subtle.digest('SHA-256',enc.encode(v));
  return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
function ascii(s:string){const b='০১২৩৪৫৬৭৮৯';return s.replace(/[০-৯]/g,c=>String(b.indexOf(c)))}
function phone(v:string){let n=v.replace(/\D/g,'');if(n.startsWith('8801')&&n.length===13)return n;if(n.startsWith('01')&&n.length===11)return '88'+n;return ''}
async function db(path:string,opt:any={}){
  const h={apikey:KEY,Authorization:'Bearer '+KEY,'content-type':'application/json',...(opt.headers||{})};
  const r=await fetch(URL+'/rest/v1/'+path,{...opt,headers:h});
  const t=await r.text();let d:any=null;
  try{d=t?JSON.parse(t):null}catch{d=t}
  if(!r.ok)throw new Error(typeof d==='object'?(d.message||d.details||'Database error'):String(d));
  return d;
}
async function settle(ctx:Trace,trxId:string,senderHash:string){
  try{
    return await db('rpc/service_settle_pending_support_claim',{method:'POST',body:JSON.stringify({p_trx_id:trxId,p_sender_hash:senderHash})});
  }catch{
    emit(ctx,'settlement_failed',200,{settlement_failed:true});
    return null;
  }
}

Deno.serve(async(req)=>{
  const ctx:Trace={id:crypto.randomUUID(),start:performance.now(),action:'bridge_ingest'};
  if(req.method==='OPTIONS')return new Response('',{headers:cors(req)});
  try{
    if(req.method!=='POST')return reply(req,ctx,{error:'POST required'},405);
    const token=req.headers.get('x-bridge-token')||'';
    if(token.length<20)return reply(req,ctx,{error:'Bridge token required'},401);

    const th=await sha(token);
    const devices=await db('support_bridge_devices?select=id,enabled&token_hash=eq.'+encodeURIComponent(th)+'&limit=1');
    const device=devices?.[0];
    if(!device||!device.enabled)return reply(req,ctx,{error:'Invalid or disabled bridge token'},401);

    const body=await req.json();
    let trx='',senderHash='',senderLast4='',amount=0,receivedAt=new Date().toISOString(),fingerprint='';
    const structured=body?.source==='android_sms'&&body?.transaction;
    ctx.action=structured?'android_sms':'raw_sms';

    if(structured){
      const x=body.transaction;
      trx=String(x.trxId||'').trim().toUpperCase();
      senderHash=String(x.senderHash||'').trim().toLowerCase();
      senderLast4=String(x.senderLast4||'').replace(/\D/g,'').slice(-4);
      amount=Number(x.amount);
      receivedAt=x.receivedAt&&Number.isFinite(Date.parse(x.receivedAt))?new Date(x.receivedAt).toISOString():receivedAt;
      fingerprint=String(x.fingerprint||'').trim().toLowerCase();
      if(!/^[A-Z0-9]{6,32}$/.test(trx)||!/^[a-f0-9]{64}$/.test(senderHash)||!/^\d{4}$/.test(senderLast4)||!Number.isFinite(amount)||amount<=0||amount>1000000||!/^[a-f0-9]{64}$/.test(fingerprint)){
        return reply(req,ctx,{error:'Invalid parsed transaction metadata'},400,{validation:'metadata'});
      }
    }else{
      let raw=ascii(String(body.rawSms||'').trim());
      if(raw.length<20||raw.length>2200)return reply(req,ctx,{error:'SMS text is missing or too long'},400,{validation:'length'});
      if(/\b(otp|one[- ]time|verification code|pin|password|do not share|secret code)\b/i.test(raw))return reply(req,ctx,{error:'Sensitive authentication SMS is not accepted'},400,{validation:'sensitive'});
      if(!/received/i.test(raw)||!/trx\s*id/i.test(raw))return reply(req,ctx,{error:'This does not look like a received-money bKash SMS'},400,{validation:'shape'});
      const tm=raw.match(/trx\s*id\s*[:\-]?\s*([A-Za-z0-9]{6,32})/i);
      const sm=raw.match(/from\s*(\+?8801\d{9}|01\d{9})/i);
      const am=raw.match(/received\s*(?:tk\.?|bdt|৳)?\s*([0-9,]+(?:\.[0-9]{1,2})?)/i)||raw.match(/(?:tk\.?|bdt|৳)\s*([0-9,]+(?:\.[0-9]{1,2})?)\s*(?:has\s+been\s+)?received/i);
      if(!tm||!sm||!am)return reply(req,ctx,{error:'Could not read amount, sender number and TrxID from this SMS'},400,{validation:'parse'});
      trx=tm[1].toUpperCase();
      const sender=phone(sm[1]);amount=Number(am[1].replace(/,/g,''));
      if(!sender||!Number.isFinite(amount)||amount<=0)return reply(req,ctx,{error:'Parsed SMS values are invalid'},400,{validation:'values'});
      senderHash=await sha(sender);senderLast4=sender.slice(-4);fingerprint=await sha(raw.replace(/\s+/g,' ').toLowerCase());
      receivedAt=body.receivedAt&&Number.isFinite(Date.parse(body.receivedAt))?new Date(body.receivedAt).toISOString():receivedAt;
    }

    let duplicate=false;
    try{
      await db('support_transactions',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({device_id:device.id,provider:'bkash',sender_hash:senderHash,sender_last4:senderLast4,amount,trx_id:trx,received_at:receivedAt,sms_fingerprint:fingerprint})});
    }catch(e){
      if(/duplicate|unique/i.test(String(e)))duplicate=true;else throw e;
    }
    await db('support_bridge_devices?id=eq.'+device.id,{method:'PATCH',body:JSON.stringify({last_seen_at:new Date().toISOString()})});
    const settlement=await settle(ctx,trx,senderHash);
    const settlementResult=Array.isArray(settlement)?settlement[0]:settlement;
    const settlementStatus=settlementResult&&typeof settlementResult==='object'?String(settlementResult.status||'unknown'):(settlement?'ok':'none');

    return reply(
      req,ctx,
      {ok:true,duplicate,provider:'bkash',amount,trxId:trx,senderMasked:'*******'+senderLast4,receivedAt,settlement},
      200,
      {duplicate,settlement_status:settlementStatus}
    );
  }catch(e){
    const m=e instanceof Error?e.message:String(e);
    return reply(req,ctx,{error:m},500,{outcome:'error'});
  }
});
