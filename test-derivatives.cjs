'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const D = require('./derivatives-core.js'), C = require('./collect_derivatives.cjs');
const NOW = Date.UTC(2026,9,16,23,45), BEGIN = Math.floor(NOW / D.HOUR) * D.HOUR - 24 * D.HOUR, END = BEGIN + 24 * D.HOUR - 1;
const rawMeta = (name = 'BTC') => ({ name, szDecimals: 5, maxLeverage: 40, marginTableId: 56 });
const rawCtx = () => ({ funding: '0.0000125', openInterest: '100.25', prevDayPx: '80000', dayNtlVlm: '3500000.125', premium: null, oraclePx: '81000', markPx: '81200', midPx: '81195', impactPxs: ['81100','81300'], dayBaseVlm: '42.5' });
const receipt = (requestBody, time = NOW) => ({ url: D.ENDPOINT, method: 'POST', requestBody, startedAt: time - 100, fetchedAt: time, httpStatus: 200, contentType: 'application/json', bytes: 100, sha256: 'a'.repeat(64) });
const rawFunding = (name = 'BTC', count = 24, start = BEGIN) => Array.from({ length: count }, (_,i) => ({ coin: name, time: start + i * D.HOUR + 3, fundingRate: i % 2 ? '-0.00002' : '0.0000125', premium: '-0.0001' }));
function snapshot() {
  const raw = [{ universe: [rawMeta(), { ...rawMeta('kPEPE'), isDelisted: true }], collateralToken: 0 }, [rawCtx(), rawCtx()]];
  const n = D.normalizeContext(raw), h = D.normalizeFunding(rawFunding(), 'BTC', BEGIN, END);
  h.receipts = [receipt({ type: 'fundingHistory', coin: 'BTC', startTime: BEGIN, endTime: END })];
  return { schemaVersion:1, kind:'derivatives-context', sourceId:'hyperliquid', dex:'', marketType:'perpetual', generatedAt:NOW, asOf:NOW, finishedAt:NOW,
    providerAsOf:null, timestampBasis:'collector_response_received_utc', metadata:n.metadata, assets:n.assets,
    contextReceipt:receipt({type:'metaAndAssetCtxs',dex:''}), fundingHistories:{[h.key]:h}, coverage:{metadataEntries:2,activeMarkets:1,delistedMarkets:1,fundingRequested:1,fundingCaptured:1},
    errors:[],collectionState:'complete',capabilities:{liquidationHeatmap:false,whaleAttribution:false,openInterestHistory:false} };
}
function fresh(s) { return D.validateSnapshot(s, { now: NOW }); }
test('metadata/context index alignment is mandatory; duplicate native names reject',()=>{
  assert.throws(()=>D.normalizeContext([{universe:[rawMeta()],collateralToken:0},[]]),e=>e.code==='alignment');
  assert.throws(()=>D.normalizeContext([{universe:[rawMeta(),rawMeta()],collateralToken:0},[rawCtx(),rawCtx()]]),e=>e.code==='duplicate_asset');
  assert.throws(()=>D.normalizeContext([{universe:[rawMeta()],collateralToken:5},[rawCtx()]]),e=>e.code==='collateral');
});
test('native contract names never collapse kPEPE into PEPE or lowercase aliases',()=>{
  const s=snapshot(); assert.equal(D.findExactNativeAsset(s,'kPEPE').nativeName,'kPEPE'); assert.equal(D.findExactNativeAsset(s,'PEPE'),null); assert.equal(D.findExactNativeAsset(s,'btc'),null);
});
test('raw decimals retain precision and OI conversion does not double-count the two sides',()=>{
  const ctx=rawCtx();ctx.openInterest='100.250000000000000001'; const a=D.normalizeContext([{universe:[rawMeta()],collateralToken:0},[ctx]]).assets[0];
  assert.equal(a.rawContext.openInterest,'100.250000000000000001'); assert.equal(a.openInterestQuoteAtMark,100.25*81200);assert.equal(a.openInterestQuoteAtOracle,100.25*81000);
  assert.equal(a.fundingRateHourly,0.0000125); assert.equal(a.quoteUnit,'native_contract_quote');
});
test('null prices stay unavailable and never imply zero-valued positive OI',()=>{
  const ctx=rawCtx();ctx.markPx=null;ctx.oraclePx='0';const a=D.normalizeContext([{universe:[rawMeta()],collateralToken:0},[ctx]]).assets[0];
  assert.equal(a.markPrice,null);assert.equal(a.openInterestQuoteAtMark,null);assert.equal(a.openInterestQuoteAtOracle,null);assert.equal(a.priceChange24h,null);
});
test('reject numeric coercions, missing mandatory funding, negative OI and empty decimals',()=>{
  for(const [k,v] of [['funding',undefined],['openInterest','-1'],['dayNtlVlm',''],['markPx',81200],['oraclePx','Infinity']]){
    const c={...rawCtx(),[k]:v};assert.throws(()=>D.normalizeContext([{universe:[rawMeta()],collateralToken:0},[c]]));
  }
});
test('funding preserves signed hourly rates, UTC receipt offsets, and missing hours',()=>{
  const full=D.normalizeFunding(rawFunding(),'BTC',BEGIN,END); assert.equal(full.coverage.complete,true);assert.equal(full.coverage.expectedHours,24);
  assert.equal(full.rows[0].time,BEGIN+3); assert.equal(full.rows[0].hour,BEGIN);assert.equal(D.fundingSummary(full,24).complete,true);
  const raw=rawFunding();raw.splice(5,1);const gap=D.normalizeFunding(raw,'BTC',BEGIN,END);
  assert.deepEqual(gap.coverage.missingHours,[BEGIN+5*D.HOUR]);assert.equal(D.fundingSummary(gap,24).cumulativeRate,null);assert.equal(D.fundingSummary(gap,24).observedHours,23);
});
test('wrong-coin, out-of-range and duplicate funding records reject rather than guess',()=>{
  assert.throws(()=>D.normalizeFunding(rawFunding('ETH'),'BTC',BEGIN,END),e=>e.code==='funding_identity');
  assert.throws(()=>D.normalizeFunding(rawFunding('BTC',25),'BTC',BEGIN,END),e=>e.code==='funding_identity');
  const rows=rawFunding();rows.push({...rows[0],time:rows[0].time+1});assert.throws(()=>D.normalizeFunding(rows,'BTC',BEGIN,END),e=>e.code==='funding_duplicate');
});
test('summary excludes delisted markets and reports stale snapshot instead of presenting live',()=>{
  const s=snapshot(),result=D.summary(s,{now:NOW});assert.equal(result.active,1);assert.equal(result.delisted,1);assert.equal(result.totalOpenInterestQuoteAtMark,100.25*81200);assert.equal(result.stale,false);
  assert.equal(D.summary(s,{now:NOW+D.FRESH_MS+1}).stale,true);
});
test('snapshot validates recomputed metrics, coverage, source proof and unsupported capability flags',()=>{
  assert.equal(fresh(snapshot()).valid,true);
  for(const mutate of [s=>s.assets[0].openInterestQuoteAtMark++,s=>s.assets[0].nativeName='ETH',s=>s.coverage.activeMarkets++,s=>s.contextReceipt.sha256='bad',s=>s.capabilities.liquidationHeatmap=true,s=>s.providerAsOf=NOW,s=>s.asOf=NOW+120000]){
    const s=snapshot();mutate(s);assert.throws(()=>fresh(s));
  }
  const s=snapshot();s.fundingHistories[D.nativeKey('BTC')].rows[0].fundingRate=1;assert.throws(()=>fresh(s),e=>e.code==='funding_derived');
});
test('funding pagination uses inclusive cursor and deduplicates only identical boundary records',async()=>{
  const start=BEGIN-600*D.HOUR,end=start+720*D.HOUR-1,all=rawFunding('BTC',720,start),calls=[];
  const request=async body=>{calls.push(body);const value=all.filter(r=>r.time>=body.startTime&&r.time<=body.endTime).slice(0,500);return{value,receipt:receipt(body)};};
  const h=await C.collectFunding(request,{nativeName:'BTC',nativeIndex:0},start,end);assert.equal(h.rows.length,720);assert.equal(h.coverage.complete,true);assert.equal(calls.length,2);assert.equal(calls[1].startTime,all[499].time);
  let first=true;await assert.rejects(C.collectFunding(async body=>{const value=all.filter(r=>r.time>=body.startTime).slice(0,500).map(x=>({...x}));if(!first)value[0].fundingRate='0.7';first=false;return{value,receipt:receipt(body)};},{nativeName:'BTC',nativeIndex:0},start,end),/Conflicting source/);
});
test('HTTP restriction stops requester without retries',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'flow-deriv-test-'));let calls=0;
  const request=C.createRequester({gapMs:0,receiptsDir:dir,fetchImpl:async()=>{calls++;return{status:403,ok:false,headers:{get:()=> 'application/json'},text:async()=>'{"error":"denied"}'};}});
  try{await assert.rejects(request({type:'metaAndAssetCtxs',dex:''},'blocked'),/HTTP 403/);await assert.rejects(request({type:'metaAndAssetCtxs',dex:''},'second'),/already halted/);assert.equal(calls,1);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('failed funding collection preserves previous published snapshot exactly',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'flow-deriv-test-')),output=path.join(dir,'snapshot.json'),old='{"previous":"preserve exactly"}';fs.writeFileSync(output,old);
  const request=async body=>{if(body.type==='metaAndAssetCtxs')return{value:[{universe:[rawMeta()],collateralToken:0},[rawCtx()]],receipt:receipt(body,Date.now())};throw Error('Deliberate source outage');};
  try{await assert.rejects(C.collect({historyMarkets:1,historyDays:1,output,receiptsDir:dir,request}),/Deliberate source outage/);assert.equal(fs.readFileSync(output,'utf8'),old);assert.equal(fs.existsSync(path.join(dir,'last-failure-report.json')),true);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('reject invalid CLI scopes and accept explicit small collection',()=>{
  assert.deepEqual(C.argumentsFrom(['--history-markets','0','--history-days','7']),{historyMarkets:0,historyDays:7});
  assert.deepEqual(C.argumentsFrom([]),{historyMarkets:32,historyDays:90});
  assert.deepEqual(C.argumentsFrom(['--history-days','90','--selection-from','prior.json']),{historyMarkets:32,historyDays:90,selectionFrom:'prior.json'});
  for(const args of [['--history-markets','201'],['--history-days','91'],['--history-days','-1'],['--anything','1'],['--selection-from']])assert.throws(()=>C.argumentsFrom(args));
});
test('90-day pagination retains five source pages and exact hourly membership',async()=>{
  const start=Date.UTC(2026,6,19),end=start+90*D.DAY-1,all=rawFunding('BTC',2160,start),calls=[];
  const request=async body=>{calls.push(body);const value=all.filter(r=>r.time>=body.startTime&&r.time<=body.endTime).slice(0,500);return{value,receipt:receipt(body)};};
  const h=await C.collectFunding(request,{nativeName:'BTC',nativeIndex:0},start,end);
  assert.equal(h.rows.length,2160);assert.equal(h.coverage.complete,true);assert.equal(h.receipts.length,5);assert.equal(calls.length,5);
  assert.equal(D.aggregateFunding(h,'month').filter(p=>p.complete).length,2);
});
test('frozen selection preserves native membership and order despite changed volume ranks',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'flow-deriv-selection-')),file=path.join(dir,'baseline.json'),s=snapshot();
  s.fundingSelection={requestedMarkets:1,requestedDays:1,startTime:BEGIN,endTime:END,selectedNativeKeys:[D.nativeKey('BTC')],historicalMembership:false};
  fs.writeFileSync(file,JSON.stringify(s));
  try {
    const n=D.normalizeContext([{universe:[rawMeta('BTC'),rawMeta('ETH')],collateralToken:0},[{...rawCtx(),dayNtlVlm:'1'},{...rawCtx(),dayNtlVlm:'999999'}]]);
    assert.equal(C.selectMarkets(n,1).selected[0].nativeName,'ETH');
    const frozen=C.selectMarkets(n,1,file);assert.equal(frozen.selected[0].nativeName,'BTC');assert.match(frozen.baseline.sha256,/^[a-f0-9]{64}$/);
    assert.throws(()=>C.selectMarkets(n,2,file),/market count/);
    n.assets[0].isDelisted=true;assert.throws(()=>C.selectMarkets(n,1,file),/absent or delisted/);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test('selection windows and retained funding counters reject incorrect completeness claims',()=>{
  const s=snapshot();s.fundingSelection={requestedMarkets:1,requestedDays:1,startTime:BEGIN,endTime:END,selectedNativeKeys:[D.nativeKey('BTC')],historicalMembership:false};
  s.coverage.fundingRecords=24;s.coverage.fundingCompleteWindows=1;assert.equal(fresh(s).valid,true);
  for(const mutate of [v=>v.coverage.fundingRecords++,v=>v.coverage.fundingCompleteWindows=0,v=>v.fundingSelection.requestedDays=90,v=>v.fundingSelection.selectedNativeKeys.push(D.nativeKey('BTC')),v=>v.fundingSelection.historicalMembership=true]){
    const v=structuredClone(s);mutate(v);assert.throws(()=>fresh(v));
  }
});
const real=path.join(__dirname,'data','derivatives-snapshot.json');
if(fs.existsSync(real))test('published capture source fields and every retained funding record replay through validator',()=>{const s=JSON.parse(fs.readFileSync(real,'utf8'));const r=D.validateSnapshot(s);assert.equal(r.assets,s.metadata.universe.length);assert.ok(s.assets.length>100);for(const h of Object.values(s.fundingHistories))assert.ok(h.rows.length>0);});
test('UTC funding aggregation keeps partial calendar periods and missing hours unavailable',()=>{
  const start=Date.UTC(2026,9,1),end=Date.UTC(2026,10,1)-1;
  const raw=rawFunding('BTC',31*24,start),h=D.normalizeFunding(raw,'BTC',start,end);
  const month=D.aggregateFunding(h,'month');assert.equal(month.length,1);assert.equal(month[0].expectedHours,744);assert.equal(month[0].complete,true);assert.notEqual(month[0].sumRate,null);
  const gapRaw=raw.filter((_,i)=>i!==100),g=D.normalizeFunding(gapRaw,'BTC',start,end),gmonth=D.aggregateFunding(g,'month')[0];assert.equal(gmonth.missingWithinQuery,1);assert.equal(gmonth.sumRate,null);
  const short=D.normalizeFunding(raw.slice(24,72),'BTC',start+24*D.HOUR,start+72*D.HOUR-1),partial=D.aggregateFunding(short,'month')[0];assert.equal(partial.complete,false);assert.equal(partial.withinQueryHours,48);assert.equal(partial.missingWithinQuery,0);assert.equal(partial.sumRate,null);
  const weeks=D.aggregateFunding(h,'week');assert.equal(new Date(weeks[0].time).getUTCDay(),1);assert.equal(weeks[0].complete,false);assert.ok(weeks.some(w=>w.complete));
});
