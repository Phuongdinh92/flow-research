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
test('Gate registry and tickers preserve native instrument keys, percent units and response-clock quality',()=>{
 const meta=[{id:'BTC_USDT',base:'BTC',quote:'USDT',trade_status:'tradable',type:'normal'},{id:'PRE_USDT',base:'PRE',quote:'USDT',trade_status:'tradable',type:'premarket'},{id:'OFF_USDT',base:'OFF',quote:'USDT',trade_status:'untradable',type:'normal'}];
 const r=M.parseScan('gate',meta,[{currency_pair:'BTC_USDT',last:'100',change_percentage:'2.5',base_volume:'999',quote_volume:'25000'}],now,now);assert.equal(r.instrumentCount,1);assert.equal(r.rows[0].key,'gate:BTC_USDT');assert.equal(r.rows[0].return24,.025);assert.equal(r.rows[0].turnover24,25000);assert.equal(r.rows[0].timestampKind,'source_response');assert.equal(r.rows[0].asOf,now);assert.equal(r.capabilities.perInstrumentTimestamp,false);assert.equal(r.excludedCount,2);
 const dup=M.parseScan('gate',meta,[{currency_pair:'BTC_USDT'},{currency_pair:'BTC_USDT'}],now,now);assert.equal(dup.rows.length,0);assert.match(dup.errors[0].message,/trùng/);
});
test('Gate daily candle field order, seconds, quote volume and closed flag are validated',()=>{
 const gate=(time=day,flag='true')=>[String(time/1000),'5000','100','110','80','90','50',flag];
 const r=M.parseHistory('gate',[gate(today,'false'),gate()],now,now);assert.equal(r.bars.length,1);assert.equal(r.dropped,1);assert.deepEqual(r.bars[0],{time:day,end:day+M.DAY-1,open:90,high:110,low:80,close:100,quote:5000,buy:null});
 assert.equal(M.parseHistory('gate',[gate(day,'false')],now,now).bars.length,0);assert.throws(()=>M.parseHistory('gate',[gate(day,'maybe')],now,now));assert.throws(()=>M.parseHistory('gate',[gate(day+3600000)],now,now));
});
test('WhiteBIT exact quote volume, percent and spot filtering keep missing source time explicit',()=>{
 const meta=[{name:'BTC_USDT',stock:'BTC',money:'USDT',type:'spot',tradesEnabled:true},{name:'BTC_PERP',stock:'BTC',money:'USDT',type:'futures',tradesEnabled:true},{name:'OFF_USDT',stock:'OFF',money:'USDT',type:'spot',tradesEnabled:false}];
 const ticker={BTC_USDT:{last_price:'100',quote_volume:'15000',base_volume:'999',change:'-2',isFrozen:false},BTC_PERP:{last_price:'200'}};
 const r=M.parseScan('whitebit',meta,ticker,now,now);assert.equal(r.rows.length,1);assert.equal(r.rows[0].key,'whitebit:BTC_USDT');assert.equal(r.rows[0].return24,-.02);assert.equal(r.rows[0].turnover24,15000);assert.equal(r.rows[0].timestampKind,'response_received');assert.equal(r.capabilities.browserDirect,false);assert.equal(r.supportsDaily,false);assert.equal(r.excludedCount,2);
 ticker.BTC_USDT.isFrozen=true;const frozen=M.parseScan('whitebit',meta,ticker,now,now);assert.equal(frozen.rows.length,0);assert.equal(frozen.errors.length,1);assert.throws(()=>M.parseScan('whitebit',meta,[],now,now));
});
test('new adapters use only their documented public origin and unsupported history sends no request',async()=>{
 const seen=[];const response=data=>({ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>data});
 const fetcher=async url=>{seen.push(url);if(url.includes('/spot/time'))return response({server_time:Date.now()});if(url.includes('currency_pairs'))return response([{id:'BTC_USDT',base:'BTC',quote:'USDT',trade_status:'tradable',type:'normal'}]);if(url.includes('/spot/tickers'))return response([{currency_pair:'BTC_USDT',last:'100',quote_volume:'10000',change_percentage:'1'}]);if(url.includes('/public/markets'))return response([{name:'BTC_USDT',stock:'BTC',money:'USDT',type:'spot',tradesEnabled:true}]);return response({BTC_USDT:{last_price:'100',quote_volume:'10000',change:'1',isFrozen:false}});};
 assert.equal((await M.scanSource('gate',fetcher)).rows.length,1);assert.equal((await M.scanSource('whitebit',fetcher)).rows.length,1);assert(seen.every(u=>u.startsWith('https://api.gateio.ws/')||u.startsWith('https://whitebit.com/')));const n=seen.length;await assert.rejects(()=>M.history('whitebit','BTC_USDT',fetcher),/chưa hỗ trợ/);assert.equal(seen.length,n);assert.equal(M.NAMES.gate,'Gate');assert.equal(M.list().length,M.SOURCES.length);
});

test('history parsing preserves 121-day default and exposes requested 401-day coverage without silent truncation',()=>{
 const raw=Array.from({length:402},(_,i)=>bc(today-i*M.DAY));
 const legacy=M.parseHistory('binance',raw,now,now),long=M.parseHistory('binance',raw,now,now,{days:401});
 assert.equal(legacy.bars.length,121);assert.equal(legacy.coverage.requestedDays,121);
 assert.equal(long.bars.length,401);assert.equal(long.dropped,1);assert.equal(long.bars[0].time,today-401*M.DAY);assert.equal(long.bars.at(-1).time,day);assert.equal(long.coverage.completeWindow,true);assert.equal(long.coverage.shortfallDays,0);
 const short=M.parseHistory('binance',raw.slice(0,13),now,now,{days:401});assert.equal(short.bars.length,12);assert.equal(short.coverage.shortfallDays,389);assert.equal(short.coverage.completeWindow,false);
 const gap=M.parseHistory('binance',raw.filter((_,i)=>i!==10),now,now,{days:401});assert.equal(gap.coverage.continuous,false);assert.equal(gap.coverage.completeWindow,false);
});
test('long Binance and Gate histories request source-native daily limits and retain the full returned span',async()=>{
 for(const id of ['binance','gate']){
  const seen=[],response=data=>({ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>data});
  const fetcher=async url=>{seen.push(new URL(url));if(url.endsWith('/time'))return response(id==='binance'?{serverTime:Date.now()}:{server_time:Date.now()});return response(Array.from({length:402},(_,i)=>id==='binance'?bc(today-i*M.DAY):[String((today-i*M.DAY)/1000),'5000','100','110','80','90','50',i===0?'false':'true']));};
  const result=await M.history(id,id==='gate'?'BTC_USDT':'BTCUSDT',fetcher,{days:401});
  assert.equal(result.bars.length,401);assert.equal(result.coverage.completeWindow,true);assert.equal(seen.length,2);assert.equal(seen[1].searchParams.get('limit'),'402');assert.equal(seen[1].searchParams.get('interval'),'1d');assert.equal(seen[1].searchParams.has('from'),false);assert.equal(seen[1].searchParams.has('to'),false);
 }
});
test('Bitget long history fills an observed 300-row cap with an older documented page and leaves taker missing',async()=>{
 const seen=[],response=data=>({ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>wrap(data)});
 const fetcher=async url=>{const u=new URL(url);seen.push(u);return response(u.pathname.endsWith('/history-candles')?Array.from({length:102},(_,i)=>gc(today-(300+i)*M.DAY)):Array.from({length:300},(_,i)=>gc(today-i*M.DAY)));};
 const result=await M.history('bitget','BTCUSDT',fetcher,{days:401});
 assert.equal(result.bars.length,401);assert.equal(result.coverage.completeWindow,true);assert.equal(result.coverage.pages,2);assert.equal(result.dropped,1);assert(result.bars.every(b=>b.buy===null));
 assert.equal(seen.length,2);assert.equal(seen[0].searchParams.get('limit'),'402');assert.equal(seen[1].pathname,'/api/v2/spot/market/history-candles');assert.equal(seen[1].searchParams.get('limit'),'102');assert.equal(seen[1].searchParams.get('endTime'),String(today-299*M.DAY));assert.equal(seen[1].searchParams.get('granularity'),'1Dutc');
 assert.equal(result.bars[0].time,today-401*M.DAY);assert.equal(result.bars.at(-1).time,day);
});
test('Bitget short listing history remains explicitly short, and non-progress or blocked pagination stops',async()=>{
 const response=data=>({ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>wrap(data)});
 let calls=0;const recent=Array.from({length:12},(_,i)=>gc(day-i*M.DAY));
 const short=await M.history('bitget','BTCUSDT',async()=>response(++calls===1?recent:[]),{days:401});assert.equal(calls,2);assert.equal(short.bars.length,12);assert.equal(short.coverage.shortfallDays,389);assert.equal(short.coverage.completeWindow,false);
 calls=0;await assert.rejects(()=>M.history('bitget','BTCUSDT',async()=>{calls++;return response(recent);},{days:401}),/không lùi/);assert.equal(calls,2);
 calls=0;await assert.rejects(()=>M.history('bitget','BTCUSDT',async()=>++calls===1?response(recent):{ok:false,status:429,headers:{get:()=> '120'}},{days:401}),e=>e.retryAfterMs===120000);assert.equal(calls,2);
});
test('invalid history lengths fail before network access rather than clamping the requested period',async()=>{
 let calls=0;for(const days of [0,-1,1000,'401',401.5,NaN]){
  assert.throws(()=>M.parseHistory('binance',[bc()],now,now,{days}),/Số ngày lịch sử/);
  await assert.rejects(()=>M.history('binance','BTCUSDT',async()=>{calls++;throw Error('unexpected network');},{days}),/Số ngày lịch sử/);
 }assert.equal(calls,0);
});

(async()=>{for(const t of tests){await t.fn();console.log('ok - '+t.name);}console.log(tests.length+' meaningful market tests passed');})().catch(e=>{console.error(e);process.exitCode=1;});
