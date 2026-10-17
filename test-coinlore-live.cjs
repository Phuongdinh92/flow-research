'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{webcrypto}=require('node:crypto');
const C=require('./coinlore-core.js'),L=require('./coinlore-live.js');
function asset(n){return {id:String(n),symbol:'C'+n,name:'Coin '+n,nameid:'coin-'+n,rank:n};}
function quote(n,price='1.25'){return {...asset(n),price_usd:price,market_cap_usd:'1000000',volume24:'5000',percent_change_1h:'1.2',percent_change_24h:'-0.5',percent_change_7d:'4.4'};}
function harness({count=201,handler,repeatMs=0,initialSnapshot=null}={}){
 let clock=Date.UTC(2026,9,17),inflight=0,maxFlight=0;const calls=[],updates=[],statuses=[],progress=[],timers=new Map();let timerId=0;
 const response=value=>new Response(JSON.stringify(value),{status:200,headers:{'content-type':'application/json'}});
 async function fetchImpl(url,options){assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.equal(new URL(url).origin,C.ORIGIN);calls.push({url,at:clock});inflight++;maxFlight=Math.max(maxFlight,inflight);try{await Promise.resolve();clock+=7;if(handler){const special=await handler({url,options,calls,clock,response,count});if(special!==undefined)return special;}const u=new URL(url);if(u.pathname==='/api/assets/')return response({data:Array.from({length:count},(_,i)=>asset(i+1))});if(u.pathname==='/api/tickers/'){const start=Number(u.searchParams.get('start'));return response({data:Array.from({length:Math.min(100,count-start)},(_,i)=>quote(start+i+1)),info:{coins_num:count,time:Math.floor(clock/1000)}});}if(u.pathname==='/api/ticker/')return response(u.searchParams.get('id').split(',').map(n=>quote(Number(n))));throw Error('Unexpected URL '+url);}finally{inflight--;}}
 const controller=L.create({fetchImpl,cryptoImpl:webcrypto,now:()=>clock,pause:async(ms,signal)=>{assert(ms>=0);if(signal.aborted)throw Error('aborted');clock+=ms;},repeatMs,initialSnapshot,document:null,onUpdate:x=>updates.push(x),onStatus:x=>statuses.push(x),onProgress:x=>progress.push(x),setTimeout:(fn,ms)=>{const id=++timerId;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)});
 return {controller,calls,updates,statuses,progress,timers,response,get maxFlight(){return maxFlight;},advance:ms=>{clock+=ms;}};
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
