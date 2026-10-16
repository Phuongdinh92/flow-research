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

function domHarness(initialFetch,scanSource){
 const ids=['load','count','source-count','coverage-sub','asof','fetched','coverage','export','search','source','sort','table','prev','next','page-info','status','log','detail','detail-title','detail-body','close'];
 class Element{constructor(id){this.id=id;this.value=id==='source'?'all':id==='sort'?'turnover24':'';this.textContent=id==='log'?'Chưa gửi yêu cầu mạng.':'';this.innerHTML='';this.handlers={};this.open=false;}addEventListener(k,f){this.handlers[k]=f;}showModal(){this.open=true;}close(){this.open=false;}}
 const nodes=Object.fromEntries(ids.map(id=>[id,new Element(id)])),nav=new Element('nav');
 const ctx={console,Date,Blob,URL,setTimeout,clearTimeout,AbortSignal,setInterval:()=>0,FlowMarket:{scanSource,history:async()=>({bars:bars(),asOf:now,fetchedAt:now,dropped:1})},fetch:initialFetch,document:{querySelector:s=>s==='nav'?nav:nodes[s.slice(1)],querySelectorAll:()=>[],createElement:()=>({click(){}})}};
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

(async()=>{for(const t of tests){await t.fn();console.log('ok - '+t.name);}console.log(tests.length+' meaningful UI tests passed');})().catch(e=>{console.error(e);process.exitCode=1;});
