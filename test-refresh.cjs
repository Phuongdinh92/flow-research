'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {guarded,selectJobs,executePlan,refresh,jobs,GROUPS,PROFILES}=require('./refresh_data.cjs');
test('collector failure restores every prior generation and removes partial new files',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'flow-refresh-'));fs.mkdirSync(path.join(root,'data'));fs.writeFileSync(path.join(root,'data/source.json'),'old');
 const job={id:'fixture',files:['data/source.json','data/partial.json'],validate(){throw Error('not coherent');}};
 const out=await guarded(job,async()=>{fs.writeFileSync(path.join(root,'data/source.json'),'new');fs.writeFileSync(path.join(root,'data/partial.json'),'partial');},root);
 assert.equal(out.status,'error');assert.equal(out.previousFilesRetained,true);assert.equal(fs.readFileSync(path.join(root,'data/source.json'),'utf8'),'old');assert.equal(fs.existsSync(path.join(root,'data/partial.json')),false);fs.rmSync(root,{recursive:true});
});
test('successful collection records exact file hash without changing source bytes',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'flow-refresh-'));fs.mkdirSync(path.join(root,'data'));
 const job={id:'fixture',files:['data/new.json'],validate(){assert.equal(fs.readFileSync(path.join(root,'data/new.json'),'utf8'),'{"ok":true}');}};
 const out=await guarded(job,async()=>fs.writeFileSync(path.join(root,'data/new.json'),'{"ok":true}'),root);
 assert.equal(out.status,'ok');assert.equal(out.files[0].bytes,11);assert.match(out.files[0].sha256,/^[a-f0-9]{64}$/);fs.rmSync(root,{recursive:true});
});
test('a failed shard pack restores old parts and removes only new parts of its own publication',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'flow-refresh-parts-'));fs.mkdirSync(path.join(root,'data'));
 const base='data/source.json',files=[base,base+'.gz',base+'.manifest.json'];
 const originals=new Map([...files,base+'.gz.part-000',base+'.gz.part-001'].map((file,i)=>[file,Buffer.from('old-'+i)]));
 const unrelated=base+'.gz.part-not-a-number';
 try{
  for(const [file,bytes] of originals)fs.writeFileSync(path.join(root,file),bytes);
  fs.writeFileSync(path.join(root,unrelated),'keep');fs.writeFileSync(path.join(root,'data/other.json.gz.part-000'),'unrelated');
  const job={id:'fixture',files,validate(){},pack(){
   fs.writeFileSync(path.join(root,base+'.gz.part-000'),'replacement');fs.unlinkSync(path.join(root,base+'.gz.part-001'));
   fs.writeFileSync(path.join(root,base+'.gz.part-002'),'new part');fs.writeFileSync(path.join(root,base+'.manifest.json'),'new manifest');
   throw Error('manifest publication failed');
  }};
  const out=await guarded(job,async()=>fs.writeFileSync(path.join(root,base),'new source'),root);
  assert.equal(out.status,'error');for(const [file,bytes] of originals)assert.deepEqual(fs.readFileSync(path.join(root,file)),bytes);
  assert.equal(fs.existsSync(path.join(root,base+'.gz.part-002')),false);
  assert.equal(fs.readFileSync(path.join(root,unrelated),'utf8'),'keep');assert.equal(fs.readFileSync(path.join(root,'data/other.json.gz.part-000'),'utf8'),'unrelated');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('successful shard collection records every current part with its exact bytes and hash',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'flow-refresh-parts-'));fs.mkdirSync(path.join(root,'data'));
 const base='data/source.json',files=[base,base+'.gz',base+'.manifest.json'];
 try{
  const job={id:'fixture',files,validate(){},pack(){
   fs.writeFileSync(path.join(root,base+'.gz.part-000'),'abc');fs.writeFileSync(path.join(root,base+'.gz.part-001'),'de');fs.writeFileSync(path.join(root,base+'.manifest.json'),'manifest');
  }};
  const out=await guarded(job,async()=>fs.writeFileSync(path.join(root,base),'source'),root);
  assert.equal(out.status,'ok');assert.deepEqual(out.files.map(file=>file.path),[base,base+'.manifest.json',base+'.gz.part-000',base+'.gz.part-001']);
  assert.deepEqual(out.files.filter(file=>file.path.includes('.part-')).map(file=>file.bytes),[3,2]);
  assert.equal(out.files.find(file=>file.path.endsWith('part-000')).sha256,'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('selecting either end of a publication chain expands to all of its ordered dependencies',()=>{
 for(const member of GROUPS.research)assert.deepEqual(selectJobs([member]).map(j=>j.id),GROUPS.research);
 for(const member of GROUPS.acquisition)assert.deepEqual(selectJobs([member]).map(j=>j.id),GROUPS.acquisition);
 assert.deepEqual(selectJobs(['venue-prices','venue-prices']).map(j=>j.id),['venue-prices']);
 assert.throws(()=>selectJobs(['unknown']),/Unknown collection job/);
 assert.throws(()=>selectJobs(['--profile','unknown']),/Unknown collection profile/);
 assert.throws(()=>selectJobs(['--profile','market','daily']),/Unknown collection profile/);
});
test('each scheduled profile has dependencies included and a bounded serial budget below the workflow deadline',()=>{
 assert.deepEqual(Object.keys(PROFILES),['market','daily','context','ledger']);
 for(const profile of Object.keys(PROFILES)){
  const selected=selectJobs(['--profile',profile]);
  assert.ok(selected.length>0);assert.ok(selected.reduce((sum,j)=>sum+j.timeout,0)<60*60*1000,profile+' must leave at least one hour for verification/cache/publication');
 }
 assert.ok(selectJobs(['--profile','daily']).some(j=>j.id==='market-windows'));
 assert.ok(selectJobs(['--profile','ledger']).some(j=>j.id==='inventory-reconciliation'));
 const packed=jobs.find(j=>j.id==='event-study');assert.ok(packed.files.includes('data/intelligence-study.json.gz'));assert.ok(packed.files.includes('data/intelligence-study.json.manifest.json'));
});
function transactionFixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'flow-refresh-group-'));fs.mkdirSync(path.join(root,'data'));
 const jobList=['source','preview','study','windows','prices'].map(id=>({id,files:['data/'+id+'.json','data/'+id+'.json.gz','data/'+id+'.json.manifest.json'],validate(){}}));
 const original=new Map();for(const job of jobList)for(const file of job.files){const bytes=Buffer.from(JSON.stringify({schemaVersion:1,id:job.id,sourceObservedAt:100,kind:file}));fs.writeFileSync(path.join(root,file),bytes);original.set(file,bytes);}
 return {root,jobList,original,groups:{research:['source','preview','study','windows']}};
}
test('derived failure restores the full source group, gzip bytes and manifests while independent prices publish',async()=>{
 const fixture=transactionFixture(),{root,jobList,groups,original}=fixture,calls=[];
 try{
  const result=await executePlan({root,jobList,groups,selected:['source','prices'],runJob:async job=>{
   calls.push(job.id);for(const file of job.files)fs.writeFileSync(path.join(root,file),'new-'+job.id);
   if(job.id==='study')throw Error('study did not match its source');
  }});
  assert.deepEqual(calls,['source','preview','study','prices']);
  assert.equal(result.status,'partial');assert.deepEqual(result.jobs.map(j=>j.status),['rolled_back','rolled_back','error','skipped','ok']);
  assert.deepEqual(result.transactions[0],{id:'research',status:'error',jobs:['source','preview','study','windows'],failedJob:'study',previousFilesRetained:true});
  for(const job of jobList.filter(j=>j.id!=='prices'))for(const file of job.files)assert.deepEqual(fs.readFileSync(path.join(root,file)),original.get(file));
  assert.equal(fs.readFileSync(path.join(root,'data/prices.json'),'utf8'),'new-prices');
  for(const resultJob of result.jobs.slice(0,4)){assert.equal(resultJob.previousFilesRetained,true);assert.equal(resultJob.files,undefined);assert.equal(resultJob.retainedFiles.length,3);}
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('a packaging failure also restores earlier derived files and removes newly created partial artifacts',async()=>{
 const {root,jobList,groups,original}=transactionFixture();
 try{
  const windows=jobList.find(j=>j.id==='windows');windows.files.push('data/partial-new.json.gz');windows.pack=()=>{fs.writeFileSync(path.join(root,'data/partial-new.json.gz'),'partial');throw Error('gzip publication failed');};
  const result=await executePlan({root,jobList,groups,selected:['windows'],runJob:async job=>{fs.writeFileSync(path.join(root,job.files[0]),'new');}});
  assert.equal(result.status,'error');assert.deepEqual(result.jobs.map(j=>j.status),['rolled_back','rolled_back','rolled_back','error']);
  for(const [file,bytes]of original)assert.deepEqual(fs.readFileSync(path.join(root,file)),bytes);
  assert.equal(fs.existsSync(path.join(root,'data/partial-new.json.gz')),false);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('a failed upstream job prevents all downstream work and never marks prior source observations fresh',async()=>{
 const {root,jobList,groups,original}=transactionFixture(),calls=[];
 try{
  const result=await executePlan({root,jobList,groups,selected:['study'],runJob:async job=>{calls.push(job.id);throw Error('source HTTP 429');}});
  assert.deepEqual(calls,['source']);assert.equal(result.status,'error');assert.deepEqual(result.jobs.map(j=>j.status),['error','skipped','skipped','skipped']);
  for(const [file,bytes]of original)assert.deepEqual(fs.readFileSync(path.join(root,file)),bytes);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('downstream failure rolls back a successful shard generation as a whole',async()=>{
 const {root,jobList,groups}=transactionFixture(),base='data/source.json.gz';
 try{
  fs.writeFileSync(path.join(root,base+'.part-000'),'old first');fs.writeFileSync(path.join(root,base+'.part-001'),'old second');
  jobList.find(job=>job.id==='source').pack=()=>{fs.writeFileSync(path.join(root,base+'.part-000'),'new first');fs.unlinkSync(path.join(root,base+'.part-001'));fs.writeFileSync(path.join(root,base+'.part-002'),'new third');};
  const result=await executePlan({root,jobList,groups,selected:['source'],runJob:async job=>{if(job.id==='preview')throw Error('derived mismatch');}});
  assert.equal(result.status,'error');assert.equal(result.jobs[0].status,'rolled_back');
  assert.equal(fs.readFileSync(path.join(root,base+'.part-000'),'utf8'),'old first');assert.equal(fs.readFileSync(path.join(root,base+'.part-001'),'utf8'),'old second');
  assert.equal(fs.existsSync(path.join(root,base+'.part-002')),false);
  assert.deepEqual(result.jobs[0].retainedFiles.filter(file=>file.path.includes('.part-')).map(file=>file.path),[base+'.part-000',base+'.part-001']);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('all failed jobs still write truthful publishable automation and collection reports with original source bytes',async()=>{
 const {root,jobList,groups,original}=transactionFixture();
 try{
  const report=await refresh({root,jobList,groups,selected:['source'],env:{GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'schedule',GITHUB_RUN_ID:'12345'},now:()=>999,runJob:async()=>{throw Error('source unavailable');}});
  assert.equal(report.status,'error');assert.equal(report.scheduled,true);assert.equal(report.finishedAt,999);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'data/collection-status.json'),'utf8')),report);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'data/automation-status.json'),'utf8')),{schemaVersion:1,state:'blocked',observedAt:999,provider:'GitHub Actions',lastAttemptRunId:12345});
  for(const [file,bytes]of original)assert.deepEqual(fs.readFileSync(path.join(root,file)),bytes);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('workflow publishes verified retained generations and failure reports before surfacing collector failure',()=>{
 const workflow=fs.readFileSync(path.join(__dirname,'.github/workflows/refresh.yml'),'utf8');
 assert.match(workflow,/id: collect\s+continue-on-error: true/);
 const collect=workflow.indexOf('id: collect'),verify=workflow.indexOf('name: Verify calculations and publication'),publish=workflow.indexOf('name: Commit coherent public snapshots'),fail=workflow.indexOf('name: Report collection failure after publishing retained data');
 assert.ok(collect<verify&&verify<publish&&publish<fail);
 assert.match(workflow,/if: steps\.collect\.outcome == 'failure'/);
 assert.match(workflow,/node refresh_data\.cjs --profile "\$profile"/);
 for(const cron of ['23 */6 * * *','41 0 * * *','17 2 * * *','47 3 * * *'])assert.ok(workflow.includes("cron: '"+cron+"'"));
});
