const URL=Deno.env.get('SUPABASE_URL')!;

type AlertItem={
  id:number;
  audit_log_id:number;
  delivery_kind:'initial'|'escalation_1'|'escalation_2'|'recovery';
  severity:'ok'|'warning'|'critical';
  payload:Record<string,unknown>;
  attempt_count:number;
  created_at:string;
};

type Trace={id:string;start:number};

function key():string{
  const raw=Deno.env.get('SUPABASE_SECRET_KEYS');
  if(raw){
    try{
      const parsed=JSON.parse(raw);
      if(parsed&&typeof parsed.default==='string'&&parsed.default)return parsed.default;
    }catch{}
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
}

function dbHeaders(){
  const k=key();
  if(!k)throw new Error('Supabase backend key unavailable');
  const h:Record<string,string>={'apikey':k,'content-type':'application/json'};
  if(!k.startsWith('sb_secret_'))h.Authorization='Bearer '+k;
  return h;
}

async function rpc(name:string,args:Record<string,unknown>){
  const r=await fetch(URL+'/rest/v1/rpc/'+name,{
    method:'POST',
    headers:dbHeaders(),
    body:JSON.stringify(args)
  });
  const t=await r.text();
  let data:unknown=null;
  try{data=t?JSON.parse(t):null}catch{data=t}
  if(!r.ok){
    const detail=typeof data==='object'&&data!==null
      ?String((data as Record<string,unknown>).message||(data as Record<string,unknown>).details||'Database RPC failed')
      :String(data||'Database RPC failed');
    throw new Error(detail);
  }
  return data;
}

function emit(ctx:Trace,event:string,status:number,extra:Record<string,unknown>={}){
  const line=JSON.stringify({
    component:'production-alert-dispatch',
    event,
    trace_id:ctx.id,
    status,
    duration_ms:Math.round(performance.now()-ctx.start),
    ...extra
  });
  if(status>=500)console.error(line);
  else if(status>=400)console.warn(line);
  else console.log(line);
}

function reply(ctx:Trace,data:unknown,status=200,extra:Record<string,unknown>={}){
  emit(ctx,'request_complete',status,extra);
  return new Response(JSON.stringify(data),{
    status,
    headers:{
      'content-type':'application/json',
      'x-alert-trace-id':ctx.id
    }
  });
}

function safeWebhookUrl(raw:string){
  const u=new URL(raw);
  if(u.protocol!=='https:')throw new Error('Production alert webhook must use HTTPS');
  return u.toString();
}

async function hmacHex(secret:string,body:string){
  const enc=new TextEncoder();
  const k=await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    {name:'HMAC',hash:'SHA-256'},
    false,
    ['sign']
  );
  const sig=await crypto.subtle.sign('HMAC',k,enc.encode(body));
  return [...new Uint8Array(sig)].map(x=>x.toString(16).padStart(2,'0')).join('');
}

function truncate(v:string,n=900){
  return v.length>n?v.slice(0,n):v;
}

Deno.serve(async(req)=>{
  const ctx:Trace={id:crypto.randomUUID(),start:performance.now()};
  try{
    if(req.method!=='POST')return reply(ctx,{error:'POST required'},405);

    const dispatchToken=(req.headers.get('x-alert-dispatch-token')||'').trim();
    if(dispatchToken.length<32)return reply(ctx,{error:'Dispatch authentication required'},401);

    const webhookRaw=(Deno.env.get('PRODUCTION_ALERT_WEBHOOK_URL')||'').trim();
    if(!webhookRaw){
      await rpc('service_record_production_alert_dispatcher_state',{
        p_dispatch_token:dispatchToken,
        p_configured:false,
        p_error:'PRODUCTION_ALERT_WEBHOOK_URL is not configured',
        p_disable:true
      });
      return reply(ctx,{
        ok:true,
        configured:false,
        disabled:true,
        delivered:0,
        failed:0
      },200,{configured:false,auto_disabled:true});
    }

    let webhookUrl:string;
    try{
      webhookUrl=safeWebhookUrl(webhookRaw);
    }catch(e){
      const m=e instanceof Error?e.message:String(e);
      await rpc('service_record_production_alert_dispatcher_state',{
        p_dispatch_token:dispatchToken,
        p_configured:false,
        p_error:m,
        p_disable:true
      });
      return reply(ctx,{ok:false,configured:false,disabled:true,error:m},424,{configured:false,auto_disabled:true});
    }

    await rpc('service_record_production_alert_dispatcher_state',{
      p_dispatch_token:dispatchToken,
      p_configured:true,
      p_error:null,
      p_disable:false
    });

    const claimed=await rpc('service_claim_production_alert_batch',{
      p_dispatch_token:dispatchToken,
      p_limit:10
    });

    const items=Array.isArray(claimed)?claimed as AlertItem[]:[];
    if(!items.length){
      return reply(ctx,{ok:true,configured:true,claimed:0,delivered:0,failed:0},200,{configured:true,claimed:0});
    }

    const bearer=(Deno.env.get('PRODUCTION_ALERT_WEBHOOK_BEARER')||'').trim();
    const signing=(Deno.env.get('PRODUCTION_ALERT_WEBHOOK_SIGNING_SECRET')||'').trim();

    let delivered=0;
    let failed=0;
    const results:Array<Record<string,unknown>>=[];

    for(const item of items){
      const outbound={
        source:'DRAW//01',
        alert_id:item.id,
        audit_log_id:item.audit_log_id,
        delivery_kind:item.delivery_kind,
        severity:item.severity,
        attempt:item.attempt_count,
        alert:item.payload,
        sent_at:new Date().toISOString()
      };
      const body=JSON.stringify(outbound);
      const headers:Record<string,string>={
        'content-type':'application/json',
        'user-agent':'DRAW01-Production-Alert/1.0',
        'x-draw01-alert-id':String(item.id),
        'x-draw01-delivery-kind':item.delivery_kind,
        'x-draw01-severity':item.severity,
        'x-draw01-trace-id':ctx.id
      };
      if(bearer)headers.Authorization='Bearer '+bearer;
      if(signing)headers['x-draw01-signature']='sha256='+await hmacHex(signing,body);

      let success=false;
      let statusCode:number|null=null;
      let errorText:string|null=null;

      try{
        const response=await fetch(webhookUrl,{
          method:'POST',
          headers,
          body,
          signal:AbortSignal.timeout(8000)
        });
        statusCode=response.status;
        success=response.ok;
        if(!success){
          errorText=truncate(await response.text().catch(()=>''))||('Webhook HTTP '+response.status);
        }
      }catch(e){
        errorText=truncate(e instanceof Error?e.message:String(e));
      }

      await rpc('service_complete_production_alert_delivery',{
        p_dispatch_token:dispatchToken,
        p_outbox_id:item.id,
        p_success:success,
        p_http_status:statusCode,
        p_error:errorText
      });

      if(success)delivered++;else failed++;
      results.push({
        id:item.id,
        delivery_kind:item.delivery_kind,
        success,
        status:statusCode
      });
    }

    return reply(ctx,{
      ok:failed===0,
      configured:true,
      claimed:items.length,
      delivered,
      failed,
      results
    },failed?207:200,{configured:true,claimed:items.length,delivered,failed});
  }catch(e){
    const m=e instanceof Error?e.message:String(e);
    return reply(ctx,{error:m},500,{outcome:'error'});
  }
});
