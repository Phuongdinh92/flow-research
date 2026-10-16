'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const U=require('./market-ui.js'),DAY=86400000,now=Date.now(),today=Math.floor(now/DAY)*DAY;
const row=(sourceId='binance',extra={})=>({key:sourceId+':BTCUSDT',sourceId,instrument:'BTCUSDT',base:'BTC',quote:'USDT',last:100,return24:0.02,turnover24:1000,asOf:now,...extra});
const source=(sourceId='binance',extra={})=>({sourceId,name:U.NAMES[sourceId],asOf:now,fetchedAt:now,instrumentCount:2,rows:[row(sourceId)],errors:[],...extra});
const snapshot=sources=>({schemaVersion:1,generatedAt:now,sources});
const bars=()=>Array.from({length:31},(_,i)=>{const time=today-(31-i)*DAY;return {time,end:time+DAY-1,open:100,high:150,low:80,close:100+i,quote:i===30?100:1,buy:i===30?90:0};});
const tests=[];const test=(name,fn)=>tests.push({name,fn});
test('31-day summaries use exact endpoints and quote-weighted buy share',()=>{
 const r=U.summarize(bars(),now);assert.equal(r.return7,130/123-1);assert(Math.abs(r.return30-0.3)<1e-12);assert.equal(r.buyShare,90/106);assert.equal(r.turnover,119/20);
});
test('missing latest closed UTC day, gaps and insufficient history block current summaries',()=>{
 assert.throws(()=>U.summarize(bars().slice(1),now),/31/);
 const gap=bars();gap[2].time-=DAY;gap[2].end-=DAY;assert.throws(()=>U.summarize(gap,now),/Thiếu ngày/);
 const delayed=bars().map(b=>({...b,time:b.time-DAY,end:b.end-DAY}));assert.throws(()=>U.summarize(delayed,now),/mới nhất/);
});
test('unavailable taker-buy stays null, numeric zero stays zero',()=>{
 assert.equal(U.summarize(bars().map(b=>({...b,buy:null})),now).buyShare,null);
 assert.equal(U.summarize(bars().map(b=>({...b,buy:0})),now).buyShare,0);
});
test('one complete source outage does not discard another source or coverage denominator',()=>{
 const s=U.validateSnapshot(snapshot([source(),source('bitget',{fetchedAt:null,asOf:null,rows:[],instrumentCount:0,errors:['HTTP403']})]),now);
 assert.equal(s[0].rows.length,1);assert.equal(s[0].instrumentCount,2);assert.equal(s[1].rows.length,0);
});
test('venue identity and Unicode identifiers survive snapshots without merging',()=>{
 const a=source('binance',{rows:[row('binance',{key:'binance:币安人生USDT',instrument:'币安人生USDT',base:'币安人生'})]});
 const s=U.validateSnapshot(snapshot([a,source('bitget')]),now);assert.equal(U.rowsFor(s).length,2);
 const both=U.validateSnapshot(snapshot([source(),source('bitget')]),now);assert.equal(U.rowsFor(both).length,2);
 assert.equal(U.rowsFor(both,{source:'bitget',query:'btc'}).length,1);
});
test('stale saved rows keep original timestamps and are labelled stale',()=>{
 const s=U.validateSnapshot(snapshot([source('binance',{rows:[row('binance',{asOf:now-U.TTL-1})]})]),now);
 const r=U.rowsFor(s,{now})[0];assert.equal(r.stale,true);assert.equal(r.mode,'saved');assert.equal(r.asOf,now-U.TTL-1);
});
test('malformed identifiers, duplicate keys, zero price and fake future timestamps reject snapshots',()=>{
 for(const extra of [{last:0},{asOf:now+U.TTL+1},{base:'<script>'},{instrument:'BTC/USDT'}])assert.throws(()=>U.validateSnapshot(snapshot([source('binance',{rows:[row('binance',extra)]})]),now));
 assert.throws(()=>U.validateSnapshot(snapshot([source('binance',{rows:[row(),row()]})]),now));
});

function domHarness(initialFetch,scanSource,history=async id=>({bars:bars().map(b=>({...b,buy:id==='bitget'?null:b.buy})),asOf:now,fetchedAt:now,dropped:1}),sourceList){
 const ids=['load','count','source-count','coverage-sub','asof','fetched','coverage','export','search','source','sort','table','prev','next','page-info','status','log','detail','detail-title','detail-body','close','overview-chart','overview-meta','view-bubbles','view-scatter','chart-exclusions','flow-chart','flow-meta','flow-exclusions','bubble-size','bubble-count','history-count','load-history','cancel-history','history-status'];
 class Element{constructor(id){this.id=id;this.value=id==='source'?'all':id==='sort'?'turnover24':'';this.textContent=id==='log'?'Chưa gửi yêu cầu mạng.':'';this.innerHTML='';this.handlers={};this.open=false;}addEventListener(k,f){this.handlers[k]=f;}showModal(){this.open=true;}close(){this.open=false;}}
 const nodes=Object.fromEntries(ids.map(id=>[id,new Element(id)])),nav=new Element('nav');
 const ctx={console,Date,Blob,URL,setTimeout,clearTimeout,AbortSignal,setInterval:()=>0,FlowCharts:require('./charts-core.js'),FlowChartsView:require('./charts-view.js'),FlowMarket:{scanSource,history,...(sourceList?{SOURCES:sourceList}:{})},fetch:initialFetch,document:{querySelector:s=>s==='nav'?nav:nodes[s.slice(1)],querySelectorAll:()=>[],createElement:()=>({click(){}})}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync('./market-ui.js','utf8'),ctx);return {nodes,ctx};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('delayed startup snapshot cannot overwrite a newer successful live scan',async()=>{
 let resolveInitial;const promise=new Promise(r=>resolveInitial=r);
 const h=domHarness(()=>promise,async id=>source(id,{instrumentCount:1}));
 await h.nodes.load.handlers.click();assert.equal(h.nodes.count.textContent,'2');assert.match(h.nodes.status.textContent,/2\/2 nguồn/);
 resolveInitial({ok:true,json:async()=>snapshot([source('binance',{rows:[],instrumentCount:0})])});await flush();assert.equal(h.nodes.count.textContent,'2');assert.match(h.nodes.coverage.innerHTML,/Đã đọc trực tiếp/);
});
test('failed live source retains earlier saved rows, timestamps and explicit error',async()=>{
 const h=domHarness(async()=>({ok:true,json:async()=>snapshot([source(),source('bitget')])}),async id=>{if(id==='bitget')throw Error('HTTP403');return source(id);});
 await flush();await h.nodes.load.handlers.click();assert.equal(h.nodes.count.textContent,'2');assert.match(h.nodes.coverage.innerHTML,/Lần đọc mới lỗi: HTTP403/);assert.match(h.nodes.table.innerHTML,/Bản lưu/);assert.match(h.nodes.status.textContent,/1\/2 nguồn/);
});
test('missing snapshot remains empty and never fills synthetic production rows',async()=>{
 const h=domHarness(async()=>({ok:false,status:404}),async()=>{throw Error('blocked');});await flush();assert.equal(h.nodes.count.textContent,'0');assert.match(h.nodes.table.innerHTML,/Chưa có dữ liệu/);
});
function flowSnapshot(){const b=bars(),seven=b.slice(-7),quote7=seven.reduce((n,b)=>n+b.quote,0),buyQuote7=seven.reduce((n,b)=>n+b.buy,0);return {schemaVersion:1,sourceId:'binance',generatedAt:now,asOf:now,eligibleInstrumentCount:2,attemptedCount:1,records:[{key:'binance:BTCUSDT',sourceId:'binance',instrument:'BTCUSDT',base:'BTC',quote:'USDT',return7:130/123-1,return30:130/100-1,buyShare7:buyQuote7/quote7,quote7,buyQuote7,close:130,close7:123,turnover20:119/20,end:b.at(-1).end,firstTime:b[0].time,days:31,asOf:now,fetchedAt:now,provenance:{url:'https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=32',sha256:'a'.repeat(64)}}],errors:[]};}
function routeFetch(url){return Promise.resolve({ok:true,json:async()=>url.includes('flow-snapshot')?flowSnapshot():url.includes('history-snapshot')?{schemaVersion:1,histories:{}}:snapshot([source(),source('bitget')])});}
test('restored map loads source-valid broad summaries and Bitget filter never borrows its taker data',async()=>{
 const h=domHarness(routeFetch,async id=>source(id));await flush();assert.match(h.nodes['flow-chart'].innerHTML,/data-key="binance:BTCUSDT"/);assert.match(h.nodes['overview-chart'].innerHTML,/data-key="bitget:BTCUSDT"/);
 h.nodes.source.value='bitget';h.nodes.source.handlers.change();assert.match(h.nodes['flow-chart'].innerHTML,/không có trường taker/);assert.match(h.nodes.table.innerHTML,/Bitget/);assert.doesNotMatch(h.nodes['overview-chart'].innerHTML,/data-key="binance:/);
});
test('market points open real candle, delta and window-reset CVD charts',async()=>{
 const h=domHarness(routeFetch,async id=>source(id));await flush();h.nodes['overview-chart'].handlers.click({target:{closest:()=>({dataset:{key:'binance:BTCUSDT'}})}});await flush();assert.equal(h.nodes.detail.open,true);assert.match(h.nodes['detail-body'].innerHTML,/chart-candle-body/);
 h.nodes['detail-body'].handlers.click({target:{closest:sel=>sel==='[data-chart-mode]'?({dataset:{chartMode:'delta'}}):null}});assert.match(h.nodes['detail-body'].innerHTML,/chart-price-overlay/);
 h.nodes['detail-body'].handlers.click({target:{closest:sel=>sel==='[data-chart-mode]'?({dataset:{chartMode:'cvd'}}):null}});assert.match(h.nodes['detail-body'].innerHTML,/chart-cvd-line/);assert.match(h.nodes['detail-body'].innerHTML,/mốc|CVD cộng dồn từ 0/);
 h.nodes['detail-body'].handlers.change({target:{matches:sel=>sel==='[data-detail-window]',value:'90'}});assert.match(h.nodes['detail-body'].innerHTML,/31\/90 ngày/);
});
test('cached-history source failure warning survives chart and window changes',async()=>{
 const old={bars:bars(),asOf:now,fetchedAt:now-600001,dropped:1};
 const fetcher=async url=>({ok:true,json:async()=>url.includes('history-snapshot')?{schemaVersion:1,histories:{'binance:BTCUSDT':old}}:url.includes('flow-snapshot')?flowSnapshot():snapshot([source()])});
 const h=domHarness(fetcher,async id=>source(id),async()=>{throw Error('HTTP403');});await flush();h.nodes.table.handlers.click({target:{closest:()=>({dataset:{key:'binance:BTCUSDT'}})}});await flush();assert.match(h.nodes['detail-body'].innerHTML,/Đọc mới thất bại: HTTP403/);
 h.nodes['detail-body'].handlers.click({target:{closest:sel=>sel==='[data-chart-mode]'?({dataset:{chartMode:'cvd'}}):null}});assert.match(h.nodes['detail-body'].innerHTML,/Đọc mới thất bại: HTTP403/);
 h.nodes['detail-body'].handlers.change({target:{matches:sel=>sel==='[data-detail-window]',value:'120'}});assert.match(h.nodes['detail-body'].innerHTML,/Đọc mới thất bại: HTTP403/);
});
test('Bitget daily detail leaves taker charts unavailable instead of zero-filled',async()=>{
 const h=domHarness(routeFetch,async id=>source(id));await flush();h.nodes.table.handlers.click({target:{closest:()=>({dataset:{key:'bitget:BTCUSDT'}})}});await flush();assert.match(h.nodes['detail-body'].innerHTML,/Nguồn nến Bitget không có dữ liệu taker/);assert.match(h.nodes['detail-body'].innerHTML,/data-chart-mode="cvd" disabled/);
});


test('weekly and calendar-month controls show complete periods and retain daily indicators',async()=>{
 const long=Array.from({length:121},(_,i)=>{const time=today-(121-i)*DAY,close=100+i;return {time,end:time+DAY-1,open:close-1,high:close+2,low:close-2,close,quote:10,buy:6};});
 const h=domHarness(routeFetch,async id=>source(id),async()=>({bars:long,asOf:now,fetchedAt:now,dropped:1}));await flush();h.nodes.table.handlers.click({target:{closest:()=>({dataset:{key:'binance:BTCUSDT'}})}});await flush();
 assert.match(h.nodes['detail-body'].innerHTML,/chart-ema50/);
 h.nodes['detail-body'].handlers.change({target:{matches:sel=>sel==='[data-detail-interval]',value:'1w'}});assert.match(h.nodes['detail-body'].innerHTML,/nến tuần hoàn chỉnh/);
 h.nodes['detail-body'].handlers.change({target:{matches:sel=>sel==='[data-detail-interval]',value:'1M'}});assert.match(h.nodes['detail-body'].innerHTML,/nến tháng hoàn chỉnh/);assert.match(h.nodes['detail-body'].innerHTML,/chart-ema50/);
});
test('gapped daily history keeps valid complete calendar periods while summary stats remain missing',async()=>{
 const long=Array.from({length:121},(_,i)=>{const time=today-(121-i)*DAY,close=100+i;return {time,end:time+DAY-1,open:close-1,high:close+2,low:close-2,close,quote:10,buy:6};}).filter((_,i)=>i!==100);
 const h=domHarness(routeFetch,async id=>source(id),async()=>({bars:long,asOf:now,fetchedAt:now,dropped:1}));await flush();h.nodes.table.handlers.click({target:{closest:()=>({dataset:{key:'binance:BTCUSDT'}})}});await flush();
 h.nodes['detail-body'].handlers.change({target:{matches:sel=>sel==='[data-detail-interval]',value:'1M'}});assert.match(h.nodes['detail-body'].innerHTML,/Chuỗi ngày thiếu hoặc không liên tục/);assert.match(h.nodes['detail-body'].innerHTML,/chart-candle-body/);assert.match(h.nodes['detail-body'].innerHTML,/nến tháng hoàn chỉnh/);
});


test('four-venue scans preserve the dated snapshot-only source without attempting forbidden browser fetches',async()=>{
 const ids=['binance','bitget','gate','whitebit'],calls=[];
 const h=domHarness(async()=>({ok:true,json:async()=>snapshot(ids.map(id=>source(id)))}),async id=>{calls.push(id);return source(id);},undefined,ids.map(id=>({id,name:U.NAMES[id],capabilities:{browserDirect:id!=='whitebit'}})));
 await flush();await h.nodes.load.handlers.click();assert.deepEqual(calls.sort(),['binance','bitget','gate']);assert.equal(h.nodes.count.textContent,'4');assert.equal(h.nodes['source-count'].textContent,'4 / 4');assert.match(h.nodes.status.textContent,/3\/3 nguồn/);assert.match(h.nodes.status.textContent,/1 nguồn chỉ dùng bản thu thập máy chủ/);
});

(async()=>{for(const t of tests){await t.fn();console.log('ok - '+t.name);}console.log(tests.length+' meaningful UI tests passed');})().catch(e=>{console.error(e);process.exitCode=1;});
