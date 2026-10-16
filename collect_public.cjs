#!/usr/bin/env node
/* Maintain the public four-venue snapshot using exactly the browser adapters.
   Run: node collect_public.cjs. No account, key, trading or scheduling. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),M=require('./market.js'),U=require('./market-ui.js');
const output=path.join(__dirname,'data/market-snapshot.json');
const receipts=path.join(__dirname,'..','probes','market-final-v6');
fs.mkdirSync(receipts,{recursive:true});
async function collect(s){
 const provenance=[];
 async function observedFetch(url,options){
  const startedAt=Date.now();
  const res=await fetch(url,{...options,redirect:'error'}),body=await res.text(),fetchedAt=Date.now();
  const sha256=crypto.createHash('sha256').update(body).digest('hex');
  fs.writeFileSync(path.join(receipts,s.id+'-'+sha256+'.json'),body);
  provenance.push({url,startedAt,fetchedAt,httpStatus:res.status,bytes:Buffer.byteLength(body),contentType:res.headers.get('content-type'),sha256});
  return {ok:res.ok,status:res.status,headers:res.headers,json:async()=>JSON.parse(body)};
 }
 try{
  const r=await M.scanSource(s.id,observedFetch);
  return {...r,eligibleInstrumentCount:r.instrumentCount,status:r.errors.length?'partial':'ok',mode:'saved',provenance};
 }catch(e){return {sourceId:s.id,name:s.name,instrumentCount:0,eligibleInstrumentCount:0,rows:[],errors:[{stage:'source',message:e.message}],status:'error',asOf:null,fetchedAt:null,capabilities:s.capabilities,supportsDaily:s.supportsDaily,timestampKind:s.timestampKind||'per_instrument',provenance};}
}
(async()=>{
 const sources=await Promise.all(M.SOURCES.map(collect)),snapshot={schemaVersion:1,generatedAt:Date.now(),ttlMs:M.TTL,sources,errors:sources.flatMap(s=>s.errors.map(e=>({sourceId:s.sourceId,...e}))),scope:'Active spot/USDT venue instruments only. No assertion of whole-market or crypto-only asset classification.',collector:'collect_public.cjs; shared market.js source adapters'};
 U.validateSnapshot(snapshot);
 if(!sources.some(s=>s.rows.length))throw Error('All sources failed; prior snapshot retained.');
 const temp=output+'.tmp';fs.writeFileSync(temp,JSON.stringify(snapshot));fs.renameSync(temp,output);
 console.log(JSON.stringify({generatedAt:snapshot.generatedAt,sources:sources.map(s=>({id:s.sourceId,valid:s.rows.length,eligible:s.instrumentCount,errors:s.errors.length,status:s.status,requests:s.provenance.length}))}));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
