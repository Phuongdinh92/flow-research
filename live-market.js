/* Public Binance market-data stream. No account data, orders or synthetic ticks.
 * Official specification (checked 2026-10-17):
 * https://github.com/binance/binance-spot-api-docs/blob/master/web-socket-streams.md
 * !miniTicker@arr sends changed symbols every 1000 ms. A frame is NOT a census.
 * Return = last/open - 1 for the source's rolling 24-hour mini-ticker window.
 * The current specification does not list the former !ticker@arr stream.
 */
(function(root,factory){'use strict';const api=factory();root.FlowLiveMarket=api;if(typeof module==='object'&&module.exports)module.exports=api;})(globalThis,function(){
  'use strict';
  const ENDPOINT='wss://data-stream.binance.vision/ws/!miniTicker@arr';
  const STALE_MS=5000,MAX_EVENT_AGE_MS=15000,MAX_FUTURE_MS=2000,UPDATE_MS=1000;
  const MIN_TIMESTAMP=946684800000,MAX_TIMESTAMP=4102444800000;
  function timestamp(n){if(!Number.isSafeInteger(n)||n<MIN_TIMESTAMP||n>=MAX_TIMESTAMP)throw Error('timestamp');return n;}
  function decimal(v,positive=false){if(typeof v!=='string'||v.length>100||!/^\d+(?:\.\d+)?$/.test(v))throw Error('decimal');const n=Number(v);if(!Number.isFinite(n)||n<0||(positive&&n<=0))throw Error('decimal');return n;}
  function identifier(v){return typeof v==='string'&&/^[\p{L}\p{N}_.-]{1,80}$/u.test(v);}
  function instruments(input){if(!Array.isArray(input)||input.length>10000)throw Error('instruments');const out=new Map();for(const x of input){if(!x||!identifier(x.instrument)||!identifier(x.base)||x.quote!=='USDT'||x.instrument!==x.base+'USDT'||(x.sourceId&&x.sourceId!=='binance')||out.has(x.instrument))throw Error('instrument');out.set(x.instrument,Object.freeze({instrument:x.instrument,base:x.base,quote:'USDT'}));}return out;}
  function parseTicker(raw,meta,receivedAt,{maxEventAgeMs=MAX_EVENT_AGE_MS,maxFutureMs=MAX_FUTURE_MS}={}){
    timestamp(receivedAt);
    if(!meta||!identifier(meta.instrument)||!identifier(meta.base)||meta.quote!=='USDT'||meta.instrument!==meta.base+'USDT')throw Error('instrument');
    if(!raw||typeof raw!=='object'||Array.isArray(raw)||raw.e!=='24hrMiniTicker'||raw.s!==meta.instrument)throw Error('event_shape');
    const eventTime=timestamp(raw.E);if(eventTime>receivedAt+maxFutureMs)throw Error('future_event');if(receivedAt-eventTime>maxEventAgeMs)throw Error('old_event');
    const last=decimal(raw.c,true),open=decimal(raw.o,true),high=decimal(raw.h,true),low=decimal(raw.l,true),volume24=decimal(raw.v),turnover24=decimal(raw.q);
    const tolerance=Math.max(high,last,open)*1e-12;
    if(high+tolerance<Math.max(open,last,low)||low-tolerance>Math.min(open,last,high))throw Error('ohlc');
    if((volume24===0)!==(turnover24===0))throw Error('volume');
    const return24=last/open-1;if(!Number.isFinite(return24)||return24< -1)throw Error('return');
    return Object.freeze({key:'binance:'+meta.instrument,sourceId:'binance',...meta,last,open,high,low,volume24,turnover24,return24,asOf:eventTime,eventTime,sourceEventAt:eventTime,lastTradeAt:null,receivedAt,fetchedAt:receivedAt,timestampKind:'source_event',mode:'stream',window:'rolling24h',returnMethod:'mini_ticker_last_div_open_minus_one',sourceStream:'!miniTicker@arr',raw:Object.freeze({e:raw.e,E:raw.E,s:raw.s,c:raw.c,o:raw.o,h:raw.h,l:raw.l,v:raw.v,q:raw.q})});
  }
  function create(options={}){
    let listed=instruments(options.instruments||[]),rows=new Map(),observedConnection=new Map(),socket=null,generation=0,wanted=false,transport='idle',connectedAt=null,lastFrameAt=null,lastEventAt=null,lastReceivedAt=null,nextRetryAt=null,retry=0,timer=null,connectTimer=null,reconnectTimer=null,lastEmit=0,changed=new Map(),dirty=false,blockedReason=null,sessionStartedAt=null,connectionAccepted=0,lastFreshCount=-1;
    const now=options.now||(()=>Date.now()),schedule=options.setTimeout||setTimeout,cancel=options.clearTimeout||clearTimeout,WS=options.WebSocketImpl||globalThis.WebSocket,doc=options.document===undefined?(typeof document==='object'?document:null):options.document;
    const stats={frames:0,accepted:0,rejected:0,filtered:0,reconnects:0,rejectionReasons:{}};
    const notify=(fn,value)=>{if(typeof fn==='function')try{fn(value);}catch(e){if(typeof options.onCallbackError==='function')options.onCallbackError(e);}};
    function reject(reason,count=1){stats.rejected+=count;stats.rejectionReasons[reason]=(stats.rejectionReasons[reason]||0)+count;dirty=true;}
    function status(at=now()){
      const current=[...rows.values()],fresh=current.filter(r=>observedConnection.get(r.instrument)===generation&&at-r.eventTime<=STALE_MS&&r.eventTime<=at+MAX_FUTURE_MS),frameFresh=connectionAccepted>0&&lastReceivedAt!==null&&at-lastReceivedAt<=STALE_MS&&lastEventAt<=at+MAX_FUTURE_MS;
      let state=transport;if(transport==='open')state=frameFresh&&fresh.length?'live':connectionAccepted===0?'waiting':'stale';
      return {state,endpoint:ENDPOINT,sourceId:'binance',stream:'!miniTicker@arr',window:'rolling24h',eventTimeMeaning:'ticker_generated_not_last_trade',lastTradeTimeAvailable:false,updateMs:UPDATE_MS,staleMs:STALE_MS,expectedCount:listed.size,observedCount:rows.size,freshCount:transport==='open'?fresh.length:0,connectedAt,lastFrameAt,lastEventAt,lastReceivedAt,sessionStartedAt,nextRetryAt,blockedReason,...stats,rejectionReasons:{...stats.rejectionReasons}};
    }
    function snapshot(){const at=now();return {rows:[...rows.values()].map(r=>({...r,stale:transport!=='open'||observedConnection.get(r.instrument)!==generation||at-r.eventTime>STALE_MS||r.eventTime>at+MAX_FUTURE_MS})),status:status(at)};}
    function emit(force=false){const at=now();if(!force&&at-lastEmit<UPDATE_MS)return;lastEmit=at;const snap=snapshot();notify(options.onStatus,snap.status);if(dirty||changed.size||snap.status.freshCount!==lastFreshCount){lastFreshCount=snap.status.freshCount;const updated=[...changed.values()];changed.clear();dirty=false;notify(options.onUpdate,{...snap,changedRows:updated});}}
    function heartbeat(){timer=null;if(!wanted)return;emit();timer=schedule(heartbeat,UPDATE_MS);}
    function clear(which){if(which!==null)cancel(which);}
    function closeSocket(){generation++;const s=socket;socket=null;clear(connectTimer);connectTimer=null;if(s){s.onopen=s.onmessage=s.onerror=s.onclose=null;try{s.close(1000,'Local lifecycle');}catch{}}}
    function terminal(reason){blockedReason=reason;transport='blocked';nextRetryAt=null;clear(reconnectTimer);reconnectTimer=null;closeSocket();emit(true);}
    function reconnect(reason){
      closeSocket();if(!wanted||doc?.hidden){transport=doc?.hidden?'paused':'idle';emit(true);return;}
      // No speculative reconnect loop on an initial access failure. A browser
      // cannot distinguish HTTP policy/region rejection from a network failure.
      if(!sessionStartedAt){terminal(reason||'initial_connection_failed');return;}
      if(retry>=8){terminal('reconnect_limit');return;}
      const delay=Math.min(60000,2000*2**retry++);nextRetryAt=now()+delay;transport='disconnected';dirty=true;emit(true);
      reconnectTimer=schedule(()=>{reconnectTimer=null;nextRetryAt=null;connect();},delay);
    }
    function ingest(data,receivedAt=now()){
      let payload;try{if(typeof data!=='string'||data.length>4000000)throw Error('frame_size');payload=JSON.parse(data);}catch(e){reject(e.message==='frame_size'?'frame_size':'json');return [];}
      if(payload&&payload.e==='serverShutdown'){reconnect('server_shutdown');return [];}
      if(!Array.isArray(payload)||payload.length>20000){reject('frame_shape');return [];}
      stats.frames++;lastFrameAt=receivedAt;const seen=new Set(),dupes=new Set(),accepted=[];
      for(const x of payload){if(x&&listed.has(x.s)){if(seen.has(x.s))dupes.add(x.s);seen.add(x.s);}}
      for(const x of payload){
        if(!x||!listed.has(x.s)){stats.filtered++;continue;}
        if(dupes.has(x.s)){reject('frame_duplicate');continue;}
        try{
          const row=parseTicker(x,listed.get(x.s),receivedAt),prior=rows.get(row.instrument);
          if(prior&&row.eventTime<=prior.eventTime){reject(row.eventTime===prior.eventTime?(JSON.stringify(row.raw)===JSON.stringify(prior.raw)?'duplicate':'same_time_conflict'):'out_of_order');continue;}
          rows.set(row.instrument,row);observedConnection.set(row.instrument,generation);changed.set(row.instrument,row);accepted.push(row);stats.accepted++;connectionAccepted++;lastEventAt=lastEventAt===null?row.eventTime:Math.max(lastEventAt,row.eventTime);lastReceivedAt=receivedAt;dirty=true;
        }catch(e){reject(e.message||'invalid');}
      }
      emit();return accepted;
    }
    function connect(){
      if(!wanted||socket||doc?.hidden)return;
      if(!listed.size){transport='empty';emit(true);return;}
      if(typeof WS!=='function'){transport='unsupported';emit(true);return;}
      transport='connecting';blockedReason=null;nextRetryAt=null;connectionAccepted=0;emit(true);const current=++generation;
      try{socket=new WS(ENDPOINT);}catch{reconnect('socket_constructor_failed');return;}
      const s=socket;
      connectTimer=schedule(()=>{if(current===generation)reconnect('connection_timeout');},15000);
      s.onopen=()=>{if(current!==generation)return;clear(connectTimer);connectTimer=null;transport='open';connectedAt=now();if(sessionStartedAt!==null)stats.reconnects++;sessionStartedAt=connectedAt;emit(true);};
      s.onmessage=event=>{if(current!==generation)return;ingest(event.data);};
      s.onerror=()=>{if(current!==generation)return;reconnect('socket_error');};
      s.onclose=event=>{if(current!==generation)return;if([1008,4003,4008].includes(event.code)){terminal('source_policy_'+event.code);return;}reconnect('socket_closed_'+event.code);};
      // Browsers automatically answer protocol ping frames. Sending textual
      // "ping" would be a different application message and is not required.
    }
    function start(){if(wanted&&socket)return;wanted=true;blockedReason=null;retry=0;transport=doc?.hidden?'paused':'idle';if(timer===null)timer=schedule(heartbeat,UPDATE_MS);if(!doc?.hidden)connect();else emit(true);}
    function stop(){wanted=false;clear(timer);timer=null;clear(reconnectTimer);reconnectTimer=null;nextRetryAt=null;closeSocket();transport='idle';dirty=true;emit(true);}
    function visibility(){if(!wanted)return;if(doc.hidden){clear(reconnectTimer);reconnectTimer=null;nextRetryAt=null;closeSocket();transport='paused';dirty=true;emit(true);}else connect();}
    if(doc?.addEventListener)doc.addEventListener('visibilitychange',visibility);
    function setInstruments(input){const next=instruments(input);listed=next;for(const key of rows.keys())if(!listed.has(key)){rows.delete(key);observedConnection.delete(key);}for(const key of changed.keys())if(!listed.has(key))changed.delete(key);dirty=true;if(wanted&&!socket&&!doc?.hidden&&transport==='empty')connect();emit(true);}
    function destroy(){stop();if(doc?.removeEventListener)doc.removeEventListener('visibilitychange',visibility);}
    return Object.freeze({start,stop,destroy,snapshot,setInstruments});
  }
  return Object.freeze({ENDPOINT,STALE_MS,MAX_EVENT_AGE_MS,MAX_FUTURE_MS,UPDATE_MS,parseTicker,create});
});
