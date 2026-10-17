'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {guarded}=require('./refresh_data.cjs');
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
