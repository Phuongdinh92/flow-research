#!/usr/bin/env node
/* Exact BTC-only view of the verified research snapshot for fast first paint. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto');
const R=require('./research-ui.js');
const {packFile}=require('./pack-data.cjs');
const KEY='binance:BTCUSDT';
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function subsetManifest(parentManifest,data){
  const manifest=structuredClone(parentManifest);
  manifest.sourceCoverage=structuredClone(data.sourceCoverage);
  manifest.universe.eligibleInstrumentCount=data.universe.eligibleInstrumentCount;
  return manifest;
}
function buildPreview(parentManifest,compressed,{now=Date.now()}={}){
  R.checkManifest(parentManifest,now);
  const snapshot=parentManifest.snapshot;
  if(compressed.length!==snapshot.bytes||hash(compressed)!==snapshot.sha256)throw Error('Parent snapshot gzip does not match its manifest.');
  const decoded=zlib.gunzipSync(compressed);
  if(decoded.length!==snapshot.decodedBytes||hash(decoded)!==snapshot.decodedSha256)throw Error('Decoded parent snapshot does not match its manifest.');
  const full=R.validateDataset(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(decoded)),parentManifest,now);
  const history=full.histories[KEY],instrument=full.universe.instruments.find(row=>row.key===KEY);
  if(!history||!instrument||history.bars.length!==full.requestedDays)throw Error('A complete BTC source history is required for the initial preview.');
  const data=structuredClone(full);
  data.histories={[KEY]:structuredClone(history)};
  data.universe.instruments=[structuredClone(instrument)];
  data.universe.eligibleInstrumentCount=1;
  data.sourceCoverage={eligible:1,attempted:1,completed:1,fullLength:1,shortHistory:0,errors:0,unattempted:0};
  data.scope='BTC/USDT-only initial chart view of the dated verified Binance research snapshot. All candles and source timestamps are unchanged. Parent manifest and universe provenance retain the full original census; this preview does not represent market-wide coverage.';
  R.validateDataset(data,subsetManifest(parentManifest,data),now);
  return {schemaVersion:1,kind:'terminal-price-preview',sourceId:'binance',parentManifest:structuredClone(parentManifest),data};
}
function writePreview({directory=path.join(__dirname,'data'),now=Date.now()}={}){
  const parentManifest=JSON.parse(fs.readFileSync(path.join(directory,'research-manifest.json'),'utf8'));
  const compressed=fs.readFileSync(path.join(directory,'research-snapshot.json.gz'));
  const preview=buildPreview(parentManifest,compressed,{now}),file=path.join(directory,'terminal-preview.json');
  const temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify(preview));fs.renameSync(temp,file);
  return packFile(file);
}
if(require.main===module){
  try{const result=writePreview();console.log(JSON.stringify({file:result.file,bytes:result.bytes,gzipBytes:result.gzipBytes,sha256:result.manifest.payload.sha256,decodedSha256:result.manifest.payload.decodedSha256}));}
  catch(error){console.error(error.message);process.exitCode=1;}
}
module.exports={KEY,hash,subsetManifest,buildPreview,writePreview};
