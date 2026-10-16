'use strict';
const assert = require('node:assert/strict');
const M = require('./market.js');
const now = Date.now(), today = Math.floor(now / M.DAY) * M.DAY, day = today - M.DAY;
const wrap = data => ({code:'00000',requestTime:now,data});
const bmeta = {symbols:[{symbol:'BTCUSDT',status:'TRADING',isSpotTradingAllowed:true,quoteAsset:'USDT',baseAsset:'BTC'}]};
const gmeta = wrap([{symbol:'BTCUSDT',category:'SPOT',symbolType:'crypto',instrumentType:'crypto',status:'online',baseCoin:'BTC',quoteCoin:'USDT'}]);
const bt = extra => ({symbol:'BTCUSDT',lastPrice:'100',quoteVolume:'12345',priceChangePercent:'2',closeTime:now,...extra});
const gt = extra => ({symbol:'BTCUSDT',lastPr:'100',quoteVolume:'12345',baseVolume:'123',change24h:'0.02',ts:String(now),...extra});
const bc = (time = day, extra = {}) => Object.assign([time,'90','110','80','100','50',time+M.DAY-1,'5000',40,'25','2500','0'],extra);
const gc = (time = day, extra = {}) => Object.assign([String(time),'90','110','80','100','50','4999','5000'],extra);
const tests = [];
function test(name, fn) { tests.push({name,fn}); }

test('spot registry excludes inactive, derivatives, non-USDT and typed stock instruments', () => {
  const raw = wrap([...gmeta.data, {...gmeta.data[0],symbol:'RSTOCKUSDT',symbolType:'stock',instrumentType:'stock'}, {...gmeta.data[0],symbol:'OFFUSDT',status:'offline'}, {...gmeta.data[0],symbol:'FUTUSDT',category:'USDT-FUTURES'}, {...gmeta.data[0],symbol:'BTCUSDC',quoteCoin:'USDC'}]);
  const r=M.registry('bitget',raw);assert.equal(r.instruments.length,1);assert.equal(r.excludedCount,4);
});
test('all eligible instruments scanned without a fixed 30-row ceiling', () => {
  const meta={symbols:Array.from({length:150},(_,i)=>({...bmeta.symbols[0],symbol:'C'+i+'USDT',baseAsset:'C'+i}))};
  const tickers=meta.symbols.map(x=>bt({symbol:x.symbol}));assert.equal(M.parseScan('binance',meta,tickers,now,now).rows.length,150);
});
test('exchange units and source-specific keys are preserved', () => {
  const b=M.parseScan('binance',bmeta,[bt()],now,now).rows[0], g=M.parseScan('bitget',gmeta,wrap([gt()]),now,now).rows[0];
  assert.equal(b.return24,0.02);assert.equal(g.return24,0.02);assert.equal(g.turnover24,12345);assert.equal(b.key,'binance:BTCUSDT');assert.equal(g.key,'bitget:BTCUSDT');
});
test('Unicode exchange identifiers are retained and conflicting ticker duplicates excluded', () => {
  const meta={symbols:[{...bmeta.symbols[0],symbol:'币安人生USDT',baseAsset:'币安人生'}]};
  const r=M.parseScan('binance',meta,[bt({symbol:'币安人生USDT'})],now,now);
  assert.equal(r.rows[0].base,'币安人生');
  const duplicated=M.parseScan('binance',bmeta,[bt(),bt({lastPrice:'101'})],now,now);
  assert.equal(duplicated.rows.length,0);assert.match(duplicated.errors[0].message,/trùng/);
});
test('bad, stale, future and absent ticker records are explicitly logged', () => {
  for(const extra of [{lastPr:'0'},{lastPr:'NaN'},{quoteVolume:null},{change24h:''},{ts:now-M.TTL-1},{ts:now+60001}]) {
    const r=M.parseScan('bitget',gmeta,wrap([gt(extra)]),now,now);assert.equal(r.rows.length,0);assert.equal(r.errors.length,1);
  }
  const absent=M.parseScan('bitget',gmeta,wrap([]),now,now);assert.equal(absent.errors.length,1);
  const zero=M.parseScan('bitget',gmeta,wrap([gt({quoteVolume:'0',change24h:'0'})]),now,now);assert.equal(zero.rows[0].turnover24,0);assert.equal(zero.rows[0].return24,0);
});
test('wrong exchange codes and malformed top-level payload fail closed', () => {
  assert.throws(()=>M.registry('bitget',{code:'40000',data:[]}));assert.throws(()=>M.parseScan('binance',bmeta,{code:-1121,msg:'Invalid symbol'},now,now));assert.throws(()=>M.registry('binance',{}));
});
test('timestamps reject seconds/microseconds and source clock drift', () => {
  assert.throws(()=>M.stamp(Math.floor(now/1000)));assert.throws(()=>M.stamp(now*1000));assert.throws(()=>M.clock(now-M.TTL-1,now));assert.equal(M.clock(now,now),now);
});
test('completed UTC candles sorted; incomplete current day dropped', () => {
  const r=M.parseHistory('binance',[bc(today),bc(day),bc(day-M.DAY)],now,now);assert.equal(r.bars.length,2);assert.equal(r.dropped,1);assert.equal(r.bars[0].time,day-M.DAY);
  assert.equal(M.parseHistory('binance',[bc()],now,now).bars.length,1); // UI decides history sufficiency.
});
test('quote volume uses documented column, never base or converted-USDT column', () => {
  const r=M.parseHistory('bitget',wrap([gc()]),now,now);assert.equal(r.bars[0].quote,5000);assert.equal(r.bars[0].buy,null);
  const b=M.parseHistory('binance',[bc(day,{10:'0'})],now,now);assert.equal(b.bars[0].buy,0);
  assert.throws(()=>M.parseHistory('binance',[bc(day,{10:null})],now,now));
});
test('negative volumes, buy > total, invalid OHLC and wrong UTC close rejected', () => {
  for(const extra of [{7:'-1'},{10:'5001'},{2:'89'},{6:day+M.DAY}]) assert.throws(()=>M.parseHistory('binance',[bc(day,extra)],now,now));
  assert.throws(()=>M.parseHistory('bitget',wrap([gc(day+3600000)]),now,now));
});
test('identical duplicate candles coalesce; conflicting duplicates reject', () => {
  assert.equal(M.parseHistory('binance',[bc(),bc()],now,now).bars.length,1);
  assert.throws(()=>M.parseHistory('binance',[bc(),bc(day,{4:'99'})],now,now));
});
test('HTTP errors and HTML block pages never become successful scans', async () => {
  await assert.rejects(()=>M.scanSource('binance',async()=>({ok:false,status:403})),/HTTP 403/);
  await assert.rejects(()=>M.scanSource('binance',async()=>({ok:true,status:200,headers:{get:()=> 'text/html'},json:async()=>({})})),/JSON/);
  await assert.rejects(()=>M.scanSource('bitget',async()=>({ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>({code:'40000',msg:'blocked'})})),/mã lỗi/);
  await assert.rejects(()=>M.scanSource('binance',async()=>({ok:false,status:429,headers:{get:()=> '120'}})),e=>e.retryAfterMs===120000);
});
test('adapters request broad discovery and daily UTC endpoints', async () => {
  const seen=[];const fetcher=async url=>{seen.push(url);let data;if(url.endsWith('/time'))data={serverTime:Date.now()};else if(url.includes('exchangeInfo'))data=bmeta;else if(url.includes('ticker/24hr'))data=[bt({closeTime:Date.now()})];else if(url.includes('instruments'))data=wrap(gmeta.data);else if(url.includes('tickers'))data=wrap([gt({ts:Date.now()})]);else if(url.includes('klines'))data=[bc()];else data=wrap([gc()]);return {ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>data};};
  assert.equal((await M.scanSource('binance',fetcher)).rows.length,1);assert.equal((await M.scanSource('bitget',fetcher)).rows.length,1);await M.history('binance','BTCUSDT',fetcher);await M.history('bitget','BTCUSDT',fetcher);
  assert(seen.some(u=>u.includes('instruments?category=SPOT')));assert(seen.some(u=>u.includes('granularity=1Dutc')));assert(seen.some(u=>u.includes('interval=1d')));assert(!seen.some(u=>u.includes('proxy')));
});

(async()=>{for(const t of tests){await t.fn();console.log('ok - '+t.name);}console.log(tests.length+' meaningful market tests passed');})().catch(e=>{console.error(e);process.exitCode=1;});
