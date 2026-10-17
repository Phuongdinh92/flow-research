'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{webcrypto}=require('node:crypto');
const C=require('./coinlore-core.js'),L=require('./coinlore-live.js');
function asset(n){return {id:String(n),symbol:'C'+n,name:'Coin '+n,nameid:'coin-'+n,rank:n};}
function quote(n,price='1.25'){return {...asset(n),price_usd:price,market_cap_usd:'1000000',volume24:'5000',percent_change_1h:'1.2',percent_change_24h:'-0.5',percent_change_7d:'4.4'};}
function harness({count=201,handler,repeatMs=0,initialSnapshot=null,snapshotCache=false}={}){
 let clock=Date.UTC(2026,9,17),inflight=0,maxFlight=0;const calls=[],updates=[],batches=[],batchUpdateCounts=[],statuses=[],progress=[],timers=new Map();let timerId=0;
 const response=value=>new Response(JSON.stringify(value),{status:200,headers:{'content-type':'application/json'}});
 async function fetchImpl(url,options){assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.equal(new URL(url).origin,C.ORIGIN);calls.push({url,at:clock});inflight++;maxFlight=Math.max(maxFlight,inflight);try{await Promise.resolve();clock+=7;if(handler){const special=await handler({url,options,calls,clock,response,count});if(special!==undefined)return special;}const u=new URL(url);if(u.pathname==='/api/assets/')return response({data:Array.from({length:count},(_,i)=>asset(i+1))});if(u.pathname==='/api/tickers/'){const start=Number(u.searchParams.get('start'));return response({data:Array.from({length:Math.min(100,count-start)},(_,i)=>quote(start+i+1)),info:{coins_num:count,time:Math.floor(clock/1000)}});}if(u.pathname==='/api/ticker/')return response(u.searchParams.get('id').split(',').map(n=>quote(Number(n))));throw Error('Unexpected URL '+url);}finally{inflight--;}}
 const controller=L.create({fetchImpl,cryptoImpl:webcrypto,now:()=>clock,pause:async(ms,signal)=>{assert(ms>=0);if(signal.aborted)throw Error('aborted');clock+=ms;},repeatMs,initialSnapshot,snapshotCache,document:null,onBatch:x=>{batches.push(x);batchUpdateCounts.push(updates.length);},onUpdate:x=>updates.push(x),onStatus:x=>statuses.push(x),onProgress:x=>progress.push(x),setTimeout:(fn,ms)=>{const id=++timerId;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)});
 return {controller,calls,updates,batches,batchUpdateCounts,statuses,progress,timers,response,get maxFlight(){return maxFlight;},advance:ms=>{clock+=ms;}};
}
test('entire frozen catalog scans sequentially at bounded pacing and publishes only one complete snapshot',async()=>{
 const h=harness(),result=await h.controller.start();assert.equal(result.published,true);assert.equal(h.updates.length,1);const snapshot=h.updates[0];assert.equal(C.validateSnapshot(snapshot),snapshot);assert.equal(snapshot.rows.length,201);assert.equal(snapshot.coverage.pageCount,3);assert.equal(snapshot.collection.counts.unattempted,0);assert.equal(h.maxFlight,1);
 assert.equal(h.calls.length,5);for(let i=1;i<h.calls.length;i++)assert(h.calls[i].at-h.calls[i-1].at>=L.SPACING);
 for(const row of snapshot.rows){assert.equal(row.providerUpdatedAt,null);assert.equal(row.lastTradeAt,null);assert.equal(row.sourceResponseAt,row.sourceTs);assert.equal(row.return30dPct,null);assert.equal(row.return1yPct,null);assert.match(row.sourceSha256,/^[a-f0-9]{64}$/);}
 const external=h.controller.current();external.rows[0].priceUsd=999;assert.notEqual(h.controller.current().rows[0].priceUsd,999);h.controller.destroy();
});
test('rank pagination gaps use explicit missing IDs, preserving unknown source quote time',async()=>{
 const h=harness({handler:({url,clock,response,count})=>{const u=new URL(url);if(u.pathname==='/api/tickers/'&&u.searchParams.get('start')==='100')return response({data:Array.from({length:100},(_,i)=>quote(i+100)),info:{coins_num:count,time:Math.floor(clock/1000)}});}});
 const result=await h.controller.start();assert.equal(result.published,true);const snapshot=h.controller.current();assert.equal(snapshot.coverage.duplicateObservations,1);assert.equal(snapshot.coverage.attemptedCount,201);assert(h.calls.some(c=>c.url.endsWith('/api/ticker/?id=200')));const repaired=snapshot.rows.find(r=>r.id==='200');assert.equal(repaired.sourceTs,null);assert.equal(repaired.sourceResponseAt,null);assert.equal(repaired.providerUpdatedAt,null);assert.equal(repaired.lastTradeAt,null);h.controller.destroy();
});
test('zero quote is explicit no_quote and missing explicit ID never publishes partial data',async()=>{
 const zero=harness({count:2,handler:({url,clock,response,count})=>url.includes('/tickers/')?response({data:[quote(1),quote(2,'0')],info:{coins_num:count,time:Math.floor(clock/1000)}}):undefined});
 await zero.controller.start();assert.equal(zero.controller.current().coverage.noQuoteCount,1);assert.equal(zero.controller.current().rows.length,1);zero.controller.destroy();
 const missing=harness({count:2,handler:({url,clock,response,count})=>url.includes('/tickers/')?response({data:[quote(1)],info:{coins_num:count,time:Math.floor(clock/1000)}}):url.includes('/ticker/?')?response([]):undefined});
 const r=await missing.controller.start();assert.equal(r.published,false);assert.equal(r.complete,false);assert.equal(missing.controller.current(),null);assert.equal(missing.controller.status().state,'incomplete');assert.equal(missing.controller.progress().missingCount,1);missing.controller.destroy();
});
test('catalog churn retains previous snapshot and never labels new membership complete',async()=>{
 const first=harness({count:2});await first.controller.start();const previous=first.controller.current();first.controller.destroy();
 let assetCalls=0;const h=harness({count:2,initialSnapshot:previous,handler:({url,response})=>{if(url.endsWith('/api/assets/')&&++assetCalls===2)return response({data:[asset(1),asset(2),asset(3)]});}});
 const r=await h.controller.start();assert.equal(r.published,false);assert.equal(h.updates.length,0);assert.deepEqual(h.controller.current(),previous);assert.equal(h.controller.status().state,'incomplete');h.controller.destroy();
});
test('provider count mismatch or foreign observed IDs prevent a false whole-catalog publication',async()=>{
 for(const altered of ['count','foreign']){
  const h=harness({count:2,handler:({url,clock,response,count})=>url.includes('/tickers/')?response({data:altered==='foreign'?[quote(1),quote(3)]:[quote(1),quote(2)],info:{coins_num:altered==='count'?3:count,time:Math.floor(clock/1000)}}):undefined});
  const result=await h.controller.start();assert.equal(result.published,false);assert.equal(result.complete,false);assert.equal(h.controller.current(),null);assert.equal(h.controller.status().state,'incomplete');h.controller.destroy();
 }
});
test('first HTTP/access/CORS/schema failure blocks the session without retries or alternate hosts',async()=>{
 for(const fail of [()=>new Response('{}',{status:429,headers:{'content-type':'application/json'}}),()=>new Response('{}',{status:403,headers:{'content-type':'application/json'}}),()=>{throw TypeError('Failed to fetch (CORS)');},()=>new Response('not json',{status:200,headers:{'content-type':'text/html'}})]){
  const h=harness({handler:()=>fail()});assert.equal((await h.controller.start()).blocked,true);const count=h.calls.length;assert.equal((await h.controller.start()).blocked,true);h.controller.setActive({visible:false});h.controller.setActive({visible:true});await Promise.resolve();assert.equal(h.calls.length,count);assert.equal(h.controller.current(),null);assert.equal(h.controller.status().blocked,true);h.controller.destroy();
 }
});
test('hiding aborts an in-flight scan, records a gap and preserves the prior verified snapshot',async()=>{
 const first=harness({count:1});await first.controller.start();const previous=first.controller.current();first.controller.destroy();
 const h=harness({initialSnapshot:previous,handler:({options})=>new Promise((resolve,reject)=>{options.signal.addEventListener('abort',()=>{const e=Error('Abort');e.name='AbortError';reject(e);},{once:true});})});
 const pending=h.controller.start();await Promise.resolve();await Promise.resolve();h.controller.setActive({visible:false});const result=await pending;assert.equal(result.paused,true);assert.equal(h.controller.status().blocked,false);assert.equal(h.controller.status().gaps.length,1);assert.deepEqual(h.controller.current(),previous);assert.equal(h.updates.length,0);h.controller.destroy();
});
test('concurrent starts share one pass and selected/visible/user-pause controls gate repeated scans',async()=>{
 const h=harness({count:2,repeatMs:600000});const a=h.controller.start(),b=h.controller.start();assert.equal(a,b);await a;assert.equal(h.updates.length,1);assert.equal(h.timers.size,1);assert.equal([...h.timers.values()][0].ms,600000);
 h.controller.setActive({selected:false});assert.equal(h.timers.size,0);const before=h.calls.length;assert.equal((await h.controller.start()).paused,true);assert.equal(h.calls.length,before);
 h.controller.setPaused(true);h.controller.setActive({selected:true});await Promise.resolve();assert.equal(h.calls.length,before);h.controller.destroy();
});
test('normal continuous scans retain request spacing and a real thirty-second quiet interval',async()=>{
 assert.equal(L.SPACING,1100);assert.equal(L.REPEAT_MS,30000);
 const timed=harness({count:201,repeatMs:L.REPEAT_MS});await timed.controller.start();
 assert.equal([...timed.timers.values()][0].ms,30000);
 assert(timed.calls.slice(1).every((call,i)=>call.at-timed.calls[i].at>=1100));
 timed.controller.destroy();
});
test('cross-provider or unverified prior images cannot survive a price refresh',async()=>{
 const first=harness({count:2});await first.controller.start();const previous=first.controller.current();first.controller.destroy();
 // A core-validated snapshot has null images unless exact-ID provenance exists.
 const h=harness({count:2,initialSnapshot:previous});await h.controller.start();assert(h.controller.current().rows.every(r=>r.imageUrl===null&&r.imageIdentityVerified===false));h.controller.destroy();
});
test('only exact-ID metadata images retain their original provenance across a full refresh',async()=>{
 const first=harness({count:2});await first.controller.start();const previous=first.controller.current();first.controller.destroy();
 previous.rows[1].symbol='CHANGED';
 for(const [i,row]of previous.rows.entries()){
  const source={key:'info-'+row.id,url:C.ORIGIN+'/api/coin/info/?id='+row.id,startedAt:previous.startedAt,receivedAt:previous.startedAt,status:200,sha256:String(i+1).repeat(64),sourceTs:null};previous.provenance.push(source);
  row.imageUrl='https://c2.coinlore.com/img/logo/coin-'+row.id+'.png';row.image=row.imageUrl;row.imageIdentityVerified=true;row.imageSource={url:source.url,sourceSha256:source.sha256,receivedAt:source.receivedAt,id:row.id,returnedId:row.id,returnedSymbol:row.symbol,returnedNameid:row.nameid,returnedLogoUrl:row.imageUrl};
 }
 C.validateSnapshot(previous);
 const h=harness({count:2,initialSnapshot:previous});h.advance(3600000);await h.controller.start();const next=h.controller.current();C.validateSnapshot(next);
 assert.equal(next.rows[0].imageUrl,previous.rows[0].imageUrl);assert.deepEqual(next.rows[0].imageSource,previous.rows[0].imageSource);assert(next.rows[0].receivedAt>previous.rows[0].receivedAt);
 assert.equal(next.rows[1].imageUrl,null);assert.equal(next.rows[1].imageIdentityVerified,false);h.controller.destroy();
});

test('verified page batches appear before whole-catalog publication and retain source receipt identity',async()=>{
 const h=harness({count:201});const pending=h.controller.start();while(h.batches.length===0)await new Promise(resolve=>setImmediate(resolve));await pending;
 assert.equal(h.batches.length,3);assert.deepEqual(h.batchUpdateCounts,[0,0,0]);assert.equal(h.batches[0].rows.length,100);assert.equal(h.batches[0].attemptedCount,100);assert.equal(h.batches[0].expectedCount,201);assert.equal(h.batches[0].complete,false);assert.equal(h.batches[0].nonAtomic,true);assert.equal(h.batches[2].attemptedCount,201);assert(h.batches[0].receivedAt<h.controller.current().collection.finishedAt);
 for(const batch of h.batches){assert.equal(batch.sourceId,'coinlore');assert.equal(batch.currency,'USD');for(const row of batch.rows){assert.equal(row.receivedAt,batch.receivedAt);assert.equal(row.sourceResponseAt,batch.sourceResponseAt);assert.equal(row.sourceSha256,batch.sourceSha256);assert.equal(row.sourceUrl,batch.sourceUrl);assert(batch.provenance.some(p=>p.sha256===row.sourceSha256));}}
 const status=h.controller.status();assert.equal(status.progress.phase,'complete');assert.equal(status.progress.complete,true);assert.equal(status.lastResponseAt,h.controller.current().collection.catalogAfter.receivedAt);assert.equal(status.lastSourceResponseAt,h.batches.at(-1).sourceResponseAt);h.controller.destroy();
});
test('foreign IDs and duplicate rank observations never leak into page batch membership',async()=>{
 const h=harness({count:2,handler:({url,clock,response,count})=>url.includes('/tickers/')?response({data:[quote(1),quote(3)],info:{coins_num:count,time:Math.floor(clock/1000)}}):undefined});
 await h.controller.start();assert.equal(h.updates.length,0);assert.deepEqual(h.batches[0].rows.map(r=>r.id),['1']);assert.deepEqual(h.batches.flatMap(b=>b.rows).map(r=>r.id),['1','2']);assert(h.batches.every(b=>b.rows.every(r=>['1','2'].includes(r.id))));h.controller.destroy();
});
test('no-quote batch entries stay explicit rather than silently leaving an old positive quote current',async()=>{
 const h=harness({count:2,handler:({url,clock,response,count})=>url.includes('/tickers/')?response({data:[quote(1),quote(2,'0?')],info:{coins_num:count,time:Math.floor(clock/1000)}}):undefined});await h.controller.start();assert.equal(h.batches[0].rows.length,1);assert.equal(h.batches[0].entries.find(e=>e.id==='2').status,'no_quote');assert.equal(h.batches[0].noQuoteCount,1);h.controller.destroy();
});
test('newer validated complete browser cache survives reload without resetting source timestamps',async()=>{
 const old=harness({count:2});await old.controller.start();const previous=old.controller.current();old.controller.destroy();
 const fresh=harness({count:2});fresh.advance(20000);await fresh.controller.start();const cached=fresh.controller.current();fresh.controller.destroy();
 const h=harness({count:2,initialSnapshot:previous,snapshotCache:{load:async()=>cached,save:async()=>{}}});h.advance(50000);await h.controller.cacheReady();assert.equal(h.calls.length,0);assert.deepEqual(h.controller.current(),cached);assert.equal(h.updates.length,1);assert.equal(h.controller.status().lastSuccessAt,cached.collection.finishedAt);assert.equal(h.controller.status().cache.state,'ready');assert.equal(h.controller.current().rows[0].receivedAt,cached.rows[0].receivedAt);h.controller.destroy();
});
test('stale, malformed or future cache cannot replace a newer complete source snapshot',async()=>{
 const first=harness({count:1});await first.controller.start();const previous=first.controller.current();first.controller.destroy();
 for(const cached of [{bad:true},{...previous,finishedAt:previous.finishedAt+3600000,collection:{...previous.collection,finishedAt:previous.finishedAt+3600000}},previous]){
  const h=harness({count:1,initialSnapshot:previous,snapshotCache:{load:async()=>cached,save:async()=>{}}});await h.controller.cacheReady();assert.deepEqual(h.controller.current(),previous);assert.equal(h.updates.length,0);assert.equal(h.controller.status().cache.state,cached===previous?'ready':'unavailable');h.controller.destroy();
 }
});
test('cache quota/read failures preserve useful complete source publication and original capture times',async()=>{
 let saved=0;const h=harness({count:2,snapshotCache:{load:async()=>{throw Error('storage denied');},save:async snapshot=>{assert.equal(snapshot.coverage.complete,true);saved++;throw Error('QuotaExceededError');}}});const result=await h.controller.start();assert.equal(result.published,true);assert.equal(saved,1);assert.equal(h.updates.length,1);assert.equal(h.controller.status().state,'waiting');assert.equal(h.controller.status().cache.state,'unavailable');assert.match(h.controller.status().cache.reason,/Quota/);h.controller.destroy();
});
function fakeIndexedDB(){
 const values=new Map();let failWrite=false;const db={objectStoreNames:{contains:()=>true},close(){},transaction(name,mode){const tx={error:null,objectStore(){return {get(key){const req={};queueMicrotask(()=>{req.result=values.get(key);req.onsuccess?.();queueMicrotask(()=>tx.oncomplete?.());});return req;},put(value,key){queueMicrotask(()=>{if(failWrite){tx.error=Error('quota');tx.onabort?.();}else{values.set(key,value);tx.oncomplete?.();}});}};}};return tx;}};
 return {factory:{open(){const req={};queueMicrotask(()=>{req.result=db;req.onsuccess?.();});return req;}},values,denyWrites(){failWrite=true;}};
}
test('IndexedDB adapter round-trips the SHA-checked complete body and rejects corruption',async()=>{
 const first=harness({count:2});await first.controller.start();const snapshot=first.controller.current();first.controller.destroy();const db=fakeIndexedDB(),cache=L.createSnapshotCache({indexedDB:db.factory,cryptoImpl:webcrypto,databaseName:'test-cache'});assert.equal(await cache.load(),null);const written=await cache.save(snapshot);assert.equal(written.finishedAt,snapshot.collection.finishedAt);assert.match(written.sha256,/^[a-f0-9]{64}$/);assert.deepEqual(await cache.load(),snapshot);
 const record=db.values.get('complete');db.values.set('complete',{...record,body:record.body.replace('Coin 1','Coin X')});await assert.rejects(cache.load(),/integrity mismatch/);db.values.set('complete',record);db.denyWrites();await assert.rejects(cache.save(snapshot),/quota/);
});
test('incomplete or corrupted cache adapter payloads are never persisted',async()=>{
 const first=harness({count:2});await first.controller.start();const snapshot=first.controller.current();first.controller.destroy();const db=fakeIndexedDB(),cache=L.createSnapshotCache({indexedDB:db.factory,cryptoImpl:webcrypto});await assert.rejects(cache.save({...snapshot,collection:{...snapshot.collection,state:'partial'},coverage:{...snapshot.coverage,complete:false}}),/Only complete/);assert.equal(db.values.size,0);assert.equal(L.createSnapshotCache({indexedDB:null}),null);
});

test('an older tab cannot overwrite a newer complete browser cache',async()=>{
 const first=harness({count:1});await first.controller.start();const older=first.controller.current();first.controller.destroy();const second=harness({count:1});second.advance(20000);await second.controller.start();const newer=second.controller.current();second.controller.destroy();
 const db=fakeIndexedDB(),cache=L.createSnapshotCache({indexedDB:db.factory,cryptoImpl:webcrypto});await cache.save(newer);const result=await cache.save(older);assert.equal(result.retained,true);assert.equal(result.finishedAt,newer.collection.finishedAt);assert.deepEqual(await cache.load(),newer);
});
