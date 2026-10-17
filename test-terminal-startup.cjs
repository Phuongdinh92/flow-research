'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const T=require('./terminal-ui.js');
const P=require('./public-data.js');
const R=require('./research-ui.js');
const S=require('./signal-core.js');
const C=require('./charts-core.js');
const V=require('./charts-view.js');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const preview=JSON.parse(fs.readFileSync('./data/terminal-preview.json'));
const fileFetch=async url=>{const filename=String(url).replace(/^\.\//,'');return fs.existsSync(filename)?new Response(fs.readFileSync(filename),{status:200}):new Response('',{status:404});};

test('actual verified lightweight BTC archive renders candles before a hung optional layer settles',async()=>{
 const events=[],progress=[];let chart='',signalReady;const ready=new Promise(resolve=>{signalReady=resolve;});
 const run=T.loadInStages({
  primary:ctx=>P.loadVerified('./data/terminal-preview.json',{fetchImpl:T.progressFetch(fileFetch,ctx),signal:ctx.signal,validate:value=>T.validatePreview(value,R)}),
  secondary:[{key:'holders',load:()=>new Promise(()=>{})},{key:'costReference',load:async()=>{events.push('cost-reference');return 'optional';}}],
  secondaryTimeoutMs:25,onProgress:(key,value)=>progress.push({key,...value}),
  onPrimary:loaded=>{const h=loaded.data.data.histories['binance:BTCUSDT'];const out=C.aggregateBarsUTC(h.bars,{asOf:h.asOf,now:Date.now(),interval:'1d',windowDays:180});const analyzed=S.analyze(h,{windowDays:365});assert.equal(analyzed.seriesFull.length,401);chart=V.daily(out.series,{mode:'price',showSma20:false});events.push('candles');signalReady();},
  onSecondary:(key,result)=>events.push(key+':'+result.status)
 });
 await Promise.race([ready,run]);assert.match(chart,/chart-price-pro/);assert.equal(events[0],'candles');assert.ok(!events.includes('holders:rejected'));
 const out=await run;assert.equal(out.secondary[0].reason.code,'load_timeout');assert.equal(out.secondary[1].status,'fulfilled');assert.match(chart,/chart-price-pro/);
 assert.ok(progress.some(p=>p.key==='primary'&&p.phase==='verify'&&p.loaded===21387));
});

test('failed base archive never starts optional layers or manufactures bars',async()=>{
 let starts=0,published=0;await assert.rejects(T.loadInStages({primary:async()=>{throw Error('SHA-256 không khớp');},secondary:[{key:'costReference',load:async()=>{starts++;}}],onPrimary:()=>published++}),/SHA-256/);
 assert.equal(starts,0);assert.equal(published,0);
});

test('secondary failures are explicit and retain the already published primary object and timestamps',async()=>{
 const bars={sourceTs:1792195199999,fetchedAt:1792195379819};let shown;const results=[];
 await T.loadInStages({primary:async()=>bars,onPrimary:value=>{shown=value;},secondary:[{key:'holderHistory',load:async()=>{throw Error('Gzip HTTP 503');}},{key:'costReference',load:async()=>({sourceTs:10})}],onSecondary:(key,value)=>results.push({key,...value})});
 assert.equal(shown,bars);assert.equal(shown.fetchedAt,1792195379819);assert.equal(results.find(r=>r.key==='holderHistory').reason.message,'Gzip HTTP 503');assert.equal(results.find(r=>r.key==='costReference').status,'fulfilled');
});

test('bounded stages cancel outstanding work and a superseded generation cannot publish its late optional result',async()=>{
 const controller=new AbortController();let abortSeen=false,published=0,release;
 const run=T.loadInStages({signal:controller.signal,primary:async()=>1,secondary:[{key:'ledger',load:ctx=>{ctx.signal.addEventListener('abort',()=>{abortSeen=true;});return new Promise(resolve=>{release=resolve;});}}],onSecondary:()=>published++});
 await sleep(0);controller.abort(Error('superseded'));await assert.rejects(run,/superseded/);release({old:true});await sleep(0);assert.equal(abortSeen,true);assert.equal(published,0);
});

test('optional downloads are limited to two concurrent tasks',async()=>{
 let active=0,max=0,completed=0;
 await T.loadInStages({primary:async()=>1,secondary:Array.from({length:7},(_,i)=>({key:String(i),load:async()=>{active++;max=Math.max(max,active);await sleep(2);active--;completed++;}})),concurrency:2});
 assert.equal(max,2);assert.equal(completed,7);
});

test('real transfer progress counts bytes read from the response rather than invented timer percentages',async()=>{
 const seen=[];let part=0;const fetcher=T.progressFetch(async()=>({ok:true,status:200,body:{getReader:()=>({read:async()=>part++===0?{done:false,value:Uint8Array.of(1,2)}:part===2?{done:false,value:Uint8Array.of(3,4,5)}:{done:true},cancel:async()=>{}})}}),{onProgress:value=>seen.push(value)});
 const response=await fetcher('./data/source.json.gz');assert.deepEqual([...new Uint8Array(await response.arrayBuffer())],[1,2,3,4,5]);assert.deepEqual(seen.filter(p=>p.phase==='download').map(p=>p.loaded),[0,2,5]);assert.equal(seen.at(-1).phase,'verify');assert.equal(seen.at(-1).loaded,5);
});

test('preview validation binds BTC identity, source end time and complete 401 source bars',()=>{
 assert.equal(T.validatePreview(preview,R),preview);
 for(const mutate of [p=>p.data.endTime--,p=>p.parentManifest.endTime--,p=>p.data.histories['binance:BTCUSDT'].bars.pop(),p=>{p.data.histories['binance:ETHUSDT']=p.data.histories['binance:BTCUSDT'];},p=>p.data.histories['binance:BTCUSDT'].provenance[0].url='https://example.com/unverified']){const broken=structuredClone(preview);mutate(broken);assert.throws(()=>T.validatePreview(broken,R));}
});

test('preview source proof identifies the verified preview and keeps the parent full-archive hash a reference',()=>{
 const html=T.proofHtml(preview.data.histories['binance:BTCUSDT'],{...preview.parentManifest,previewTransport:{decodedSha256:'a'.repeat(64)}});
 assert.match(html,/Bản mở nhanh BTC đã kiểm tra/);assert.match(html,/chưa được trình duyệt xác minh/);assert.doesNotMatch(html,/Gói nến SHA-256/);
});

test('complete terminal startup replaces its placeholder with verified BTC candles even when the full archive hangs',async()=>{
 const globals=['document','FlowSignals','FlowCharts','FlowChartsView','FlowResearch','FlowPublicData','FlowIntelligence','FlowHolders','FlowHolderHistory','FlowCostReference','FlowDerivatives','ChainLedger','FlowChainLedger','FlowUI'];const previous=new Map(globals.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 const nodes=new Map();let anonymous=0;
 const element=id=>{if(nodes.has(id))return nodes.get(id);const node={id,dataset:{},clientWidth:1200,hidden:false,open:false,disabled:false,textContent:'',classList:{add(){},remove(){}},addEventListener(){},setAttribute(){},appendChild(value){return value;},after(){},querySelector(selector){return selector.startsWith('#')?nodes.get(selector.slice(1))||null:null;},querySelectorAll(){return [];},insertAdjacentHTML(_where,html){for(const match of html.matchAll(/\bid="([^"]+)"/g))element(match[1]);},matches(){return false;}};let html='';Object.defineProperty(node,'innerHTML',{get:()=>html,set:value=>{html=value;node.insertAdjacentHTML('beforeend',value);}});nodes.set(id,node);return node;};element('terminal');
 let terminal;
 try{
  globalThis.document={getElementById:id=>nodes.get(id)||null,createElement:()=>element('anonymous-'+anonymous++),addEventListener(){},hidden:false};
  Object.assign(globalThis,{FlowSignals:S,FlowCharts:C,FlowChartsView:V,FlowResearch:R,FlowPublicData:P});
  for(const key of ['FlowIntelligence','FlowHolders','FlowHolderHistory','FlowCostReference','FlowDerivatives','ChainLedger','FlowChainLedger','FlowUI'])globalThis[key]=undefined;
  terminal=T.init({fetcher:fileFetch,loadResearch:()=>new Promise(()=>{}),researchTimeoutMs:10,optionalTimeoutMs:10});
  const until=Date.now()+2000;while(terminal.state.backgroundBusy&&Date.now()<until)await sleep(1);
  assert.equal(terminal.state.initialized,true);assert.equal(terminal.state.preview,true);assert.equal(terminal.state.data.histories['binance:BTCUSDT'].bars.length,401);
  assert.match(nodes.get('terminal-price-body').innerHTML,/chart-price-pro/);assert.doesNotMatch(nodes.get('terminal-price-body').innerHTML,/Đang kiểm tra lịch sử/);
  assert.match(nodes.get('terminal-status').textContent,/Đã hiện BTC/);assert.match(nodes.get('terminal-status').textContent,/Danh mục đầy đủ chưa nạp được/);assert.match(nodes.get('terminal-loading-body').innerHTML,/Quá thời gian chờ/);assert.equal(nodes.get('terminal-reload').disabled,false);
 }finally{terminal?.state.loadController?.abort();for(const [key,descriptor]of previous){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}
});
