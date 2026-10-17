#!/usr/bin/env node
'use strict';
// Public read-only collectors. A failed job restores its previously published
// files byte-for-byte. No credentials or trading operations are used.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const {spawn}=require('node:child_process');
const ROOT=__dirname;
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const json=name=>JSON.parse(fs.readFileSync(path.join(ROOT,name),'utf8'));
const jobs=[
 {id:'venue-prices',script:'collect_public.cjs',files:['data/market-snapshot.json'],timeout:180000,validate(){require('./market-ui.js').validateSnapshot(json(this.files[0]));}},
 {id:'global-markets',script:'collect_market_overview.cjs',files:['data/ecosystem-snapshot.json','data/market-categories.json','data/market-coverage.json'],timeout:2400000,validate(){const E=require('./ecosystem.js'),ledgerBytes=fs.readFileSync(path.join(ROOT,this.files[2]));E.validateMarketCoveragePair(json(this.files[0]),JSON.parse(ledgerBytes),{coverageSha256:sha(ledgerBytes)});require('./market-overview.js').validateCategories(json(this.files[1]));}},
 {id:'daily-research',script:'collect_signals.cjs',files:['data/research-snapshot.json.gz','data/research-manifest.json','data/research-snapshot.json'],timeout:900000,validate(){
   const m=json('data/research-manifest.json'),b=fs.readFileSync(path.join(ROOT,'data/research-snapshot.json.gz')),decoded=zlib.gunzipSync(b);
   if(m.collectionState!=='complete'||m.sourceCoverage.errors!==0||m.sourceCoverage.completed!==m.sourceCoverage.eligible||sha(b)!==m.snapshot.sha256||sha(decoded)!==m.snapshot.decodedSha256)throw Error('Research collection incomplete or hash mismatch; previous generation retained');
   require('./research-ui.js').validateDataset(JSON.parse(decoded),m);
 }},
 {id:'event-study',script:'collect_intelligence.cjs',files:['data/intelligence-study.json'],timeout:180000,validate(){
   const s=json(this.files[0]),m=json('data/research-manifest.json');
   if(s.source.sha256!==m.snapshot.sha256||s.cutoff!==m.endTime)throw Error('Study and research archive differ');
   const I=require('./intelligence-core.js');I.validateStudy(s,{expectedSourceSha256:m.snapshot.sha256,expectedCutoff:m.endTime,expectedCodeSha256:Object.fromEntries(['intelligence-core.js','signal-core.js','instrument-classes.js','collect_intelligence.cjs'].map(name=>[name,sha(fs.readFileSync(path.join(ROOT,name)))]))});
 }},
 {id:'hedera-holders',script:'collect_holder_history.cjs',files:['data/holder-history-snapshot.json'],timeout:1800000,validate(){require('./holder-history.js').validateSnapshot(json(this.files[0]));}},
 {id:'ton-holders',script:'collect_holders.cjs',files:['data/holders-snapshot.json'],timeout:180000,validate(){require('./holders.js').validateSnapshot(json(this.files[0]));}},
 {id:'dex-acquisition',script:'collect_chain_ledger.cjs',files:['data/chain-ledger-snapshot.json'],timeout:900000,validate(){require('./chain-ledger.js').validateSnapshot(json(this.files[0]));}},
 {id:'derivatives',script:'collect_derivatives.cjs',files:['data/derivatives-snapshot.json'],timeout:900000,validate(){require('./derivatives-core.js').validateSnapshot(json(this.files[0]));}}
];
function backup(files,root=ROOT){return new Map(files.map(f=>{const p=path.join(root,f);return [f,fs.existsSync(p)?fs.readFileSync(p):null];}));}
function restore(saved,root=ROOT){for(const [f,b] of saved){const p=path.join(root,f);if(b===null){if(fs.existsSync(p))fs.unlinkSync(p);}else{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p+'.restore',b);fs.renameSync(p+'.restore',p);}}}
async function guarded(job,run,root=ROOT){
 const saved=backup(job.files,root),startedAt=Date.now();
 try{await run(job);job.validate.call(job);return {id:job.id,status:'ok',startedAt,finishedAt:Date.now(),files:job.files.filter(f=>fs.existsSync(path.join(root,f))).map(f=>({path:f,sha256:sha(fs.readFileSync(path.join(root,f))),bytes:fs.statSync(path.join(root,f)).size}))};}
 catch(error){restore(saved,root);return {id:job.id,status:'error',startedAt,finishedAt:Date.now(),message:error.message,previousFilesRetained:true};}
}
function run(job){return new Promise((resolve,reject)=>{
 const child=spawn(process.execPath,[path.join(ROOT,job.script)],{cwd:ROOT,stdio:'inherit',env:process.env});
 const timer=setTimeout(()=>{child.kill('SIGTERM');setTimeout(()=>child.kill('SIGKILL'),3000).unref();},job.timeout);
 child.once('error',e=>{clearTimeout(timer);reject(e);});
 child.once('exit',(code,signal)=>{clearTimeout(timer);code===0?resolve():reject(Error(job.script+' failed ('+(signal||code)+')'));});
});}
async function main(){
 const selected=process.argv.slice(2);if(selected.some(id=>!jobs.some(j=>j.id===id)))throw Error('Unknown collection job');
 const report={schemaVersion:1,kind:'public-collection-status',startedAt:Date.now(),finishedAt:null,scheduled:!!process.env.GITHUB_ACTIONS,mode:process.env.GITHUB_EVENT_NAME||'manual',jobs:[]};
 for(const job of jobs.filter(j=>!selected.length||selected.includes(j.id))){
   process.stdout.write('Collecting '+job.id+'\n');const result=await guarded(job,run);report.jobs.push(result);
   if(result.status==='error')process.stderr.write(job.id+': '+result.message+'; previous files restored\n');
 }
 require('./pack-data.cjs').packAll();
 report.finishedAt=Date.now();report.status=report.jobs.every(j=>j.status==='ok')?'complete':report.jobs.every(j=>j.status==='error')?'error':'partial';
 if(process.env.GITHUB_ACTIONS){const a=path.join(ROOT,'data/automation-status.json');fs.writeFileSync(a+'.tmp',JSON.stringify({schemaVersion:1,state:report.status==='error'?'blocked':report.status==='complete'?'complete':'partial',observedAt:report.finishedAt,provider:'GitHub Actions',lastAttemptRunId:Number(process.env.GITHUB_RUN_ID)||null}));fs.renameSync(a+'.tmp',a);}
 const p=path.join(ROOT,'data/collection-status.json');fs.writeFileSync(p+'.tmp',JSON.stringify(report));fs.renameSync(p+'.tmp',p);
 console.log(JSON.stringify({status:report.status,jobs:report.jobs.map(j=>({id:j.id,status:j.status,message:j.message}))}));
 if(report.status==='error')process.exitCode=1;
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={jobs,backup,restore,guarded};
