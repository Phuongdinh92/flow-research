'use strict';
const assert=require('node:assert/strict'),G=require('./global-ui.js');
const now=Date.now(),base={id:'a-coin',sourceId:'coingecko',key:'coingecko:a-coin',symbol:'A',name:'Asset A',priceUsd:2,marketCapUsd:100,volume24hUsd:10,return24hPct:0,return7dPct:12.5,return30dPct:-20,providerUpdatedAt:now,fetchedAt:now};
const selected=(rows,extra={})=>G.selectRows(rows,{now,...extra});
assert.equal(selected([base]).rows[0].x,0);
assert.equal(selected([base],{period:'7d'}).rows[0].x,.125);
assert.equal(selected([base],{period:'30d'}).rows[0].x,-.2);
assert.equal(selected([base]).rows[0].quote,'USD');
console.log('ok - provider percent units become correct day/week/month coordinates and remain USD');
const old={...base,id:'old',key:'coingecko:old',providerUpdatedAt:now-900001,volume24hUsd:1e9};
const missing={...base,id:'missing',key:'coingecko:missing',return7dPct:null};
const future={...base,id:'future',key:'coingecko:future',providerUpdatedAt:now+60001};
const zero={...base,id:'zero',key:'coingecko:zero',volume24hUsd:0};
const r=selected([base,old,missing,future,zero],{period:'7d'});
assert.equal(r.matching,5);assert.equal(r.available,1);assert.equal(r.missing,4);assert.equal(r.rows[0].id,'a-coin');
console.log('ok - stale, future, unavailable and zero-volume rows do not masquerade as current bubbles');
const other={...base,id:'different-asset',key:'coingecko:different-asset',name:'Different Asset',marketCapUsd:200};
const same=selected([base,other]);assert.equal(same.rows.length,2);assert.equal(same.rows[0].key,'coingecko:different-asset');assert.notEqual(same.rows[0].key,same.rows[1].key);
assert.equal(selected([base,other],{query:'different',limit:1}).rows[0].id,'different-asset');
console.log('ok - shared ticker symbols retain distinct provider IDs with explicit market-cap selection');
assert.throws(()=>selected([base],{period:'year'}));
console.log('4 global display checks passed');

(async()=>{
 const clone=v=>JSON.parse(JSON.stringify(v)),sha='a'.repeat(64),old={snapshot:{global:{generationId:'old'}},categories:{rows:[]},coverage:{generationId:'old'},coverageSha256:'b'.repeat(64)},store=G.createBundleStore(old);
 function fixture({generation='new',coverageGeneration=generation,manifestHash=sha,boundHash=sha,reject=null,scope='active_catalog'}={}){
  const market={schemaVersion:1,global:{rankScope:scope,generationId:generation,catalogCoverage:{coverageSha256:boundHash}}},coverage={schemaVersion:1,generationId:coverageGeneration},categories={schemaVersion:1,provider:'CoinGecko',currency:'USD',generatedAt:now,source:{url:'https://api.coingecko.com/api/v3/coins/categories?order=market_cap_desc',sha256:'c'.repeat(64),inputCount:0},rows:[]};
  const calls=[],pairCalls=[],ecosystem={validateSnapshot:v=>v,validateCoverageLedger:v=>v,validateMarketCoveragePair:(s,l,{coverageSha256})=>{pairCalls.push(coverageSha256);assert.equal(s.global.generationId,l.generationId,'generation mismatch');assert.equal(s.global.catalogCoverage.coverageSha256,coverageSha256,'coverage hash mismatch');return true;}};
  const transport={loadVerified:async(path,options)=>{calls.push(path);if(reject&&path.includes(reject))throw Error('Source transport failed');const data=path.includes('ecosystem')?market:path.includes('coverage')?coverage:categories;options.validate(data);return {data,manifest:{payload:{decodedSha256:path.includes('coverage')?manifestHash:'d'.repeat(64)}}};}};
  return {options:{transport,ecosystem},market,coverage,categories,calls,pairCalls};
 }
 const before=clone(old),badGen=fixture({coverageGeneration:'other'});await assert.rejects(store.reload(badGen.options),/generation mismatch/);assert.equal(store.value,old);assert.deepEqual(old,before);
 const badHash=fixture({boundHash:'f'.repeat(64)});await assert.rejects(store.reload(badHash.options),/coverage hash mismatch/);assert.equal(store.value,old);
 const absentHash=fixture({manifestHash:null});await assert.rejects(store.reload(absentHash.options),/Manifest danh mục thiếu/);assert.equal(store.value,old);assert.equal(absentHash.pairCalls.length,0);
 const sourceFailed=fixture({reject:'categories'});await assert.rejects(store.reload(sourceFailed.options),/Source transport failed/);assert.equal(store.value,old);assert.equal(sourceFailed.calls.length,2);
 const legacy=fixture({scope:'top_market_cap'}),legacyStore=G.createBundleStore();await legacyStore.reload(legacy.options);assert.equal(legacyStore.value.snapshot,legacy.market);assert.equal(legacyStore.value.coverage,null);assert.equal(legacy.pairCalls.length,0);assert.equal(legacy.calls.length,2);
 const preservedLegacy=legacyStore.value;await assert.rejects(legacyStore.reload(fixture({coverageGeneration:'bad-active'}).options));assert.equal(legacyStore.value,preservedLegacy);assert.equal(legacyStore.value.coverage,null);
 const next=fixture();await store.reload(next.options);assert.equal(store.value.snapshot,next.market);assert.equal(store.value.coverage,next.coverage);assert.equal(store.value.categories,next.categories);assert.deepEqual(next.pairCalls,[sha]);assert.deepEqual(next.calls.sort(),['data/ecosystem-snapshot.json','data/market-categories.json','data/market-coverage.json']);
 const keep=store.value;await assert.rejects(store.reload(fixture({coverageGeneration:'bad-next'}).options));assert.equal(store.value,keep);assert.equal(store.value.coverage,next.coverage);
 console.log('ok - verified bundle changes atomically; source, generation, missing decoded hash and hash mismatch preserve the previous whole pair');
})().catch(e=>{console.error(e);process.exitCode=1;});

(async()=>{
 const fs=require('node:fs'),zlib=require('node:zlib'),crypto=require('node:crypto'),E=require('./ecosystem.js'),P=require('./public-data.js');
 const hash=b=>crypto.createHash('sha256').update(b).digest('hex'),names=['ecosystem-snapshot','market-categories','market-collection-attempt'],fixtures=new Map(),calls=[];
 for(const name of names){const data=JSON.parse(fs.readFileSync('data/'+name+'.json'));if(name==='ecosystem-snapshot')data.global.rankScope='top_market_cap';const decoded=Buffer.from(JSON.stringify(data)),compressed=zlib.gzipSync(decoded),manifest={schemaVersion:1,kind:'public-data-manifest',transportVersion:1,identity:{schemaVersion:1},payload:{url:name+'.json.gz',compression:'gzip',bytes:compressed.length,sha256:hash(compressed),decodedBytes:decoded.length,decodedSha256:hash(decoded)}};fixtures.set('data/'+name+'.json.manifest.json',{ok:true,json:async()=>manifest});fixtures.set('data/'+name+'.json.gz',{ok:true,arrayBuffer:async()=>compressed.buffer.slice(compressed.byteOffset,compressed.byteOffset+compressed.byteLength)});}
 const store=G.createBundleStore(),out=await store.reload({transport:P,ecosystem:E,fetchImpl:async url=>{calls.push(url);return fixtures.get(url)||{ok:false,status:404};}});
 assert.equal(out.coverage,null);assert.equal(out.snapshot.global.rankScope,'top_market_cap');assert.equal(out.attempt.counts.catalogCount,out.attempt.entries.length);assert.equal(out.attempt.counts.attempted+out.attempt.counts.unattempted,out.attempt.counts.catalogCount);assert.ok(calls.every(u=>!u.includes('market-coverage')));assert.equal(calls.length,6);
 assert.equal(out.snapshot.global.pricedCount,out.snapshot.global.pricedRows.length);assert.ok(!out.attempt.entries.some(r=>'priceUsd'in r));
 console.log('ok - real gzip+SHA transport and schemas retain the limited price snapshot while exposing the independent full-catalog failed-attempt metadata, without old-price joins');
})().catch(e=>{console.error(e);process.exitCode=1;});
