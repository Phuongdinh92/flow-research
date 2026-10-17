/* Browser-only, sequential CoinLore catalog scans. No source switching or
 * access-error retry. Response time is not a quote's underlying update time. */
(function(root,factory){'use strict';const api=factory(root.FlowCoinLore||(typeof require==='function'?require('./coinlore-core.js'):null));root.FlowCoinLoreLive=api;if(typeof module==='object'&&module.exports)module.exports=api;})(globalThis,function(C){
 'use strict';
 const SPACING=1100,REPEAT_MS=600000,MAX_PAGES=2000,MAX_BYTES=32*1024*1024;
 const copy=x=>x===null?null:JSON.parse(JSON.stringify(x));
 function cacheDeadline(promise,ms=2000){let timer;const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Snapshot cache timed out')),ms);});return Promise.race([promise,timeout]).finally(()=>clearTimeout(timer));}
 async function sha256(bytes,cryptoImpl=globalThis.crypto){if(!cryptoImpl?.subtle?.digest)throw Error('SHA-256 unavailable');const hash=await cryptoImpl.subtle.digest('SHA-256',bytes);return [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('');}
 function createSnapshotCache(options={}){
  const factory=options.indexedDB===undefined?globalThis.indexedDB:options.indexedDB,cryptoImpl=options.cryptoImpl||globalThis.crypto,name=options.databaseName||'flow-research-coinlore-v1';if(!factory?.open)return null;let connection=null;
  function open(){if(connection)return connection;connection=new Promise((resolve,reject)=>{const request=factory.open(name,1);request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains('snapshots'))db.createObjectStore('snapshots');};request.onsuccess=()=>{request.result.onversionchange=()=>{request.result.close();connection=null;};resolve(request.result);};request.onerror=()=>{connection=null;reject(request.error||Error('Snapshot cache could not open'));};request.onblocked=()=>{connection=null;reject(Error('Snapshot cache upgrade blocked'));};});return connection;}
  async function read(){const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction('snapshots','readonly'),request=tx.objectStore('snapshots').get('complete');request.onsuccess=()=>resolve(request.result||null);request.onerror=()=>reject(request.error||Error('Snapshot cache read failed'));tx.onabort=()=>reject(tx.error||Error('Snapshot cache read aborted'));});}
  return Object.freeze({
   async load(){const record=await read();if(!record)return null;if(record.version!==1||typeof record.body!=='string'||!/^[a-f0-9]{64}$/.test(record.sha256))throw Error('Snapshot cache record invalid');const bytes=new TextEncoder().encode(record.body);if(bytes.byteLength>MAX_BYTES||await sha256(bytes,cryptoImpl)!==record.sha256)throw Error('Snapshot cache integrity mismatch');const snapshot=C.validateSnapshot(JSON.parse(record.body));if(snapshot.collection.state!=='complete'||snapshot.coverage.complete!==true)throw Error('Snapshot cache is not complete');return snapshot;},
   async save(snapshot){C.validateSnapshot(snapshot);if(snapshot.collection.state!=='complete'||snapshot.coverage.complete!==true)throw Error('Only complete snapshots can be cached');const body=JSON.stringify(snapshot),bytes=new TextEncoder().encode(body);if(bytes.byteLength>MAX_BYTES)throw Error('Snapshot cache size limit exceeded');const sha=await sha256(bytes,cryptoImpl),db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction('snapshots','readwrite'),store=tx.objectStore('snapshots'),request=store.get('complete');let result={finishedAt:snapshot.collection.finishedAt,bytes:bytes.byteLength,sha256:sha,retained:false};request.onsuccess=()=>{const previous=request.result;if(previous?.version===1&&Number.isSafeInteger(previous.finishedAt)&&previous.finishedAt>snapshot.collection.finishedAt){result={finishedAt:previous.finishedAt,sha256:previous.sha256,retained:true};}else store.put({version:1,body,sha256:sha,finishedAt:snapshot.collection.finishedAt},'complete');};request.onerror=()=>reject(request.error||Error('Snapshot cache comparison failed'));tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error||Error('Snapshot cache write failed'));tx.onabort=()=>reject(tx.error||Error('Snapshot cache write aborted'));});}
  });
 }
 const aborted=()=>{const e=Error('Scan paused');e.name='AbortError';return e;};
 function wait(ms,signal){return new Promise((resolve,reject)=>{if(signal.aborted){reject(aborted());return;}const timer=setTimeout(done,ms);function done(){signal.removeEventListener('abort',cancel);resolve();}function cancel(){clearTimeout(timer);signal.removeEventListener('abort',cancel);reject(aborted());}signal.addEventListener('abort',cancel,{once:true});});}
 function create(options={}){
  if(!C?.parsePage||!C?.validateSnapshot)throw Error('CoinLore core unavailable');
  const fetchImpl=options.fetchImpl||globalThis.fetch,now=options.now||Date.now,pause=options.pause||wait,cryptoImpl=options.cryptoImpl||globalThis.crypto;
  const schedule=options.setTimeout||setTimeout,cancelTimer=options.clearTimeout||clearTimeout;
  const repeatMs=options.repeatMs===0?0:Math.max(REPEAT_MS,Number(options.repeatMs)||REPEAT_MS);
  const documentRef=options.document===undefined?(typeof document==='undefined'?null:document):options.document;
  let current=options.initialSnapshot?copy(C.validateSnapshot(options.initialSnapshot)):null;
  let visible=options.visible!==false&&documentRef?.visibilityState!=='hidden',selected=options.selected!==false,userPaused=false,started=false,destroyed=false,blocked=false;
  let controller=null,running=null,timer=null,lastStarted=null,epoch=0,resumeRequested=false;
  let status={state:'idle',reason:null,observedAt:now(),blocked:false,lastSuccessAt:current?.collection.finishedAt??null,lastResponseAt:null,lastSourceResponseAt:null,nextScanAt:null,gaps:[],progress:null,cache:{state:'disabled',reason:null,finishedAt:null}};
  let progress={phase:'idle',expectedCount:0,attemptedCount:0,pricedCount:0,noQuoteCount:0,missingCount:0,invalidCount:0,errorCount:0,unattemptedCount:0,pages:0,requests:0,complete:false};
  function emit(fn,value){try{if(typeof fn==='function')fn(copy(value));}catch{}}
  function setStatus(state,reason=null,extra={}){status={...status,state,reason,observedAt:now(),blocked,progress:copy(progress),...extra};emit(options.onStatus,status);}
  const snapshotCache=options.snapshotCache===false?null:options.snapshotCache||createSnapshotCache({indexedDB:options.indexedDB,cryptoImpl});
  function cacheStatus(state,reason=null,finishedAt=status.cache.finishedAt){status.cache={state,reason,finishedAt};emit(options.onStatus,status);}
  const cacheReady=snapshotCache?Promise.resolve().then(async()=>{cacheStatus('loading');try{const cached=await cacheDeadline(snapshotCache.load());if(destroyed)return null;if(cached){C.validateSnapshot(cached);if(cached.collection.state!=='complete'||cached.coverage.complete!==true||cached.collection.finishedAt>now()+60000)throw Error('Cached complete snapshot interval invalid');if(!current||cached.collection.finishedAt>current.collection.finishedAt){current=copy(cached);status.lastSuccessAt=cached.collection.finishedAt;emit(options.onUpdate,current);}}cacheStatus('ready',null,cached?.collection.finishedAt??null);return cached;}catch(error){cacheStatus('unavailable',error.message);return null;}}):Promise.resolve(null);
  async function saveCurrent(snapshot){if(!snapshotCache)return;try{cacheStatus('writing');await cacheDeadline(snapshotCache.save(snapshot),5000);if(!destroyed)cacheStatus('ready',null,snapshot.collection.finishedAt);}catch(error){if(!destroyed)cacheStatus('unavailable',error.message);}}
  function active(){return visible&&selected&&!userPaused&&!destroyed&&!blocked;}
  function clearRepeat(){if(timer!==null)cancelTimer(timer);timer=null;status.nextScanAt=null;}
  function planRepeat(){clearRepeat();if(!repeatMs||!active()||!started)return;const nextScanAt=now()+repeatMs;status.nextScanAt=nextScanAt;timer=schedule(()=>{timer=null;if(active())start(false);},repeatMs);emit(options.onStatus,status);}
  function markGap(reason){const gap={reason,startedAt:now(),scanAborted:!!controller};status.gaps=[...status.gaps.slice(-99),gap];}
  function stop(reason='user_pause'){
   clearRepeat();if(reason==='user_pause'||reason==='paused')userPaused=true;
   if(controller){markGap(reason);controller.abort();}
   setStatus(blocked?'blocked':'paused',blocked?(status.failureReason||status.reason):reason);return copy(status);
  }
  function setActive(next={}){
   const was=active();if(typeof next.visible==='boolean')visible=next.visible;if(typeof next.selected==='boolean')selected=next.selected;
   if(!active()){resumeRequested=false;stop(!visible?'hidden':!selected?'source_not_selected':userPaused?'user_pause':'inactive');}
   else if(!was&&started){resumeRequested=true;if(!running)start(false);}
   return copy(status);
  }
  function setPaused(value){userPaused=!!value;if(userPaused)stop('user_pause');else if(active()&&started){resumeRequested=true;if(!running)start(false);}return copy(status);}
  async function digest(bytes){return sha256(bytes,cryptoImpl);}
  function preserveImages(rows,provenance){
   if(!current)return;const old=new Map(current.rows.map(r=>[r.id,r])),sources=new Map(current.provenance.map(p=>[p.sha256,p])),present=new Set(provenance.map(p=>p.sha256));
   for(const row of rows){const previous=old.get(row.id),image=previous?.imageSource,source=image&&sources.get(image.sourceSha256);if(previous?.imageIdentityVerified!==true||previous.nameid!==row.nameid||previous.symbol!==row.symbol||image?.id!==row.id||!source||source.status!==200||source.url!==C.ORIGIN+'/api/coin/info/?id='+row.id||source.receivedAt!==image.receivedAt)continue;
    let url;try{url=new URL(previous.imageUrl);}catch{continue;}if(url.protocol!=='https:'||!['c2.coinlore.com','www.coinlore.com'].includes(url.hostname)||url.username||url.password)continue;
    row.imageUrl=previous.imageUrl;row.image=previous.imageUrl;row.imageIdentityVerified=true;row.imageSource=copy(image);if(!present.has(source.sha256)){provenance.push(copy(source));present.add(source.sha256);}
   }
  }
  async function scan(signal,myEpoch){
   const startedAt=now(),provenance=[],rows=new Map(),entries=new Map(),foreign=new Set(),pageCounts=[],errors=[];
   let catalog=[],after=null,beforeReceipt=null,afterReceipt=null,pages=0,duplicates=0,requests=0;
   function check(){if(signal.aborted||myEpoch!==epoch||!active())throw aborted();}
   function publishProgress(phase){const counts={priced:0,no_quote:0,missing:0,invalid:0,error:0,unattempted:0};for(const e of entries.values())counts[e.status]++;progress={phase,observedAt:now(),expectedCount:catalog.length,attemptedCount:catalog.length-counts.unattempted,pricedCount:counts.priced,noQuoteCount:counts.no_quote,missingCount:counts.missing,invalidCount:counts.invalid,errorCount:counts.error,unattemptedCount:counts.unattempted,pages,requests,complete:false};status.progress=copy(progress);emit(options.onProgress,progress);return counts;}
   async function get(key,url){
    check();if(new URL(url).origin!==C.ORIGIN)throw Error('Unsupported CoinLore origin');
    const delay=lastStarted===null?0:SPACING-(now()-lastStarted);if(delay>0)await pause(delay,signal);check();
    const requestStartedAt=now();lastStarted=requestStartedAt;requests++;
    const timeout=setTimeout(()=>controller?.abort('request_timeout'),20000);
    try{
     const response=await fetchImpl(url,{headers:{Accept:'application/json'},credentials:'omit',cache:'no-store',redirect:'error',signal});
     if(!response.ok)throw Error('CoinLore HTTP '+response.status+'; source blocked without retry');
     const contentType=response.headers?.get?.('content-type')||'';if(!/json/i.test(contentType))throw Error('CoinLore non-JSON response');
     const bytes=await response.arrayBuffer();check();if(bytes.byteLength>MAX_BYTES)throw Error('CoinLore response size limit exceeded');
     const receivedAt=now(),sha256=await digest(bytes);check();const raw=JSON.parse(new TextDecoder().decode(bytes));
     const receipt={key,url,startedAt:requestStartedAt,receivedAt,status:response.status,contentType,bytes:bytes.byteLength,sha256,sourceTs:null};provenance.push(receipt);status.lastResponseAt=receivedAt;return {raw,receipt};
    }finally{clearTimeout(timeout);}
   }
   function put(result,receipt){if(!entries.has(result.id)){foreign.add(result.id);return false;}if(entries.get(result.id).status!=='unattempted'){duplicates++;return false;}entries.set(result.id,{id:result.id,status:result.status,reason:result.reason||null,sourceSha256:receipt.sha256,receivedAt:receipt.receivedAt});if(result.row)rows.set(result.id,result.row);return true;}
   function publishBatch(results,receipt,phase,page=null){const accepted=[];for(const result of results)if(put(result,receipt))accepted.push(result);const batchRows=accepted.filter(r=>r.row).map(r=>r.row);preserveImages(batchRows,provenance);publishProgress(phase);status.lastSourceResponseAt=receipt.sourceTs;status.progress=copy(progress);emit(options.onBatch,{schemaVersion:1,kind:'catalog-price-batch',sourceId:C.SOURCE_ID,currency:'USD',scanId:myEpoch,collectionStartedAt:startedAt,receivedAt:receipt.receivedAt,sourceResponseAt:receipt.sourceTs,sourceSha256:receipt.sha256,sourceUrl:receipt.url,page,rows:batchRows,entries:accepted.map(r=>copy(entries.get(r.id))),attemptedCount:progress.attemptedCount,expectedCount:catalog.length,pricedCount:progress.pricedCount,noQuoteCount:progress.noQuoteCount,requests,pages,complete:false,nonAtomic:true,provenance:provenance.filter(p=>p.sha256===receipt.sha256||batchRows.some(r=>r.imageSource?.sourceSha256===p.sha256))});emit(options.onStatus,status);}
   try{
    publishProgress('catalog_before');const first=await get('catalog-before',C.ORIGIN+'/api/assets/');catalog=C.parseCatalog(first.raw);beforeReceipt=first.receipt;
    if(Math.ceil(catalog.length/C.MAX_PAGE)>MAX_PAGES)throw Error('CoinLore page safety limit exceeded');
    for(const a of catalog)entries.set(a.id,{id:a.id,status:'unattempted',reason:'Not observed in this capture'});
    publishProgress('catalog_frozen');const pageTotal=Math.ceil(catalog.length/C.MAX_PAGE);
    for(let page=0;page<pageTotal;page++){
     const {raw,receipt}=await get('page-'+page,C.ORIGIN+'/api/tickers/?start='+(page*C.MAX_PAGE)+'&limit='+C.MAX_PAGE);
     const parsed=C.parsePage(raw,{...receipt,sourceSha256:receipt.sha256,sourceUrl:receipt.url,sourcePage:page+1});receipt.sourceTs=parsed.sourceTs;pageCounts.push(parsed.reportedCount);pages++;publishBatch(parsed.results,receipt,'prices',page+1);
    }
    const last=await get('catalog-after',C.ORIGIN+'/api/assets/');after=C.parseCatalog(last.raw);afterReceipt=last.receipt;
    // Ranking can move between pages. This is a fresh request for explicit
    // missing frozen IDs, never a retry of a denied or failed request.
    const missing=[...entries.values()].filter(e=>e.status==='unattempted').map(e=>e.id);
    for(let offset=0;offset<missing.length;offset+=50){
     const ids=missing.slice(offset,offset+50),batch='missing-'+Math.floor(offset/50),{raw,receipt}=await get(batch,C.ORIGIN+'/api/ticker/?id='+ids.join(','));
     publishBatch(C.parseSpecific(raw,{...receipt,sourceSha256:receipt.sha256,sourceUrl:receipt.url,sourceBatch:batch},ids),receipt,'missing_ids');
     for(const id of ids)if(entries.get(id).status==='unattempted')entries.set(id,{id,status:'missing',reason:'Explicit requested ID absent from source response',sourceSha256:receipt.sha256,receivedAt:receipt.receivedAt});publishProgress('missing_ids');
    }
    check();const finishedAt=now(),counts=publishProgress('validated'),churn=C.catalogDelta(catalog,after);
    const complete=!!catalog.length&&!counts.missing&&!counts.invalid&&!counts.error&&!counts.unattempted&&!churn.added.length&&!churn.removed.length&&!foreign.size&&pageCounts.every(n=>n===catalog.length);
    const resultRows=[...rows.values()];preserveImages(resultRows,provenance);
    const coverage={catalogCount:catalog.length,pricedCount:counts.priced,attemptedCount:catalog.length-counts.unattempted,noQuoteCount:counts.no_quote,missingCount:counts.missing,invalidCount:counts.invalid,errorCount:counts.error,unattemptedCount:counts.unattempted,complete,providerReportedCounts:[...new Set(pageCounts)],pageCount:pages,duplicateObservations:duplicates,foreignObservedCount:foreign.size,logoCount:resultRows.filter(r=>r.imageIdentityVerified).length,catalogAfterCount:after.length,churn};
    const snapshot={schemaVersion:1,provider:C.PROVIDER,sourceId:C.SOURCE_ID,kind:'catalog-market',currency:'USD',startedAt,finishedAt,catalog,rows:resultRows,entries:[...entries.values()],coverage,collection:{state:complete?'complete':'partial',startedAt,finishedAt,expectedCount:catalog.length,counts,catalogBefore:beforeReceipt,catalogAfter:afterReceipt,nonAtomic:true},attribution:{label:'Market data: CoinLore',url:'https://www.coinlore.com/cryptocurrency-data-api'},provenance,errors,limitations:['CoinLore catalog only; not every token on every chain.','Non-atomic scan: each quote keeps its own source response and receipt time.','Response-generation time does not establish the underlying quote-update or last-trade time.','Different provider identities are not joined by ticker symbol.','30-day and 1-year returns remain null.','Prior logo metadata is retained only for the same verified CoinLore ID and identity.']};
    C.validateSnapshot(snapshot);check();
    if(!complete){progress={...progress,phase:'incomplete',complete:false};emit(options.onProgress,progress);setStatus('incomplete','Catalog changed, provider counts differ or unresolved IDs remain; prior verified snapshot retained');return {published:false,complete:false,coverage};}
    current=copy(snapshot);progress={...progress,phase:'complete',complete:true};status.lastSuccessAt=finishedAt;emit(options.onProgress,progress);emit(options.onUpdate,current);setStatus('waiting','Full frozen catalog captured; non-atomic source times preserved');await saveCurrent(current);return {published:true,complete:true,snapshot:copy(snapshot)};
   }catch(error){
    if(signal.aborted||error.name==='AbortError'||myEpoch!==epoch){publishProgress('paused');if(signal.reason==='request_timeout'){blocked=true;setStatus('blocked','CoinLore request timed out; no retry',{failureReason:'CoinLore request timed out; no retry'});return {published:false,blocked:true};}setStatus(blocked?'blocked':'paused',status.reason||'Scan paused; prior verified snapshot retained');return {published:false,paused:true};}
    blocked=true;errors.push({message:error.message,observedAt:now()});publishProgress('blocked');setStatus('blocked',error.message,{failureReason:error.message});return {published:false,blocked:true,error:error.message};
   }
  }
  function start(manual=true){
   if(destroyed||blocked)return Promise.resolve({published:false,blocked,destroyed});if(manual)userPaused=false;started=true;if(!active()){setStatus('paused',!visible?'hidden':!selected?'source_not_selected':'user_pause');return Promise.resolve({published:false,paused:true});}if(running)return running;
   clearRepeat();resumeRequested=false;controller=new AbortController();const signal=controller.signal,myEpoch=++epoch;setStatus('collecting','Sequential full-catalog scan');
   running=cacheReady.then(()=>scan(signal,myEpoch)).finally(()=>{running=null;controller=null;if(resumeRequested&&active()){resumeRequested=false;start(false);}else if(active()&&!blocked)planRepeat();});return running;
  }
  function visibility(){setActive({visible:documentRef.visibilityState!=='hidden'});}
  documentRef?.addEventListener?.('visibilitychange',visibility);
  function destroy(){started=false;destroyed=true;clearRepeat();controller?.abort();documentRef?.removeEventListener?.('visibilitychange',visibility);setStatus(blocked?'blocked':'paused',blocked?status.failureReason:'destroyed');}
  return Object.freeze({start,stop,setActive,setPaused,current:()=>copy(current),status:()=>copy(status),progress:()=>copy(progress),cacheReady:()=>cacheReady,destroy});
 }
 return Object.freeze({create,createSnapshotCache,SPACING,REPEAT_MS,MAX_PAGES});
});
