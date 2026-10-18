/* Display-only recovery of missing native Binance UTC daily candles.
 * Official specification checked 2026-10-17:
 * https://github.com/binance/binance-spot-api-docs/blob/master/rest-api.md#klinecandlestick-data
 * https://github.com/binance/binance-spot-api-docs/blob/master/faqs/market_data_only.md
 * GET /api/v3/klines: weight 2, at most 1000 bars, timezone 0 (UTC).
 * One shared serial queue, >=1100 ms between starts. No retries or host fallback.
 * Exact successful/error response bodies and SHA-256 receipts remain with the
 * session result. Recovered candles never replace saved research/backtest data.
 */
(function(root,factory){'use strict';const api=factory();root.FlowSelectedHistory=api;if(typeof module==='object'&&module.exports)module.exports=api;})(globalThis,function(){
 'use strict';
 const DAY=86400000,ORIGIN='https://data-api.binance.vision',PATH='/api/v3/klines',SPACING=1100,LIMIT=1000,MAX_DAYS=3660,MAX_BYTES=2*1024*1024,TIMEOUT=20000,MAX_CACHE=8,MAX_CACHE_BYTES=16*1024*1024,SCALE=20,UNIT=10n**20n;
 const finite=n=>typeof n==='number'&&Number.isFinite(n);
 function fail(code,message=code,extra={}){throw Object.assign(Error(message),{code,...extra});}
 function abortError(){return Object.assign(Error('Selected history request cancelled'),{name:'AbortError',code:'cancelled'});}
 function checkSignal(signal){if(signal?.aborted)throw abortError();}
 function callerSignal(promise,signal){if(!signal)return promise;return new Promise((resolve,reject)=>{if(signal.aborted){reject(abortError());return;}const stop=()=>{signal.removeEventListener('abort',stop);reject(abortError());};signal.addEventListener('abort',stop,{once:true});promise.then(value=>{signal.removeEventListener('abort',stop);resolve(value);},error=>{signal.removeEventListener('abort',stop);reject(error);});});}
 function timestamp(n){if(!Number.isSafeInteger(n)||n<946684800000||n>=4102444800000)fail('timestamp');return n;}
 function instrument(value){if(typeof value!=='string'||value!==value.toUpperCase()||!/^([\p{L}\p{N}_.-]{1,76})USDT$/u.test(value))fail('instrument');return value;}
 function decimal(value,positive=false){if(typeof value!=='string'||!/^\d{1,40}(?:\.\d{1,20})?$/.test(value))fail('decimal');const [whole,fraction='']=value.split('.'),exact=BigInt(whole)*UNIT+BigInt(fraction.padEnd(SCALE,'0')),number=Number(value);if(!finite(number)||positive&&exact<=0n)fail('decimal');return {number,exact};}
 function endpoint(symbol,startTime,endTime){instrument(symbol);timestamp(startTime);timestamp(endTime);if(startTime%DAY||endTime%DAY!==DAY-1||endTime<startTime)fail('range');return ORIGIN+PATH+'?'+new URLSearchParams({symbol,interval:'1d',timeZone:'0',startTime:String(startTime),endTime:String(endTime),limit:String(Math.min(LIMIT,(endTime-startTime+1)/DAY))});}
 function validateHistory(history,now){
  timestamp(now);if(!history||history.sourceId!=='binance'||history.quote!=='USDT'||history.key!=='binance:'+instrument(history.instrument))fail('history_identity');
  if(!Array.isArray(history.bars)||!history.bars.length||history.bars.length>10000)fail('history_bars');timestamp(history.asOf);timestamp(history.fetchedAt);if(history.asOf>now+60000||history.fetchedAt>now+60000)fail('future_history');
  let previous=null;for(const b of history.bars){if(!b||typeof b!=='object')fail('history_bar');timestamp(b.time);timestamp(b.end);if(b.time%DAY||b.end!==b.time+DAY-1||b.end>=Math.min(history.asOf,now)||previous!==null&&b.time<=previous)fail('history_utc');for(const key of ['open','high','low','close','quote'])if(!finite(b[key]))fail('history_values');if(Math.min(b.open,b.high,b.low,b.close)<=0||b.quote<0||b.high<Math.max(b.open,b.close,b.low)||b.low>Math.min(b.open,b.close,b.high)||b.buy!==null&&b.buy!==undefined&&(!finite(b.buy)||b.buy<0||b.buy>b.quote))fail('history_values');previous=b.time;}
  return history;
 }
 function plan(history,{now=Date.now(),targetOpenTime,forceVerify=false}={}){
  validateHistory(history,now);const open=targetOpenTime??Math.floor(now/DAY)*DAY;timestamp(open);if(open%DAY||open!==Math.floor(now/DAY)*DAY)fail('target_utc_day');const end=open-1,last=history.bars.at(-1);if(last.end>end)fail('future_history');
  let start=null;for(let i=1;i<history.bars.length;i++)if(history.bars[i].time!==history.bars[i-1].end+1){start=history.bars[i-1].time;break;}
  if(start===null&&(last.end<end||forceVerify))start=last.time;
  if(start===null)return Object.freeze({needed:false,symbol:history.instrument,startTime:null,endTime:end,targetOpenTime:open,days:0,pages:0});
  const days=(end-start+1)/DAY;if(days>MAX_DAYS)fail('history_capacity','Missing-history recovery exceeds the bounded display request range');
  return Object.freeze({needed:true,symbol:history.instrument,startTime:start,endTime:end,targetOpenTime:open,days,pages:Math.ceil(days/LIMIT)});
 }
 function parsePage(raw,{symbol,startTime,endTime,receivedAt,sha256}){
  instrument(symbol);timestamp(receivedAt);if(!Array.isArray(raw)||!raw.length||raw.length>LIMIT)fail('source_rows');const expected=(endTime-startTime+1)/DAY;if(raw.length!==expected)fail('source_gap','Native daily response is incomplete; missing days were not filled');
  return raw.map((a,i)=>{
   if(!Array.isArray(a)||a.length!==12)fail('source_row');const time=timestamp(a[0]),end=timestamp(a[6]);if(time!==startTime+i*DAY||time%DAY||end!==time+DAY-1||end>endTime||end>=receivedAt)fail('source_utc');
   const values={};for(const key of [1,2,3,4,5,7,9,10])values[key]=decimal(a[key],[1,2,3,4].includes(key));
   if(values[2].exact<values[1].exact||values[2].exact<values[4].exact||values[2].exact<values[3].exact||values[3].exact>values[1].exact||values[3].exact>values[4].exact)fail('source_ohlc');
   if(values[9].exact>values[5].exact||values[10].exact>values[7].exact||(values[5].exact===0n)!==(values[7].exact===0n))fail('source_volume');
   if(!Number.isSafeInteger(a[8])||a[8]<0||a[8]===0&&values[5].exact!==0n||a[8]>0&&values[5].exact===0n||typeof a[11]!=='string')fail('source_trades');
   return Object.freeze({key:'binance:'+symbol,sourceId:'binance',instrument:symbol,interval:'1d',quoteUnit:'USDT',time,end,open:values[1].number,high:values[2].number,low:values[3].number,close:values[4].number,volume:values[5].number,quote:values[7].number,buy:values[10].number,takerBuyBase:values[9].number,tradeCount:a[8],closed:true,provisional:false,receivedAt,sourceResponseAt:null,sourceEventAt:null,lastTradeAt:null,timestampKind:'closed_daily_bounds_not_source_update_time',sourceSha256:sha256,sourceSelectedHistory:true,researchEligible:false,raw:Object.freeze(a.slice())});
  });
 }
 function matchesSaved(native,saved){return ['time','end','open','high','low','close','quote','buy'].every(key=>saved[key]===undefined||saved[key]===null||native[key]===saved[key]);}
 async function sha256(bytes,cryptoImpl=globalThis.crypto){if(!cryptoImpl?.subtle)fail('crypto_unavailable');return [...new Uint8Array(await cryptoImpl.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');}
 async function readBody(response,signal){
  const length=Number(response.headers?.get?.('content-length'));if(finite(length)&&length>MAX_BYTES)fail('source_size');
  if(response.body?.getReader){const reader=response.body.getReader(),chunks=[];let size=0;try{for(;;){checkSignal(signal);const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>MAX_BYTES)fail('source_size');chunks.push(part.value);}}catch(error){try{await reader.cancel();}catch{}throw error;}const bytes=new Uint8Array(size);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.byteLength;}return bytes;}
  const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.byteLength>MAX_BYTES)fail('source_size');checkSignal(signal);return bytes;
 }
 function wait(ms,signal){return new Promise((resolve,reject)=>{checkSignal(signal);const done=()=>{signal?.removeEventListener('abort',cancel);resolve();},timer=setTimeout(done,ms),cancel=()=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel);reject(abortError());};signal?.addEventListener('abort',cancel,{once:true});});}
 function createTransport(options={}){
  const fetchImpl=options.fetchImpl||globalThis.fetch,now=options.now||(()=>Date.now()),pause=options.wait||wait;let queue=Promise.resolve(),lastStarted=null,blocked=null,requests=0;
  async function run(url,{signal,validate,onEvidence,onRequest}={}){
   checkSignal(signal);if(blocked)fail('source_blocked',blocked.reason,{blocked});if(typeof fetchImpl!=='function')fail('fetch_unavailable');
   await pause(lastStarted===null?0:Math.max(0,SPACING-(now()-lastStarted)),signal);checkSignal(signal);if(blocked)fail('source_blocked',blocked.reason,{blocked});
   const startedAt=now(),controller=new AbortController();lastStarted=startedAt;requests++;try{onRequest?.({url,startedAt,requestWeight:2});}catch(error){options.onCallbackError?.(error);}let timedOut=false,timer,rejectAbort;
   const aborted=new Promise((_,reject)=>{rejectAbort=reject;}),forward=()=>{controller.abort(signal?.reason);rejectAbort(abortError());};signal?.addEventListener('abort',forward,{once:true});
   const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{timedOut=true;controller.abort();reject(Object.assign(Error('Selected history source timed out; no retry'),{code:'source_timeout'}));},options.timeoutMs??TIMEOUT);});
   const work=(async()=>{const response=await fetchImpl(url,{method:'GET',credentials:'omit',cache:'no-store',redirect:'error',headers:{Accept:'application/json'},signal:controller.signal}),bytes=await readBody(response,controller.signal),receivedAt=now(),body=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes),hash=await sha256(bytes,options.cryptoImpl);checkSignal(controller.signal);
    const receipt=Object.freeze({url,method:'GET',startedAt,fetchedAt:receivedAt,receivedAt,httpStatus:response.status,contentType:response.headers?.get?.('content-type')||null,bytes:bytes.byteLength,sha256:hash,requestWeight:2,timestampBasis:'browser_receipt_clock_utc',sourceResponseAt:null}),evidence=Object.freeze({receipt,body});onEvidence?.(evidence);
    try{if(!response.ok)fail('source_http','HTTP '+response.status+'; selected history stopped without retry');if(!/^application\/json(?:\s*;|$)/i.test(receipt.contentType||''))fail('source_content_type');
     let raw;try{raw=JSON.parse(body);}catch{fail('source_json');}if(!Array.isArray(raw))fail('source_shape');const value=validate?validate(raw,receipt):raw;return {value,evidence,receipt};
    }catch(error){throw Object.assign(error,{receipt});}})();
   try{const result=await Promise.race([work,timeout,aborted]);checkSignal(signal);return result;}catch(error){if(signal?.aborted&&!timedOut)throw abortError();blocked=Object.freeze({reason:error.code||'source_network',message:error.message,at:now(),url,httpStatus:error.receipt?.httpStatus??null});throw Object.assign(error,{blocked});}finally{clearTimeout(timer);signal?.removeEventListener('abort',forward);}
  }
  function request(url,options={}){let valid=false;try{const parsed=new URL(url);valid=parsed.href===endpoint(parsed.searchParams.get('symbol'),Number(parsed.searchParams.get('startTime')),Number(parsed.searchParams.get('endTime')));}catch{}if(!valid)return Promise.reject(Object.assign(Error('Only documented native daily history endpoint is allowed'),{code:'endpoint'}));const pending=queue.then(()=>run(url,options));queue=pending.catch(()=>{});return pending;}
  return Object.freeze({request,snapshot:()=>({blocked,requests,lastStarted,spacingMs:SPACING,maxConcurrent:1,requestWeight:2})});
 }
 let sharedTransport=null;
 function create(options={}){
  const now=options.now||(()=>Date.now()),transport=options.transport||(sharedTransport||(sharedTransport=createTransport(options))),cache=new Map();let status={state:'idle',instrument:null,appendedCount:0,repairedCount:0,requests:0,displayOnly:true,researchEligible:false},active=null,epoch=0,lastResult=null,lastAttempt=null;
  const emit=next=>{status={...status,...next};try{options.onStatus?.(Object.freeze({...status}));}catch(error){options.onCallbackError?.(error);}};
  const fingerprint=history=>JSON.stringify([history.key,history.asOf,history.fetchedAt,history.bars.map(b=>[b.time,b.end,b.open,b.high,b.low,b.close,b.quote,b.buy])]);
  function snapshot(){return {status:{...status,sourceBlocked:transport.snapshot().blocked},result:lastResult,attempt:lastAttempt?{...lastAttempt,evidence:lastAttempt.evidence.slice(),receipts:lastAttempt.receipts.slice()}:null};}
  function cancel(){epoch++;if(active)active.controller.abort();active=null;if(status.state==='loading')emit({state:'cancelled'});}
  function cacheResult(key,result){cache.delete(key);cache.set(key,result);while(cache.size>MAX_CACHE||[...cache.values()].reduce((sum,item)=>sum+item.evidence.reduce((n,e)=>n+e.receipt.bytes,0),0)>MAX_CACHE_BYTES)cache.delete(cache.keys().next().value);}
  async function collect(history,p,key,token,signal){
   const evidence=[],receipts=[],native=[],saved=new Map(history.bars.map(b=>[b.time,b]));let appendedCount=0,repairedCount=0;lastAttempt={instrument:p.symbol,startedAt:now(),evidence,receipts:[],requests:0,displayOnly:true,researchEligible:false};
   for(let start=p.startTime;start<=p.endTime;start+=LIMIT*DAY){checkSignal(signal);const end=Math.min(p.endTime,start+LIMIT*DAY-1),url=endpoint(p.symbol,start,end),response=await transport.request(url,{signal,onRequest:()=>{if(token===epoch){lastAttempt.requests++;emit({requests:lastAttempt.requests});}},onEvidence:e=>{evidence.push(e);if(token===epoch){lastAttempt.receipts.push(e.receipt);emit({receivedAt:e.receipt.receivedAt});}try{options.onEvidence?.(e);}catch(error){options.onCallbackError?.(error);}},validate:(raw,receipt)=>{const rows=parsePage(raw,{symbol:p.symbol,startTime:start,endTime:end,receivedAt:receipt.receivedAt,sha256:receipt.sha256});for(const row of rows){const previous=saved.get(row.time);if(previous&&!matchesSaved(row,previous))fail('source_overlap_conflict','Native closed candle disagrees with the saved history; original research was preserved',{receipt});}return rows;}});
    checkSignal(signal);if(token!==epoch)throw abortError();receipts.push(response.receipt);native.push(...response.value);emit({state:'loading',instrument:p.symbol,requests:receipts.length,receivedAt:response.receipt.receivedAt,expectedPages:p.pages,receivedBars:native.length});
   }
   const merged=new Map(history.bars.map(b=>[b.time,Object.freeze({...b})]));for(const row of native)if(!merged.has(row.time)){merged.set(row.time,row);if(row.time>history.bars.at(-1).time)appendedCount++;else repairedCount++;}
   const bars=[...merged.values()].sort((a,b)=>a.time-b.time);for(let i=1;i<bars.length;i++)if(bars[i].time!==bars[i-1].end+1)fail('merged_gap');if(bars.at(-1).end!==p.endTime)fail('merged_stale');
   const display=Object.freeze({...history,bars:Object.freeze(bars),asOf:p.targetOpenTime,fetchedAt:receipts.at(-1).receivedAt,asOfKind:'closed_utc_boundary_not_source_update_time',sourceResearchAsOf:history.asOf,sourceResearchFetchedAt:history.fetchedAt,provenance:Object.freeze([...(history.provenance||[]),...receipts]),displayOnly:true,researchEligible:false,selectedHistory:Object.freeze({appendedCount,repairedCount,requestedStart:p.startTime,requestedEnd:p.endTime,sourceId:'binance',instrument:p.symbol,requestWeight:2,sourceResponseAt:null})});
   const result=Object.freeze({state:'ready',history:display,appendedCount,repairedCount,receipts:Object.freeze(receipts),evidence:Object.freeze(evidence),displayOnly:true,researchEligible:false});checkSignal(signal);if(token!==epoch)throw abortError();cacheResult(key,result);lastResult=result;emit({state:'ready',instrument:p.symbol,appendedCount,repairedCount,requests:receipts.length,receivedBars:native.length});return result;
  }
  function ensure(history,requestOptions={}){
   let p,key;try{p=plan(history,{now:now(),targetOpenTime:requestOptions.targetOpenTime,forceVerify:requestOptions.forceVerify===true});key=fingerprint(history)+'|'+p.endTime;checkSignal(requestOptions.signal);}catch(error){return Promise.reject(error);}
   if(active&&active.key!==key)cancel();if(lastResult?.history.key!==history.key)lastResult=null;
   if(active?.key===key)return callerSignal(active.promise,requestOptions.signal);
   if(cache.has(key)&&!requestOptions.forceVerify){const result=cache.get(key);cache.delete(key);cache.set(key,result);lastResult=result;emit({state:'ready',instrument:p.symbol,appendedCount:result.appendedCount,repairedCount:result.repairedCount,requests:0,cached:true});return Promise.resolve(result);}
   if(!p.needed){const result=Object.freeze({state:'unchanged',history,appendedCount:0,repairedCount:0,receipts:Object.freeze([]),evidence:Object.freeze([]),displayOnly:true,researchEligible:false});lastResult=result;emit({state:'unchanged',instrument:p.symbol,appendedCount:0,repairedCount:0,requests:0,cached:false});return Promise.resolve(result);}
   cancel();const controller=new AbortController(),token=epoch,forward=()=>controller.abort();requestOptions.signal?.addEventListener('abort',forward,{once:true});
   emit({state:'loading',instrument:p.symbol,appendedCount:0,repairedCount:0,requests:0,expectedPages:p.pages,receivedBars:0,cached:false,error:null});
   const promise=collect(history,p,key,token,controller.signal).catch(error=>{if(token===epoch)emit({state:error.name==='AbortError'?'cancelled':'blocked',error:error.message,reason:error.code||'source_network'});throw error;}).finally(()=>{requestOptions.signal?.removeEventListener('abort',forward);if(active?.promise===promise)active=null;});active={key,promise,controller};return promise;
  }
  return Object.freeze({ensure,cancel,stop:cancel,snapshot});
 }
 return Object.freeze({DAY,ORIGIN,PATH,SPACING,LIMIT,MAX_DAYS,MAX_BYTES,TIMEOUT,endpoint,validateHistory,plan,parsePage,matchesSaved,sha256,createTransport,create});
});
