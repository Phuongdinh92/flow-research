#!/usr/bin/env node
/* Publish gzip first, then an integrity/version manifest. Any mismatch fails closed in browser. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto');
const DEFAULT_FILES=['holders-snapshot','holder-history-snapshot','chain-ledger-snapshot','intelligence-study','derivatives-snapshot'].map(n=>path.join(__dirname,'data',n+'.json'));
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function atomicWrite(file,bytes){const tmp=file+'.tmp';fs.writeFileSync(tmp,bytes);fs.renameSync(tmp,file);}
function packFile(file){
  const decoded=fs.readFileSync(file),data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(decoded));
  if(!data||Array.isArray(data)||data.schemaVersion!==1)throw Error('Unsupported source JSON schema: '+file);
  const compressed=zlib.gzipSync(decoded,{level:9,mtime:0}),identity={schemaVersion:data.schemaVersion};
  for(const key of ['kind','sourceId','version'])if(['string','number'].includes(typeof data[key]))identity[key]=data[key];
  const manifest={schemaVersion:1,kind:'public-data-manifest',transportVersion:1,generatedAt:Date.now(),identity,
    payload:{url:path.basename(file)+'.gz',compression:'gzip',bytes:compressed.length,sha256:sha(compressed),decodedBytes:decoded.length,decodedSha256:sha(decoded)}};
  atomicWrite(file+'.gz',compressed);atomicWrite(file+'.manifest.json',JSON.stringify(manifest));
  return {file,bytes:decoded.length,gzipBytes:compressed.length,reductionPct:100*(1-compressed.length/decoded.length),manifest};
}
function packAll(files=DEFAULT_FILES){return files.map(packFile);}
if(require.main===module){try{for(const r of packAll(process.argv.length>2?process.argv.slice(2):DEFAULT_FILES))console.log(JSON.stringify({file:r.file,bytes:r.bytes,gzipBytes:r.gzipBytes,reductionPct:Number(r.reductionPct.toFixed(2))}));}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={packFile,packAll,DEFAULT_FILES};
