'use strict';
const assert = require('node:assert/strict');
const C = require('./charts-core.js');
const DAY = C.DAY, now = Date.UTC(2026, 9, 16, 6), end = Date.UTC(2026, 9, 16) - 1;
const row = (sourceId='binance',instrument='BTCUSDT',extra={}) => ({key:sourceId+':'+instrument,sourceId,instrument,base:instrument.slice(0,-4),quote:'USDT',last:100,return24:0.02,turnover24:10000,asOf:now,...extra});
const bars = (n=121,buy=60) => Array.from({length:n},(_,i)=>({time:end+1-(n-i)*DAY,end:end-(n-1-i)*DAY,open:100+i,high:102+i,low:99+i,close:101+i,quote:100,buy}));
const history = b => ({bars:b,asOf:now,fetchedAt:now});
const tests=[];function test(name,fn){tests.push({name,fn});}
test('24h chart retains source identity and excludes stale, zero, future and duplicate rows',()=>{
 const b=row(),g=row('bitget');const r=C.scatter24([b,g,row('binance','ZEROUSDT',{turnover24:0}),row('binance','OLDUSDT',{asOf:now-C.TTL-1}),row('binance','FUTUSDT',{asOf:now+60001})],{now});
 assert.equal(r.points.length,2);assert.deepEqual(r.points.map(x=>x.key),['binance:BTCUSDT','bitget:BTCUSDT']);assert.equal(r.points[0].x,.02);assert.equal(r.points[0].y,10000);assert.equal(r.yScale,'log');assert.equal(r.coverage.reasons.zero_turnover,1);assert.equal(r.coverage.excluded,3);
 assert.equal(C.scatter24([b,b],{now}).points.length,0);
});
test('daily series includes raw OHLC and exact quote-derived buy/sell/delta/CVD',()=>{
 const d=C.summaryDaily(bars(),now,{window:30,now});assert.equal(d.series.length,30);assert.equal(d.series[0].open,191);assert.equal(d.series[0].close,192);assert.equal(d.series[0].buy,60);assert.equal(d.series[0].sell,40);assert.equal(d.series[0].delta,20);assert.equal(d.series[0].cvd,20);assert.equal(d.series.at(-1).cvd,600);assert.equal(d.taker.delta,600);assert.equal(d.coverage.cvdResetAt,d.series[0].time);assert.equal(d.current,true);
 assert.equal(d.return7,221/214-1);assert.equal(d.return30,221/191-1);assert.equal(d.turnover20,100);assert.equal(d.buyShare7,.6);
});
test('CVD resets for each selected window rather than inheriting hidden previous days',()=>{
 const b=bars();assert.equal(C.summaryDaily(b,now,{window:30,now}).series.at(-1).cvd,600);assert.equal(C.summaryDaily(b,now,{window:90,now}).series.at(-1).cvd,1800);assert.equal(C.summaryDaily(b,now,{window:120,now}).series.at(-1).cvd,2400);
});
test('unavailable taker data stays null; missing day never manufactures subsequent CVD',()=>{
 const unavailable=C.summaryDaily(bars(40,null),now,{now});assert.equal(unavailable.taker,null);assert.equal(unavailable.buyShare7,null);assert(unavailable.series.every(b=>b.buy===null&&b.sell===null&&b.delta===null&&b.cvd===null));
 const mixed=bars(30);mixed[10].buy=null;const d=C.summaryDaily(mixed,now,{now});assert.equal(d.series[9].cvd,200);assert.equal(d.series[10].cvd,null);assert.equal(d.series[11].cvd,null);assert.equal(d.taker,null);
});
test('zero quote/taker is real zero while the undefined 0/0 share is null',()=>{
 const b=bars(30,0).map(x=>({...x,quote:0}));const d=C.summaryDaily(b,now,{now});assert.equal(d.series[0].buy,0);assert.equal(d.series[0].sell,0);assert.equal(d.series[0].cvd,0);assert.equal(d.buyShare7,null);
});
test('buy share is weighted by quote volume rather than an average daily ratio',()=>{
 const b=bars(8,0);b[7].quote=900;b[7].buy=900;const d=C.summaryDaily(b,now,{now});assert.equal(d.buyShare7,900/1500);assert.notEqual(d.buyShare7,1/7);assert.equal(d.return30,null);assert.equal(d.turnover20,null);
});
test('latest closed UTC day is checked against now even for an internally valid old cache',()=>{
 const h=history(bars(8)),nextDay=now+DAY;const d=C.summaryDaily(h.bars,h.asOf,{now:nextDay});assert.equal(d.current,false);assert.equal(d.stale,true);const r=C.scatter7({'binance:BTCUSDT':h},[row()],{now:nextDay});assert.equal(r.points.length,0);assert.equal(r.excluded[0].code,'stale_history');
});
test('history scatter uses exactly matching source keys and does not borrow same-ticker history',()=>{
 const histories={'binance:BTCUSDT':history(bars(8))};const r=C.scatter7(histories,[row(),row('bitget'),row('binance','WUSDT')],{now});assert.equal(r.points.length,1);assert.equal(r.points[0].x,108/101-1);assert.equal(r.points[0].y,.6);assert.equal(r.coverage.reasons.source_no_taker,1);assert.equal(r.coverage.reasons.missing_history,1);
 const wrong=C.scatter7({'bitget:BTCUSDT':history(bars(8))},[row()],{now});assert.equal(wrong.points.length,0);
});
test('gaps, duplicates, unfinished UTC bars and impossible buy/OHLC fail closed',()=>{
 const b=bars(31);for(const invalid of [b.filter((_,i)=>i!==20),[...b,b[5]],b.map((x,i)=>i===30?{...x,end:now}:x),b.map((x,i)=>i===30?{...x,buy:101}:x),b.map((x,i)=>i===30?{...x,high:1}:x)]) assert.throws(()=>C.summaryDaily(invalid,now,{now}));
 assert.throws(()=>C.summaryDaily(b,now,{window:7,now}));assert.throws(()=>C.summaryDaily(b,now+DAY,{now}));
});
test('rounding tolerance never turns derived sell volume negative',()=>{
 const b=bars(8,100+1e-9);const d=C.summaryDaily(b,now,{now});assert(d.series.every(x=>x.sell===0&&x.buy===100));
});
const summaryRecord = (extra={}) => ({key:'binance:BTCUSDT',sourceId:'binance',instrument:'BTCUSDT',base:'BTC',quote:'USDT',return7:.1,return30:.2,buyShare7:.6,quote7:1000,buyQuote7:600,close:110,lastClose:110,close7:100,turnover20:100,end,firstTime:end+1-31*DAY,days:31,asOf:now,fetchedAt:now,provenance:{url:'https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=32',sha256:'a'.repeat(64)},...extra});
const summarySnapshot = (records=[summaryRecord()],extra={}) => ({schemaVersion:1,sourceId:'binance',generatedAt:now,asOf:now,eligibleInstrumentCount:2,attemptedCount:1,records,errors:[],...extra});
test('retained summaries derive plot coordinates from close/volume and report collector coverage',()=>{
 const s=summarySnapshot(),r=C.scatter7Summary(s,[row(),row('bitget')],{now});assert.equal(r.points.length,1);assert.equal(r.points[0].x,110/100-1);assert.equal(r.points[0].y,600/1000);assert.equal(r.points[0].method,'normalized_daily_summary');assert.equal(r.coverage.eligibleInstrumentCount,2);assert.equal(r.coverage.attemptedCount,1);assert.equal(r.coverage.notAttemptedCount,1);assert.equal(r.coverage.lastEnd,end);assert.equal(r.coverage.rawDailyReplayAvailable,false);assert.equal(r.coverage.reasons.source_no_taker,1);
});
test('retained summaries reject misleading labels, bad units and invalid closed-day metadata',()=>{
 for(const change of [{return7:.8},{buyShare7:.9},{close:0,lastClose:0},{quote7:0},{buyQuote7:1001},{buyQuote7:null},{days:30},{firstTime:end+1-30*DAY},{lastClose:111},{end:end-DAY,firstTime:end+1-32*DAY},{fetchedAt:now+1}]) {
  const r=C.scatter7Summary(summarySnapshot([summaryRecord(change)]),[row()],{now});assert.equal(r.points.length,0,JSON.stringify(change));assert.equal(r.excluded.length,1);
 }
 const rollover=C.scatter7Summary(summarySnapshot(),[row()],{now:now+DAY});assert.equal(rollover.excluded[0].code,'stale_summary');
});
test('summary records never join by bare ticker and duplicates invalidate the affected pair',()=>{
 const r=C.scatter7Summary(summarySnapshot([summaryRecord(),summaryRecord()],{attemptedCount:2}),[row()],{now});assert.equal(r.points.length,0);assert.equal(r.excluded[0].code,'duplicate_record');
 const mismatch=C.scatter7Summary(summarySnapshot([summaryRecord({base:'OTHER'})]),[row()],{now});assert.equal(mismatch.excluded[0].code,'record_identity');
 const missing=C.scatter7Summary(summarySnapshot(),[row('binance','WUSDT')],{now});assert.equal(missing.excluded[0].code,'missing_summary');assert.equal(missing.recordIssues[0].code,'orphan_record');
});
test('optional retained 30-day endpoint and dated window fields are cross-checked',()=>{
 const record=summaryRecord({close30:110/1.2,close7End:end-7*DAY,close30End:end-30*DAY,quote7FirstTime:end+1-7*DAY});assert.equal(C.scatter7Summary(summarySnapshot([record]),[row()],{now}).points.length,1);
 for(const extra of [{close30:90},{close7End:end-6*DAY},{close30End:end-29*DAY},{quote7FirstTime:end+1-6*DAY}])assert.equal(C.scatter7Summary(summarySnapshot([{...record,...extra}]),[row()],{now}).points.length,0);
 const zeroBuy=C.scatter7Summary(summarySnapshot([summaryRecord({buyQuote7:0,buyShare7:0})]),[row()],{now});assert.equal(zeroBuy.points[0].y,0);
});
test('summary provenance requires matching public Binance daily endpoint and SHA-256 format',()=>{
 for(const provenance of [null,{url:'https://example.com/api/v3/klines?symbol=BTCUSDT&interval=1d',sha256:'a'.repeat(64)},{url:'https://data-api.binance.vision/api/v3/ticker/24hr?symbol=BTCUSDT&interval=1d',sha256:'a'.repeat(64)},{url:'https://data-api.binance.vision/api/v3/klines?symbol=WUSDT&interval=1d',sha256:'a'.repeat(64)},{url:'https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1h',sha256:'a'.repeat(64)},{url:'https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1d&timeZone=8',sha256:'a'.repeat(64)},{url:'https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1d',sha256:'not-a-hash'}]) {
  const r=C.scatter7Summary(summarySnapshot([summaryRecord({provenance})]),[row()],{now});assert.equal(r.points.length,0);assert.equal(r.excluded[0].code,'provenance');
 }
});
test('legitimate Unicode venue instruments match percent-encoded provenance symbols',()=>{
 const instrument='币安人生USDT',base='币安人生',record=summaryRecord({key:'binance:'+instrument,instrument,base,provenance:{url:'https://data-api.binance.vision/api/v3/klines?symbol='+encodeURIComponent(instrument)+'&interval=1d&limit=32',sha256:'b'.repeat(64)}});const r=C.scatter7Summary(summarySnapshot([record]),[row('binance',instrument)],{now});assert.equal(r.points.length,1);assert.equal(r.points[0].instrument,instrument);
});
test('malformed or future summary envelopes fail closed without placeholder points',()=>{
 assert.throws(()=>C.scatter7Summary(summarySnapshot([],{generatedAt:now+1}),[row()],{now}));assert.throws(()=>C.scatter7Summary(summarySnapshot([],{attemptedCount:3}),[row()],{now}));assert.throws(()=>C.scatter7Summary(summarySnapshot([],{sourceId:'bitget'}),[row()],{now}));
});
test('new verified venue identities retain separate 24h points and never borrow Binance taker data',()=>{
 const r=C.scatter24([row('gate'),row('whitebit')],{now});assert.deepEqual(r.points.map(p=>p.key),['gate:BTCUSDT','whitebit:BTCUSDT']);assert.equal(r.coverage.sources.gate.used,1);assert.equal(r.coverage.sources.whitebit.used,1);
 const historyResult=C.scatter7({'binance:BTCUSDT':history(bars(8))},[row('gate'),row('whitebit')],{now});assert.equal(historyResult.points.length,0);assert.equal(historyResult.coverage.reasons.source_no_taker,2);
 assert.equal(C.scatter24([row('mexc'),row('htx')],{now}).points.length,0);
});
test('daily aggregation keeps actual OHLC and resets CVD after applying the display window',()=>{
 const d=C.aggregateBarsUTC(bars(),{interval:'1d',asOf:now,now,windowDays:30});assert.equal(d.series.length,30);assert.equal(d.series[0].open,191);assert.equal(d.series[0].high,193);assert.equal(d.series[0].low,190);assert.equal(d.series[0].close,192);assert.equal(d.series[0].days,1);assert.equal(d.series[0].cvd,20);assert.equal(d.series.at(-1).cvd,600);assert.equal(d.coverage.cvdResetAt,d.series[0].time);assert.equal(d.excluded.length,0);assert.equal(d.current,true);
});
test('weekly aggregation uses Monday UTC with exact constituent OHLC and volume sums',()=>{
 const w=C.aggregateBarsUTC(bars(),{interval:'1w',asOf:now,now});assert.equal(w.series.length,16);const first=w.series[0];assert.equal(first.time,Date.UTC(2026,5,22));assert.equal(first.end,Date.UTC(2026,5,29)-1);assert.equal(first.open,105);assert.equal(first.high,113);assert.equal(first.low,104);assert.equal(first.close,112);assert.equal(first.quote,700);assert.equal(first.buy,420);assert.equal(first.sell,280);assert.equal(first.delta,140);assert.equal(first.cvd,140);assert.equal(first.days,7);assert.equal(w.series.at(-1).cvd,2240);assert.equal(w.coverage.usedDays,112);assert.equal(w.coverage.weekStartsOn,'Monday UTC');assert.equal(w.coverage.latestExpectedEnd,Date.UTC(2026,9,12)-1);assert.equal(w.current,true);
 assert.equal(w.excluded.length,2);assert.equal(w.excluded[0].code,'partial_first_period');assert.equal(w.excluded[0].availableDays,5);assert.equal(w.excluded[1].code,'partial_last_period');assert.equal(w.excluded[1].availableDays,4);
});
test('monthly aggregation uses real calendar boundaries and full 121-day input',()=>{
 const m=C.aggregateBarsUTC(bars(),{interval:'1M',asOf:now,now});assert.equal(m.series.length,3);assert.deepEqual(m.series.map(b=>b.days),[31,31,30]);assert.deepEqual(m.series.map(b=>b.time),[Date.UTC(2026,6,1),Date.UTC(2026,7,1),Date.UTC(2026,8,1)]);assert.equal(m.series[0].open,114);assert.equal(m.series[0].close,145);assert.equal(m.series[0].high,146);assert.equal(m.series[0].low,113);assert.equal(m.series[0].quote,3100);assert.equal(m.series[0].buy,1860);assert.equal(m.series.at(-1).end,Date.UTC(2026,9,1)-1);assert.equal(m.coverage.usedDays,92);assert.equal(m.excluded.length,2);assert.equal(m.current,true);
 const narrow=C.aggregateBarsUTC(bars(),{interval:'1M',asOf:now,now,windowDays:30});assert.equal(narrow.series.length,1);assert.equal(narrow.series[0].time,Date.UTC(2026,8,1));assert.equal(narrow.series[0].cvd,600);assert.equal(narrow.coverage.cvdResetAt,Date.UTC(2026,8,1));
});
function calendarBars(start,count){return Array.from({length:count},(_,i)=>({time:start+i*DAY,end:start+(i+1)*DAY-1,open:i+1,high:i+3,low:i+1,close:i+2,quote:10,buy:6}));}
test('February requires 28 or 29 actual days rather than a fixed 30-day month',()=>{
 for(const [year,days] of [[2024,29],[2025,28]]){const time=Date.UTC(year,1,1),at=Date.UTC(year,2,1,6),b=calendarBars(time,days);const m=C.aggregateBarsUTC(b,{interval:'1M',asOf:at,now:at});assert.equal(m.series.length,1);assert.equal(m.series[0].days,days);assert.equal(m.series[0].quote,days*10);assert.equal(m.excluded.length,0);assert.equal(m.current,true);const missing=C.aggregateBarsUTC(b.filter((_,i)=>i!==14),{interval:'1M',asOf:at,now:at});assert.equal(missing.series.length,0);assert.equal(missing.excluded[0].expectedDays,days);assert.equal(missing.excluded[0].missingDays.length,1);}
});
test('entire missing weeks are reported and never manufactured as zero-volume candles',()=>{
 const start=Date.UTC(2026,8,7),at=Date.UTC(2026,8,28,6),b=calendarBars(start,21).filter((_,i)=>i<7||i>=14);const r=C.aggregateBarsUTC(b,{interval:'1w',asOf:at,now:at});assert.equal(r.series.length,2);assert.equal(r.excluded.length,1);assert.equal(r.excluded[0].code,'missing_days');assert.equal(r.excluded[0].availableDays,0);assert.equal(r.excluded[0].missingDays.length,7);assert.equal(r.series[1].time,Date.UTC(2026,8,21));assert.equal(r.series[0].cvd,14);assert.equal(r.series[1].cvd,null);assert.equal(r.taker,null);assert.equal(r.coverage.completeSpan,false);
});
test('partial calendar periods are excluded even when they are the only supplied period',()=>{
 const b=calendarBars(Date.UTC(2026,8,9),3),at=Date.UTC(2026,8,12,6),r=C.aggregateBarsUTC(b,{interval:'1w',asOf:at,now:at});assert.equal(r.series.length,0);assert.equal(r.coverage.from,null);assert.equal(r.coverage.cvdResetAt,null);assert.equal(r.excluded[0].code,'partial_boundary_period');assert.equal(r.excluded[0].availableDays,3);assert.equal(r.excluded[0].expectedDays,7);
});
test('unknown quote or taker input propagates null independently through complete periods',()=>{
 const b=bars();b[8].quote=null;b[16].buy=undefined;const r=C.aggregateBarsUTC(b,{interval:'1w',asOf:now,now});assert.equal(r.series[0].quote,null);assert.equal(r.series[0].buy,420);assert.equal(r.series[0].sell,null);assert.equal(r.series[0].delta,null);assert.equal(r.series[1].quote,700);assert.equal(r.series[1].buy,null);assert.equal(r.series[1].delta,null);assert(r.series.every(b=>b.cvd===null));assert.equal(r.taker,null);
 const zero=C.aggregateBarsUTC(bars().map(b=>({...b,quote:0,buy:0})),{interval:'1w',asOf:now,now});assert(zero.series.every(b=>b.quote===0&&b.buy===0&&b.sell===0&&b.delta===0&&b.cvd===0));
});
test('weekly display windows retain whole true periods and restart CVD at the shown boundary',()=>{
 const r=C.aggregateBarsUTC(bars(),{interval:'1w',asOf:now,now,windowDays:30});assert.equal(r.series.length,4);assert.equal(r.series[0].time,Date.UTC(2026,8,14));assert.equal(r.series[0].cvd,140);assert.equal(r.series.at(-1).cvd,560);assert.equal(r.coverage.usedDays,28);
});
test('aggregate rejects duplicate, unclosed, misaligned, nonfinite and impossible raw candles',()=>{
 const b=bars();for(const bad of [[...b,b[0]],b.map((v,i)=>i===120?{...v,time:v.time+1}:v),b.map((v,i)=>i===120?{...v,high:1}:v),b.map((v,i)=>i===120?{...v,buy:Infinity}:v),b.map((v,i)=>i===120?{...v,end:now}:v)])assert.throws(()=>C.aggregateBarsUTC(bad,{interval:'1w',asOf:now,now}));assert.throws(()=>C.aggregateBarsUTC(b,{interval:'30d',asOf:now,now}));assert.throws(()=>C.aggregateBarsUTC(b,{asOf:now,now,windowDays:0}));
});
test('SMA20 and SMA-seeded EMA50 warm up on full daily history before display slicing',()=>{
 const b=calendarBars(Date.UTC(2026,5,17),121).map((v,i)=>({...v,open:i+1,high:i+1,low:i+1,close:i+1})),r=C.dailyMovingAverages(b,{asOf:now,now});assert.equal(r.series[18].sma20,null);assert.equal(r.series[19].sma20,10.5);assert.equal(r.series[48].ema50,null);assert.equal(r.series[49].ema50,25.5);assert.equal(r.series.at(-1).sma20,111.5);assert(Math.abs(r.series.at(-1).ema50-96.5)<1e-10);assert(r.series.slice(-30).every(v=>v.ema50!==null));assert.equal(r.coverage.smaDays,102);assert.equal(r.coverage.emaDays,72);assert.equal(r.coverage.usesFullHistory,true);assert.equal(r.series[0].ema200,undefined);
 const shock=b.map((v,i)=>i===120?{...v,open:200,high:200,low:200,close:200}:v),s=C.dailyMovingAverages(shock,{asOf:now,now});assert(Math.abs(s.series.at(-1).ema50-(95.5+2/51*(200-95.5)))<1e-10);
});
test('moving averages restart warmup after a missing UTC day and never bridge the gap',()=>{
 const b=bars().filter((_,i)=>i!==60),r=C.dailyMovingAverages(b,{asOf:now,now});assert.equal(r.coverage.resetsAt.length,1);assert.equal(r.series[60].sma20,null);assert.equal(r.series[60].ema50,null);assert.equal(r.series[78].sma20,null);assert.notEqual(r.series[79].sma20,null);assert.equal(r.series[108].ema50,null);assert.notEqual(r.series[109].ema50,null);assert.throws(()=>C.dailyMovingAverages(b,{asOf:now,now,emaPeriod:0}));
});
for(const t of tests){t.fn();console.log('ok - '+t.name);}console.log(tests.length+' chart tests passed');
