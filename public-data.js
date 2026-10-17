/* Verified gzip transport for public JSON. No browser writes, network fallbacks or schema bypass. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.FlowPublicData=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const MAX_COMPRESSED=32*1024*1024,MAX_DECODED=64*1024*1024;
  function fail(code,message){throw Object.assign(new Error(message),{code});}
  async function sha256(bytes){if(!globalThis.crypto?.subtle)fail('crypto_unavailable','Trình duyệt thiếu SHA-256 WebCrypto');return Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');}
  function validateManifest(m,jsonUrl){
    const name=jsonUrl.split('/').at(-1);
    if(!m||m.schemaVersion!==1||m.kind!=='public-data-manifest'||m.transportVersion!==1||!m.identity||m.identity.schemaVersion!==1)fail('manifest_schema','Manifest không đúng phiên bản');
    const p=m.payload;if(!p||p.url!==name+'.gz'||p.compression!=='gzip')fail('manifest_path','Manifest không đúng tệp gzip');
    for(const k of ['bytes','decodedBytes'])if(!Number.isSafeInteger(p[k])||p[k]<2||p[k]>(k==='bytes'?MAX_COMPRESSED:MAX_DECODED))fail('manifest_size','Kích thước manifest ngoài giới hạn');
    for(const k of ['sha256','decodedSha256'])if(typeof p[k]!=='string'||!/^[a-f0-9]{64}$/.test(p[k]))fail('manifest_hash','Manifest thiếu SHA-256');
    return m;
  }
  async function decodeGzip(bytes,expectedSize){
    if(typeof DecompressionStream!=='function')fail('gzip_unavailable','Trình duyệt chưa hỗ trợ giải nén gzip');
    let reader;try{reader=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();}catch(_){fail('gzip_decode','Không khởi tạo được giải nén gzip');}
    const chunks=[];let size=0;
    try{for(;;){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;if(size>expectedSize||size>MAX_DECODED){await reader.cancel();fail('decoded_size','Dữ liệu giải nén vượt kích thước đã xác nhận');}chunks.push(r.value);}}catch(e){if(e.code==='decoded_size')throw e;fail('gzip_decode','Gzip không hợp lệ hoặc bị hỏng');}
    if(size!==expectedSize)fail('decoded_size','Kích thước sau giải nén không khớp manifest');
    const out=new Uint8Array(size);let offset=0;for(const c of chunks){out.set(c,offset);offset+=c.byteLength;}return out;
  }
  async function loadVerified(jsonUrl,options={}){
    if(typeof jsonUrl!=='string'||!jsonUrl.endsWith('.json'))fail('json_url','Cần URL tệp .json không có query/hash');
    if(typeof options.validate!=='function')fail('schema_validator_required','Cần bộ kiểm tra schema của dữ liệu');
    const fetchImpl=options.fetchImpl||globalThis.fetch;if(typeof fetchImpl!=='function')fail('fetch_unavailable','Chưa có fetch');
    const init={credentials:'omit',cache:'no-store',signal:options.signal||AbortSignal.timeout(30000)};
    const response=await fetchImpl(jsonUrl+'.manifest.json',init);if(!response.ok)fail('manifest_http','Manifest HTTP '+response.status);
    let manifest;try{manifest=await response.json();}catch(_){fail('manifest_json','Manifest không phải JSON');}validateManifest(manifest,jsonUrl);
    const r=await fetchImpl(jsonUrl+'.gz',{...init,signal:options.signal||AbortSignal.timeout(30000)});if(!r.ok)fail('gzip_http','Gzip HTTP '+r.status);
    const compressed=new Uint8Array(await r.arrayBuffer()),p=manifest.payload;
    if(compressed.byteLength!==p.bytes)fail('compressed_size','Kích thước gzip không khớp manifest');
    if(await sha256(compressed)!==p.sha256)fail('compressed_hash','SHA-256 gzip không khớp; dừng đọc dữ liệu');
    const decoded=await decodeGzip(compressed,p.decodedBytes);
    if(await sha256(decoded)!==p.decodedSha256)fail('decoded_hash','SHA-256 dữ liệu giải nén không khớp');
    let data;try{data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(decoded));}catch(_){fail('decoded_json','Dữ liệu giải nén không phải UTF-8 JSON hợp lệ');}
    if(!data||Array.isArray(data)||typeof data!=='object')fail('data_schema','Dữ liệu phải là JSON object');
    for(const [k,v]of Object.entries(manifest.identity))if(data[k]!==v)fail('identity','Phiên bản hoặc định danh dữ liệu không khớp manifest');
    if(await options.validate(data)===false)fail('data_schema','Bộ kiểm tra schema từ chối dữ liệu');
    return {data,manifest,transport:'gzip'};
  }
  async function loadJSON(url,options){return(await loadVerified(url,options)).data;}
  return Object.freeze({loadJSON,loadVerified,validateManifest,sha256,MAX_COMPRESSED,MAX_DECODED});
});
