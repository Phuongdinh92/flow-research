'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),L=require('./live-market.js');
const BASE=1792243278000,btc={instrument:'BTCUSDT',base:'BTC',quote:'USDT'},eth={instrument:'ETHUSDT',base:'ETH',quote:'USDT'};
const ticker=(extra={})=>({e:'24hrMiniTicker',E:BASE-500,s:'BTCUSDT',c:'101.00000000',o:'100.00000000',h:'103.00000000',l:'97.00000000',v:'1000.00000000',q:'100500.00000000',...extra});
function harness(opts={}){
 let time=BASE,serial=0;const tasks=new Map(),updates=[],statuses=[],sockets=[],listeners=new Map();
 const doc={hidden:false,addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:type=>listeners.delete(type)};
 class Socket{constructor(url){this.url=url;this.closed=false;sockets.push(this);}close(code,reason){this.closed=true;this.closeCode=code;this.closeReason=reason;}open(){this.onopen?.({});}message(value){this.onmessage?.({data:typeof value==='string'?value:JSON.stringify(value)});}error(){this.onerror?.({});}drop(code=1006){this.onclose?.({code});}}
 const engine=L.create({instruments:[btc,eth],now:()=>time,setTimeout:(fn,ms)=>{const id=++serial;tasks.set(id,{fn,at:time+ms});return id;},clearTimeout:id=>tasks.delete(id),WebSocketImpl:Socket,document:doc,onUpdate:x=>updates.push(x),onStatus:x=>statuses.push(x),...opts});
 const advance=ms=>{const end=time+ms;for(let n=0;n<1000;n++){const next=[...tasks].filter(([,x])=>x.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next){time=end;return;}time=next[1].at;tasks.delete(next[0]);next[1].fn();}throw Error('Timer loop');};
 return {engine,advance,updates,statuses,sockets,doc,visibility:flag=>{doc.hidden=flag;listeners.get('visibilitychange')?.();},get time(){return time;},get tasks(){return tasks;},listeners};
}
test('documented market-data-only endpoint and unrounded source numbers are used',()=>{
 assert.equal(L.ENDPOINT,'wss://data-stream.binance.vision/ws/!miniTicker@arr');const r=L.parseTicker(ticker(),btc,BASE);
 assert.equal(r.key,'binance:BTCUSDT');assert.equal(r.turnover24,100500);assert.equal(r.volume24,1000);assert.equal(r.return24,101/100-1);assert.equal(r.asOf,BASE-500);assert.equal(r.receivedAt,BASE);assert.equal(r.raw.c,'101.00000000');assert.equal(r.lastTradeAt,null);assert.equal(r.sourceEventAt,BASE-500);assert.equal(r.window,'rolling24h');
});
test('source timestamp is never replaced with local receive time',()=>{
 const a=L.parseTicker(ticker(),btc,BASE),b=L.parseTicker(ticker(),btc,BASE+1000);assert.equal(a.eventTime,b.eventTime);assert.notEqual(a.receivedAt,b.receivedAt);assert.equal(b.eventTime,BASE-500);
});
test('malformed, non-finite, negative and contradictory source fields fail closed',()=>{
 for(const patch of [{e:'24hrTicker'},{s:'ETHUSDT'},{E:BASE/1000},{E:BASE*1000},{c:''},{c:'NaN'},{c:'Infinity'},{c:101},{c:'0'},{o:'0'},{h:'99'},{l:'102'},{q:'-1'},{v:null},{v:'0',q:'1'},{v:'1',q:'0'}])assert.throws(()=>L.parseTicker(ticker(patch),btc,BASE));
 assert.throws(()=>L.parseTicker(ticker(),{...btc,quote:'USD'},BASE));
});
test('stale and future frames reject at documented local acceptance thresholds',()=>{
 assert.throws(()=>L.parseTicker(ticker({E:BASE-L.MAX_EVENT_AGE_MS-1}),btc,BASE),/old_event/);assert.throws(()=>L.parseTicker(ticker({E:BASE+L.MAX_FUTURE_MS+1}),btc,BASE),/future_event/);
 assert.equal(L.parseTicker(ticker({E:BASE-L.MAX_EVENT_AGE_MS}),btc,BASE).eventTime,BASE-L.MAX_EVENT_AGE_MS);
});
test('zero traded volume and unchanged price are valid and remain zero',()=>{
 const r=L.parseTicker(ticker({c:'100',v:'0',q:'0'}),btc,BASE);assert.equal(r.return24,0);assert.equal(r.turnover24,0);assert.equal(r.volume24,0);
});
test('opening a socket alone never reports live or fabricates a ticker',()=>{
 const h=harness();h.engine.start();assert.equal(h.engine.snapshot().status.state,'connecting');assert.equal(h.sockets.length,1);assert.equal(h.sockets[0].url,L.ENDPOINT);h.sockets[0].open();h.advance(2000);const s=h.engine.snapshot();assert.equal(s.status.state,'waiting');assert.equal(s.rows.length,0);assert.equal(s.status.lastEventAt,null);
});
test('partial changed-symbol arrays retain quiet rows without inflating their event time',()=>{
 const h=harness();h.engine.start();const s=h.sockets[0];s.open();s.message([ticker()]);h.advance(1000);s.message([ticker({s:'ETHUSDT',E:h.time-200})]);const snap=h.engine.snapshot();assert.equal(snap.rows.length,2);assert.equal(snap.rows.find(r=>r.instrument==='BTCUSDT').eventTime,BASE-500);assert.equal(snap.status.expectedCount,2);assert.equal(snap.status.observedCount,2);assert.equal(snap.status.freshCount,2);
 h.advance(4501);s.message([ticker({s:'ETHUSDT',E:h.time-100})]);const next=h.engine.snapshot();assert.equal(next.status.state,'live');assert.equal(next.status.freshCount,1);assert.equal(next.rows.find(r=>r.instrument==='BTCUSDT').stale,true);assert.equal(next.rows.find(r=>r.instrument==='BTCUSDT').eventTime,BASE-500);
});
test('an empty array, unrelated symbols or bad frames do not refresh accepted-source freshness',()=>{
 const h=harness();h.engine.start();const s=h.sockets[0];s.open();s.message([ticker()]);h.advance(5001);for(const x of [[],[ticker({s:'SOLUSDT',E:h.time})],'{invalid',{},[{code:-1}]])s.message(x);const snap=h.engine.snapshot();assert.equal(snap.status.state,'stale');assert.equal(snap.status.lastReceivedAt,BASE);assert.equal(snap.status.lastEventAt,BASE-500);assert.equal(snap.status.filtered,2);assert.equal(snap.status.rejectionReasons.json,1);assert.equal(snap.status.rejectionReasons.frame_shape,1);
});
test('duplicates, conflicts and out-of-order events never replace a newer quote',()=>{
 const h=harness();h.engine.start();const s=h.sockets[0];s.open();s.message([ticker()]);h.advance(1000);s.message([ticker(),ticker({s:'ETHUSDT',E:h.time-100})]);s.message([ticker({c:'102'})]);s.message([ticker({E:BASE-600,c:'99'})]);const snap=h.engine.snapshot();assert.equal(snap.rows.find(r=>r.instrument==='BTCUSDT').last,101);assert.equal(snap.status.rejectionReasons.duplicate,1);assert.equal(snap.status.rejectionReasons.same_time_conflict,1);assert.equal(snap.status.rejectionReasons.out_of_order,1);
});
test('conflicting duplicate instruments within a single frame are all rejected',()=>{
 const h=harness();h.engine.start();h.sockets[0].open();h.sockets[0].message([ticker(),ticker({c:'102'})]);assert.equal(h.engine.snapshot().rows.length,0);assert.equal(h.engine.snapshot().status.rejectionReasons.frame_duplicate,2);
});
test('one source error cannot introduce non-allowlisted or cross-venue identities',()=>{
 const h=harness();h.engine.start();h.sockets[0].open();h.sockets[0].message([ticker({s:'BTCUSDC'}),ticker({s:'BTC_USDT'}),ticker({s:'BTCUSDT',sourceId:'gate'})]);assert.deepEqual(h.engine.snapshot().rows.map(r=>r.key),['binance:BTCUSDT']);assert.equal(h.engine.snapshot().status.filtered,2);assert.throws(()=>h.engine.setInstruments([{...btc,sourceId:'gate'}]));
});
test('no arbitrary 50 or 200 asset cap is applied to eligible stream observations',()=>{
 const many=Array.from({length:750},(_,i)=>({instrument:'C'+i+'USDT',base:'C'+i,quote:'USDT'})),h=harness({instruments:many});h.engine.start();h.sockets[0].open();h.sockets[0].message(many.map(x=>ticker({s:x.instrument})));assert.equal(h.engine.snapshot().rows.length,750);assert.equal(h.engine.snapshot().status.expectedCount,750);
});
test('source update callbacks are batched while the newest observed quote is preserved',()=>{
 const h=harness();h.engine.start();const s=h.sockets[0];s.open();const before=h.updates.length;for(let i=0;i<20;i++)s.message([ticker({E:BASE-500+i})]);assert.equal(h.updates.length,before);h.advance(1000);assert.equal(h.updates.length,before+1);assert.equal(h.updates.at(-1).changedRows.length,1);assert.equal(h.updates.at(-1).changedRows[0].eventTime,BASE-481);assert.equal(h.engine.snapshot().status.accepted,20);
});
test('freshness expiry produces a callback with unchanged real source timestamps',()=>{
 const h=harness();h.engine.start();h.sockets[0].open();h.sockets[0].message([ticker()]);h.advance(6000);assert.equal(h.updates.at(-1).status.freshCount,0);assert.equal(h.updates.at(-1).rows[0].stale,true);assert.equal(h.updates.at(-1).rows[0].eventTime,BASE-500);assert.equal(h.updates.at(-1).changedRows.length,0);
});
test('manual stop closes the socket and reports retained rows as stale',()=>{
 const h=harness();h.engine.start();const s=h.sockets[0];s.open();s.message([ticker()]);const handler=s.onmessage;h.engine.stop();handler({data:JSON.stringify([ticker({E:BASE+1,c:'102'})])});const snap=h.engine.snapshot();assert.equal(s.closed,true);assert.equal(snap.status.state,'idle');assert.equal(snap.status.freshCount,0);assert.equal(snap.rows[0].stale,true);assert.equal(snap.rows[0].last,101);assert.equal(h.tasks.size,0);
});
test('initial access failure stops rather than cycling across hosts or retrying',()=>{
 const h=harness();h.engine.start();h.sockets[0].error();h.advance(120000);assert.equal(h.engine.snapshot().status.state,'blocked');assert.equal(h.sockets.length,1);assert.equal(h.engine.snapshot().status.nextRetryAt,null);
});
test('reconnection is paced and starts waiting for a fresh event, retaining its source time',()=>{
 const h=harness();h.engine.start();let s=h.sockets[0];s.open();s.message([ticker()]);h.advance(1000);s.drop();assert.equal(h.engine.snapshot().status.state,'disconnected');assert.equal(h.engine.snapshot().status.freshCount,0);assert.equal(h.engine.snapshot().status.nextRetryAt,h.time+2000);h.advance(1999);assert.equal(h.sockets.length,1);h.advance(1);assert.equal(h.sockets.length,2);s=h.sockets[1];s.open();assert.equal(h.engine.snapshot().status.state,'waiting');assert.equal(h.engine.snapshot().status.freshCount,0);assert.equal(h.engine.snapshot().rows[0].stale,true);s.message([ticker({E:h.time-100})]);assert.equal(h.engine.snapshot().status.state,'live');assert.equal(h.engine.snapshot().status.reconnects,1);
});
test('explicit policy closure blocks automated reconnects',()=>{
 const h=harness();h.engine.start();h.sockets[0].open();h.sockets[0].drop(1008);h.advance(120000);assert.equal(h.sockets.length,1);assert.equal(h.engine.snapshot().status.state,'blocked');assert.equal(h.engine.snapshot().status.blockedReason,'source_policy_1008');
});
test('same-millisecond stop and restart cannot mark the previous connection fresh',()=>{
 const h=harness();h.engine.start();h.sockets[0].open();h.sockets[0].message([ticker()]);h.engine.stop();h.engine.start();h.sockets[1].open();const snap=h.engine.snapshot();assert.equal(snap.status.state,'waiting');assert.equal(snap.status.freshCount,0);assert.equal(snap.rows[0].stale,true);
});
test('hidden tabs close the stream and resume with original per-symbol times',()=>{
 const h=harness();h.engine.start();h.sockets[0].open();h.sockets[0].message([ticker()]);h.visibility(true);assert.equal(h.engine.snapshot().status.state,'paused');assert.equal(h.engine.snapshot().status.freshCount,0);h.advance(30000);assert.equal(h.sockets.length,1);h.visibility(false);assert.equal(h.sockets.length,2);h.sockets[1].open();assert.equal(h.engine.snapshot().status.state,'waiting');assert.equal(h.engine.snapshot().rows[0].eventTime,BASE-500);h.engine.destroy();assert.equal(h.listeners.size,0);assert.equal(h.tasks.size,0);
});
test('metadata revisions remove delisted rows and allow newly listed exact identities',()=>{
 const h=harness();h.engine.start();h.sockets[0].open();h.sockets[0].message([ticker()]);h.engine.setInstruments([eth]);h.sockets[0].message([ticker({E:BASE+1}),ticker({s:'ETHUSDT',E:BASE+1})]);const snap=h.engine.snapshot();assert.deepEqual(snap.rows.map(x=>x.instrument),['ETHUSDT']);assert.equal(snap.status.expectedCount,1);assert.throws(()=>h.engine.setInstruments([eth,eth]));
});
test('empty or unsupported runtimes expose their actual state without inventing values',()=>{
 const a=harness({instruments:[]});a.engine.start();assert.equal(a.engine.snapshot().status.state,'empty');assert.equal(a.sockets.length,0);a.engine.setInstruments([btc]);assert.equal(a.sockets.length,1);const b=harness({WebSocketImpl:{}});b.engine.start();assert.equal(b.engine.snapshot().status.state,'unsupported');assert.equal(b.engine.snapshot().rows.length,0);
});
