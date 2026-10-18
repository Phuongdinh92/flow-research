#!/usr/bin/env node
/* Deterministic native-venue returns from the verified closed-day archive. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto');
const R=require('./research-ui.js'),W=require('./market-windows.js'),{packFile}=require('./pack-data.cjs');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function codeHash(){return hash(Buffer.concat([fs.readFileSync(__filename),Buffer.from('\n--market-windows.js--\n'),fs.readFileSync(path.join(__dirname,'market-windows.js'))]));}
function buildMarketWindows(parentManifest,compressed,{now=Date.now()}={}){
 R.checkManifest(parentManifest,now);const m=parentManifest.snapshot;
 if(compressed.length!==m.bytes||hash(compressed)!==m.sha256)throw Error('Parent archive gzip does not match manifest');
 const decoded=zlib.gunzipSync(compressed);if(decoded.length!==m.decodedBytes||hash(decoded)!==m.decodedSha256)throw Error('Decoded parent archive does not match manifest');
 const data=R.validateDataset(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(decoded)),parentManifest,now),frames={};
 for(const [period,days]of Object.entries(W.DAILY)){const rows=[],missing=[];for(const h of Object.values(data.histories)){const result=W.deriveDaily(h,period,{expectedEnd:data.endTime});if(result.row)rows.push(result.row);else missing.push(result.missing);}rows.sort((a,b)=>a.key.localeCompare(b.key));missing.sort((a,b)=>a.key.localeCompare(b.key));frames[period]={period,sourceId:'binance',quote:'USDT',kind:'closed_daily',rows,missing,expectedCount:data.sourceCoverage.completed,observedCount:rows.length,missingCount:missing.length,asOf:data.endTime,sourceEndISO:new Date(data.endTime+1).toISOString(),closedOnly:true,returnDays:days,requiredCloses:days+1};}
 return W.validateDailySnapshot({schemaVersion:1,kind:'cex-market-windows',sourceId:'binance',currency:'USDT',generatedAt:data.generatedAt,endTime:data.endTime,sourceEndISO:new Date(data.endTime+1).toISOString(),codeSha256:codeHash(),parentManifest:structuredClone(parentManifest),frames,scope:'Dated native Binance Spot/USDT instruments in the verified research archive. Completed UTC close-to-close returns; not current rolling prices, not market-wide USD or wallet accumulation.',limitations:['30D requires 31 contiguous completed daily closes; 365D requires 366. Newer or gapped instruments remain missing.','Daily return price, last-day volume and cutoff stay dated independently of live rolling windows.','Current registry and surviving instruments do not establish historical universe membership.']});
}
function writeMarketWindows({repoDir=__dirname,now=Date.now()}={}){
 const dir=path.join(repoDir,'data'),parent=JSON.parse(fs.readFileSync(path.join(dir,'research-manifest.json'),'utf8')),compressed=fs.readFileSync(path.join(dir,'research-snapshot.json.gz')),snapshot=buildMarketWindows(parent,compressed,{now}),file=path.join(dir,'market-windows.json');
 fs.writeFileSync(file,JSON.stringify(snapshot));const manifest=packFile(file);return {snapshot,manifest};
}
module.exports={hash,codeHash,buildMarketWindows,writeMarketWindows};
if(require.main===module){const {snapshot}=writeMarketWindows();console.log(JSON.stringify({kind:snapshot.kind,sourceEndISO:snapshot.sourceEndISO,coverage:Object.fromEntries(Object.entries(snapshot.frames).map(([p,f])=>[p,{expected:f.expectedCount,observed:f.observedCount,missing:f.missingCount}]))}));}
