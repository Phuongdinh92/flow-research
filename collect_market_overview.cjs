#!/usr/bin/env node
'use strict';
/* Repeatable public CoinGecko collection. Never replace an observation time after a failed request. */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const E=require('./ecosystem.js'),M=require('./market-overview.js');
if(!globalThis.crypto)globalThis.crypto=crypto.webcrypto;
const CATEGORY_URL='https://api.coingecko.com/api/v3/coins/categories?order=market_cap_desc';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function atomicJSON(file,value){const temporary=file+'.tmp-'+process.pid;fs.writeFileSync(temporary,JSON.stringify(value));fs.renameSync(temporary,file);}
async function collect({repoDir=__dirname,fetchImpl=globalThis.fetch,wait=pause,now=Date.now,rawDirectory}={}){
 const dataDirectory=path.join(repoDir,'data'),marketPath=path.join(dataDirectory,'ecosystem-snapshot.json'),categoryPath=path.join(dataDirectory,'market-categories.json');
 const previous=E.validateSnapshot(JSON.parse(fs.readFileSync(marketPath,'utf8'))),previousCategories=M.validateCategories(JSON.parse(fs.readFileSync(categoryPath,'utf8')));
 const rawDir=rawDirectory||fs.mkdtempSync(path.join(os.tmpdir(),'flow-market-overview-'));fs.mkdirSync(rawDir,{recursive:true});
 const report={collector:'public-market-overview-v1',startedAt:now(),finishedAt:null,rawDirectory:rawDir,markets:{status:'preserved',generatedAt:previous.generatedAt},categories:{status:'preserved',generatedAt:previousCategories.generatedAt},requests:[],errors:[]};
 let requestIndex=0;
 async function recordedFetch(url,options){
  const index=++requestIndex,startedAt=now(),response=await fetchImpl(url,options),body=await response.text(),meta={index,url,startedAt,fetchedAt:now(),status:response.status,sha256:crypto.createHash('sha256').update(body).digest('hex'),bytes:Buffer.byteLength(body)},stem='request-'+String(index).padStart(2,'0');
  fs.writeFileSync(path.join(rawDir,stem+'.raw'),body);fs.writeFileSync(path.join(rawDir,stem+'.meta.json'),JSON.stringify(meta,null,2));report.requests.push(meta);
  return {ok:response.ok,status:response.status,text:async()=>body};
 }
 try{
  const next=await E.refresh(previous,recordedFetch,{wait,now});atomicJSON(marketPath,next);
  report.markets={status:'updated',generatedAt:next.generatedAt,pricedCount:next.global.pricedCount,fieldCoverage:Object.fromEntries(Object.entries(M.PERIODS).map(([period,p])=>[period,next.global.pricedRows.filter(r=>Number.isFinite(r[p.field])).length]))};
 }catch(e){report.errors.push({section:'markets',message:e.message});report.categories.skipReason='Stopped after market provider error; no further request to the provider.';report.finishedAt=now();fs.writeFileSync(path.join(rawDir,'collection-report.json'),JSON.stringify(report,null,2));return report;}
 await wait(8000);
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
 try{
  const response=await recordedFetch(CATEGORY_URL,{method:'GET',credentials:'omit',cache:'no-store',signal:controller.signal,headers:{Accept:'application/json'}});
  if(!response.ok)throw Error('CoinGecko categories HTTP '+response.status+'; prior observation preserved, no retry.');
  const raw=JSON.parse(await response.text()),at=now(),parsed=M.parseCategories(raw,{fetchedAt:at,now:at});
  if(!parsed.rows.length)throw Error('No complete category records; prior observation preserved.');
  const metadata=report.requests.at(-1),next=M.validateCategories({schemaVersion:1,provider:'CoinGecko',currency:'USD',generatedAt:at,source:{url:CATEGORY_URL,sha256:metadata.sha256,inputCount:parsed.inputCount,fetchedAt:at},rows:parsed.rows,errors:parsed.errors,meaning:'Overlapping provider categories; market-cap change is not net buying. Representative coin IDs are not full category membership.'});
  atomicJSON(categoryPath,next);report.categories={status:'updated',generatedAt:at,inputCount:parsed.inputCount,validCount:parsed.rows.length,excludedCount:parsed.errors.length};
 }catch(e){report.errors.push({section:'categories',message:e.name==='AbortError'?'Category request timed out; prior observation preserved.':e.message});}
 finally{clearTimeout(timer);}
 report.finishedAt=now();fs.writeFileSync(path.join(rawDir,'collection-report.json'),JSON.stringify(report,null,2));return report;
}
module.exports={collect,CATEGORY_URL};
if(require.main===module)collect().then(report=>{console.log(JSON.stringify(report,null,2));if(report.errors.length)process.exitCode=1;}).catch(error=>{console.error('Market overview collection failed: '+error.message);process.exitCode=1;});
