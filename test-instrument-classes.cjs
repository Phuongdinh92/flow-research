'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const Classes=require('./instrument-classes.js'),R=require('./research-ui.js'),S=require('./signal-core.js');
// Independent expected venue list from the 2026-08-28 Binance announcement:
// https://www.binance.com/vi/support/announcement/detail/4fea39f8b6e54e1b88e388fc90ce323e
const STOCKS='AAOIB AAPLB ALABB AMATB AMDB AMZNB ARMB ASMLB ASTSB AVGOB AXTIB BABAB BEB BMNRB CBRSB COHRB COINB CRCLB CRDOB CRWVB DELLB DJTB DRAMB EWYB FLNCB GLWB GMEB GOOGLB GSB HOODB IBMB INTCB INTWB IRENB KORUB LITEB METAB MRVLB MSFTB MSTRB MUB MUUB MVLLB NBISB NFLXB NOKB NVDAB ORCLB PLTRB PYPLB QCOMB QNTB QQQB RKLBB SKHYB SMCIB SMHB SNDKB SNXXB SOXLB SOXSB SPCXB SPYB TQQQB TSLAB TSMB USARB WDCB'.split(' ');
const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'data/research-manifest.json'),'utf8'));
const dataset=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname,'data/research-snapshot.json.gz'))));
const observedNow=manifest.finishedAt||manifest.generatedAt;
const result=R.analyzeAll(dataset,S,{now:observedNow});
const analyses=result.analyses.map(a=>({...a,instrumentClass:Classes.classify(a.sourceId,a.instrument)}));

test('the exact 68 announcement-listed Binance securities carry their primary source',()=>{
 assert.equal(STOCKS.length,68);assert.equal(new Set(STOCKS).size,68);
 for(const base of STOCKS){const c=Classes.classify('binance',base+'USDT');assert.equal(c.kind,'tokenized_security',base);assert.equal(c.excludedByDefault,true,base);assert.equal(c.sourceUrl,Classes.stockSource);assert.match(c.label,/bStocks/);}
 const classified=dataset.universe.instruments.filter(r=>Classes.classify('binance',r.instrument).kind==='tokenized_security');
 assert.deepEqual(classified.map(r=>r.base).sort(),[...STOCKS].sort());
});
test('four verified USD-pegged assets and EUR have exact distinct classifications',()=>{
 for(const base of ['XUSD','USDC','FDUSD','USDE']){const c=Classes.classify('binance',base+'USDT');assert.equal(c.kind,'stablecoin');assert.equal(c.excludedByDefault,true);assert.equal(new URL(c.sourceUrl).protocol,'https:');}
 const eur=Classes.classify('binance','EURUSDT');assert.equal(eur.kind,'fiat');assert.equal(eur.excludedByDefault,true);assert.equal(new URL(eur.sourceUrl).hostname,'www.binance.com');
});
test('classification never infers a security from the B suffix or certifies remaining assets as crypto',()=>{
 for(const instrument of ['BNBUSDT','BOBUSDT','UNKNOWNBUSDT','AAOIBXUSDT','XAAPLBUSDT','AXUSDUSDT','EURXUSDT','BTCUSDT','币安人生USDT']){
  const c=Classes.classify('binance',instrument);assert.equal(c.kind,'unclassified',instrument);assert.equal(c.excludedByDefault,false,instrument);assert.equal(c.sourceUrl,null,instrument);assert.match(c.label,/Chưa phân loại/);
 }
});
test('classes apply only to the exact Binance instrument and quote, never across venues or guessed keys',()=>{
 for(const sourceId of ['bitget','gate','whitebit','coingecko','BINANCE','binance:'])for(const instrument of ['AAPLBUSDT','USDCUSDT','EURUSDT']){
  const c=Classes.classify(sourceId,instrument);assert.equal(c.kind,'unclassified');assert.equal(c.excludedByDefault,false);assert.equal(c.sourceUrl,null);
 }
 for(const instrument of ['AAPLBUSDC','USDCBTC','AAPLB_USDT','binance:AAPLBUSDT','aaplbUSDT','AAPLBUSDT ',null,undefined,123]){
  const c=Classes.classify('binance',instrument);assert.equal(c.kind,'unclassified',String(instrument));assert.equal(c.excludedByDefault,false);
 }
});
test('inherited object properties cannot become verified stablecoin identities',()=>{
 for(const instrument of ['constructorUSDT','toStringUSDT','__proto__USDT','valueOfUSDT','hasOwnPropertyUSDT']){
  const c=Classes.classify('binance',instrument);assert.equal(c.kind,'unclassified',instrument);assert.equal(c.excludedByDefault,false);assert.equal(c.sourceUrl,null);
 }
});
test('current research retains all 511 source histories and classifies exactly 73 known exclusions',()=>{
 assert.equal(result.errors.length,0);assert.equal(analyses.length,511);
 const excluded=analyses.filter(a=>a.instrumentClass.excludedByDefault),counts={};
 for(const a of excluded)counts[a.instrumentClass.kind]=(counts[a.instrumentClass.kind]||0)+1;
 assert.equal(excluded.length,73);assert.deepEqual(counts,{stablecoin:4,fiat:1,tokenized_security:68});
 assert.equal(Object.keys(dataset.histories).length,511);
 for(const a of analyses)assert.ok(dataset.histories[a.key],'classification never deletes retained evidence');
});
test('research filter excludes known asset types only when selected and preserves unclassified candidates',()=>{
 const full=R.selectRows(analyses,{scope:'all',excludeKnown:false}),filtered=R.selectRows(analyses,{scope:'all',excludeKnown:true});
 assert.equal(full.count,511);assert.equal(filtered.count,438);assert.equal(new Set(full.rows.map(a=>a.key)).size,511);
 assert.ok(filtered.rows.every(a=>a.instrumentClass.kind==='unclassified'));assert.equal(R.selectRows(analyses,{scope:'eligible',excludeKnown:false}).count,488);
 assert.equal(R.selectRows(analyses,{scope:'eligible',excludeKnown:true}).count,415);
 const candidates=R.selectRows(analyses,{scope:'candidate',excludeKnown:true});
 assert.equal(candidates.count,4);assert.deepEqual(candidates.rows.map(a=>a.base).sort(),['AT','NXPC','WCT','WOO']);
 assert.equal(R.selectRows(analyses,{scope:'candidate',excludeKnown:false}).count,23);
 const priorKeys=analyses.map(a=>a.key);R.selectRows(analyses,{scope:'all',excludeKnown:true});assert.deepEqual(analyses.map(a=>a.key),priorKeys,'UI selection does not mutate source analyses');
});
test('known-type filter composes with search, eligibility and pagination instead of hiding the original universe',()=>{
 assert.equal(R.selectRows(analyses,{scope:'all',query:' AAPLB ',excludeKnown:true}).count,0);
 const security=R.selectRows(analyses,{scope:'all',query:' AAPLB ',excludeKnown:false});assert.equal(security.count,1);assert.equal(security.rows[0].key,'binance:AAPLBUSDT');
 const bnb=R.selectRows(analyses,{scope:'all',query:'BNB',excludeKnown:true});assert.ok(bnb.rows.some(a=>a.instrument==='BNBUSDT'));
 const last=R.selectRows(analyses,{scope:'all',excludeKnown:true,page:999});assert.equal(last.page,last.pages-1);assert.ok(last.shown.length>0&&last.shown.length<=25);assert.ok(last.shown.every(a=>!a.instrumentClass.excludedByDefault));
 const withoutClassification={...analyses[0],instrumentClass:undefined};assert.equal(R.selectRows([withoutClassification],{scope:'all',excludeKnown:true}).count,1,'unknown classification remains visible rather than being presumed excluded');
});
test('research scripts load deferred after their dependencies and all required controls exist once',()=>{
 const html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8'),ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
 assert.equal(new Set(ids).size,ids.length,'duplicate DOM IDs');
 const scripts=[...html.matchAll(/<script\b([^>]*?)\bsrc="([^"]+)"[^>]*>/g)].map(m=>({attributes:m[1],name:m[2].split('?')[0]}));
 const index=name=>{const i=scripts.findIndex(s=>s.name===name);assert.ok(i>=0,'missing script '+name);assert.match(scripts[i].attributes,/\bdefer\b/);return i;};
 const research=index('research-ui.js');assert.ok(index('charts-core.js')<index('signal-core.js'));assert.ok(index('charts-view.js')<research);assert.ok(index('signal-core.js')<research);assert.ok(index('instrument-classes.js')<research);
 const ui=fs.readFileSync(path.join(__dirname,'research-ui.js'),'utf8'),literalIds=[...ui.matchAll(/\$\('([^']+)'\)/g)].map(m=>m[1]);
 const listenerIds=['research-search','research-scope','research-sort','research-assets','research-body','research-map'];
 for(const id of new Set([...literalIds,...listenerIds]))assert.equal(ids.filter(x=>x===id).length,1,'missing research DOM element '+id);
 assert.match(html,/<section\b[^>]*\bid="research"/);assert.match(html,/data-panel="research"/);
 const assetControl=html.match(/<select\b[^>]*\bid="research-assets"[^>]*>([\s\S]*?)<\/select>/);assert.ok(assetControl);assert.match(assetControl[1].trim(),/^<option value="excludeKnown">/,'known verified types are hidden by default');
});
