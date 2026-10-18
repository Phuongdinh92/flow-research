#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib'),I=require('./exchange-identity.js');
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
function save(s){const name='exchange-identity.json',out=path.join(__dirname,'data',name),body=Buffer.from(JSON.stringify(s)+'\n'),gz=zlib.gzipSync(body,{level:9}),m={schemaVersion:1,kind:'public-data-manifest',transportVersion:1,identity:{schemaVersion:1,kind:s.kind,provider:s.provider,exchangeId:s.exchangeId},payload:{url:name+'.gz',compression:'gzip',bytes:gz.length,decodedBytes:body.length,sha256:digest(gz),decodedSha256:digest(body)}};for(const [p,b]of [[out,body],[out+'.gz',gz],[out+'.manifest.json',JSON.stringify(m,null,2)+'\n']]){fs.writeFileSync(p+'.tmp',b);fs.renameSync(p+'.tmp',p);}}
async function collect(){
 const startedAt=Date.now(),sourcePages=[],proofDir=path.join(__dirname,'../probes/flow-identity-stable');fs.mkdirSync(proofDir,{recursive:true});let lastStarted=0,collectionComplete=false,failure=null;
 for(let page=1;page<=35;page++){
  await new Promise(r=>setTimeout(r,Math.max(0,8000-(Date.now()-lastStarted))));lastStarted=Date.now();const url='https://api.coingecko.com/api/v3/exchanges/binance/tickers?order=base_target&page='+page;
  try{const response=await fetch(url,{credentials:'omit',redirect:'error',headers:{Accept:'application/json'},signal:AbortSignal.timeout(30000)}),body=await response.text(),receipt={url,httpStatus:response.status,startedAt:lastStarted,receivedAt:Date.now(),sha256:digest(Buffer.from(body)),body};fs.writeFileSync(path.join(proofDir,'page-'+page+'.json'),JSON.stringify(receipt));if(!response.ok)throw Error('HTTP '+response.status+'; stopped without retry');const value=JSON.parse(body);if(!Array.isArray(value.tickers))throw Error('Missing tickers');sourcePages.push(receipt);I.derive(sourcePages);console.log(JSON.stringify({page,count:value.tickers.length,bindings:I.derive(sourcePages).bindings.length}));if(value.tickers.length===0){collectionComplete=true;break;}}
  catch(error){failure=error.message;console.error(failure);break;}
 }
 if(!sourcePages.length)throw Error(failure||'No verified source pages');
 const snapshot={schemaVersion:1,kind:'exchange-asset-identity',provider:'CoinGecko',exchangeId:'binance',startedAt,generatedAt:Date.now(),collectionComplete,failure,sourcePages,...I.derive(sourcePages),method:'Explicit CoinGecko market.identifier/base/target/coin_id/target_coin_id plus exact Binance trade URL. Stable base_target pagination; conflicting asset IDs excluded. This is a provider mapping at receipt time, not a historical membership reconstruction.'};
 await I.validateSnapshot(snapshot);save(snapshot);console.log(JSON.stringify({saved:true,pages:sourcePages.length,bindings:snapshot.bindings.length,conflicts:snapshot.conflicts.length,complete:collectionComplete}));return snapshot;
}
if(require.main===module)collect().catch(e=>{console.error(e.message);process.exitCode=1;});module.exports={collect,save};
