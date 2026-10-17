/* Bitget public UTA spot ticker, explicitly bounded to a selected instrument set.
 * https://www.bitget.com/docs/uta/websocket/public/Tickers-Channel
 * https://www.bitget.com/docs/uta/quick-start
 * A source ticker timestamp is not a last-trade timestamp. price24hPcnt is kept
 * as the provider's fraction; it is never silently recomputed from openPrice24h.
 * One socket, fewer than 50 channels, and at least 16 seconds between subscribes.
 */
(function(root,factory){'use strict';const api=factory();root.FlowLiveBitget=api;if(typeof module==='object'&&module.exports)module.exports=api;})(globalThis,function(){
 'use strict';
 const ENDPOINT='wss://ws.bitget.com/v3/ws/public',MAX_CHANNELS=49,STALE_MS=5000,MAX_EVENT_AGE_MS=15000,MAX_FUTURE_MS=2000,UPDATE_MS=1000,SUBSCRIBE_INTERVAL_MS=16000,PING_MS=30000,PONG_TIMEOUT_MS=10000;
 const timestamp=v=>{if(!Number.isSafeInteger(v)||v<946684800000||v>=4102444800000)throw Error('timestamp');return v;};
 const identifier=v=>typeof v==='string'&&/^[\p{L}\p{N}_.-]{1,80}$/u.test(v);
 function decimal(v,{positive=false,signed=false}={}){if(typeof v!=='string'||v.length>100||!(signed?/^-?\d+(?:\.\d+)?$/:/^\d+(?:\.\d+)?$/).test(v))throw Error('decimal');const n=Number(v);if(!Number.isFinite(n)||(!signed&&n<0)||(positive&&n<=0))throw Error('decimal');return n;}
 function instruments(input){if(!Array.isArray(input)||input.length>MAX_CHANNELS)throw Error('selected_instruments_max_'+MAX_CHANNELS);const out=new Map();for(const x of input){if(!x||!identifier(x.instrument)||!identifier(x.base)||x.quote!=='USDT'||x.instrument!==x.base+'USDT'||(x.sourceId&&x.sourceId!=='bitget')||out.has(x.instrument))throw Error('instrument');out.set(x.instrument,Object.freeze({instrument:x.instrument,base:x.base,quote:'USDT'}));}return out;}
 function parseTicker(message,meta,receivedAt){
  timestamp(receivedAt);if(!meta||!identifier(meta.instrument)||!identifier(meta.base)||meta.quote!=='USDT'||meta.instrument!==meta.base+'USDT'||(meta.sourceId&&meta.sourceId!=='bitget'))throw Error('instrument');
  if(!message||typeof message!=='object'||Array.isArray(message)||message.action!=='snapshot'||message.arg?.instType!=='spot'||message.arg?.topic!=='ticker'||message.arg?.symbol!==meta.instrument||!Array.isArray(message.data)||message.data.length!==1)throw Error('event_shape');
  const eventTime=timestamp(message.ts);if(eventTime>receivedAt+MAX_FUTURE_MS)throw Error('future_event');if(receivedAt-eventTime>MAX_EVENT_AGE_MS)throw Error('old_event');
  const raw=message.data[0];if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('event_shape');
  const last=decimal(raw.lastPrice,{positive:true}),high=decimal(raw.highPrice24h,{positive:true}),low=decimal(raw.lowPrice24h,{positive:true}),sourceOpen=decimal(raw.openPrice24h),volume24=decimal(raw.volume24h),turnover24=decimal(raw.turnover24h),return24=decimal(raw.price24hPcnt,{signed:true});
  if(return24< -1)throw Error('return');const tolerance=Math.max(high,last)*1e-12;if(high+tolerance<Math.max(last,low)||low-tolerance>Math.min(last,high))throw Error('ohlc');if((volume24===0)!==(turnover24===0))throw Error('volume');
  const open=sourceOpen>0?sourceOpen:null,openImpliedReturn24=open===null?null:last/open-1,returnOpenMismatch=openImpliedReturn24!==null&&Math.abs(openImpliedReturn24-return24)>.00002;
  return Object.freeze({key:'bitget:'+meta.instrument,sourceId:'bitget',instrument:meta.instrument,base:meta.base,quote:'USDT',last,open,high,low,volume24,turnover24,return24,openImpliedReturn24,returnOpenMismatch,asOf:eventTime,eventTime,sourceEventAt:eventTime,lastTradeAt:null,receivedAt,fetchedAt:receivedAt,timestampKind:'source_event',mode:'stream',window:'provider24h',returnMethod:'provider_price24hPcnt',sourceStream:'spot:ticker',raw:Object.freeze({ts:message.ts,action:message.action,arg:Object.freeze({...message.arg}),data:Object.freeze({...raw})})});
 }
 function create(options={}){
  let listed=instruments(options.instruments||[]),rows=new Map(),observedConnection=new Map(),changed=new Map(),socket=null,generation=0,wanted=false,transport='idle',connectedAt=null,lastFrameAt=null,lastEventAt=null,lastReceivedAt=null,sessionStartedAt=null,lastSubscribedAt=null,nextSubscribeAt=null,lastPingAt=null,pongDueAt=null,blockedReason=null,timer=null,connectTimer=null,scopeTimer=null,lastEmit=0,dirty=false,connectionAccepted=0,lastFreshCount=-1;
  const now=options.now||(()=>Date.now()),schedule=options.setTimeout||setTimeout,cancel=options.clearTimeout||clearTimeout,WS=options.WebSocketImpl||globalThis.WebSocket,doc=options.document===undefined?(typeof document==='object'?document:null):options.document;
  const stats={frames:0,accepted:0,rejected:0,filtered:0,reconnects:0,subscribeRequests:0,rejectionReasons:{}};
  const notify=(fn,value)=>{if(typeof fn==='function')try{fn(value);}catch(e){if(typeof options.onCallbackError==='function')options.onCallbackError(e);}};
  const clear=id=>{if(id!==null)cancel(id);};
  function reject(reason){stats.rejected++;stats.rejectionReasons[reason]=(stats.rejectionReasons[reason]||0)+1;dirty=true;}
  function fresh(row,at){return transport==='open'&&observedConnection.get(row.instrument)===generation&&at-row.eventTime<=STALE_MS&&row.eventTime<=at+MAX_FUTURE_MS;}
  function status(at=now()){const freshCount=[...rows.values()].filter(r=>fresh(r,at)).length;let state=transport;if(transport==='open')state=freshCount?'live':connectionAccepted?'stale':'waiting';return {state,sourceId:'bitget',endpoint:ENDPOINT,stream:'spot:ticker',scope:'selected_instruments',maxChannels:MAX_CHANNELS,window:'provider24h',eventTimeMeaning:'ticker_generated_not_last_trade',lastTradeTimeAvailable:false,updateMs:200,renderUpdateMs:UPDATE_MS,staleMs:STALE_MS,expectedCount:listed.size,selectedCount:listed.size,observedCount:rows.size,freshCount,connectedAt,lastFrameAt,lastEventAt,lastReceivedAt,sessionStartedAt,nextRetryAt:null,nextSubscribeAt,blockedReason,...stats,rejectionReasons:{...stats.rejectionReasons}};}
  function snapshot(){const at=now();return {rows:[...rows.values()].map(r=>({...r,stale:!fresh(r,at)})),status:status(at)};}
  function emit(force=false){const at=now();if(!force&&at-lastEmit<UPDATE_MS)return;lastEmit=at;const snap=snapshot();notify(options.onStatus,snap.status);if(dirty||changed.size||snap.status.freshCount!==lastFreshCount){lastFreshCount=snap.status.freshCount;const updated=[...changed.values()];changed.clear();dirty=false;notify(options.onUpdate,{...snap,changedRows:updated});}}
  function closeSocket(){generation++;clear(connectTimer);connectTimer=null;const old=socket;socket=null;pongDueAt=null;lastPingAt=null;if(old){old.onopen=old.onmessage=old.onerror=old.onclose=null;try{old.close(1000,'Local lifecycle');}catch{}}}
  function terminal(reason){blockedReason=reason;clear(scopeTimer);scopeTimer=null;nextSubscribeAt=null;closeSocket();transport='blocked';dirty=true;emit(true);}
  function send(message){try{socket.send(message);return true;}catch{terminal('socket_send_failed');return false;}}
  function ingest(data,receivedAt=now()){
   if(data==='pong'){pongDueAt=null;return;}
   let payload;try{if(typeof data!=='string'||data.length>1000000)throw Error('frame_size');payload=JSON.parse(data);}catch(e){reject(e.message==='frame_size'?'frame_size':'json');return;}
   if(payload?.event==='error'||(payload?.code&&String(payload.code)!=='0')){terminal('source_error_'+String(payload.code||'unknown'));return;}
   if(payload?.event==='subscribe')return;
   if(!payload||typeof payload!=='object'||Array.isArray(payload)){reject('frame_shape');return;}
   stats.frames++;lastFrameAt=receivedAt;const symbol=payload.arg?.symbol;if(!listed.has(symbol)){stats.filtered++;return;}
   try{const row=parseTicker(payload,listed.get(symbol),receivedAt),prior=rows.get(symbol);if(prior&&row.eventTime<=prior.eventTime){reject(row.eventTime===prior.eventTime?(JSON.stringify(row.raw)===JSON.stringify(prior.raw)?'duplicate':'same_time_conflict'):'out_of_order');return;}rows.set(symbol,row);observedConnection.set(symbol,generation);changed.set(symbol,row);stats.accepted++;connectionAccepted++;lastEventAt=lastEventAt===null?row.eventTime:Math.max(lastEventAt,row.eventTime);lastReceivedAt=receivedAt;dirty=true;}catch(e){reject(e.message||'invalid');}emit();
  }
  function heartbeat(){timer=null;if(!wanted)return;if(transport==='open'){const at=now();if(pongDueAt!==null&&at>=pongDueAt)terminal('pong_timeout');else if(lastPingAt!==null&&at-lastPingAt>=PING_MS){if(send('ping')){lastPingAt=at;pongDueAt=at+PONG_TIMEOUT_MS;}}}emit();timer=schedule(heartbeat,UPDATE_MS);}
  function connect(){
   if(!wanted||socket||doc?.hidden||blockedReason)return;if(!listed.size){transport='empty';emit(true);return;}if(typeof WS!=='function'){transport='unsupported';emit(true);return;}
   const at=now();if(lastSubscribedAt!==null&&at-lastSubscribedAt<SUBSCRIBE_INTERVAL_MS){nextSubscribeAt=lastSubscribedAt+SUBSCRIBE_INTERVAL_MS;transport='subscription_scheduled';clear(scopeTimer);scopeTimer=schedule(()=>{scopeTimer=null;nextSubscribeAt=null;connect();},nextSubscribeAt-at);emit(true);return;}
   transport='connecting';nextSubscribeAt=null;connectionAccepted=0;emit(true);const current=++generation;try{socket=new WS(ENDPOINT);}catch{terminal('socket_constructor_failed');return;}const s=socket;
   connectTimer=schedule(()=>{if(current===generation)terminal('connection_timeout');},15000);
   s.onopen=()=>{if(current!==generation)return;clear(connectTimer);connectTimer=null;transport='open';connectedAt=now();lastPingAt=connectedAt;if(sessionStartedAt!==null)stats.reconnects++;sessionStartedAt=sessionStartedAt??connectedAt;const request={op:'subscribe',args:[...listed.keys()].map(symbol=>({instType:'spot',topic:'ticker',symbol}))};if(send(JSON.stringify(request))){lastSubscribedAt=now();stats.subscribeRequests++;}emit(true);};
   s.onmessage=event=>{if(current===generation)ingest(event.data);};s.onerror=()=>{if(current===generation)terminal('socket_error');};s.onclose=event=>{if(current===generation)terminal('socket_closed_'+event.code);};
  }
  function start(){if(wanted&&socket)return;wanted=true;if(timer===null)timer=schedule(heartbeat,UPDATE_MS);if(blockedReason){transport='blocked';emit(true);return;}transport=doc?.hidden?'paused':'idle';if(!doc?.hidden)connect();else emit(true);}
  function stop(){wanted=false;clear(timer);timer=null;clear(scopeTimer);scopeTimer=null;nextSubscribeAt=null;closeSocket();transport=blockedReason?'blocked':'idle';dirty=true;emit(true);}
  function setInstruments(input){const next=instruments(input),same=next.size===listed.size&&[...next.keys()].every(k=>listed.has(k));listed=next;for(const key of rows.keys())if(!listed.has(key)){rows.delete(key);observedConnection.delete(key);}for(const key of changed.keys())if(!listed.has(key))changed.delete(key);if(!same){closeSocket();clear(scopeTimer);scopeTimer=null;nextSubscribeAt=null;dirty=true;if(wanted&&!doc?.hidden&&!blockedReason)connect();else emit(true);}}
  function visibility(){if(!wanted||blockedReason)return;if(doc.hidden){clear(scopeTimer);scopeTimer=null;nextSubscribeAt=null;closeSocket();transport='paused';dirty=true;emit(true);}else connect();}
  if(doc?.addEventListener)doc.addEventListener('visibilitychange',visibility);
  function destroy(){stop();if(doc?.removeEventListener)doc.removeEventListener('visibilitychange',visibility);}
  return Object.freeze({start,stop,setInstruments,snapshot,destroy});
 }
 return Object.freeze({ENDPOINT,MAX_CHANNELS,STALE_MS,MAX_EVENT_AGE_MS,MAX_FUTURE_MS,UPDATE_MS,SUBSCRIBE_INTERVAL_MS,PING_MS,PONG_TIMEOUT_MS,parseTicker,create});
});
