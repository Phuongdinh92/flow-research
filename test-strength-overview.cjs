'use strict';
const {test}=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), zlib=require('node:zlib');
const S=require('./strength-overview.js'), K=require('./instrument-classes.js');
const DAY=86400000, END=Date.UTC(2026,9,17)-1, NOW=Date.UTC(2026,9,18,8), HASH='a'.repeat(64), BHASH='b'.repeat(64), MHASH='c'.repeat(64);
function fixture(specs=[['BTC',30,60,100],['ETH',30,30,100]]) {
 const histories={},instruments=[];
 for(const [base,length,buy,quote] of specs){const instrument=base+'USDT',key='binance:'+instrument;instruments.push({instrument,key,base,quote:'USDT'});histories[key]={sourceId:'binance',instrument,key,base,quote:'USDT',asOf:END+1,fetchedAt:END+1000,bars:Array.from({length},(_,i)=>({time:END+1-(length-i)*DAY,end:END-(length-i-1)*DAY,open:10,high:12,low:9,close:11,quote,buy})),provenance:[{url:'https://data-api.binance.vision/api/v3/klines?symbol='+instrument+'&interval=1d&limit=401&endTime='+END,sha256:HASH,httpStatus:200}]};}
 const c={eligible:specs.length,attempted:specs.length,completed:specs.length,fullLength:0,shortHistory:specs.length,errors:0,unattempted:0},data={schemaVersion:1,kind:'cex-research',sourceId:'binance',collectionState:'complete',generatedAt:END+2000,requestedDays:401,endTime:END,universe:{instruments,eligibleInstrumentCount:specs.length},sourceCoverage:c,histories};
 return {data,manifest:{schemaVersion:1,kind:'cex-research-manifest',sourceId:'binance',collectionState:'complete',generatedAt:data.generatedAt,requestedDays:401,endTime:END,sourceCoverage:{...c},snapshot:{sha256:HASH,decodedSha256:HASH}}};
}
function identityFixture() {
 const sourceUrl='https://api.coingecko.com/api/v3/exchanges/binance/tickers?order=base_target&page=1', sourceReceivedAt=NOW-1000, raw={name:'Binance',tickers:[{base:'BTC',target:'USDT',market:{identifier:'binance'},coin_id:'bitcoin',target_coin_id:'tether'}]};
 const binding={key:'binance:BTCUSDT',sourceId:'binance',instrument:'BTCUSDT',base:'BTC',quote:'USDT',coinId:'bitcoin',targetCoinId:'tether',sourceUrl,sourceSha256:BHASH,sourceReceivedAt,sourceIndex:0};
 const identity={schemaVersion:1,kind:'exchange-asset-identity',provider:'CoinGecko',exchangeId:'binance',generatedAt:NOW,bindings:[binding],sourcePages:[{url:sourceUrl,httpStatus:200,receivedAt:sourceReceivedAt,sha256:BHASH,body:JSON.stringify(raw)}]};
 const url='https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=bitcoin',image='https://coin-images.coingecko.com/coins/images/1/large/bitcoin.png?123';
 const row={sourceId:'coingecko',id:'bitcoin',key:'coingecko:bitcoin',symbol:'btc',name:'Bitcoin',marketCapUsd:1e12,providerUpdatedAt:NOW-60000,receivedAt:NOW-1000,sourceSha256:MHASH,sourceUrl:url,imageUrl:image,imageIdentityVerified:true,imageSource:{id:'bitcoin',returnedId:'bitcoin',returnedImage:image,sourceSha256:MHASH,sourceUrl:url,receivedAt:NOW-1000}};
 const market={sourceId:'coingecko',provider:'CoinGecko',currency:'USD',rows:[row],provenance:[{url,sha256:MHASH,receivedAt:row.receivedAt,status:200}]};
 return {identity,market};
}
const derive=(d,o={})=>S.deriveModel(d,{now:NOW,classify:K.classify,...o});
test('measured taker share uses ratio of sums, never equal-weight means or fabricated zero scores',()=>{
 const d=fixture([['SMALL',30,9,10],['BIG',30,100,1000],['ZERO',30,0,0]]),m=derive(d);
 assert.equal(m.rows[0].buyShare,.9);assert.equal(m.rows[1].buyShare,.1);assert.equal(m.rows[2].buyShare,null);assert.equal(m.weightedBuyShare,109/1010);assert.notEqual(m.weightedBuyShare,.5);assert.equal(m.plotEligible,2);
 const joined=S.joinIdentity(m,null,null),selected=S.selectRows(joined);assert.equal(selected.rows.length,2);assert.equal(selected.zeroVolume,1);assert.equal(S.selectRows(joined,{axis:'cap'}).rows.length,0);
});
test('all periods keep exact archive cutoff and distinguish missing windows from no activity',()=>{
 const d=fixture([['NEW',1,6,10],['SEVEN',7,6,10],['THIRTY',30,6,10]]);
 for(const [days,count] of [[1,3],[7,2],[30,1]]){const m=derive(d,{days});assert.equal(m.coverage.eligible,count);assert.equal(m.end,END);assert.equal(m.start,END+1-days*DAY);for(const r of m.rows){assert.equal(r.buyShare,.6);assert.equal(r.net,2*days);}}
 assert.throws(()=>derive({...d,preview:true}),/mở nhanh/);d.data.histories['binance:THIRTYUSDT'].bars.at(-1).buy=null;assert.equal(derive(d,{days:30}).coverage.eligible,0);
});
test('market caps and native logos require exact source coin_id and source receipt, not ticker matches',()=>{
 const m=derive(fixture()),f=identityFixture(),j=S.joinIdentity(m,f.identity,f.market,{now:NOW});assert.equal(j.identityCoverage.cap,1);assert.equal(j.identityCoverage.logos,1);assert.equal(j.rows[0].marketIdentity.coinId,'bitcoin');assert.equal(j.rows[1].marketCapUsd,null);assert.equal(S.selectRows(j,{axis:'cap'}).rows[0].key,'binance:BTCUSDT');assert.equal(S.selectRows(j,{axis:'volume'}).rows.length,2);
 const sameSymbol={...f.market.rows[0],id:'fake-bitcoin',key:'coingecko:fake-bitcoin',symbol:'BTC'};assert.equal(S.joinIdentity(m,f.identity,{...f.market,rows:[sameSymbol]},{now:NOW}).identityCoverage.bound,0);
 for(const mutate of [x=>x.identity.bindings[0].coinId='fake-bitcoin',x=>x.identity.bindings[0].sourceIndex=4,x=>x.identity.bindings[0].sourceSha256='d'.repeat(64),x=>x.market.rows[0].sourceSha256='d'.repeat(64),x=>x.market.rows[0].providerUpdatedAt=NOW+120000,x=>x.market.rows[0].providerUpdatedAt=NOW-9000000]){const x=identityFixture();mutate(x);assert.equal(S.joinIdentity(m,x.identity,x.market,{now:NOW}).identityCoverage.bound,0);}
 const bad=identityFixture();bad.market.rows[0].imageSource.returnedId='wrong';const a=S.joinIdentity(m,bad.identity,bad.market,{now:NOW});assert.equal(a.identityCoverage.cap,1);assert.equal(a.identityCoverage.logos,0);
});
test('missing or zero market cap stays missing; logo invalid URLs and conflicting bindings fail closed',()=>{
 const m=derive(fixture());for(const value of [null,0,-1,Infinity]){const f=identityFixture();f.market.rows[0].marketCapUsd=value;const j=S.joinIdentity(m,f.identity,f.market,{now:NOW});assert.equal(j.rows[0].marketCapUsd,null);assert.equal(j.identityCoverage.cap,0);assert.equal(S.selectRows(j,{axis:'cap'}).rows.length,0);}
 for(const url of ['javascript:alert(1)','https://evil.example/coins/images/1/icon.png','https://user:pass@coin-images.coingecko.com/coins/images/1/icon.png'])assert.equal(S.safeImage(url),null);
 const f=identityFixture();f.identity.bindings.push({...f.identity.bindings[0],coinId:'other'});assert.equal(S.joinIdentity(m,f.identity,f.market,{now:NOW}).identityCoverage.bound,0);
});
test('log cap buckets have explicit non-overlapping thresholds and filters never change full-scope totals',()=>{
 const m=derive(fixture([['A',30,60,100],['B',30,40,100],['C',30,60,100],['D',30,40,100]]));m.rows.forEach((r,i)=>r.marketCapUsd=[1e9,1e8,1e7,1e6][i]);const before=JSON.stringify(m.totals);
 for(const [bucket,base] of [['large','A'],['mid','B'],['low','C'],['micro','D']])assert.equal(S.selectRows(m,{axis:'cap',bucket}).rows[0].base,base);
 assert.equal(S.selectRows(m,{axis:'cap',zoomStart:50,zoomEnd:100}).rows.length,2);assert.equal(S.selectRows(m,{query:'B'}).rows.length,1);assert.equal(JSON.stringify(m.totals),before);assert.throws(()=>S.selectRows(m,{zoomStart:99,zoomEnd:99}));
});
test('scatter coordinates encode exact logarithmic X and measured Y without repositioning overlapping data',()=>{
 const m=derive(fixture([['A',30,6,10],['B',30,60,100],['C',30,600,1000],['D',30,60,100]]));const selection=S.selectRows(m,{limit:'all'}),g=S.geometry(selection),a=g.points.find(p=>p.row.base==='A'),b=g.points.find(p=>p.row.base==='B'),c=g.points.find(p=>p.row.base==='C'),d=g.points.find(p=>p.row.base==='D');assert.ok(Math.abs((b.x-a.x)-(c.x-b.x))<1e-10);assert.equal(b.x,d.x);assert.equal(b.y,d.y);assert.equal(g.y(.5),g.pad.top+g.plotH/2);
 const html=S.renderScatter(selection);assert.match(html,/TỶ TRỌNG TAKER MUA · 0–1/);assert.match(html,/TỔNG QUOTE TRONG KỲ · USDT · LOGARIT/);assert.match(html,/tabindex="0"/);assert.doesNotMatch(html,/NaN|Infinity|Accumulation Strength Index|SMART.MONEY/);assert.match(S.renderScatter(selection,{view:'net'}),/NET MUA − BÁN · USDT/);
 const f=identityFixture(),j=S.joinIdentity(derive(fixture()),f.identity,f.market,{now:NOW}),capHtml=S.renderScatter(S.selectRows(j,{axis:'cap'}));assert.match(capHtml,/VỐN HÓA · USD · LOGARIT/);assert.match(capHtml,/<image class="so-logo" href="https:\/\/coin-images.coingecko.com/);assert.match(capHtml,/Thời điểm vốn hóa/);
});
test('real dataset independently reproduces 1/7/30-day measured shares and same-source totals',()=>{
 const data=JSON.parse(zlib.gunzipSync(fs.readFileSync('data/research-snapshot.json.gz'))),manifest=JSON.parse(fs.readFileSync('data/research-manifest.json'));
 for(const [days,count] of [[1,438],[7,433],[30,418]]){const m=derive({data,manifest},{days});assert.equal(m.coverage.eligible,count);const btc=m.rows.find(r=>r.key==='binance:BTCUSDT'),bars=data.histories[btc.key].bars.slice(-days),buy=bars.reduce((n,b)=>n+b.buy,0),quote=bars.reduce((n,b)=>n+b.quote,0);assert.ok(Math.abs(btc.buyShare-buy/quote)<1e-12);assert.equal(btc.end,data.endTime);assert.equal(m.topPositive.length,10);assert.ok(m.rows.every(r=>r.buyShare===null||(r.buyShare>=0&&r.buyShare<=1)));}
});
function viewHost(){const nodes=new Map(),events=new Map();const node=k=>{if(nodes.has(k))return nodes.get(k);const n={dataset:{},value:'',clientWidth:1200,textContent:'',innerHTML:'',classList:{add(){},toggle(){}},setAttribute(){},addEventListener(type,fn){this[type]=fn;}};nodes.set(k,n);return n;};return {node,events,host:{classList:{add(){}},innerHTML:'',querySelector:node,querySelectorAll:()=>[],addEventListener:(type,fn)=>events.set(type,fn)}};}
test('UI auto-selects verified cap view, preserves archive on refresh error and opens exact asset with pointer/keyboard',()=>{
 const d=viewHost(),opened=[],ui=S.mount(d.host,{now:()=>NOW,classify:K.classify,onOpen:(key,o)=>{opened.push([key,o.days]);return {ok:true};}});assert.match(d.node('[data-so-status]').textContent,/kho nến Binance đầy đủ/);assert.equal(ui.setDataset({...fixture(),preview:true}),false);assert.equal(ui.setDataset(fixture()),true);assert.equal(ui.snapshot().axis,'volume');const f=identityFixture();assert.equal(ui.setIdentity({bindings:f.identity,marketSnapshot:f.market}),true);assert.equal(ui.snapshot().axis,'cap');assert.match(d.node('[data-so-axis-note]').textContent,/Hai mốc khác nhau/);assert.match(d.node('[data-so-leaders]').innerHTML,/<img/);
 ui.setError('HTTP 503');assert.equal(ui.snapshot().model.end,END);assert.match(d.node('[data-so-status]').textContent,/giữ bản đã kiểm tra/);
 const asset={dataset:{soKey:'binance:BTCUSDT'}},target={closest:s=>s==='[data-so-key]'||s==='g[data-so-key]'?asset:null};d.events.get('click')({target});d.events.get('keydown')({target,key:'Enter',preventDefault(){}});assert.deepEqual(opened,[['binance:BTCUSDT',1],['binance:BTCUSDT',1]]);d.events.get('focusin')({target});assert.match(d.node('[data-so-inspect]').textContent,/bitcoin/);
 d.node('[data-so-axis]').change({target:{value:'volume'}});assert.equal(ui.snapshot().axis,'volume');ui.setIdentity({bindings:f.identity,marketSnapshot:f.market});assert.equal(ui.snapshot().axis,'volume');d.node('[data-so-search]').input({target:{value:'missing'}});assert.match(d.node('[data-so-plot]').innerHTML,/Không có cặp/);assert.equal(ui.snapshot().model.coverage.eligible,2);
});
test('retained real CoinGecko ticker identity links match native market IDs and keep unmatched pairs absent in cap mode',()=>{
 const CG=require('./coingecko-market'),data=JSON.parse(zlib.gunzipSync(fs.readFileSync('data/research-snapshot.json.gz'))),manifest=JSON.parse(fs.readFileSync('data/research-manifest.json')),identity=JSON.parse(fs.readFileSync('data/exchange-identity.json')),market=CG.fromSnapshot(JSON.parse(fs.readFileSync('data/ecosystem-snapshot.json'))),m=S.joinIdentity(derive({data,manifest}),identity,market,{now:NOW});
 assert.equal(identity.collectionComplete,false);assert.equal(m.identityCoverage.bound,126);assert.equal(m.identityCoverage.cap,126);assert.equal(m.identityCoverage.logos,126);assert.equal(m.identityCoverage.missing,312);assert.equal(m.identityCoverage.excluded.length,0);const btc=m.rows.find(r=>r.key==='binance:BTCUSDT');assert.equal(btc.marketIdentity.coinId,'bitcoin');assert.equal(btc.marketCapUsd,1642162428252);assert.ok(btc.marketIdentity.providerUpdatedAt>btc.end);assert.equal(S.selectRows(m,{axis:'cap',limit:'all'}).rows.length,126);assert.equal(S.selectRows(m,{axis:'volume',limit:'all'}).rows.length,438);
});
