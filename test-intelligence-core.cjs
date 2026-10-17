'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const I=require('./intelligence-core.js');
const DAY=I.DAY,NOW=Date.UTC(2026,9,16,12),END=Date.UTC(2026,9,16)-1;
const bars=(n=100)=>Array.from({length:n},(_,i)=>({time:END+1-(n-i)*DAY,end:END-(n-1-i)*DAY,open:100,high:102,low:98,close:100,quote:i>=n-7?200:100,buy:i>=n-7?120:55}));
const history=(b=bars())=>({key:'binance:ABCUSDT',sourceId:'binance',instrument:'ABCUSDT',base:'ABC',quote:'USDT',asOf:NOW,fetchedAt:NOW,bars:b});
const run=b=>I.analyze(history(b),{now:NOW});
const approx=(a,b)=>assert.ok(Math.abs(a-b)<1e-10,`${a} != ${b}`);
test('raw component groups preserve observed units and explicitly omit wallet models',()=>{
 const a=run(),p=a.latest;assert.equal(p.features.pressureSetup,true);assert.equal(p.features.sidewaysBuyPressure,true);approx(p.axes.pressure.buyShare7,.6);assert.equal(p.axes.pressure.delta7,280);assert.equal(p.axes.overheat.rsi14,50);assert.equal(p.axes.risk.volatility30,0);assert.equal(p.axes.positioningProxy.distanceEma50,0);assert.equal(p.axes.positioningProxy.distanceEma200,null);assert.ok(a.unavailable.walletCostBasis);assert.ok(a.unavailable.realizedBands);assert.ok(!('whaleScore'in p.axes));assert.equal(Object.keys(I.DEFINITIONS).length,6);
});
test('single-day quote anomaly excludes the current day from its baseline',()=>{
 const b=bars().map(x=>({...x,quote:100,buy:55}));b.at(-1).quote=1000;b.at(-1).buy=550;
 const p=run(b).latest;assert.equal(p.metrics.quoteRatio1vsPrior30,10);assert.equal(p.features.volumeAnomaly,true);approx(p.metrics.volumeRatio7vsPrior30,16/7);
});
test('null taker remains unavailable, while valid zero buy is sell-heavy',()=>{
 const missing=bars().map(x=>({...x,buy:null})),m=run(missing).latest;assert.equal(m.features.pressureSetup,null);assert.equal(m.axes.pressure.delta7,null);assert.equal(m.features.possibleSellAbsorption,null);
 const zero=bars().map(x=>({...x,buy:0})),z=run(zero).latest;assert.equal(z.axes.pressure.buyShare7,0);assert.equal(z.features.pressureSetup,false);assert.equal(z.features.possibleSellAbsorption,true);
});
test('no zero division or fabricated signal when prior quote volume is zero',()=>{
 const b=bars().map(x=>({...x,quote:0,buy:0}));b.at(-1).quote=100;b.at(-1).buy=60;const p=run(b).latest;assert.equal(p.metrics.quoteRatio1vsPrior30,null);assert.equal(p.metrics.volumeRatio7vsPrior30,null);assert.equal(p.features.volumeAnomaly,null);assert.equal(p.features.pressureSetup,null);
});
test('future candles cannot rewrite indicators, features or event onsets',()=>{
 const b=bars(150),prefix=b.slice(0,90),prefixNow=prefix.at(-1).end+3600001;
 const h={...history(prefix),asOf:prefixNow,fetchedAt:prefixNow},a=I.analyze(h,{now:prefixNow}),full=run(b);
 assert.deepEqual(full.series.slice(0,90),a.series);assert.deepEqual(full.events.filter(e=>e.signalTime<=prefix.at(-1).end),a.events);
});
test('gaps reset RSI, EMA, contiguous inputs and observable onset state',()=>{
 const b=bars(100).filter((_,i)=>i!==80),a=run(b);assert.equal(a.coverage.gaps.length,1);const p=a.series.find(x=>x.time===b[80].time);assert.equal(p.metrics.rsi14,null);assert.equal(p.metrics.ema50,null);assert.equal(p.features.pressureSetup,null);assert.equal(a.latest.metrics.contiguousDays,19);
});
test('RSI is a Wilder recurrence, flat=50 and uninterrupted rising closes=100',()=>{
 const b=bars(40).map((x,i)=>({...x,open:i+100,high:i+102,low:i+99,close:i+101})),a=run(b);assert.equal(a.series[13].metrics.rsi14,null);assert.equal(a.series[14].metrics.rsi14,100);assert.equal(a.latest.metrics.rsi14,100);assert.equal(run(bars()).latest.metrics.rsi14,50);
});
test('onset ledger does not count every persistent true day as a new event',()=>{
 const b=bars(100).map(x=>({...x,buy:x.quote*.6})),a=run(b);const events=a.events.filter(e=>e.signal==='pressureSetup');assert.equal(events.length,1);assert.equal(events[0].firstObservable,false);assert.equal(events[0].availableAt,events[0].signalTime+1);assert.ok(a.series.filter(p=>p.features.pressureSetup===true).length>1);
});
test('calendar bins are Monday UTC / first of month and label unfinished periods',()=>{
 const date=Date.UTC(2026,9,15,23,59,59,999),e={signal:'pressureSetup',signalTime:date};
 assert.equal(I.periodStart(date,'week'),Date.UTC(2026,9,12));assert.equal(I.periodStart(date,'month'),Date.UTC(2026,9,1));
 const a=I.eventsSummary([e,{...e,signalTime:Date.UTC(2026,9,16,23,59,59,999)}],NOW);assert.equal(a.windows.pressureSetup[1],1);assert.equal(a.calendarWeek[0].complete,false);assert.equal(a.calendarMonth[0].complete,false);assert.equal(a.calendarWeek[0].counts.pressureSetup,1);
});
test('outcome enters next open, not signal close; exits exact horizon and charges both sides',()=>{
 const b=bars(40);b[10].close=50;b[10].low=49;b[11].open=80;b[11].low=79;b[17].close=120;b[17].high=121;
 const o=I.outcome(b,10,7);assert.equal(o.entryOpen,80);assert.equal(o.exitClose,120);approx(o.grossReturn,.5);approx(o.netReturn,120*.998/(80*1.002)-1);assert.equal(o.entryTime,b[11].time);assert.equal(o.exitTime,b[17].end);
});
test('drawdown uses entry / prior daily-close peak and separately reports intraday adverse low',()=>{
 const b=bars(40);b[11].open=100;b[11].close=120;b[11].high=130;b[11].low=80;b[12].close=90;b[12].low=70;
 const o=I.outcome(b,10,7);approx(o.maxDrawdown,.25);approx(o.worstLowFromEntry,-.3);
});
test('pending and gapped outcomes are retained as missing, never successful zero returns',()=>{
 const b=bars(40),p=I.outcome(b,37,7);assert.equal(p.status,'pending');assert.equal(p.netReturn,null);
 const gap=b.filter((_,i)=>i!==14),g=I.outcome(gap,10,7);assert.equal(g.status,'missing');assert.equal(g.netReturn,null);
 assert.throws(()=>I.outcome(b,1,0));assert.throws(()=>I.outcome(b,1,7,{feeBps:-1}));
});
test('descriptive summaries include failures and ignore unavailable values without treating zero as absent',()=>{
 const s=I.describe([null,-.2,0,.1]);assert.equal(s.count,3);approx(s.mean,-.1/3);assert.equal(s.median,0);approx(s.positiveRate,1/3);assert.equal(s.min,-.2);assert.equal(I.describe([null]).mean,null);
});
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const studyFile=path.join(__dirname,'data/intelligence-study.json');
function study(){return JSON.parse(fs.readFileSync(studyFile,'utf8'));}
test('published study validates every event outcome, loss count and summary against its ledger',{skip:!fs.existsSync(studyFile)},()=>{
 const s=study(),manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'data/research-manifest.json')));
 assert.equal(I.validateStudy(s,{expectedSourceSha256:manifest.snapshot.sha256,expectedCutoff:manifest.endTime}),s);
 assert.ok(s.eventStudy.summary[7].negativeEvents>0);assert.ok(s.eventStudy.summary[30].negativeEvents>0);
});
test('study rejects source/cutoff mismatch, altered results, omitted failures and overlapping event selection',{skip:!fs.existsSync(studyFile)},()=>{
 let s=study();assert.throws(()=>I.validateStudy(s,{expectedSourceSha256:'0'.repeat(64)}),/không khớp/);assert.throws(()=>I.validateStudy(s,{expectedCutoff:s.cutoff-DAY}),/không khớp/);
 s=study();s.eventStudy.summary[7].negativeEvents--;assert.throws(()=>I.validateStudy(s),/lãi\/lỗ/);
 s=study();s.eventStudy.events.find(e=>e.outcomes[7].status==='complete').outcomes[7].netReturn=.99;assert.throws(()=>I.validateStudy(s),/chi phí/);
 s=study();s.eventStudy.events.push(s.eventStudy.events[0]);assert.throws(()=>I.validateStudy(s),/chọn sự kiện/);
 s=study();s.eventCounts.windows.pressureSetup[7]++;assert.throws(()=>I.validateStudy(s),/bộ đếm/);
});
test('browser verification hashes all four published model files and refuses a mismatched revision',{skip:!fs.existsSync(studyFile)},async()=>{
 const s=study(),opts={expectedSourceSha256:s.source.sha256,expectedCutoff:s.cutoff,cryptoImpl:crypto.webcrypto};let reads=0;
 const fetchImpl=async url=>{reads++;const b=fs.readFileSync(path.join(__dirname,url.replace(/^\.\//,'')));return{ok:true,status:200,arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.length)};};
 assert.equal(await I.verifyStudy(s,{...opts,fetchImpl}),s);assert.equal(reads,4);
 await assert.rejects(I.verifyStudy(s,{...opts,fetchImpl:async()=>({ok:true,status:200,arrayBuffer:async()=>new TextEncoder().encode('different model').buffer})}),/khác phiên bản/);
 await assert.rejects(I.verifyStudy(s,{fetchImpl}),/Cần hash/);
});
