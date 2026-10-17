'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const R=require('./research-ui.js');
const {KEY,hash,subsetManifest,buildPreview}=require('./build_terminal_preview.cjs');
const read=name=>fs.readFileSync(path.join(__dirname,'data',name));
const parent=JSON.parse(read('research-manifest.json'));
const sourceBytes=read('research-snapshot.json.gz');
const sourceDecoded=zlib.gunzipSync(sourceBytes),full=JSON.parse(sourceDecoded);
const bytes=read('terminal-preview.json.gz'),decoded=zlib.gunzipSync(bytes);
const preview=JSON.parse(decoded),manifest=JSON.parse(read('terminal-preview.json.manifest.json'));
const NOW=Math.max(Date.now(),parent.generatedAt);

test('initial BTC preview verifies both gzip and decoded bytes without altering the parent transport',()=>{
  assert.equal(bytes.length,manifest.payload.bytes);assert.equal(hash(bytes),manifest.payload.sha256);
  assert.equal(decoded.length,manifest.payload.decodedBytes);assert.equal(hash(decoded),manifest.payload.decodedSha256);
  assert.deepEqual(manifest.identity,{schemaVersion:1,kind:'terminal-price-preview',sourceId:'binance'});
  assert.equal(manifest.payload.url,'terminal-preview.json.gz');
  assert.ok(bytes.length<40000,'BTC initial transport should remain small');
  assert.equal(sourceBytes.length,parent.snapshot.bytes);assert.equal(hash(sourceBytes),parent.snapshot.sha256);
  assert.equal(sourceDecoded.length,parent.snapshot.decodedBytes);assert.equal(hash(sourceDecoded),parent.snapshot.decodedSha256);
});
test('preview contains exactly the original 401 BTC bars, raw values, source proofs and quote identity',()=>{
  assert.deepEqual(preview.parentManifest,parent);
  assert.equal(preview.schemaVersion,1);assert.equal(preview.kind,'terminal-price-preview');assert.equal(preview.sourceId,'binance');
  assert.deepEqual(Object.keys(preview.data.histories),[KEY]);
  const actual=preview.data.histories[KEY],expected=full.histories[KEY];
  assert.equal(actual.bars.length,401);assert.deepEqual(actual,expected);
  assert.deepEqual(preview.data.universe.instruments,full.universe.instruments.filter(row=>row.key===KEY));
  assert.deepEqual(actual.provenance,expected.provenance);assert.equal(actual.fetchedAt,expected.fetchedAt);
  for(let i=0;i<401;i++)assert.deepEqual(actual.bars[i],expected.bars[i],`BTC bar ${i} differs from verified parent`);
});
test('subset metadata preserves source clocks and census provenance while its own coverage is exactly one',()=>{
  const data=preview.data;
  assert.deepEqual(data.sourceCoverage,{eligible:1,attempted:1,completed:1,fullLength:1,shortHistory:0,errors:0,unattempted:0});
  assert.equal(data.universe.eligibleInstrumentCount,1);
  for(const field of ['generatedAt','asOf','endTime','lastClosedDay','requestedDays','finishedAt'])assert.equal(data[field],full[field]);
  for(const field of ['asOf','fetchedAt','excludedCount','errors','provenance','after'])assert.deepEqual(data.universe[field],full.universe[field]);
  assert.deepEqual(data.collector,full.collector);assert.deepEqual(data.errors,full.errors);
  assert.match(data.scope,/BTC\/USDT-only/);assert.match(data.scope,/does not represent market-wide coverage/);
  assert.equal(R.validateDataset(data,subsetManifest(parent,data),NOW),data);
});
test('preview builder is deterministic, does not mutate the full manifest and never changes source data',()=>{
  const original=JSON.stringify(parent),made=buildPreview(parent,sourceBytes,{now:NOW});
  assert.deepEqual(made,preview);assert.equal(JSON.stringify(parent),original);
  assert.equal(parent.sourceCoverage.completed,511);assert.equal(parent.universe.eligibleInstrumentCount,511);
  assert.equal(Object.keys(full.histories).length,511);
});
test('builder refuses damaged parent bytes or a manifest with a false decoded identity',()=>{
  const corrupted=Buffer.from(sourceBytes);corrupted[corrupted.length-1]^=1;
  assert.throws(()=>buildPreview(parent,corrupted,{now:NOW}),/gzip does not match/);
  const wrong=structuredClone(parent);wrong.snapshot.decodedSha256='0'.repeat(64);
  assert.throws(()=>buildPreview(wrong,sourceBytes,{now:NOW}),/Decoded parent snapshot does not match/);
});
