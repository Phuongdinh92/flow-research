#!/usr/bin/env node
'use strict';
/* Offline reproducible descriptive event study. It does not fetch or trade. */
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto');
const I=require('./intelligence-core.js'),Classes=require('./instrument-classes.js');
const input=path.resolve(process.argv[2]||path.join(__dirname,'data/research-snapshot.json.gz'));
const output=path.resolve(process.argv[3]||path.join(__dirname,'data/intelligence-study.json'));
const bytes=fs.readFileSync(input),snapshot=JSON.parse(input.endsWith('.gz')?zlib.gunzipSync(bytes):bytes.toString());
if(snapshot.kind!=='cex-research'||snapshot.sourceId!=='binance'||!snapshot.histories)throw Error('Unsupported archive');
if(snapshot.collectionState!=='complete'||snapshot.sourceCoverage?.completed!==snapshot.sourceCoverage?.eligible||snapshot.errors?.length)throw Error('Source archive is incomplete; preserve previous study until the full declared collection finishes');
const inputSha256=crypto.createHash('sha256').update(bytes).digest('hex');
const histories=Object.values(snapshot.histories),analyses=new Map(),raw=new Map(),errors=[],classifications=new Map(),latest=[];
if(histories.length!==snapshot.sourceCoverage.completed)throw Error('Archive history count does not match declared completed source coverage');
// asOf fixes the market cutoff before a multi-minute collection starts; fetchedAt
// naturally follows it. Validate against the finished collection clock, not start.
const observationClock=Math.max(snapshot.asOf,snapshot.finishedAt||0,...histories.map(h=>h.fetchedAt));
for(const h of histories){try{
  const a=I.analyze(h,{now:observationClock}),classification=Classes.classify(h.sourceId,h.instrument);
  analyses.set(h.key,a);raw.set(h.key,a.series.map(p=>p.metrics));classifications.set(h.key,classification);
  latest.push({key:a.key,base:a.base,instrument:a.instrument,classification,asOf:a.asOf,fetchedAt:a.fetchedAt,coverage:a.coverage,latest:a.latest});
}catch(e){errors.push({key:h.key,error:e.message});}}
const included=[...analyses.values()].filter(a=>!classifications.get(a.key).excludedByDefault),studyUniverse=included.filter(a=>a.key!=='binance:BTCUSDT');
const allEvents=included.flatMap(a=>a.events).sort((a,b)=>a.signalTime-b.signalTime||a.key.localeCompare(b.key)||a.signal.localeCompare(b.signal));
const costScenario={feeBpsPerSide:10,slippageBpsPerSide:10,fundingBps:0,borrowBps:0,unit:'bps',description:'Illustrative costs only: 0.10% fee + 0.10% slippage each side. Actual execution costs are not observed.'};
const design={
  kind:'retrospective_descriptive_event_study',signal:'pressureSetup',horizons:[7,30],
  signalRule:I.DEFINITIONS.pressureSetup,signalTimestamp:'Completed UTC candle close. Inputs use that candle and earlier candles only.',
  entry:'Next completed daily candle OPEN proxy after signal close; assumes immediate next-open execution. Not an observed fill.',
  exit:'CLOSE of the 7th / 30th UTC candle after signal. No stop, target, leverage or intraperiod trading.',
  costs:costScenario,
  netFormula:'exitClose × (1 - 0.002) / (entryOpen × (1 + 0.002)) - 1',
  drawdown:'Maximum loss from entry-open or a previous daily CLOSE peak to a later daily CLOSE. Daily intrabar path unknown; worst daily LOW / entryOpen - 1 reported separately.',
  selection:'Condition onsets only; exclude first-observable/left-censored onsets; retain first eligible onset then 30-calendar-day per-instrument embargo. Events with pending outcomes remain in ledger.',
  baseline:'For each event date, equal-weight other current-listed instruments in the same date-specific trailing30 quote-volume quartile and with -30% ≤ return30 ≤ 15%. Require 37 continuous prior candles and valid taker/volume inputs. No pressure/share threshold. Each horizon uses only complete outcomes and reports unavailable counts.',
  benchmark:'BTCUSDT next-open to same-horizon close, with same illustrative trading costs. Excess = token net return minus BTC net return.',
  universe:'Current-listed Binance spot/USDT archive; explicitly classified securities/stablecoins/fiat excluded, BTC benchmark excluded from event candidates. Remaining assets not fully classified.',
  validation:'Exploratory in-sample description, not out-of-sample validation, causal evidence, a trading recommendation or a statistically established edge.',
  limitations:[...I.LIMITATIONS,'Historical membership, delisted instruments, actual fills, order-book depth and historical trader identity are unavailable. Same-day controls share market exposure; rows are not independent across instruments. No significance or win-probability claim.','Baseline membership uses data at signal close, but the source universe and explicit asset classifications were assembled at collection time. This prevents a claim of fully point-in-time universe backtesting.']
};
const dateMap=new Map();
for(const a of studyUniverse){for(let index=0;index<a.series.length;index++){
  const p=a.series[index],m=p.metrics;
  if(m.contiguousDays<37||[m.return30,m.buyShare7,m.buyShare30,m.volumeRatio7vsPrior30].some(v=>v===null))continue;
  const rows=raw.get(a.key).slice(index-29,index+1),liquidity=rows.reduce((s,b)=>s+b.quote,0)/30;
  if(!dateMap.has(p.end))dateMap.set(p.end,[]);
  dateMap.get(p.end).push({key:a.key,index,liquidity,return30:m.return30});
}}
for(const list of dateMap.values()){
  list.sort((a,b)=>a.liquidity-b.liquidity||a.key.localeCompare(b.key));
  list.forEach((r,j)=>r.quartile=Math.min(3,Math.floor(j*4/list.length)));
}
const btc=raw.get('binance:BTCUSDT'),btcByEnd=new Map((btc||[]).map((b,index)=>[b.end,index])),outcomeCache=new Map();
function getOutcome(key,index,horizon){const id=key+':'+index+':'+horizon;if(!outcomeCache.has(id))outcomeCache.set(id,I.outcome(raw.get(key),index,horizon));return outcomeCache.get(id);}
const studyEvents=[],excluded={firstObservable:0,overlapEmbargo:0},lastSelected=new Map();
for(const event of allEvents.filter(e=>e.signal==='pressureSetup'&&e.key!=='binance:BTCUSDT')){
  if(event.firstObservable){excluded.firstObservable++;continue;}
  if(lastSelected.has(event.key)&&event.signalTime-lastSelected.get(event.key)<30*I.DAY){excluded.overlapEmbargo++;continue;}
  lastSelected.set(event.key,event.signalTime);
  const sameDay=dateMap.get(event.signalTime)||[],self=sameDay.find(r=>r.key===event.key),controls=self?sameDay.filter(r=>r.key!==event.key&&r.quartile===self.quartile&&r.return30>=-.30&&r.return30<=.15):[];
  const result={...event,base:analyses.get(event.key).base,liquidityQuartile:self?self.quartile+1:null,baselinePoolCount:controls.length,outcomes:{}};
  for(const horizon of design.horizons){
    const token=getOutcome(event.key,event.index,horizon),btcIndex=btcByEnd.get(event.signalTime),benchmark=btcIndex===undefined?null:I.outcome(btc,btcIndex,horizon);
    const compared=controls.map(r=>getOutcome(r.key,r.index,horizon)),complete=compared.filter(o=>o.status==='complete'),baselineReturn=I.describe(complete.map(o=>o.netReturn));
    result.outcomes[horizon]={...token,btcNetReturn:benchmark?.status==='complete'?benchmark.netReturn:null,excessBtc:token.status==='complete'&&benchmark?.status==='complete'?token.netReturn-benchmark.netReturn:null,baseline:{count:complete.length,unavailableCount:compared.length-complete.length,meanNetReturn:baselineReturn.mean,medianNetReturn:baselineReturn.median,positiveRate:baselineReturn.positiveRate},excessBaseline:token.status==='complete'&&baselineReturn.mean!==null?token.netReturn-baselineReturn.mean:null};
  }
  studyEvents.push(result);
}
const summary={};
for(const horizon of design.horizons){
  const outcomes=studyEvents.map(e=>e.outcomes[horizon]),complete=outcomes.filter(o=>o.status==='complete');
  summary[horizon]={selectedEvents:outcomes.length,completedEvents:complete.length,pendingEvents:outcomes.filter(o=>o.status==='pending').length,missingEvents:outcomes.filter(o=>o.status==='missing').length,netReturn:I.describe(complete.map(o=>o.netReturn)),grossReturn:I.describe(complete.map(o=>o.grossReturn)),excessBtc:I.describe(complete.map(o=>o.excessBtc)),excessBaseline:I.describe(complete.map(o=>o.excessBaseline)),matchedBaselineMean:I.describe(complete.map(o=>o.baseline.meanNetReturn)),maxDrawdown:I.describe(complete.map(o=>o.maxDrawdown)),worstLowFromEntry:I.describe(complete.map(o=>o.worstLowFromEntry)),negativeEvents:complete.filter(o=>o.netReturn<0).length,zeroEvents:complete.filter(o=>o.netReturn===0).length,positiveEvents:complete.filter(o=>o.netReturn>0).length};
}
const conditionDays={};for(const signal of Object.keys(I.DEFINITIONS)){conditionDays[signal]={};for(const days of I.WINDOWS){const threshold=snapshot.endTime-days*I.DAY;conditionDays[signal][days]=included.reduce((sum,a)=>sum+a.series.filter(p=>p.end>threshold&&p.end<=snapshot.endTime&&p.features[signal]===true).length,0);}}
function breadth(read){const values=included.map(a=>a.latest).filter(p=>p.end===snapshot.endTime).map(read).filter(Number.isFinite);return {available:values.length,unavailable:included.length-values.length,positive:values.filter(x=>x>0).length,negative:values.filter(x=>x<0).length,flat:values.filter(x=>x===0).length,positiveFraction:values.length?values.filter(x=>x>0).length/values.length:null};}
const marketContext={asOf:snapshot.endTime,benchmark:analyses.get('binance:BTCUSDT')?.latest??null,
  breadth:{universeCount:included.length,return7:breadth(p=>p.metrics.return7),return30:breadth(p=>p.metrics.return30),distanceEma50:breadth(p=>p.metrics.distanceEma50),distanceEma200:breadth(p=>p.metrics.distanceEma200)},
  methodology:'Equal instrument counts in the explicitly filtered current-listed archive, not capitalization-weighted market breadth or unique-token counts. EMA distances >0 mean the close is above that EMA; unavailable inputs are excluded and counted. Descriptive regime context, not a forecast.'};
const record={schemaVersion:1,kind:'transparent-market-intelligence',generatedAt:Date.now(),asOf:snapshot.asOf,cutoff:snapshot.endTime,lastClosedDay:snapshot.lastClosedDay,
  source:{file:path.relative(path.dirname(output),input),sha256:inputSha256,archiveGeneratedAt:snapshot.generatedAt,observationClock,sourceId:snapshot.sourceId,archiveCollectionState:snapshot.collectionState,codeSha256:Object.fromEntries(['intelligence-core.js','collect_intelligence.cjs','signal-core.js','instrument-classes.js'].map(name=>[name,crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,name))).digest('hex')]))},
  scope:design.universe,coverage:{archiveExpectedInstruments:snapshot.sourceCoverage.eligible,archivedInstruments:histories.length,analyzedInstruments:analyses.size,defaultIncludedInstruments:included.length,eventStudyInstruments:studyUniverse.length,excludedByExplicitClassification:histories.filter(h=>Classes.classify(h.sourceId,h.instrument).excludedByDefault).length,errors,uniqueBeneficialOwnersKnown:0,fullHistoricalUniverse:false},
  definitions:I.DEFINITIONS,limitations:design.limitations,marketContext,latest,eventCounts:I.eventsSummary(allEvents,snapshot.asOf),conditionDays,eventLedger:allEvents,
  eventStudy:{design,excluded,summary,events:studyEvents},unavailable:{whaleAccumulation:'Không có danh tính và tồn kho trader; dữ liệu CEX không xác minh cá mập.',realizedBands:'Không có sổ lot/giá vốn ví. Không suy từ nến.',holderAge:'Không có lịch sử chủ sở hữu để phân bổ tuổi token.'}};
if(crypto.createHash('sha256').update(fs.readFileSync(input)).digest('hex')!==inputSha256)throw Error('Source archive changed during analysis; previous study preserved');
I.validateStudy(record);
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output+'.tmp',JSON.stringify(record));fs.renameSync(output+'.tmp',output);
console.log(JSON.stringify({output,bytes:fs.statSync(output).size,coverage:{...record.coverage,errors:errors.length},onsets:allEvents.length,studyEvents:studyEvents.length,excluded,summary:Object.fromEntries(Object.entries(summary).map(([h,s])=>[h,{selected:s.selectedEvents,complete:s.completedEvents,pending:s.pendingEvents,netMean:s.netReturn.mean,netMedian:s.netReturn.median,positiveRate:s.netReturn.positiveRate,negative:s.negativeEvents,excessBtcMean:s.excessBtc.mean,excessBaselineMean:s.excessBaseline.mean}]))},null,2));
