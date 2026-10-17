'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const C=require('./coinlore-core.js'),{collect,SPACING}=require('./collect_coinlore.cjs'),BASE=1792245950000;
const asset=(n,extra={})=>({id:String(n),symbol:'C'+n,name:'Coin '+n,nameid:'coin-'+n,rank:n,...extra});
const rawQuote=(n,extra={})=>({...asset(n),price_usd:'0.000000001234',market_cap_usd:'123456',volume24:12.345,percent_change_1h:'-1.2',percent_change_24h:'2.3',percent_change_7d:'4.5',...extra});
const meta={receivedAt:BASE,sourceTs:BASE-2000,sourceSha256:'a'.repeat(64),sourceUrl:C.ORIGIN+'/api/tickers/?start=0&limit=100'};
test('CoinLore identities remain provider-native and never use ticker symbols as IDs',()=>{
 const a=C.quote(rawQuote(1,{symbol:'SAME'}),meta).row,b=C.quote(rawQuote(2,{symbol:'SAME'}),meta).row;assert.notEqual(a.key,b.key);assert.equal(a.key,'coinlore:1');assert.equal(a.priceUsd,0.000000001234);assert.equal(a.volume24hUsd,12.345);assert.equal(a.return24hPct,2.3);assert.equal(a.providerUpdatedAt,null);assert.equal(a.lastTradeAt,null);assert.equal(a.sourceResponseAt,meta.sourceTs);assert.equal(a.fetchedAt,meta.receivedAt);assert.equal(a.return30dPct,null);
});
test('source response generation never becomes individual last-trade or quote-update time',()=>{
 const p=C.parsePage({data:[rawQuote(1)],info:{coins_num:1,time:BASE/1000-100}},meta);assert.equal(p.sourceTs,BASE-100000);assert.equal(p.results[0].row.providerUpdatedAt,null);assert.equal(p.results[0].row.lastTradeAt,null);assert.equal(p.results[0].row.sourceResponseAt,BASE-100000);
 const a=C.parseSpecific([rawQuote(1)],meta,['1'])[0].row;assert.equal(a.sourceTs,null);assert.equal(a.sourceResponseAt,null);assert.equal(a.timestampKind,'response_received');
});
test('missing optional metrics, including actual 0? source sentinel, remain null not zero',()=>{
 const r=C.quote(rawQuote(1,{market_cap_usd:'0?',volume24:null,percent_change_7d:'nan'}),meta).row;assert.equal(r.marketCapUsd,null);assert.equal(r.volume24hUsd,null);assert.equal(r.return7dPct,null);assert.equal(r.activityKnown,false);assert.equal(r.warnings.length,2);
});
test('unreturned returns never get manufactured from another timeframe',()=>{
 const r=C.quote(rawQuote(1,{percent_change_1h:null,percent_change_24h:'',percent_change_7d:undefined}),meta).row;for(const k of ['return1hPct','return24hPct','return7dPct','return30dPct','return1yPct'])assert.equal(r[k],null);
});
test('zero price is explicitly unquoted while negative or corrupt essential prices fail',()=>{
 for(const v of ['0','0?','',null])assert.equal(C.quote(rawQuote(1,{price_usd:v}),meta).status,'no_quote');for(const v of ['NaN','Infinity','-1','0x10',' 1',{},true])assert.throws(()=>C.quote(rawQuote(1,{price_usd:v}),meta));assert.equal(C.quote(rawQuote(1,{price_usd:'1.31E-11'}),meta).row.priceUsd,1.31e-11);const p=C.parsePage({data:[rawQuote(1,{price_usd:'NaN'}),rawQuote(2)],info:{coins_num:2,time:BASE/1000}},meta);assert.equal(p.results[0].status,'invalid');assert.equal(p.results[1].status,'priced');
});
test('catalog and pages reject duplicate identities, foreign IDs and oversized pages',()=>{
 assert.throws(()=>C.parseCatalog({data:[asset(1),asset(1)]}));assert.throws(()=>C.parseSpecific([rawQuote(2)],meta,['1']));assert.throws(()=>C.parseSpecific([rawQuote(1),rawQuote(1)],meta,['1']));assert.throws(()=>C.parsePage({data:Array.from({length:101},(_,i)=>rawQuote(i+1)),info:{coins_num:101,time:BASE/1000}},meta));assert.throws(()=>C.parsePage({data:[rawQuote(1),rawQuote(1)],info:{coins_num:2,time:BASE/1000}},meta));
});
test('timestamps reject second/microsecond confusion and future source responses',()=>{
 for(const t of [BASE,BASE*1000,BASE/1000+61])assert.throws(()=>C.sourceTime(t,BASE));assert.throws(()=>C.quote(rawQuote(1),{...meta,receivedAt:BASE/1000}));
});
function fixture({count=201,failAt=null,omit=null,churn=false,logoError=false}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'coinlore-test-')),rawDirectory=path.join(root,'raw');fs.mkdirSync(path.join(root,'data'));let clock=BASE,catalogCalls=0;const calls=[],catalog=Array.from({length:count},(_,i)=>asset(i+1));
 const fetchImpl=async url=>{calls.push({url,startedAt:clock});clock+=10;const u=new URL(url);let value,status=200;
  if(failAt&&calls.length===failAt){status=429;value={error:'Too many requests'};}
  else if(u.pathname==='/api/assets/'){catalogCalls++;value={data:churn&&catalogCalls===2?[...catalog,asset(count+1)]:catalog};}
  else if(u.pathname==='/api/tickers/'){const start=Number(u.searchParams.get('start')),limit=Number(u.searchParams.get('limit'));value={data:catalog.slice(start,start+limit).filter(a=>a.id!==omit).map(a=>rawQuote(Number(a.id))),info:{coins_num:count,time:Math.floor(clock/1000)}};}
  else if(u.pathname==='/api/ticker/'){value=u.searchParams.get('id').split(',').map(n=>rawQuote(Number(n)));}
  else if(u.pathname==='/api/coin/info/'){const n=u.searchParams.get('id');value=[{...asset(Number(n)),logo:logoError?'https://evil.example/coin.png':'https://c2.coinlore.com/img/25x25/coin-'+n+'.png'}];}
  else throw Error('Unexpected source URL');const b=Buffer.from(JSON.stringify(value));return {status,ok:status===200,headers:{get:()=> 'application/json'},arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)};
 };
 return {root,rawDirectory,calls,run:opts=>collect({repoDir:root,rawDirectory,fetchImpl,now:()=>clock,pause:async ms=>{clock+=ms;},logoCount:0,...opts}),read:()=>JSON.parse(fs.readFileSync(path.join(root,'data/coinlore-market.json'))),cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};
}
test('full census crosses 100/200 boundaries and partitions all frozen provider IDs',async()=>{
 const f=fixture();try{const r=await f.run();assert.equal(r.published,true);const s=f.read();assert.equal(s.rows.length,201);assert.equal(s.coverage.pricedCount,201);assert.equal(s.coverage.catalogCount,201);assert.equal(s.coverage.complete,true);assert.equal(s.coverage.pageCount,3);assert.equal(s.rows.at(-1).id,'201');assert.equal(C.validateSnapshot(s),s);for(let i=1;i<f.calls.length;i++)assert.ok(f.calls[i].startedAt-f.calls[i-1].startedAt>=SPACING);}finally{f.cleanup();}
});
test('rank-pagination gaps are repaired only by exact IDs without invented source timestamps',async()=>{
 const f=fixture({omit:'150'});try{await f.run();const s=f.read(),r=s.rows.find(x=>x.id==='150');assert.equal(s.coverage.complete,true);assert.ok(f.calls.some(x=>x.url===C.ORIGIN+'/api/ticker/?id=150'));assert.equal(r.sourceTs,null);assert.equal(r.providerUpdatedAt,null);assert.equal(r.return30dPct,null);}finally{f.cleanup();}
});
test('before/after catalog churn prevents a false complete-current-catalog claim',async()=>{
 const f=fixture({churn:true});try{await f.run();const s=f.read();assert.equal(s.coverage.complete,false);assert.equal(s.coverage.frozenCatalogComplete,true);assert.deepEqual(s.coverage.churn.added,['202']);assert.equal(s.collection.state,'partial');}finally{f.cleanup();}
});
test('first HTTP error stops requests, preserves published data and blocks automatic retries',async()=>{
 const f=fixture({failAt:3});try{const previous=Buffer.from('{"previous":true}');fs.writeFileSync(path.join(f.root,'data/coinlore-market.json'),previous);const r=await f.run();assert.equal(r.published,false);assert.equal(f.calls.length,3);assert.equal(fs.readFileSync(path.join(f.root,'data/coinlore-market.json')).toString(),previous.toString());await assert.rejects(()=>f.run(),/Prior CoinLore source failure/);assert.equal(f.calls.length,3);}finally{f.cleanup();}
});
test('provider logos require exact-ID metadata and bind the source bytes and URL',async()=>{
 const f=fixture({count:2});try{await f.run({logoCount:2});const s=f.read();assert.equal(s.coverage.logoCount,2);assert.equal(s.rows[0].imageUrl,'https://c2.coinlore.com/img/25x25/coin-1.png');assert.equal(s.rows[0].imageIdentityVerified,true);const bad=structuredClone(s);bad.rows[0].imageSource.id='2';assert.throws(()=>C.validateSnapshot(bad),/Logo provenance/);}finally{f.cleanup();}
});
test('unexpected logo hosts stop collection and are never published',async()=>{
 const f=fixture({count:1,logoError:true});try{const r=await f.run({logoCount:1});assert.equal(r.published,false);assert.match(r.errors[0].message,/logo origin/);assert.equal(f.calls.length,4);}finally{f.cleanup();}
});
test('coverage, source timing and provider identity corruption are rejected',async()=>{
 const f=fixture({count:2});try{await f.run();const s=f.read();for(const mutate of [x=>x.coverage.pricedCount++,x=>x.rows[0].providerUpdatedAt=BASE,x=>x.rows[0].sourceResponseAt++,x=>x.rows[0].sourceSha256='b'.repeat(64),x=>x.rows[0].key='coingecko:coin-1',x=>x.entries[0].receivedAt++,x=>x.catalog.pop(),x=>x.rows[0].imageUrl='https://c2.coinlore.com/img/25x25/fake.png',x=>x.coverage.foreignObservedCount++,x=>x.coverage.providerReportedCounts=[999],x=>x.coverage.catalogAfterCount++,x=>x.coverage.churn.added.push('999')]){const bad=structuredClone(s);mutate(bad);assert.throws(()=>C.validateSnapshot(bad));}}finally{f.cleanup();}
});
