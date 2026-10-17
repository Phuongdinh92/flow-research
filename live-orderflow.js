/* Binance public aggregate trades. No account identity, historical backfill or whale inference.
 * https://github.com/binance/binance-spot-api-docs/blob/master/web-socket-streams.md
 * m=true means buyer is maker, so the aggressor sells. A single aggTrade can contain
 * several fills. Count below is aggregate events, never individual trades or wallets.
 * Decimal input is exact (<=20 fractional digits); products retain up to 40 digits.
 */
(function(root,factory){'use strict';const api=factory();root.FlowLiveOrderFlow=api;if(typeof module==='object'&&module.exports)module.exports=api;})(globalThis,function(){
  'use strict';
  const BASE='wss://data-stream.binance.vision/ws/', SCALE=20, UNIT=10n**20n;
  const WINDOW_MS=30*60*1000,MAX_TRADES=10000,STALE_MS=5000,MAX_FUTURE_MS=2000,MAX_EVENT_AGE_MS=30000;
  function instrument(v){if(typeof v!=='string'||!/^([\p{L}\p{N}_.-]{1,76})USDT$/u.test(v)||v!==v.toUpperCase())throw Error('instrument');return v;}
  function endpoint(v){return BASE+encodeURIComponent(instrument(v).toLowerCase())+'@aggTrade';}
  function decimal(v){if(typeof v!=='string'||v.length>80||!/^\d{1,40}(?:\.\d{1,20})?$/.test(v))throw Error('decimal');const p=v.split('.');const n=BigInt(p[0])*UNIT+BigInt((p[1]||'').padEnd(SCALE,'0'));if(n<=0n)throw Error('positive_decimal');return n;}
  function format(n,scale=SCALE){const sign=n<0n?'-':'';let s=(n<0n?-n:n).toString().padStart(scale+1,'0');if(!scale)return sign+s;const whole=s.slice(0,-scale),fraction=s.slice(-scale).replace(/0+$/,'');return sign+whole+(fraction?'.'+fraction:'');}
  function timestamp(n){if(!Number.isSafeInteger(n)||n<946684800000||n>=4102444800000)throw Error('timestamp');return n;}
  function id(v){if(typeof v==='number'){if(!Number.isSafeInteger(v)||v<0)throw Error('id');return BigInt(v);}if(typeof v==='string'&&/^\d{1,20}$/.test(v))return BigInt(v);throw Error('id');}
  function parseTrade(raw,symbol,receivedAt,options={}){
    instrument(symbol);timestamp(receivedAt);
    if(!raw||typeof raw!=='object'||Array.isArray(raw)||raw.e!=='aggTrade'||raw.s!==symbol||typeof raw.m!=='boolean')throw Error('event_shape');
    const tradeAt=timestamp(raw.T),eventAt=timestamp(raw.E),future=options.maxFutureMs??MAX_FUTURE_MS,age=options.maxEventAgeMs??MAX_EVENT_AGE_MS;
    if(tradeAt>receivedAt+future||eventAt>receivedAt+future)throw Error('future_event');
    if(receivedAt-eventAt>age||receivedAt-tradeAt>age)throw Error('old_event');
    if(tradeAt>eventAt+future)throw Error('event_before_trade');
    const aggregateId=id(raw.a),firstId=id(raw.f),lastId=id(raw.l);if(lastId<firstId)throw Error('fill_range');
    const price=decimal(raw.p),quantity=decimal(raw.q);
    return {aggregateId,firstId,lastId,price,quantity,quote:price*quantity,side:raw.m?'sell':'buy',tradeAt,eventAt,receivedAt,
      raw:Object.freeze({e:raw.e,s:raw.s,a:raw.a,f:raw.f,l:raw.l,p:raw.p,q:raw.q,T:raw.T,E:raw.E,m:raw.m})};
  }
  function automaticWidth(price){const s=format(price),p=s.split('.');let order;if(p[0]!=='0')order=p[0].length-1;else order=-1-(p[1]||'').search(/[1-9]/);const exponent=Math.max(-20,order-3);return exponent>=0?10n**BigInt(exponent)*UNIT:10n**BigInt(SCALE+exponent);}
  function createAccumulator(options={}){
    const symbol=instrument(options.instrument),windowMs=options.windowMs??WINDOW_MS,maxTrades=options.maxTrades??MAX_TRADES;
    if(!Number.isSafeInteger(windowMs)||windowMs<1000||windowMs>WINDOW_MS||!Number.isSafeInteger(maxTrades)||maxTrades<1||maxTrades>MAX_TRADES)throw Error('retention');
    let width=options.priceBinWidth===undefined?null:decimal(options.priceBinWidth),records=[],buy=0n,sell=0n,latestReceivedAt=null,latestTradeAt=null,firstObservedTradeAt=null;
    let startedAt=options.startedAt??null,captureFrom=null,connectionCount=0,evictedIdFloor=-1n,highestId=null;
    const seen=new Map(),active=new Map(),bins=new Map(),gaps=[],dropped={duplicate:0,expired:0,invalid:0,retention:0,outOfOrder:0};
    function addGap(gap){if(gaps.length<200)gaps.push({...gap});else gaps[gaps.length-1]={kind:'additional_gaps',count:(gaps[gaps.length-1].count||1)+1,from:gaps[gaps.length-1].from,to:gap.to??null};}
    function remove(r,kind){active.delete(r.aggregateId.toString());if(r.side==='buy')buy-=r.quote;else sell-=r.quote;const b=bins.get(r.bin);b[r.side]-=r.quote;b.count--;if(!b.count)bins.delete(r.bin);dropped[kind]++;if(kind==='retention'&&r.aggregateId>evictedIdFloor)evictedIdFloor=r.aggregateId;}
    function prune(at){const cutoff=at-windowMs;const kept=[];for(const r of records){if(r.tradeAt<cutoff)remove(r,'expired');else kept.push(r);}records=kept;
      for(const [key,value]of seen)if(value.time<cutoff&&!active.has(key))seen.delete(key);
      if(records.length>maxTrades){records.sort((a,b)=>a.tradeAt-b.tradeAt||(a.aggregateId<b.aggregateId?-1:a.aggregateId>b.aggregateId?1:0));while(records.length>maxTrades)remove(records.shift(),'retention');}
      if(seen.size>maxTrades*2)for(const key of seen.keys()){if(!active.has(key))seen.delete(key);if(seen.size<=maxTrades*2)break;}
    }
    function ingest(raw,receivedAt){let r;try{r=parseTrade(raw,symbol,receivedAt,options);}catch(e){dropped.invalid++;throw e;}
      prune(receivedAt);const key=r.aggregateId.toString(),signature=[r.price,r.quantity,r.side,r.tradeAt,r.firstId,r.lastId].join('|'),previous=active.get(key)||seen.get(key);if(previous){if(previous.signature!==signature){dropped.invalid++;throw Error('conflicting_duplicate_id');}dropped.duplicate++;return false;}
      if(r.aggregateId<=evictedIdFloor){dropped.expired++;addGap({kind:'late_below_retained_id',from:r.tradeAt,to:r.tradeAt,aggregateId:key});return false;}
      if(r.tradeAt<receivedAt-windowMs){dropped.expired++;return false;}
      if(highestId!==null&&r.aggregateId<highestId)dropped.outOfOrder++;
      // A discontinuity is an observation to investigate, not a claim of proven
      // missing fills. Late messages remain accepted and appear in observed IDs.
      if(highestId!==null&&r.aggregateId>highestId+1n)addGap({kind:'aggregate_id_discontinuity',from:latestTradeAt,to:r.tradeAt,afterId:highestId.toString(),beforeId:key,resolution:'unverified'});
      if(highestId===null||r.aggregateId>highestId)highestId=r.aggregateId;
      width=width||automaticWidth(r.price);r.bin=r.price/width;const k=r.bin;
      if(!bins.has(k))bins.set(k,{buy:0n,sell:0n,count:0});const b=bins.get(k);b[r.side]+=r.quote;b.count++;
      if(r.side==='buy')buy+=r.quote;else sell+=r.quote;
      records.push(r);const identity={time:r.tradeAt,signature};active.set(key,identity);seen.set(key,identity);latestReceivedAt=receivedAt;latestTradeAt=latestTradeAt===null?r.tradeAt:Math.max(latestTradeAt,r.tradeAt);firstObservedTradeAt=firstObservedTradeAt===null?r.tradeAt:Math.min(firstObservedTradeAt,r.tradeAt);prune(receivedAt);return true;
    }
    function connected(at){timestamp(at);if(startedAt===null)startedAt=at;if(captureFrom===null)captureFrom=at;connectionCount++;for(const g of gaps)if(g.to===null)g.to=at;}
    function snapshot(at=Date.now()){timestamp(at);prune(at);const sorted=[...records].sort((a,b)=>a.tradeAt-b.tradeAt);return {
      instrument:symbol,sourceId:'binance',stream:symbol.toLowerCase()+'@aggTrade',endpoint:endpoint(symbol),quoteUnit:'USDT',count:records.length,countUnit:'aggregate_trade_events',
      buyQuote:format(buy,40),sellQuote:format(sell,40),deltaQuote:format(buy-sell,40),
      bins:[...bins].sort((a,b)=>a[0]<b[0]?-1:1).map(([k,b])=>({priceFrom:format(k*width),priceTo:format((k+1n)*width),buyQuote:format(b.buy,40),sellQuote:format(b.sell,40),deltaQuote:format(b.buy-b.sell,40),count:b.count})),
      priceBinWidth:width===null?null:format(width),firstTradeAt:sorted[0]?.tradeAt??null,latestTradeAt:sorted.length?sorted[sorted.length-1].tradeAt:null,sourceFirstTradeAt:sorted[0]?.tradeAt??null,
      firstObservedTradeAt,lastObservedTradeAt:latestTradeAt,latestReceivedAt,startedAt,captureFrom,connectionCount,asOf:at,windowMs,maxTrades,
      completeHistory:false,scope:'observed_connection_window',historyBackfilled:false,whaleAttribution:false,retainedFrom:sorted[0]?.tradeAt??null,
      gaps:gaps.map(g=>({...g})),dropped:{...dropped},retentionTruncated:dropped.retention>0||dropped.expired>0,
      observedIds:sorted.map(r=>r.aggregateId.toString()),
      latestRaw:sorted.length?{...sorted[sorted.length-1].raw}:null
    };}
    return Object.freeze({ingest,snapshot,connected,addGap});
  }
  function createController(options={}){
    const now=options.now||(()=>Date.now()),WS=options.WebSocketImpl||globalThis.WebSocket,schedule=options.setTimeoutImpl||options.setTimeout||setTimeout,cancel=options.clearTimeoutImpl||options.clearTimeout||clearTimeout;
    let symbol=instrument(options.instrument),acc=createAccumulator({...options,instrument:symbol}),socket=null,generation=0,wanted=false,blocked=false,status='idle',reason=null,timer=null,connectTimer=null,connectedAt=null,lastState='',lastEmitAt=null,connectionAccepted=0,connectionLastTradeAt=null,connectionLastReceivedAt=null;
    function call(fn,v){if(typeof fn==='function')try{fn(v);}catch(e){if(typeof options.onCallbackError==='function')options.onCallbackError(e);}}
    function state(at,snap){let s=status;if(status==='open')s=connectionAccepted===0?'waiting':at-connectionLastTradeAt<=STALE_MS?'live':'stale';return {status:s,state:s,reason,instrument:symbol,at,connectedAt,connectionAccepted,connectionLastTradeAt,completeHistory:false,scope:'observed_connection_window'};}
    function emit(force=false){const at=now();if(!force&&lastEmitAt!==null&&at-lastEmitAt<1000)return;lastEmitAt=at;const snap=acc.snapshot(at),s=state(at,snap);call(options.onUpdate,snap);const key=s.status+'|'+(s.reason||'');if(force||key!==lastState){lastState=key;call(options.onState,s);}return snap;}
    function closeSocket(){generation++;const old=socket;socket=null;if(connectTimer!==null){cancel(connectTimer);connectTimer=null;}if(old){old.onopen=old.onmessage=old.onerror=old.onclose=null;try{old.close();}catch(_){}}}
    function fail(why){blocked=true;wanted=false;status='blocked';reason=why;acc.addGap({kind:'source_error',from:now(),to:null,reason:why});closeSocket();if(timer!==null){cancel(timer);timer=null;}emit(true);}
    function tick(){timer=null;if(!wanted)return;emit();timer=schedule(tick,1000);}
    function start(){if(wanted||blocked)return false;if(typeof WS!=='function'){fail('websocket_unavailable');return false;}wanted=true;status='connecting';reason=null;connectionAccepted=0;connectionLastTradeAt=null;connectionLastReceivedAt=null;const token=++generation;let local;
      try{local=new WS(endpoint(symbol));socket=local;}catch(_){fail('connection_constructor');return false;}
      connectTimer=schedule(()=>{if(token===generation)fail('connection_timeout');},15000);
      local.onopen=()=>{if(token!==generation)return;if(connectTimer!==null){cancel(connectTimer);connectTimer=null;}connectedAt=now();acc.connected(connectedAt);status='open';emit(true);};
      local.onmessage=event=>{if(token!==generation||!wanted)return;if(typeof event.data!=='string'||event.data.length>10000){fail('invalid_frame');return;}let raw;try{raw=JSON.parse(event.data);if(raw&&typeof raw==='object'&&('code'in raw||'error'in raw))throw Error('source_error');const receivedAt=now();if(acc.ingest(raw,receivedAt)){connectionAccepted++;connectionLastTradeAt=connectionLastTradeAt===null?raw.T:Math.max(connectionLastTradeAt,raw.T);connectionLastReceivedAt=receivedAt;}}catch(e){fail('invalid_source_'+e.message);return;}emit();};
      local.onerror=()=>{if(token===generation)fail('websocket_error');};
      local.onclose=event=>{if(token!==generation)return;wanted=false;status='disconnected';reason='connection_closed_'+(event?.code??'unknown');acc.addGap({kind:'connection_closed',from:connectionLastReceivedAt??connectedAt??now(),detectedAt:now(),to:null,code:event?.code??null});closeSocket();if(timer!==null){cancel(timer);timer=null;}emit(true);};
      timer=schedule(tick,1000);emit(true);return true;
    }
    function stop(){if(wanted||socket){acc.addGap({kind:'paused',from:now(),to:null});}wanted=false;closeSocket();if(timer!==null){cancel(timer);timer=null;}if(!blocked){status='stopped';reason=null;}emit(true);}
    function setInstrument(next){next=instrument(next);if(next===symbol)return;const resume=wanted;stop();symbol=next;acc=createAccumulator({...options,instrument:symbol});connectedAt=null;lastState='';if(!blocked){status='idle';reason=null;}emit(true);if(resume&&!blocked)start();}
    return Object.freeze({start,stop,destroy:stop,setInstrument,snapshot:()=>acc.snapshot(now()),state:()=>state(now(),acc.snapshot(now()))});
  }
  return Object.freeze({BASE,WINDOW_MS,MAX_TRADES,STALE_MS,MAX_FUTURE_MS,MAX_EVENT_AGE_MS,endpoint,parseTrade,createAccumulator,createController});
});
