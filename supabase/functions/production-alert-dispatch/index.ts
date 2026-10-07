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

type TelegramTarget={
  bot_token?:string|null;
  chat_id?:string|null;
  pairing_code?:string|null;
  bot_configured?:boolean;
  chat_configured?:boolean;
};

type DeliveryTarget={
  channel?:'webhook'|'telegram'|string;
  telegram?:TelegramTarget;
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

function titleCase(v:string){
  return v.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
}

function alertSignals(payload:Record<string,unknown>){
  const raw=Array.isArray(payload.breaches)?payload.breaches:[];
  const rows=raw.slice(0,6).map((x)=>{
    if(!x||typeof x!=='object')return String(x||'signal');
    const r=x as Record<string,unknown>;
    const signal=titleCase(String(r.signal||r.category||'signal'));
    const parts=[signal];
    if(r.value!==undefined)parts.push('value '+String(r.value));
    if(r.threshold!==undefined)parts.push('threshold '+String(r.threshold));
    return parts.join(' · ');
  });
  return rows.length?rows.join('\n'):'No detailed signal payload';
}

function telegramAlertText(item:AlertItem){
  const p=item.payload||{};
  const event=String(p.event||'production_slo_breached');
  const recovered=item.delivery_kind==='recovery'||event==='production_slo_recovered'||item.severity==='ok';
  const heading=recovered?'Lootera — RECOVERED':'Lootera — '+String(item.severity||'warning').toUpperCase();
  const kind=titleCase(String(item.delivery_kind||'initial'));
  const occurred=String(p.occurred_at||item.created_at||new Date().toISOString());
  const action=recovered
    ?'Production SLO returned to healthy. Verify the Incident Center and recent snapshots.'
    :'Open the admin Incident Center, inspect the signal, acknowledge ownership, then mitigate or roll back if needed.';
  return truncate([
    heading,
    'lootera.win',
    '',
    'Delivery: '+kind,
    'Audit event: #'+String(item.audit_log_id),
    'Signals:',
    alertSignals(p),
    '',
    'Occurred: '+occurred,
    'Attempt: '+String(item.attempt_count),
    '',
    action
  ].join('\n'),3900);
}

async function telegramApi(botToken:string,method:string,body:Record<string,unknown>){
  const response=await fetch('https://api.telegram.org/bot'+encodeURIComponent(botToken)+'/'+method,{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify(body),
    signal:AbortSignal.timeout(8000)
  });
  const text=await response.text();
  let data:unknown=null;
  try{data=text?JSON.parse(text):null}catch{data=text}
  if(!response.ok){
    const detail=typeof data==='object'&&data!==null
      ?String((data as Record<string,unknown>).description||('Telegram HTTP '+response.status))
      :String(data||('Telegram HTTP '+response.status));
    throw new Error(detail);
  }
  if(data&&typeof data==='object'&&(data as Record<string,unknown>).ok===false){
    throw new Error(String((data as Record<string,unknown>).description||'Telegram API error'));
  }
  return {status:response.status,data};
}

async function sendTelegram(botToken:string,chatId:string,text:string){
  return telegramApi(botToken,'sendMessage',{
    chat_id:chatId,
    text,
    disable_notification:false,
    protect_content:false
  });
}

async function loadTarget(dispatchToken:string){
  return await rpc('service_get_production_alert_delivery_target',{
    p_dispatch_token:dispatchToken
  }) as DeliveryTarget;
}

async function recordState(dispatchToken:string,configured:boolean,error:string|null,disable=false){
  return rpc('service_record_production_alert_dispatcher_state',{
    p_dispatch_token:dispatchToken,
    p_configured:configured,
    p_error:error,
    p_disable:disable
  });
}

async function discoverTelegram(ctx:Trace,dispatchToken:string,target:DeliveryTarget){
  const tg=target.telegram||{};
  const botToken=(Deno.env.get('TELEGRAM_BOT_TOKEN')||String(tg.bot_token||'')).trim();
  const requestedCode=String((target as DeliveryTarget & {setup_code?:string}).setup_code||'').trim();
  const pairingCode=requestedCode||String(tg.pairing_code||'').trim();

  if(!botToken){
    await recordState(dispatchToken,false,'Telegram bot token is not configured',true);
    return reply(ctx,{ok:false,channel:'telegram',paired:false,error:'Telegram bot token is not configured'},424,{channel:'telegram',paired:false});
  }
  if(!pairingCode){
    return reply(ctx,{ok:false,channel:'telegram',paired:false,error:'Telegram pairing code is missing'},424,{channel:'telegram',paired:false});
  }

  const response=await fetch(
    'https://api.telegram.org/bot'+encodeURIComponent(botToken)+'/getUpdates?limit=100&allowed_updates='+encodeURIComponent(JSON.stringify(['message'])),
    {signal:AbortSignal.timeout(8000)}
  );
  const payload=await response.json().catch(()=>null) as {ok?:boolean;description?:string;result?:unknown[]}|null;
  if(!response.ok||!payload?.ok){
    const m=payload?.description||('Telegram getUpdates HTTP '+response.status);
    await recordState(dispatchToken,false,m,false);
    return reply(ctx,{ok:false,channel:'telegram',paired:false,error:m},424,{channel:'telegram',paired:false});
  }

  const updates=Array.isArray(payload.result)?payload.result:[];
  let match:Record<string,unknown>|null=null;
  for(let i=updates.length-1;i>=0;i--){
    const u=updates[i];
    if(!u||typeof u!=='object')continue;
    const message=(u as Record<string,unknown>).message;
    if(!message||typeof message!=='object')continue;
    const msg=message as Record<string,unknown>;
    const text=String(msg.text||'').trim();
    const chat=msg.chat;
    if(!chat||typeof chat!=='object')continue;
    const ch=chat as Record<string,unknown>;
    if(String(ch.type||'')!=='private')continue;
    if(text===pairingCode||text==='/start '+pairingCode||text.includes(pairingCode)){
      match=msg;
      break;
    }
  }

  if(!match){
    return reply(ctx,{
      ok:false,
      channel:'telegram',
      paired:false,
      waiting_for_pairing:true,
      instruction:'Send /start '+pairingCode+' to the bot, then retry discovery.'
    },404,{channel:'telegram',paired:false,waiting:true});
  }

  const chat=match.chat as Record<string,unknown>;
  const chatId=String(chat.id||'');
  const label=[
    String(chat.first_name||'').trim(),
    String(chat.last_name||'').trim(),
    chat.username?'@'+String(chat.username):''
  ].filter(Boolean).join(' ').slice(0,200);

  await rpc('service_store_production_alert_telegram_chat',{
    p_dispatch_token:dispatchToken,
    p_chat_id:chatId,
    p_chat_label:label||'private chat'
  });

  await sendTelegram(
    botToken,
    chatId,
    'Lootera production alerts paired successfully. External delivery is still disabled until the test alert succeeds.'
  );

  await recordState(dispatchToken,true,null,false);

  return reply(ctx,{
    ok:true,
    channel:'telegram',
    paired:true,
    chat_configured:true,
    test_required:true
  },200,{channel:'telegram',paired:true});
}

async function testTelegram(ctx:Trace,dispatchToken:string,target:DeliveryTarget){
  const tg=target.telegram||{};
  const botToken=(Deno.env.get('TELEGRAM_BOT_TOKEN')||String(tg.bot_token||'')).trim();
  const chatId=String(tg.chat_id||'').trim();

  if(!botToken||!chatId){
    await recordState(dispatchToken,false,'Telegram bot/chat pairing is incomplete',true);
    return reply(ctx,{ok:false,channel:'telegram',tested:false,error:'Telegram bot/chat pairing is incomplete'},424,{channel:'telegram',tested:false});
  }

  try{
    const sent=await sendTelegram(
      botToken,
      chatId,
      [
        'Lootera — TEST ALERT',
        '',
        'Telegram production alert delivery is connected.',
        'Critical: escalation after 5 minutes if unacknowledged.',
        'Warning: escalation after 15 minutes.',
        'Level 2: escalation after 30 minutes.',
        '',
        'This is a configuration test; no production incident occurred.'
      ].join('\n')
    );
    await recordState(dispatchToken,true,null,false);
    return reply(ctx,{ok:true,channel:'telegram',tested:true,status:sent.status,ready_to_enable:true},200,{channel:'telegram',tested:true});
  }catch(e){
    const m=truncate(e instanceof Error?e.message:String(e));
    await recordState(dispatchToken,false,m,true);
    return reply(ctx,{ok:false,channel:'telegram',tested:false,error:m},424,{channel:'telegram',tested:false});
  }
}

async function dispatchTelegram(
  dispatchToken:string,
  target:DeliveryTarget,
  items:AlertItem[]
){
  const tg=target.telegram||{};
  const botToken=(Deno.env.get('TELEGRAM_BOT_TOKEN')||String(tg.bot_token||'')).trim();
  const chatId=String(tg.chat_id||'').trim();

  if(!botToken||!chatId){
    await recordState(dispatchToken,false,'Telegram bot/chat pairing is incomplete',true);
    return {configured:false,disabled:true,delivered:0,failed:0,results:[] as Array<Record<string,unknown>>};
  }

  await recordState(dispatchToken,true,null,false);

  let delivered=0;
  let failed=0;
  const results:Array<Record<string,unknown>>=[];

  for(const item of items){
    let success=false;
    let statusCode:number|null=null;
    let errorText:string|null=null;

    try{
      const sent=await sendTelegram(botToken,chatId,telegramAlertText(item));
      statusCode=sent.status;
      success=true;
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
    results.push({id:item.id,delivery_kind:item.delivery_kind,success,status:statusCode});
  }

  return {configured:true,disabled:false,delivered,failed,results};
}

async function dispatchWebhook(
  dispatchToken:string,
  items:AlertItem[],
  ctx:Trace
){
  const webhookRaw=(Deno.env.get('PRODUCTION_ALERT_WEBHOOK_URL')||'').trim();
  if(!webhookRaw){
    await recordState(dispatchToken,false,'PRODUCTION_ALERT_WEBHOOK_URL is not configured',true);
    return {configured:false,disabled:true,delivered:0,failed:0,results:[] as Array<Record<string,unknown>>};
  }

  let webhookUrl:string;
  try{
    webhookUrl=safeWebhookUrl(webhookRaw);
  }catch(e){
    const m=e instanceof Error?e.message:String(e);
    await recordState(dispatchToken,false,m,true);
    return {configured:false,disabled:true,delivered:0,failed:0,results:[] as Array<Record<string,unknown>>,error:m};
  }

  await recordState(dispatchToken,true,null,false);

  const bearer=(Deno.env.get('PRODUCTION_ALERT_WEBHOOK_BEARER')||'').trim();
  const signing=(Deno.env.get('PRODUCTION_ALERT_WEBHOOK_SIGNING_SECRET')||'').trim();
  let delivered=0;
  let failed=0;
  const results:Array<Record<string,unknown>>=[];

  for(const item of items){
    const outbound={
      source:'lootera.win',
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
      'user-agent':'Lootera-Production-Alert/1.0',
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
    results.push({id:item.id,delivery_kind:item.delivery_kind,success,status:statusCode});
  }

  return {configured:true,disabled:false,delivered,failed,results};
}

Deno.serve(async(req)=>{
  const ctx:Trace={id:crypto.randomUUID(),start:performance.now()};
  try{
    if(req.method!=='POST')return reply(ctx,{error:'POST required'},405);

    const dispatchToken=(req.headers.get('x-alert-dispatch-token')||'').trim();
    if(dispatchToken.length<32)return reply(ctx,{error:'Dispatch authentication required'},401);

    let requestBody:Record<string,unknown>={};
    try{requestBody=await req.json()}catch{}
    const action=String(requestBody.action||'dispatch');

    const target=await loadTarget(dispatchToken) as DeliveryTarget & {setup_code?:string};
    const channel=String(target.channel||'webhook');

    if(action==='telegram_discover'){
      target.setup_code=String(requestBody.pairing_code||'').trim();
      if(channel!=='telegram')return reply(ctx,{error:'Telegram channel is not selected'},409,{channel});
      return discoverTelegram(ctx,dispatchToken,target);
    }

    if(action==='telegram_test'){
      if(channel!=='telegram')return reply(ctx,{error:'Telegram channel is not selected'},409,{channel});
      return testTelegram(ctx,dispatchToken,target);
    }

    const claimed=await rpc('service_claim_production_alert_batch',{
      p_dispatch_token:dispatchToken,
      p_limit:10
    });

    const items=Array.isArray(claimed)?claimed as AlertItem[]:[];
    if(!items.length){
      return reply(ctx,{ok:true,channel,configured:true,claimed:0,delivered:0,failed:0},200,{channel,claimed:0});
    }

    const result=channel==='telegram'
      ?await dispatchTelegram(dispatchToken,target,items)
      :await dispatchWebhook(dispatchToken,items,ctx);

    return reply(ctx,{
      ok:result.failed===0,
      channel,
      claimed:items.length,
      ...result
    },result.failed?207:200,{channel,claimed:items.length,delivered:result.delivered,failed:result.failed});
  }catch(e){
    const m=e instanceof Error?e.message:String(e);
    return reply(ctx,{error:m},500,{outcome:'error'});
  }
});
