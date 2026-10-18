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
 {id:'coinlore-market',script:'collect_coinlore.cjs',files:['data/coinlore-market.json'],timeout:1800000,validate(){const s=require('./coinlore-core.js').validateSnapshot(json(this.files[0]));if(!s.coverage.complete)throw Error('CoinLore source catalog incomplete; previous generation retained');}},
 {id:'network-cost-reference',script:'collect_cost_reference.cjs',files:['data/cost-reference.json'],timeout:180000,validate(){require('./cost-reference.js').validateSnapshot(json(this.files[0]));}},
 {id:'venue-prices',script:'collect_public.cjs',files:['data/market-snapshot.json'],timeout:180000,validate(){require('./market-ui.js').validateSnapshot(json(this.files[0]));}},
 {id:'global-markets',script:'collect_market_overview.cjs',files:['data/ecosystem-snapshot.json','data/market-categories.json','data/market-coverage.json'],timeout:2400000,validate(){const E=require('./ecosystem.js'),ledgerBytes=fs.readFileSync(path.join(ROOT,this.files[2]));E.validateMarketCoveragePair(json(this.files[0]),JSON.parse(ledgerBytes),{coverageSha256:sha(ledgerBytes)});require('./market-overview.js').validateCategories(json(this.files[1]));}},
 {id:'daily-research',script:'collect_signals.cjs',files:['data/research-snapshot.json.gz','data/research-manifest.json','data/research-snapshot.json'],timeout:900000,validate(){
   const m=json('data/research-manifest.json'),b=fs.readFileSync(path.join(ROOT,'data/research-snapshot.json.gz')),decoded=zlib.gunzipSync(b);
   if(m.collectionState!=='complete'||m.sourceCoverage.errors!==0||m.sourceCoverage.completed!==m.sourceCoverage.eligible||sha(b)!==m.snapshot.sha256||sha(decoded)!==m.snapshot.decodedSha256)throw Error('Research collection incomplete or hash mismatch; previous generation retained');
   require('./research-ui.js').validateDataset(JSON.parse(decoded),m);
 }},
 {id:'terminal-preview',script:'build_terminal_preview.cjs',files:['data/terminal-preview.json','data/terminal-preview.json.gz','data/terminal-preview.json.manifest.json'],timeout:60000,validate(){const p=json(this.files[0]),m=json('data/research-manifest.json'),B=require('./build_terminal_preview.cjs');if(JSON.stringify(p.parentManifest)!==JSON.stringify(m))throw Error('Preview parent manifest mismatch');require('./research-ui.js').validateDataset(p.data,B.subsetManifest(m,p.data));}},
 {id:'event-study',script:'collect_intelligence.cjs',files:['data/intelligence-study.json'],timeout:180000,validate(){
   const s=json(this.files[0]),m=json('data/research-manifest.json');
   if(s.source.sha256!==m.snapshot.sha256||s.cutoff!==m.endTime)throw Error('Study and research archive differ');
   const I=require('./intelligence-core.js');I.validateStudy(s,{expectedSourceSha256:m.snapshot.sha256,expectedCutoff:m.endTime,expectedCodeSha256:Object.fromEntries(['intelligence-core.js','signal-core.js','instrument-classes.js','collect_intelligence.cjs'].map(name=>[name,sha(fs.readFileSync(path.join(ROOT,name)))]))});
 }},
 {id:'market-windows',script:'build_market_windows.cjs',files:['data/market-windows.json','data/market-windows.json.gz','data/market-windows.json.manifest.json'],timeout:60000,validate(){const s=json(this.files[0]),m=json('data/research-manifest.json');if(JSON.stringify(s.parentManifest)!==JSON.stringify(m))throw Error('Market windows parent manifest mismatch');if(s.codeSha256!==require('./build_market_windows.cjs').codeHash())throw Error('Market windows calculation code mismatch');require('./market-windows.js').validateDailySnapshot(s);}},
 {id:'hedera-holders',script:'collect_holder_history.cjs',files:['data/holder-history-snapshot.json'],timeout:1800000,validate(){require('./holder-history.js').validateSnapshot(json(this.files[0]));}},
 {id:'ton-holders',script:'collect_holders.cjs',files:['data/holders-snapshot.json'],timeout:180000,validate(){require('./holders.js').validateSnapshot(json(this.files[0]));}},
 {id:'dex-acquisition',script:'collect_chain_ledger.cjs',files:['data/chain-ledger-snapshot.json'],timeout:900000,validate(){require('./chain-ledger.js').validateSnapshot(json(this.files[0]));}},
 {id:'inventory-reconciliation',script:'collect_inventory_ledger.cjs',files:['data/inventory-ledger.json'],timeout:180000,validate(){const chainBytes=fs.readFileSync(path.join(ROOT,'data/chain-ledger-snapshot.json'));require('./inventory-ledger.js').validateReport(json(this.files[0]),JSON.parse(chainBytes),{sourceSnapshotSha256:sha(chainBytes)});}},
 {id:'derivatives',script:'collect_derivatives.cjs',files:['data/derivatives-snapshot.json'],timeout:900000,validate(){require('./derivatives-core.js').validateSnapshot(json(this.files[0]));}}
];
// A derived publication must travel with the exact archive it names. Selecting
// any member deliberately selects the complete transaction, not a mixed pair.
const GROUPS={research:['daily-research','terminal-preview','event-study','market-windows'],acquisition:['dex-acquisition','inventory-reconciliation']};
const PROFILES={market:['coinlore-market','venue-prices'],daily:['network-cost-reference','daily-research'],context:['global-markets','derivatives'],ledger:['hedera-holders','ton-holders','dex-acquisition']};
const PACKED={
 'coinlore-market':['data/coinlore-market.json'],'network-cost-reference':['data/cost-reference.json'],
 'global-markets':['data/ecosystem-snapshot.json','data/market-categories.json','data/market-coverage.json'],
 'terminal-preview':['data/terminal-preview.json'],'event-study':['data/intelligence-study.json'],'market-windows':['data/market-windows.json'],
 'hedera-holders':['data/holder-history-snapshot.json'],'ton-holders':['data/holders-snapshot.json'],
 'dex-acquisition':['data/chain-ledger-snapshot.json'],'inventory-reconciliation':['data/inventory-ledger.json'],'derivatives':['data/derivatives-snapshot.json']
};
for(const job of jobs){job.packed=PACKED[job.id]||[];job.files=[...new Set([...job.files,...job.packed.flatMap(f=>[f+'.gz',f+'.manifest.json'])])];job.pack=function(){for(const f of this.packed)require('./pack-data.cjs').packFile(path.join(ROOT,f));};}
function backup(files,root=ROOT){return new Map(files.map(f=>{const p=path.join(root,f);return [f,fs.existsSync(p)?fs.readFileSync(p):null];}));}
function restore(saved,root=ROOT){for(const [f,b] of saved){const p=path.join(root,f);if(b===null){if(fs.existsSync(p))fs.unlinkSync(p);}else{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p+'.restore',b);fs.renameSync(p+'.restore',p);}}}
function fileRecords(files,root=ROOT){return files.filter(f=>fs.existsSync(path.join(root,f))).map(f=>({path:f,sha256:sha(fs.readFileSync(path.join(root,f))),bytes:fs.statSync(path.join(root,f)).size}));}
async function guarded(job,run,root=ROOT){
 const saved=backup(job.files,root),startedAt=Date.now();
 try{await run(job);await job.validate.call(job);if(job.pack)await job.pack.call(job);return {id:job.id,status:'ok',startedAt,finishedAt:Date.now(),files:fileRecords(job.files,root)};}
 catch(error){restore(saved,root);return {id:job.id,status:'error',startedAt,finishedAt:Date.now(),message:error.message,previousFilesRetained:true};}
}
function selectJobs(selected=[],{jobList=jobs,groups=GROUPS,profiles=PROFILES}={}){
 let ids=[...selected];if(ids[0]==='--profile'){if(ids.length!==2||!profiles[ids[1]])throw Error('Unknown collection profile');ids=profiles[ids[1]];}
 const known=new Set(jobList.map(j=>j.id));if(ids.some(id=>!known.has(id)))throw Error('Unknown collection job');
 const wanted=new Set(ids.length?ids:known);let changed;
 do{changed=false;for(const members of Object.values(groups))if(members.some(id=>wanted.has(id)))for(const id of members){if(!known.has(id))throw Error('Unknown dependency job: '+id);if(!wanted.has(id)){wanted.add(id);changed=true;}}}while(changed);
 return jobList.filter(j=>wanted.has(j.id));
}
async function executePlan({selected=[],jobList=jobs,groups=GROUPS,profiles=PROFILES,runJob=run,root=ROOT,log=()=>{}}={}){
 const plan=selectJobs(selected,{jobList,groups,profiles}),byId=new Map(plan.map(j=>[j.id,j])),done=new Set(),results=[],transactions=[];
 for(const candidate of plan){
  if(done.has(candidate.id))continue;
  const entry=Object.entries(groups).find(([,members])=>members.includes(candidate.id));
  const groupId=entry?.[0]||candidate.id,members=entry?entry[1].filter(id=>byId.has(id)).map(id=>byId.get(id)):[candidate];
  const saved=backup([...new Set(members.flatMap(j=>j.files))],root),groupResults=[];let failure=null;
  for(const job of members){
   done.add(job.id);
   if(failure){groupResults.push({id:job.id,status:'skipped',groupId,message:'Not attempted after '+failure.id+' failed; coherent previous publication retained',previousFilesRetained:true});continue;}
   log('Collecting '+job.id);const result=await guarded(job,runJob,root);result.groupId=groupId;groupResults.push(result);
   if(result.status==='error'){failure=result;log(job.id+': '+result.message+'; coherent previous publication retained');}
  }
  if(failure){restore(saved,root);for(const result of groupResults){if(result.status==='ok'){result.status='rolled_back';result.message='Restored with '+groupId+' after '+failure.id+' failed';delete result.files;}result.previousFilesRetained=true;const job=byId.get(result.id);result.retainedFiles=fileRecords(job.files,root);}}
  transactions.push({id:groupId,status:failure?'error':'ok',jobs:members.map(j=>j.id),...(failure?{failedJob:failure.id,previousFilesRetained:true}:{})});results.push(...groupResults);
 }
 return {jobs:results,transactions,status:results.every(j=>j.status==='ok')?'complete':results.some(j=>j.status==='ok')?'partial':'error'};
}
function run(job){return new Promise((resolve,reject)=>{
 const child=spawn(process.execPath,[path.join(ROOT,job.script)],{cwd:ROOT,stdio:'inherit',env:process.env});
 const timer=setTimeout(()=>{child.kill('SIGTERM');setTimeout(()=>child.kill('SIGKILL'),3000).unref();},job.timeout);
 child.once('error',e=>{clearTimeout(timer);reject(e);});
 child.once('exit',(code,signal)=>{clearTimeout(timer);code===0?resolve():reject(Error(job.script+' failed ('+(signal||code)+')'));});
});}
async function refresh({selected=[],jobList=jobs,groups=GROUPS,profiles=PROFILES,runJob=run,root=ROOT,env=process.env,now=Date.now,log=()=>{}}={}){
 selectJobs(selected,{jobList,groups,profiles});
 const report={schemaVersion:1,kind:'public-collection-status',startedAt:now(),finishedAt:null,scheduled:!!env.GITHUB_ACTIONS,mode:env.GITHUB_EVENT_NAME||'manual',jobs:[]};
 const attemptFile='data/market-collection-attempt.json',attemptBefore=backup([attemptFile,attemptFile+'.gz',attemptFile+'.manifest.json'],root);
 Object.assign(report,await executePlan({selected,jobList,groups,profiles,runJob,root,log}));
 // A failed catalog attempt is a separate observation, not replacement prices.
 // Package it only when its actual bytes changed; unchanged retained sources and
 // their transport manifests are never retimestamped by an unrelated job.
 const attemptPath=path.join(root,attemptFile),before=attemptBefore.get(attemptFile);
 if(fs.existsSync(attemptPath)&&(!before||!before.equals(fs.readFileSync(attemptPath)))){try{require('./ecosystem.js').validateCollectionAttempt(JSON.parse(fs.readFileSync(attemptPath,'utf8')));require('./pack-data.cjs').packFile(attemptPath);}catch(error){restore(attemptBefore,root);report.jobs.push({id:'collection-attempt-publication',status:'error',message:error.message,previousFilesRetained:true});report.status=report.jobs.some(j=>j.status==='ok')?'partial':'error';}}
 report.finishedAt=now();if(selected[0]==='--profile')report.profile=selected[1];
 fs.mkdirSync(path.join(root,'data'),{recursive:true});
 if(env.GITHUB_ACTIONS){const a=path.join(root,'data/automation-status.json');fs.writeFileSync(a+'.tmp',JSON.stringify({schemaVersion:1,state:report.status==='error'?'blocked':report.status==='complete'?'complete':'partial',observedAt:report.finishedAt,provider:'GitHub Actions',lastAttemptRunId:Number(env.GITHUB_RUN_ID)||null,...(report.profile?{profile:report.profile}:{})}));fs.renameSync(a+'.tmp',a);}
 const p=path.join(root,'data/collection-status.json');fs.writeFileSync(p+'.tmp',JSON.stringify(report));fs.renameSync(p+'.tmp',p);
 return report;
}
async function main(){
 const report=await refresh({selected:process.argv.slice(2),log:message=>process.stdout.write(message+'\n')});
 console.log(JSON.stringify({status:report.status,jobs:report.jobs.map(j=>({id:j.id,status:j.status,message:j.message}))}));
 if(report.status!=='complete')process.exitCode=1;
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={jobs,GROUPS,PROFILES,backup,restore,guarded,selectJobs,executePlan,refresh};
