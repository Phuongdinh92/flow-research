/* Gate public spot.tickers; exact explicit registry pairs, no account operations.
 * Official specification checked 2026-10-17:
 * https://www.gate.com/docs/developers/apiv4/ws/en/#tickers-channel
 * time_ms is SERVER RESPONSE/SEND TIME, not last trade time. 1000ms update channel.
 * Docs allow multiple explicit pairs, repeated additive subscriptions, <=300
 * sockets/IP, and do not specify a ticker-pair maximum. Client safety policy:
 * one socket, <=50 pairs/request, one acknowledged request at a time, >=1s apart.
 * No wildcard, host fallback, source-error retry, or implicit ticker/token join.
 */
(function(root,factory){'use strict';const api=factory();root.FlowLiveGate=api;if(typeof module==='object'&&module.exports)module.exports=api;})(globalThis,function(){
  'use strict';
  const ENDPOINT='wss://api.gateio.ws/ws/v4/',CHANNEL='spot.tickers',STALE_MS=5000,MAX_EVENT_AGE_MS=15000,MAX_FUTURE_MS=2000,UPDATE_MS=1000,BATCH_SIZE=50,REQUEST_INTERVAL_MS=1000,ACK_TIMEOUT_MS=15000,MAX_INSTRUMENTS=10000;
  function timestamp(n){if(!Number.isSafeInteger(n)||n<946684800000||n>=4102444800000)throw Error('timestamp');return n;}
  function identifier(s){return typeof s==='string'&&/^[\p{L}\p{N}_.-]{1,80}$/u.test(s);}
  function instruments(input){if(!Array.isArray(input)||input.length>MAX_INSTRUMENTS)throw Error('instruments');const out=new Map();for(const x of input){if(!x||!identifier(x.instrument)||!identifier(x.base)||x.quote!=='USDT'||x.instrument!==x.base+'_USDT'||x.sourceId&&x.sourceId!=='gate'||x.key&&x.key!=='gate:'+x.instrument||out.has(x.instrument))throw Error('instrument');out.set(x.instrument,Object.freeze({instrument:x.instrument,base:x.base,quote:'USDT'}));}return out;}
  function decimal(v,{positive=false,signed=false}={}){if(typeof v!=='string'||v.length>100||!(signed?/^-?\d+(?:\.\d+)?$/:/^\d+(?:\.\d+)?$/).test(v))throw Error('decimal');const n=Number(v);if(!Number.isFinite(n)||!signed&&n<0||positive&&n<=0)throw Error('decimal');return n;}
  function sourceTime(raw,receivedAt){timestamp(receivedAt);if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('frame_shape');const t=timestamp(raw.time_ms);if(!Number.isSafeInteger(raw.time)||Math.floor(t/1000)!==raw.time)throw Error('source_time_consistency');if(t>receivedAt+MAX_FUTURE_MS)throw Error('future_event');if(receivedAt-t>MAX_EVENT_AGE_MS)throw Error('old_event');return t;}
  function parseTicker(raw,meta,receivedAt){
    const eventTime=sourceTime(raw,receivedAt);if(!meta||!identifier(meta.instrument)||!identifier(meta.base)||meta.quote!=='USDT'||meta.instrument!==meta.base+'_USDT')throw Error('instrument');
    if(raw.channel!==CHANNEL||raw.event!=='update'||raw.error!=null||!raw.result||Array.isArray(raw.result)||raw.result.currency_pair!==meta.instrument)throw Error('ticker_shape');
    const r=raw.result,last=decimal(r.last,{positive:true}),high=decimal(r.high_24h,{positive:true}),low=decimal(r.low_24h,{positive:true}),ask=decimal(r.lowest_ask),bid=decimal(r.highest_bid),volume24=decimal(r.base_volume),turnover24=decimal(r.quote_volume),changePercentage=decimal(r.change_percentage,{signed:true});
    const tolerance=Math.max(high,last)*1e-12;if(high+tolerance<Math.max(low,last)||low-tolerance>Math.min(high,last))throw Error('ohlc');if(changePercentage< -100)throw Error('return');
    return Object.freeze({key:'gate:'+meta.instrument,sourceId:'gate',...meta,last,open:null,high,low,ask,bid,volume24,turnover24,return24:changePercentage/100,asOf:eventTime,eventTime,sourceEventAt:eventTime,lastTradeAt:null,receivedAt,fetchedAt:receivedAt,timestampKind:'source_response',eventTimeMeaning:'server_send_time_not_last_trade',mode:'stream',window:'rolling24h',returnMethod:'source_change_percentage_div_100',sourceStream:CHANNEL,
      raw:Object.freeze({time:raw.time,time_ms:raw.time_ms,channel:raw.channel,event:raw.event,currency_pair:r.currency_pair,last:r.last,lowest_ask:r.lowest_ask,highest_bid:r.highest_bid,change_percentage:r.change_percentage,base_volume:r.base_volume,quote_volume:r.quote_volume,high_24h:r.high_24h,low_24h:r.low_24h})});
  }
  function create(options={}){
    let listed=instruments(options.instruments||[]),rows=new Map(),observedConnection=new Map(),socket=null,generation=0,wanted=false,blocked=false,transport='idle',connectedAt=null,sessionStartedAt=null,lastFrameAt=null,lastEventAt=null,lastReceivedAt=null,lastEmit=-Infinity,dirty=true,lastFreshCount=-1;
    let timer=null,connectTimer=null,batchTimer=null,ackTimer=null,pending=null,requestId=0,lastSubscribeAt=null,nextIndex=0,subscriptionBatchCount=0,subscribed=new Set(),sent=new Set(),connectionAccepted=0,blockedReason=null;
    const changed=new Map(),now=options.now||(()=>Date.now()),schedule=options.setTimeout||options.setTimeoutImpl||setTimeout,cancel=options.clearTimeout||options.clearTimeoutImpl||clearTimeout,WS=options.WebSocketImpl||globalThis.WebSocket,doc=options.document===undefined?(typeof document==='object'?document:null):options.document;
    const stats={frames:0,accepted:0,rejected:0,filtered:0,rejectionReasons:{}};
    function notify(fn,v){if(typeof fn==='function')try{fn(v);}catch(e){if(typeof options.onCallbackError==='function')options.onCallbackError(e);}}
    function reject(reason){stats.rejected++;stats.rejectionReasons[reason]=(stats.rejectionReasons[reason]||0)+1;dirty=true;}
    function status(at=now()){
      const fresh=[...rows.values()].filter(r=>observedConnection.get(r.instrument)===generation&&at-r.eventTime<=STALE_MS&&r.eventTime<=at+MAX_FUTURE_MS),frameFresh=connectionAccepted>0&&lastReceivedAt!==null&&at-lastReceivedAt<=STALE_MS;
      const state=transport==='open'?(frameFresh&&fresh.length?'live':connectionAccepted?'stale':'waiting'):transport;
      return {state,sourceId:'gate',endpoint:ENDPOINT,stream:CHANNEL,window:'rolling24h',eventTimeMeaning:'server_send_time_not_last_trade',lastTradeTimeAvailable:false,updateMs:UPDATE_MS,staleMs:STALE_MS,expectedCount:listed.size,observedCount:rows.size,freshCount:transport==='open'?fresh.length:0,requestedCount:sent.size,subscribedCount:subscribed.size,subscriptionActive:transport==='open',subscriptionComplete:transport==='open'&&subscribed.size===listed.size,subscriptionBatches:subscriptionBatchCount,pendingSubscriptionCount:pending?.pairs.length||0,unattemptedCount:listed.size-sent.size,subscriptionPolicy:{batchSize:BATCH_SIZE,minRequestIntervalMs:REQUEST_INTERVAL_MS,acknowledgementRequired:true,maxSockets:1,providerTickerPairLimit:null},connectedAt,sessionStartedAt,lastFrameAt,lastEventAt,lastReceivedAt,blockedReason,nextRetryAt:null,...stats,rejectionReasons:{...stats.rejectionReasons}};
    }
    function snapshot(){const at=now();return {rows:[...rows.values()].map(r=>({...r,stale:transport!=='open'||observedConnection.get(r.instrument)!==generation||at-r.eventTime>STALE_MS||r.eventTime>at+MAX_FUTURE_MS})),status:status(at)};}
    function emit(force=false){const at=now();if(!force&&at-lastEmit<UPDATE_MS)return;lastEmit=at;const s=snapshot();notify(options.onStatus,s.status);if(force||dirty||changed.size||lastFreshCount!==s.status.freshCount){lastFreshCount=s.status.freshCount;dirty=false;const updates=[...changed.values()];changed.clear();notify(options.onUpdate,{...s,changedRows:updates});}}
    function clearTimers(){for(const id of [timer,connectTimer,batchTimer,ackTimer])if(id!==null)cancel(id);timer=connectTimer=batchTimer=ackTimer=null;}
    function closeSocket(){generation++;const previous=socket;socket=null;clearTimers();pending=null;if(previous){previous.onopen=previous.onmessage=previous.onerror=previous.onclose=null;try{previous.close(1000,'Local lifecycle');}catch(_){}}}
    function fail(reason){blocked=true;wanted=false;blockedReason=reason;transport='blocked';closeSocket();dirty=true;emit(true);}
    function heartbeat(){timer=null;if(!wanted)return;emit();timer=schedule(heartbeat,UPDATE_MS);}
    function nextBatch(){batchTimer=null;if(!wanted||transport!=='open'||pending||!socket)return;const pairs=[...listed.keys()].slice(nextIndex,nextIndex+BATCH_SIZE);if(!pairs.length)return;const elapsed=lastSubscribeAt===null?REQUEST_INTERVAL_MS:now()-lastSubscribeAt;if(elapsed<REQUEST_INTERVAL_MS){batchTimer=schedule(nextBatch,REQUEST_INTERVAL_MS-elapsed);return;}
      const id=++requestId;pending={id,pairs,sentAt:now()};for(const p of pairs)sent.add(p);lastSubscribeAt=now();nextIndex+=pairs.length;
      try{socket.send(JSON.stringify({time:Math.floor(now()/1000),id,channel:CHANNEL,event:'subscribe',payload:pairs}));}catch(_){fail('subscribe_send_failed');return;}
      const token=generation;ackTimer=schedule(()=>{ackTimer=null;if(token===generation&&pending?.id===id)fail('subscription_ack_timeout');},ACK_TIMEOUT_MS);dirty=true;emit(true);
    }
    function ingest(data,receivedAt=now()){
      if(typeof data!=='string'||data.length>100000){fail('invalid_frame_size');return;}
      let raw;try{raw=JSON.parse(data);}catch(_){fail('invalid_json');return;}stats.frames++;lastFrameAt=receivedAt;
      if(!raw||typeof raw!=='object'||Array.isArray(raw)){fail('invalid_frame_shape');return;}
      if(raw.error!=null||raw.header&&['401','403','429'].includes(String(raw.header.status))){fail('source_error_'+String(raw.error?.code??raw.header?.status??'unknown'));return;}
      if(raw.channel==='spot.system'&&raw.result?.type==='upgrade'){transport='disconnected';wanted=false;closeSocket();dirty=true;emit(true);return;}
      if(raw.channel!==CHANNEL){stats.filtered++;return;}
      if(raw.event==='subscribe'){
        if(!pending||raw.id!==pending.id||raw.result?.status!=='success'){fail('invalid_subscription_ack');return;}
        try{sourceTime(raw,receivedAt);}catch(e){fail('invalid_subscription_'+e.message);return;}
        if(raw.payload!==undefined&&(!Array.isArray(raw.payload)||JSON.stringify(raw.payload)!==JSON.stringify(pending.pairs))){fail('subscription_payload_conflict');return;}
        if(ackTimer!==null){cancel(ackTimer);ackTimer=null;}for(const p of pending.pairs)subscribed.add(p);pending=null;subscriptionBatchCount++;dirty=true;emit(true);nextBatch();return;
      }
      if(raw.event!=='update'){reject('unexpected_event');emit();return;}
      const name=raw.result?.currency_pair;if(!listed.has(name)||!sent.has(name)){stats.filtered++;return;}
      try{const row=parseTicker(raw,listed.get(name),receivedAt),prior=rows.get(name);if(prior&&row.eventTime<=prior.eventTime){reject(row.eventTime===prior.eventTime?(JSON.stringify(row.raw)===JSON.stringify(prior.raw)?'duplicate':'same_time_conflict'):'out_of_order');emit();return;}
        rows.set(name,row);observedConnection.set(name,generation);changed.set(name,row);connectionAccepted++;stats.accepted++;lastEventAt=lastEventAt===null?row.eventTime:Math.max(lastEventAt,row.eventTime);lastReceivedAt=receivedAt;dirty=true;emit();
      }catch(e){reject(e.message||'invalid_ticker');emit();}
    }
    function connect(){if(!wanted||socket||blocked||doc?.hidden)return;if(!listed.size){transport='empty';emit(true);return;}if(typeof WS!=='function'){transport='unsupported';emit(true);return;}
      transport='connecting';connectedAt=null;connectionAccepted=0;subscribed=new Set();sent=new Set();nextIndex=0;subscriptionBatchCount=0;lastSubscribeAt=null;pending=null;const token=++generation;dirty=true;emit(true);
      try{socket=new WS(ENDPOINT);}catch(_){fail('connection_constructor');return;}const local=socket;
      connectTimer=schedule(()=>{connectTimer=null;if(token===generation)fail('connection_timeout');},15000);
      local.onopen=()=>{if(token!==generation)return;if(connectTimer!==null){cancel(connectTimer);connectTimer=null;}connectedAt=now();if(sessionStartedAt===null)sessionStartedAt=connectedAt;transport='open';emit(true);nextBatch();};
      local.onmessage=e=>{if(token===generation&&wanted)ingest(e.data);};
      local.onerror=()=>{if(token===generation)fail('socket_error');};
      local.onclose=e=>{if(token!==generation)return;if([1008,1013,4003,4008,4403,4429].includes(e.code)){fail('source_policy_'+e.code);return;}wanted=false;transport='disconnected';blockedReason='socket_closed_'+e.code;closeSocket();dirty=true;emit(true);};
    }
    function start(){if(blocked)return false;if(wanted&&socket)return true;wanted=true;transport=doc?.hidden?'paused':'idle';if(!doc?.hidden)connect();if(wanted&&timer===null)timer=schedule(heartbeat,UPDATE_MS);return true;}
    function stop(){wanted=false;closeSocket();if(!blocked){transport='idle';blockedReason=null;}dirty=true;emit(true);}
    function visibility(){if(!wanted||blocked)return;if(doc.hidden){closeSocket();transport='paused';dirty=true;emit(true);}else{connect();if(wanted&&timer===null)timer=schedule(heartbeat,UPDATE_MS);}}
    function setInstruments(input){const next=instruments(input),same=JSON.stringify([...next.values()])===JSON.stringify([...listed.values()]);if(same)return;const resume=wanted;closeSocket();listed=next;subscribed=new Set();sent=new Set();nextIndex=0;subscriptionBatchCount=0;connectionAccepted=0;for(const key of rows.keys())if(!listed.has(key)){rows.delete(key);observedConnection.delete(key);}changed.clear();dirty=true;if(resume&&!blocked&&!doc?.hidden){connect();if(wanted&&timer===null)timer=schedule(heartbeat,UPDATE_MS);}else emit(true);}
    function destroy(){stop();if(doc?.removeEventListener)doc.removeEventListener('visibilitychange',visibility);}
    if(doc?.addEventListener)doc.addEventListener('visibilitychange',visibility);
    return Object.freeze({start,stop,destroy,setInstruments,snapshot});
  }
  return Object.freeze({ENDPOINT,CHANNEL,STALE_MS,MAX_EVENT_AGE_MS,MAX_FUTURE_MS,UPDATE_MS,BATCH_SIZE,REQUEST_INTERVAL_MS,ACK_TIMEOUT_MS,MAX_INSTRUMENTS,parseTicker,create});
});
