/* Binance native UTC daily kline stream, isolated from closed research inputs.
 * Official specification checked 2026-10-17:
 * https://github.com/binance/binance-spot-api-docs/blob/master/web-socket-streams.md#klinecandlestick-streams-for-utc
 * https://github.com/binance/binance-spot-api-docs/blob/master/faqs/market_data_only.md
 * 1d updates are source cumulative candles every 2000 ms, not rolling miniTicker OHLC.
 */
(function(root,factory){'use strict';const api=factory();root.FlowLiveCandle=api;if(typeof module==='object'&&module.exports)module.exports=api;})(globalThis,function(){
 'use strict';
 const DAY=86400000,BASE='wss://data-stream.binance.vision/ws/',UPDATE_MS=2000,MAX_SESSION_BARS=31,STALE_MS=7000,MAX_EVENT_AGE_MS=15000,MAX_FUTURE_MS=2000,SCALE=20,UNIT=10n**20n;
 const finite=n=>typeof n==='number'&&Number.isFinite(n);
 function instrument(value){if(typeof value!=='string'||!/^([\p{L}\p{N}_.-]{1,76})USDT$/u.test(value)||value!==value.toUpperCase())throw Error('instrument');return value;}
 function endpoint(value){return BASE+encodeURIComponent(instrument(value).toLowerCase())+'@kline_1d';}
 function timestamp(value){if(!Number.isSafeInteger(value)||value<946684800000||value>=4102444800000)throw Error('timestamp');return value;}
 function decimal(value,positive=false){if(typeof value!=='string'||!/^\d{1,40}(?:\.\d{1,20})?$/.test(value))throw Error('decimal');const parts=value.split('.'),exact=BigInt(parts[0])*UNIT+BigInt((parts[1]||'').padEnd(SCALE,'0')),number=Number(value);if(!finite(number)||exact<0n||positive&&exact<=0n)throw Error('decimal');return {exact,number};}
 function parseKline(raw,symbol,receivedAt,options={}){
  instrument(symbol);timestamp(receivedAt);if(!raw||typeof raw!=='object'||Array.isArray(raw)||raw.e!=='kline'||raw.s!==symbol||!raw.k||typeof raw.k!=='object'||raw.k.s!==symbol||raw.k.i!=='1d'||typeof raw.k.x!=='boolean')throw Error('event_shape');
  const k=raw.k,eventTime=timestamp(raw.E),time=timestamp(k.t),end=timestamp(k.T),future=options.maxFutureMs??MAX_FUTURE_MS,age=options.maxEventAgeMs??MAX_EVENT_AGE_MS,utcDay=Math.floor(receivedAt/DAY)*DAY;
  if(time%DAY||end!==time+DAY-1)throw Error('utc_day');if(eventTime>receivedAt+future)throw Error('future_event');if(receivedAt-eventTime>age)throw Error('old_event');if(eventTime<time)throw Error('event_before_open');
  if(k.x){if(eventTime<end||end>receivedAt+future||time!==utcDay&&!(time===utcDay-DAY&&receivedAt-end<=age))throw Error('closed_time');}
  else if(time!==utcDay||eventTime>end+future)throw Error('current_utc_day');
  const values={};for(const key of ['o','c','h','l','v','q','V','Q'])values[key]=decimal(k[key],['o','c','h','l'].includes(key));
  if(values.h.exact<values.o.exact||values.h.exact<values.c.exact||values.h.exact<values.l.exact||values.l.exact>values.o.exact||values.l.exact>values.c.exact)throw Error('ohlc');
  if(values.V.exact>values.v.exact||values.Q.exact>values.q.exact||(values.v.exact===0n)!==(values.q.exact===0n))throw Error('volume');
  if(!Number.isSafeInteger(k.n)||k.n<0||!Number.isSafeInteger(k.f)||!Number.isSafeInteger(k.L)||k.f< -1||k.L< -1||k.n>0&&(k.f<0||k.L<k.f||k.n>k.L-k.f+1)||k.n===0&&(values.v.exact!==0n||values.q.exact!==0n)||k.n>0&&values.v.exact===0n)throw Error('trade_count');
  return Object.freeze({key:'binance:'+symbol,sourceId:'binance',instrument:symbol,quoteUnit:'USDT',interval:'1d',time,end,open:values.o.number,close:values.c.number,high:values.h.number,low:values.l.number,volume:values.v.number,quote:values.q.number,buy:values.Q.number,takerBuyBase:values.V.number,tradeCount:k.n,firstTradeId:k.f,lastTradeId:k.L,closed:k.x,provisional:!k.x,eventTime,sourceEventAt:eventTime,receivedAt,lastTradeAt:null,sourceStream:symbol.toLowerCase()+'@kline_1d',timestampKind:'source_kline_event_not_last_trade',raw:Object.freeze({e:raw.e,E:raw.E,s:raw.s,k:Object.freeze({...k})})});
 }
 function projectDaily(closedSeries,bar,symbol,now=Date.now(),sessionClosed=[]){
  const series=Array.isArray(closedSeries)?closedSeries.slice():[];let sessionClosedCount=0,sessionClosedLastAt=null;
  const result=(reason,extra={})=>({series,appended:false,reason,sessionClosedCount,sessionClosedLastAt,researchEligible:false,...extra});
  const point=(native,session=false)=>{const last=series.at(-1);return {...native,ema50:finite(last.ema50)?last.ema50+2/51*(native.close-last.ema50):null,ema200:finite(last.ema200)?last.ema200+2/201*(native.close-last.ema200):null,sma20:null,sell:null,delta:null,cvd:null,candidateAtClose:null,sourceSessionClosed:session,researchEligible:false};};
  if(!series.length)return result('no_closed_history');
  if(!Array.isArray(sessionClosed)||sessionClosed.length>MAX_SESSION_BARS)return result('invalid_session_history');
  const seen=new Set();for(const native of sessionClosed.slice().sort((a,b)=>a.time-b.time)){
   if(!native||!['time','end','eventTime','receivedAt'].every(key=>Number.isSafeInteger(native[key]))||!['open','high','low','close','volume','quote','buy','takerBuyBase'].every(key=>finite(native[key]))||native.sourceId!=='binance'||native.instrument!==symbol||native.key!=='binance:'+symbol||native.interval!=='1d'||!native.closed||native.provisional||native.time%DAY||native.end!==native.time+DAY-1||native.eventTime<native.end||native.eventTime>now+MAX_FUTURE_MS||seen.has(native.time))return result('invalid_session_history');seen.add(native.time);
   if(native.end>=now||native.end<=series.at(-1).end)continue;
   if(series.at(-1).end+1!==native.time)return result('history_gap',{missingDays:Math.max(0,Math.round((native.time-series.at(-1).end-1)/DAY))});
   series.push(point(native,true));sessionClosedCount++;sessionClosedLastAt=native.end;
  }
  if(!bar)return result('waiting_for_native_kline');
  if(bar.sourceId!=='binance'||bar.instrument!==symbol||bar.key!=='binance:'+symbol||bar.interval!=='1d')return result('identity');
  if(bar.closed||!bar.provisional)return result('awaiting_next_forming_candle');
  if(bar.time!==Math.floor(now/DAY)*DAY||bar.end!==bar.time+DAY-1||bar.eventTime>now+MAX_FUTURE_MS)return result('current_utc_day');
  const last=series.at(-1);if(last.end+1!==bar.time)return result('history_gap',{missingDays:Math.max(0,Math.round((bar.time-last.end-1)/DAY))});
  const provisional=point(bar);series.push(provisional);return {series,bar:provisional,appended:true,reason:null,sessionClosedCount,sessionClosedLastAt,stale:now-bar.eventTime>STALE_MS,emaMethod:'last_closed_ema_plus_alpha_times_live_close_minus_last_closed_ema',researchEligible:false};
 }
 function create(options={}){
  const sessionClosed=new Map();
  let symbol=instrument(options.instrument),socket=null,generation=0,observedGeneration=null,wanted=false,blockedReason=null,transport='idle',bar=null,connectedAt=null,lastReceivedAt=null,connectTimer=null,timer=null,reconnectTimer=null,retry=0,everAccepted=false,lastPublishedState='';
  const now=options.now||(()=>Date.now()),schedule=options.setTimeout||setTimeout,cancel=options.clearTimeout||clearTimeout,WS=options.WebSocketImpl||globalThis.WebSocket,stats={accepted:0,rejected:0,duplicates:0,reconnects:0,rejectionReasons:{}};
  const notify=(fn,value)=>{if(typeof fn==='function')try{fn(value);}catch(error){options.onCallbackError?.(error);}};
  function snapshot(){const at=now(),fresh=transport==='open'&&observedGeneration===generation&&bar&&at-bar.eventTime<=STALE_MS&&bar.eventTime<=at+MAX_FUTURE_MS;return {bar,closedBars:[...sessionClosed.values()].sort((a,b)=>a.time-b.time),status:{state:transport==='open'?(fresh?'live':observedGeneration===generation?'stale':'waiting'):transport,sourceId:'binance',instrument:symbol,endpoint:endpoint(symbol),stream:symbol.toLowerCase()+'@kline_1d',interval:'1d',updateMs:UPDATE_MS,staleMs:STALE_MS,fresh:!!fresh,connectedAt,lastEventAt:bar?.eventTime??null,lastReceivedAt,blockedReason,...stats,rejectionReasons:{...stats.rejectionReasons}}};}
  function emit(force=false){const value=snapshot(),signature=[value.status.state,value.status.fresh,value.status.accepted,value.status.rejected,value.status.blockedReason].join('|');if(!force&&signature===lastPublishedState)return;lastPublishedState=signature;notify(options.onStatus,value.status);notify(options.onUpdate,value);}
  function clearTimer(name){if(name!==null)cancel(name);}
  function closeSocket(){generation++;observedGeneration=null;clearTimer(connectTimer);connectTimer=null;const previous=socket;socket=null;if(previous){previous.onopen=previous.onmessage=previous.onerror=previous.onclose=null;try{previous.close(1000,'Local lifecycle');}catch{}}}
  function block(reason){wanted=false;clearTimer(timer);timer=null;blockedReason=reason;transport='blocked';clearTimer(reconnectTimer);reconnectTimer=null;closeSocket();emit(true);}
  function reject(reason){stats.rejected++;stats.rejectionReasons[reason]=(stats.rejectionReasons[reason]||0)+1;emit();}
  function scheduleReconnect(reason){closeSocket();if(!wanted)return;if(!everAccepted){block(reason||'initial_source_failure');return;}if(retry>=6){block('reconnect_limit');return;}transport='disconnected';const delay=Math.min(60000,2000*2**retry++);reconnectTimer=schedule(()=>{reconnectTimer=null;connect();},delay);emit(true);}
  function ingest(text){
   if(typeof text!=='string'||text.length>20000){block('invalid_frame');return;}let raw;try{raw=JSON.parse(text);}catch{block('invalid_json');return;}
   if(raw?.e==='serverShutdown'){scheduleReconnect('server_shutdown');return;}if(!raw||typeof raw!=='object'||Array.isArray(raw)){block('invalid_frame_shape');return;}if('code'in raw||'error'in raw){block('source_error');return;}
   let next;try{next=parseKline(raw,symbol,now());}catch(error){if(error.message==='old_event'){reject('old_event');return;}block('invalid_source_'+error.message);return;}
   if(bar){if(next.eventTime<bar.eventTime){reject('out_of_order');return;}if(next.eventTime===bar.eventTime){if(JSON.stringify(next.raw)===JSON.stringify(bar.raw))stats.duplicates++;else reject('same_time_conflict');return;}
    if(next.time===bar.time){const old=bar.raw.k,k=next.raw.k;if(bar.tradeCount>0&&k.o!==old.o&&decimal(k.o).exact!==decimal(old.o).exact||next.tradeCount<bar.tradeCount||next.lastTradeId<bar.lastTradeId||decimal(k.v).exact<decimal(old.v).exact||decimal(k.q).exact<decimal(old.q).exact||decimal(k.V).exact<decimal(old.V).exact||decimal(k.Q).exact<decimal(old.Q).exact||bar.tradeCount>0&&decimal(k.h).exact<decimal(old.h).exact||bar.tradeCount>0&&decimal(k.l).exact>decimal(old.l).exact||bar.closed&&!next.closed){reject('cumulative_regression');return;}}
   }
   if(next.closed){const prior=sessionClosed.get(next.time);if(prior&&['open','close','high','low','volume','quote','buy','takerBuyBase','tradeCount','firstTradeId','lastTradeId'].some(key=>prior[key]!==next[key])){reject('closed_candle_conflict');return;}if(!prior){sessionClosed.set(next.time,next);while(sessionClosed.size>MAX_SESSION_BARS)sessionClosed.delete(sessionClosed.keys().next().value);}}
   bar=next;lastReceivedAt=next.receivedAt;observedGeneration=generation;stats.accepted++;everAccepted=true;retry=0;emit(true);
  }
  function heartbeat(){timer=null;if(!wanted)return;emit();timer=schedule(heartbeat,1000);}
  function connect(){if(!wanted||socket||blockedReason)return;if(typeof WS!=='function'){transport='unsupported';emit(true);return;}transport='connecting';observedGeneration=null;emit(true);const token=++generation;try{socket=new WS(endpoint(symbol));}catch{block('socket_constructor_failed');return;}const current=socket;connectTimer=schedule(()=>{if(token===generation)block('connection_timeout');},15000);
   current.onopen=()=>{if(token!==generation)return;clearTimer(connectTimer);connectTimer=null;connectedAt=now();transport='open';if(everAccepted)stats.reconnects++;emit(true);};
   current.onmessage=event=>{if(token!==generation||!wanted)return;ingest(event.data);};
   current.onerror=()=>{if(token!==generation)return;if(!everAccepted)block('initial_connection_failed');else scheduleReconnect('socket_error');};
   current.onclose=event=>{if(token!==generation)return;if([1008,4003,4008].includes(event.code)){block('source_policy_'+event.code);return;}scheduleReconnect('socket_closed_'+event.code);};
  }
  function start(){if(blockedReason)return false;if(wanted&&(socket||reconnectTimer!==null))return true;wanted=true;if(timer===null)timer=schedule(heartbeat,1000);connect();return true;}
  function stop(){wanted=false;clearTimer(timer);timer=null;clearTimer(reconnectTimer);reconnectTimer=null;closeSocket();if(!blockedReason)transport='paused';emit(true);}
  function setInstrument(next){next=instrument(next);if(next===symbol)return;const resume=wanted;stop();symbol=next;bar=null;sessionClosed.clear();connectedAt=null;lastReceivedAt=null;everAccepted=false;retry=0;if(!blockedReason)transport='idle';emit(true);if(resume&&!blockedReason)start();}
  return Object.freeze({start,stop,destroy:stop,setInstrument,snapshot});
 }
 return Object.freeze({DAY,BASE,UPDATE_MS,MAX_SESSION_BARS,STALE_MS,MAX_EVENT_AGE_MS,MAX_FUTURE_MS,endpoint,parseKline,projectDaily,create});
});
