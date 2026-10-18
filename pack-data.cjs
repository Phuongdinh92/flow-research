#!/usr/bin/env node
/* Publish verified gzip transport; large holder archives use bounded, ordered fragments. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto');
const P=require('./public-data.js');
const DEFAULT_FILES=['holders-snapshot','holder-history-snapshot','chain-ledger-snapshot','intelligence-study','derivatives-snapshot','ecosystem-snapshot','market-categories'].map(n=>path.join(__dirname,'data',n+'.json')).concat(['market-coverage','market-collection-attempt','inventory-ledger','coinlore-market','cost-reference','terminal-preview','market-windows'].map(n=>path.join(__dirname,'data',n+'.json')).filter(file=>fs.existsSync(file)||fs.existsSync(file+'.manifest.json')));
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function atomicWrite(file,bytes){const tmp=file+'.tmp';fs.writeFileSync(tmp,bytes);fs.renameSync(tmp,file);}
function sourceObject(decoded){const data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(decoded));if(!data||Array.isArray(data)||data.schemaVersion!==1)throw Error('Unsupported source JSON schema');return data;}
function makeManifest(file,decoded,compressed){
  const data=sourceObject(decoded),identity={schemaVersion:data.schemaVersion};
  for(const key of ['kind','sourceId','version'])if(['string','number'].includes(typeof data[key]))identity[key]=data[key];
  return {schemaVersion:1,kind:'public-data-manifest',transportVersion:1,generatedAt:Date.now(),identity,
    payload:{url:path.basename(file)+'.gz',compression:'gzip',bytes:compressed.length,sha256:sha(compressed),decodedBytes:decoded.length,decodedSha256:sha(decoded)}};
}
function writeParts(file,compressed,manifest,partBytes=P.MAX_PART_BYTES){
  if(!Number.isSafeInteger(partBytes)||partBytes<1||partBytes>P.MAX_PART_BYTES)throw Error('Invalid gzip fragment size');
  const parts=[];
  for(let offset=0,index=0;offset<compressed.length;offset+=partBytes,index++){
    const bytes=compressed.subarray(offset,offset+partBytes),url=manifest.payload.url+'.part-'+String(index).padStart(3,'0');
    parts.push({index,url,bytes:bytes.length,sha256:sha(bytes)});
  }
  const next={...manifest,transportVersion:2,payload:{...manifest.payload,parts}};P.validateManifest(next,file);
  for(const part of parts)atomicWrite(path.join(path.dirname(file),part.url),compressed.subarray(part.index*partBytes,part.index*partBytes+part.bytes));
  // Publish the manifest last so readers cannot observe a declared but unwritten part.
  atomicWrite(file+'.manifest.json',JSON.stringify(next));
  const keep=new Set(parts.map(part=>part.url)),prefix=path.basename(file)+'.gz.part-';
  for(const name of fs.readdirSync(path.dirname(file)))if(name.startsWith(prefix)&&/^\d{3}$/.test(name.slice(prefix.length))&&!keep.has(name))fs.unlinkSync(path.join(path.dirname(file),name));
  return next;
}
function readPacked(file){
  const manifest=JSON.parse(fs.readFileSync(file+'.manifest.json','utf8'));P.validateManifest(manifest,file);const p=manifest.payload;
  const compressed=manifest.transportVersion===2?Buffer.concat(p.parts.map(part=>{
    const bytes=fs.readFileSync(path.join(path.dirname(file),part.url));
    if(bytes.length!==part.bytes||sha(bytes)!==part.sha256)throw Error('Gzip fragment failed integrity: '+part.url);return bytes;
  })):fs.readFileSync(file+'.gz');
  if(compressed.length!==p.bytes||sha(compressed)!==p.sha256)throw Error('Compressed payload failed integrity: '+file);
  const decoded=zlib.gunzipSync(compressed,{maxOutputLength:P.MAX_DECODED});
  if(decoded.length!==p.decodedBytes||sha(decoded)!==p.decodedSha256)throw Error('Decoded payload failed integrity: '+file);
  const data=sourceObject(decoded);for(const [key,value]of Object.entries(manifest.identity))if(data[key]!==value)throw Error('Payload identity mismatch: '+key);
  return {manifest,compressed,decoded,data};
}
function materialize(file){const result=readPacked(file);atomicWrite(file+'.gz',result.compressed);atomicWrite(file,result.decoded);return {...result,file};}
function packFile(file,options={}){
  // A clean checkout may intentionally contain only the verified transport fragments.
  const decoded=fs.existsSync(file)?fs.readFileSync(file):readPacked(file).decoded;
  const compressed=zlib.gzipSync(decoded,{level:9,mtime:0});let manifest=makeManifest(file,decoded,compressed);
  const shard=options.shard===true||(options.shard!==false&&path.basename(file)==='holder-history-snapshot.json'&&compressed.length>P.MAX_PART_BYTES);
  if(shard)manifest=writeParts(file,compressed,manifest,options.partBytes);
  else{P.validateManifest(manifest,file);atomicWrite(file+'.gz',compressed);atomicWrite(file+'.manifest.json',JSON.stringify(manifest));}
  return {file,bytes:decoded.length,gzipBytes:compressed.length,reductionPct:100*(1-compressed.length/decoded.length),manifest};
}
function shardReceiptBundle(gzipFile,receiptManifestFile){
  if(!gzipFile.endsWith('.json.gz'))throw Error('Receipt file must end in .json.gz');
  const file=gzipFile.slice(0,-3),proof=JSON.parse(fs.readFileSync(receiptManifestFile,'utf8')),compressed=fs.readFileSync(gzipFile);
  if(proof.file!==path.basename(gzipFile)||proof.encoding!=='gzip'||compressed.length!==proof.compressedBytes||sha(compressed)!==proof.compressedSha256)throw Error('Original receipt gzip proof mismatch');
  const decoded=zlib.gunzipSync(compressed,{maxOutputLength:P.MAX_DECODED});
  if(decoded.length!==proof.decodedBytes||sha(decoded)!==proof.decodedSha256)throw Error('Original receipt decoded proof mismatch');
  const manifest=writeParts(file,compressed,makeManifest(file,decoded,compressed));
  return {file,bytes:decoded.length,gzipBytes:compressed.length,manifest};
}
function packAll(files=DEFAULT_FILES){return files.map(file=>packFile(file));}
if(require.main===module){try{
  const args=process.argv.slice(2);let results;
  if(args[0]==='--materialize')results=(args.length>1?args.slice(1):DEFAULT_FILES).map(materialize);
  else if(args[0]==='--shard-receipts'){if(args.length!==3)throw Error('Usage: --shard-receipts file.json.gz receipt.manifest.json');results=[shardReceiptBundle(args[1],args[2])];}
  else if(args[0]==='--shard')results=args.slice(1).map(file=>packFile(file,{shard:true}));
  else results=packAll(args.length?args:DEFAULT_FILES);
  for(const r of results)console.log(JSON.stringify({file:r.file,bytes:r.bytes??r.decoded?.length,gzipBytes:r.gzipBytes??r.compressed?.length,parts:r.manifest?.payload?.parts?.length||0}));
}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={packFile,packAll,DEFAULT_FILES,readPacked,materialize,shardReceiptBundle};
