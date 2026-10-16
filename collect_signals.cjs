#!/usr/bin/env node
/* Public dated-universe research archive. Read-only; no key, trading or schedule.
   node collect_signals.cjs
   Cached receipts may resume only the same completed-UTC-day cutoff. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const M=require('./market.js');
const ORIGIN='https://data-api.binance.vision',DAYS=401,GAP=300,CONCURRENCY=8;
const OUTPUT=path.join(__dirname,'data/research-snapshot.json');
const RECEIPTS=path.join(__dirname,'..','probes','research-v8');
const digest=s=>crypto.createHash('sha256').update(s).digest('hex');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let lastStarted=0,pace=Promise.resolve(),halt=null;
function startSlot(){
 const pending=pace.then(async()=>{await pause(Math.max(0,GAP-(Date.now()-lastStarted)));if(halt)throw halt;lastStarted=Date.now();});
 pace=pending.catch(()=>{});return pending;
}
async function request(url,label){
 await startSlot();const startedAt=Date.now();
 let response,body;
 try{response=await fetch(url,{redirect:'error',headers:{Accept:'application/json'},signal:AbortSignal.timeout(20000)});body=await response.text();}
 catch(error){halt=Object.assign(Error('Source/network collection stopped: '+error.message),{stage:'network'});throw halt;}
 const fetchedAt=Date.now(),sha256=digest(body),file=label+'-'+sha256+'.json';
 fs.writeFileSync(path.join(RECEIPTS,file),body);
 const receipt={url,startedAt,fetchedAt,httpStatus:response.status,contentType:response.headers.get('content-type'),bytes:Buffer.byteLength(body),sha256};
 if(!response.ok){
  const error=Object.assign(Error('HTTP '+response.status),{receipt});
  if([403,418,429].includes(response.status)){halt=error;error.stage='source-restriction';}
  throw error;
 }
 if(!/application\/json/i.test(receipt.contentType||''))throw Object.assign(Error('Source did not return JSON'),{receipt});
 let value;try{value=JSON.parse(body);}catch(_){throw Object.assign(Error('Invalid JSON response'),{receipt});}
 return {value,receipt,file};
}
function atomicSave(snapshot){
 const json=JSON.stringify(snapshot),temp=OUTPUT+'.tmp',gzip=zlib.gzipSync(json,{level:9,mtime:0});
 fs.writeFileSync(temp,json);fs.renameSync(temp,OUTPUT);
 const compressed=OUTPUT+'.gz';fs.writeFileSync(compressed+'.tmp',gzip);fs.renameSync(compressed+'.tmp',compressed);
 const manifest={schemaVersion:1,kind:'cex-research-manifest',sourceId:snapshot.sourceId,generatedAt:snapshot.generatedAt,asOf:snapshot.asOf,endTime:snapshot.endTime,lastClosedDay:snapshot.lastClosedDay,requestedDays:snapshot.requestedDays,finishedAt:snapshot.finishedAt??null,collectionState:snapshot.collectionState,scope:snapshot.scope,sourceCoverage:snapshot.sourceCoverage,
  snapshot:{url:'./data/research-snapshot.json.gz',compression:'gzip',bytes:gzip.length,sha256:digest(gzip),decodedBytes:Buffer.byteLength(json),decodedSha256:digest(json)},
  universe:{asOf:snapshot.universe.asOf,fetchedAt:snapshot.universe.fetchedAt,eligibleInstrumentCount:snapshot.universe.eligibleInstrumentCount,excludedCount:snapshot.universe.excludedCount,provenance:snapshot.universe.provenance,after:snapshot.universe.after??null},errors:snapshot.errors,halt:snapshot.halt??null};
 const manifestPath=path.join(__dirname,'data/research-manifest.json');fs.writeFileSync(manifestPath+'.tmp',JSON.stringify(manifest));fs.renameSync(manifestPath+'.tmp',manifestPath);
}
function validateBars(history,endTime){
 if(!Array.isArray(history.bars)||history.bars.length>DAYS)throw Error('History exceeds requested length');
 for(const b of history.bars)if(b.end>endTime)throw Error('Unclosed/future candle entered archive');
 if(history.bars.some((b,i)=>i&&b.time<=history.bars[i-1].time))throw Error('Candle chronology is not strictly increasing');
}
async function collect(){
 fs.mkdirSync(RECEIPTS,{recursive:true});
 const initialClock=await request(ORIGIN+'/api/v3/time','clock');
 const asOf=M.clock(initialClock.value.serverTime),endTime=Math.floor(asOf/M.DAY)*M.DAY-1;
 const lastClosedDay=new Date(endTime).toISOString().slice(0,10),cachePath=path.join(RECEIPTS,'cache-'+lastClosedDay+'.json');
 let cache={};try{cache=JSON.parse(fs.readFileSync(cachePath,'utf8'));}catch(_){}
 const before=await request(ORIGIN+'/api/v3/exchangeInfo?permissions=SPOT&showPermissionSets=false','registry-before');
 const registry=M.registry('binance',before.value);
 if(!registry.instruments.length)throw Error('Empty eligible universe; prior output preserved');
 const instruments=registry.instruments.map(m=>({...m,key:'binance:'+m.instrument}));
 const result={schemaVersion:1,kind:'cex-research',sourceId:'binance',generatedAt:Date.now(),asOf,endTime,lastClosedDay,requestedDays:DAYS,
  collector:{file:'collect_signals.cjs',requestGapMs:GAP,maxConcurrentRequests:CONCURRENCY,scheduled:false,retryPolicy:'No retry on errors; restriction/network errors halt new requests'},
  scope:'Dated current Binance TRADING spot/USDT instrument universe. Not every exchange, not historical membership, no beneficial-wallet identity. Underlying asset class is not established by registry.',
  universe:{sourceId:'binance',asOf,fetchedAt:before.receipt.fetchedAt,eligibleInstrumentCount:instruments.length,instruments,excludedCount:registry.excludedCount,errors:registry.errors,provenance:[initialClock.receipt,before.receipt]},
  sourceCoverage:{eligible:instruments.length,attempted:0,completed:0,fullLength:0,shortHistory:0,errors:0,unattempted:instruments.length},
  histories:{},errors:[],collectionState:'collecting'};
 let next=0,successful=0;
 const saveCache=()=>{const temp=cachePath+'.tmp';fs.writeFileSync(temp,JSON.stringify(cache));fs.renameSync(temp,cachePath);};
 function update(){result.sourceCoverage.errors=result.errors.filter(e=>e.stage==='history').length;result.sourceCoverage.unattempted=instruments.length-result.sourceCoverage.attempted;result.generatedAt=Date.now();if(successful)atomicSave(result);saveCache();}
 async function one(meta){
  result.sourceCoverage.attempted++;
  const url=ORIGIN+'/api/v3/klines?'+new URLSearchParams({symbol:meta.instrument,interval:'1d',limit:String(DAYS),endTime:String(endTime)});
  try{
   let captured,cached=false;
   const entry=cache[meta.instrument];
   if(entry&&entry.receipt&&entry.receipt.url===url&&entry.receipt.httpStatus===200&&entry.receipt.fetchedAt>=Math.floor(asOf/M.DAY)*M.DAY){
    try{const body=fs.readFileSync(path.join(RECEIPTS,entry.file),'utf8');if(digest(body)!==entry.receipt.sha256)throw Error('Cache hash mismatch');captured={value:JSON.parse(body),receipt:entry.receipt,file:entry.file};cached=true;}catch(_){/* Damaged local cache is replaced by a new normal request. */}
   }
   if(!captured)captured=await request(url,'klines-'+meta.instrument);
   const parsed=M.parseHistory('binance',captured.value,asOf,captured.receipt.fetchedAt,{days:DAYS});
   validateBars(parsed,endTime);
   const first=parsed.bars[0],last=parsed.bars.at(-1);
   const gaps=parsed.bars.flatMap((b,i)=>i&&b.time-parsed.bars[i-1].time!==M.DAY?[{after:parsed.bars[i-1].time,before:b.time,missingDays:(b.time-parsed.bars[i-1].time)/M.DAY-1}]:[]);
   const coverage={requestedDays:DAYS,returnedDays:parsed.bars.length,shortfallDays:Math.max(0,DAYS-parsed.bars.length),firstOpenTime:first?.time??null,lastCloseTime:last?.end??null,latestClosedDayPresent:!!last&&last.end===endTime,gapCount:gaps.length,gaps};
   result.histories[meta.key]={sourceId:'binance',instrument:meta.instrument,key:meta.key,base:meta.base,quote:meta.quote,...parsed,coverage,provenance:[captured.receipt],cacheReused:cached};
   cache[meta.instrument]={receipt:captured.receipt,file:captured.file};
   result.sourceCoverage.completed++;result.sourceCoverage[parsed.bars.length===DAYS?'fullLength':'shortHistory']++;successful++;
  }catch(error){result.errors.push({stage:'history',sourceId:'binance',instrument:meta.instrument,key:meta.key,message:error.message,provenance:error.receipt?[error.receipt]:[]});}
  if(result.sourceCoverage.attempted%25===0){update();console.log(JSON.stringify({progress:result.sourceCoverage,halted:halt?.message||null}));}
 }
 async function worker(){while(!halt){const i=next++;if(i>=instruments.length)break;await one(instruments[i]);}}
 await Promise.all(Array.from({length:CONCURRENCY},worker));
 if(!halt){
  try{
   const after=await request(ORIGIN+'/api/v3/exchangeInfo?permissions=SPOT&showPermissionSets=false','registry-after');
   const latest=M.registry('binance',after.value),oldIds=new Set(instruments.map(m=>m.instrument)),newIds=new Set(latest.instruments.map(m=>m.instrument));
   result.universe.after={fetchedAt:after.receipt.fetchedAt,eligibleInstrumentCount:latest.instruments.length,added:[...newIds].filter(x=>!oldIds.has(x)),removed:[...oldIds].filter(x=>!newIds.has(x)),errors:latest.errors,provenance:[after.receipt]};
  }catch(error){result.errors.push({stage:'registry-after',message:error.message,provenance:error.receipt?[error.receipt]:[]});}
 }
 result.finishedAt=Date.now();result.collectionState=halt?'halted':result.errors.length?'partial':'complete';
 if(halt)result.halt={message:halt.message,stage:halt.stage||'source'};
 update();
 if(!successful)throw Error('No valid histories; prior snapshot preserved');
 console.log(JSON.stringify({saved:OUTPUT,bytes:fs.statSync(OUTPUT).size,asOf,lastClosedDay,state:result.collectionState,coverage:result.sourceCoverage,elapsedSeconds:(result.finishedAt-initialClock.receipt.startedAt)/1000}));
}
if(require.main===module)collect().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={collect,validateBars,writeSnapshot:atomicSave};
