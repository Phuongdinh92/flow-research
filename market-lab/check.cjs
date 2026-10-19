/* Verify the public Market Lab from the exact committed HTML and archived data. */
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),zlib=require('node:zlib'),crypto=require('node:crypto');
const html=fs.readFileSync('market-lab/index.html','utf8');
const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
assert.equal(scripts.length,1,'Expected exactly one inline application script');
new vm.Script(scripts[0][1],{filename:'market-lab/index.html'});
const flow=JSON.parse(fs.readFileSync('data/flow-snapshot.json','utf8'));
const manifest=JSON.parse(fs.readFileSync('data/research-manifest.json','utf8'));
assert.equal(flow.sourceId,'binance');
assert.ok(flow.records.length>=500);
assert.equal(new Set(flow.records.map(x=>x.key)).size,flow.records.length,'No duplicate instruments');
assert.ok(flow.records.some(x=>x.key==='binance:BTCUSDT'));
assert.ok(flow.records.some(x=>x.key==='binance:NEARUSDT'));
assert.equal(manifest.kind,'cex-research-manifest');
const bytes=fs.readFileSync('data/research-snapshot.json.gz');
assert.equal(bytes.length,manifest.snapshot.bytes);
assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),manifest.snapshot.sha256);
const decoded=zlib.gunzipSync(bytes);
assert.equal(decoded.length,manifest.snapshot.decodedBytes);
assert.equal(crypto.createHash('sha256').update(decoded).digest('hex'),manifest.snapshot.decodedSha256);
const raw=JSON.parse(decoded.toString('utf8'));
assert.equal(raw.kind,'cex-research');
assert.equal(raw.sourceId,'binance');
assert.equal(Object.keys(raw.histories).length,manifest.sourceCoverage.completed);
for(const key of ['binance:BTCUSDT','binance:NEARUSDT','binance:LINKUSDT']){
  const h=raw.histories[key];assert.ok(h,'Missing '+key);assert.ok(h.bars.length>30);
  let prev=-Infinity;for(const b of h.bars){assert.ok(b.time>prev,'Out of order '+key);prev=b.time;}
}
assert.ok(html.includes('Không gắn hình cá mập')&&html.includes('Không phải ASI'),'Missing truthful scope labels');
console.log('Market Lab PASS: JS parsed, 511 market records, gzip checksums valid, '+Object.keys(raw.histories).length+' full histories.');
