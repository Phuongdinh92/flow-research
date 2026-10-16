'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const R = require('./research-ui.js');
const S = require('./signal-core.js');
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/research-manifest.json')));
const compressed = fs.readFileSync(path.join(__dirname, 'data/research-snapshot.json.gz'));
const decoded = zlib.gunzipSync(compressed);
const full = JSON.parse(decoded);
const OBSERVED_NOW = manifest.finishedAt || manifest.generatedAt;
const NOW = Math.max(Date.now(), OBSERVED_NOW);
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const buffer = b => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
function fixture() {
  const keys = Object.keys(full.histories).slice(0, 3), raw = { ...full, histories: Object.fromEntries(keys.map(k => [k, structuredClone(full.histories[k])])),
    universe: { ...full.universe, instruments: structuredClone(full.universe.instruments.filter(r => keys.includes(r.key))), eligibleInstrumentCount: keys.length },
    sourceCoverage: { eligible: keys.length, attempted: keys.length, completed: keys.length, fullLength: keys.length, shortHistory: 0, errors: 0, unattempted: 0 }, errors: [] };
  const m = structuredClone(manifest); m.sourceCoverage = { ...raw.sourceCoverage }; m.universe.eligibleInstrumentCount = keys.length;
  return { raw, manifest: m };
}
const first = raw => Object.values(raw.histories)[0];
const response = (status, body, json = false) => ({ ok: status >= 200 && status < 300, status, json: async () => body, arrayBuffer: async () => buffer(body) });
function fetchDataset(m = manifest, bytes = compressed) { return async url => url === './data/research-manifest.json' ? response(200, m, true) : url === m.snapshot.url ? response(200, bytes) : response(404, null); }

test('actual published gzip and decoded JSON both match manifest SHA-256 and sizes', () => {
  assert.equal(compressed.length, manifest.snapshot.bytes); assert.equal(decoded.length, manifest.snapshot.decodedBytes);
  assert.equal(hash(compressed), manifest.snapshot.sha256); assert.equal(hash(decoded), manifest.snapshot.decodedSha256);
  assert.equal(Object.keys(R.validateDataset(full, manifest, NOW).histories).length, 511);
  assert.equal(Object.values(full.histories).reduce((s, h) => s + h.bars.length, 0), 166221);
});
test('real loader checks gzip hash, decompressed hash, schema and coverage together', async () => {
  const out = await R.loadDataset(fetchDataset()); assert.equal(out.data.generatedAt, manifest.generatedAt); assert.equal(out.data.sourceCoverage.completed, 511);
  const bad = Buffer.from(compressed); bad[bad.length - 1] ^= 1;
  await assert.rejects(R.loadDataset(fetchDataset(manifest, bad)), /băm|hash/i);
  const wrongDecoded = structuredClone(manifest); wrongDecoded.snapshot.decodedSha256 = 'a'.repeat(64);
  await assert.rejects(R.loadDataset(fetchDataset(wrongDecoded)), /giải nén|decoded/i);
});
test('HTTP errors are surfaced without synthetic replacement data', async () => {
  await assert.rejects(R.loadDataset(async () => response(503, null)), /HTTP 503/);
  await assert.rejects(R.loadDataset(async url => url.includes('manifest') ? response(200, manifest, true) : response(429, null)), /HTTP 429/);
});
test('manifest rejects incomplete collection, wrong snapshot routes and invalid sizes', () => {
  for (const edit of [m => m.collectionState = 'partial', m => m.snapshot.url = 'https://example.com/fake.gz', m => m.snapshot.compression = 'br', m => m.snapshot.bytes = 0,
    m => m.snapshot.decodedBytes = 0, m => m.snapshot.decodedBytes = -1, m => m.snapshot.sha256 = 'bogus']) {
    const m = structuredClone(manifest); edit(m); assert.throws(() => R.checkManifest(m, NOW));
  }
});
test('dataset and manifest dates, completion counts and source identities must agree', () => {
  for (const edit of [({ raw }) => raw.generatedAt++, ({ raw }) => raw.endTime--, ({ raw }) => raw.sourceId = 'bitget',
    ({ raw }) => raw.sourceCoverage.completed--, ({ raw }) => first(raw).key = 'bitget:BTCUSDT',
    ({ raw }) => raw.universe.instruments.push(structuredClone(raw.universe.instruments[0])),
    ({ manifest: m }) => m.sourceCoverage.completed--]) {
    const f = fixture(); edit(f); assert.throws(() => R.validateDataset(f.raw, f.manifest, NOW));
  }
});
test('negative or fractional coverage numbers cannot balance out into a valid total', () => {
  for (const mutate of [c => { c.errors = -1; c.unattempted = 1; c.attempted = c.completed - 1; }, c => { c.errors = -.5; c.unattempted = .5; c.attempted = c.completed - .5; }]) {
    const f = fixture(); mutate(f.raw.sourceCoverage); f.manifest.sourceCoverage = { ...f.raw.sourceCoverage };
    assert.throws(() => R.validateDataset(f.raw, f.manifest, NOW));
  }
});
test('source proof must match the native pair, endpoint and one unambiguous query', () => {
  const urls = [
    'https://example.com/api/v3/klines?symbol=BTCUSDT&interval=1d',
    'https://data-api.binance.vision/api/v3/ticker/24hr?symbol=BTCUSDT&interval=1d',
    'https://data-api.binance.vision/api/v3/klines?symbol=ETHUSDT&interval=1d',
    'https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1h',
    'https://untrusted:password@data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1d',
    'https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&symbol=ETHUSDT&interval=1d',
    'https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1d#misleading'
  ];
  for (const url of urls) { const f = fixture(); first(f.raw).provenance[0].url = url; assert.throws(() => R.validateDataset(f.raw, f.manifest, NOW), url); }
  const f = fixture(); first(f.raw).provenance[0].sha256 = null; assert.throws(() => R.validateDataset(f.raw, f.manifest, NOW));
});
test('candle provenance cutoff must match the collection cutoff', () => {
  const f = fixture(), p = first(f.raw).provenance[0], u = new URL(p.url); u.searchParams.set('endTime', String(f.raw.endTime - S.DAY)); p.url = u.href;
  assert.throws(() => R.validateDataset(f.raw, f.manifest, NOW));
});
test('malformed OHLC data is rejected at validation or explicitly excluded during analysis', () => {
  const f = fixture(); first(f.raw).bars.at(-1).high = 0;
  let valid; try { valid = R.validateDataset(f.raw, f.manifest, NOW); } catch (_) { return; }
  const out = R.analyzeAll(valid, S, { now: OBSERVED_NOW });
  assert.equal(out.errors.length, 1); assert.equal(out.analyses.length, 2); assert.equal(out.errors[0].key, first(f.raw).key);
});
test('actual full current dataset screening retains all source pairs and no phantom rows', () => {
  const out = R.analyzeAll(full, S, { now: OBSERVED_NOW }); assert.equal(out.errors.length, 0); assert.equal(out.analyses.length, 511);
  assert.equal(new Set(out.analyses.map(x => x.key)).size, 511); assert.ok(out.analyses.every(x => x.sourceId === 'binance' && x.quote === 'USDT'));
  assert.ok(out.analyses.some(x => x.coverage.contiguousTailDays < 200 && x.candidate !== null));
  assert.ok(out.analyses.filter(x => x.coverage.contiguousTailDays < 37).every(x => x.candidate === null));
});
function rows() {
  return Array.from({ length: 60 }, (_, i) => ({ key: 'binance:COIN' + i + 'USDT', sourceId: 'binance', base: 'COIN' + i, instrument: 'COIN' + i + 'USDT',
    candidate: i % 3 === 0 ? true : i % 3 === 1 ? false : null, label: 'Chưa xác nhận ví', metrics: { delta7: i - 30, return30: i / 100 - .3, buyShare7: .45 + i / 1000, end: manifest.endTime, quote30: 1000 } }));
}
test('query, candidate/eligible scopes and 25-row pagination work together', () => {
  const a = rows(); assert.equal(R.selectRows(a, { scope: 'candidate' }).count, 20); assert.equal(R.selectRows(a, { scope: 'eligible' }).count, 40);
  const all = R.selectRows(a, { scope: 'all', page: 999 }); assert.equal(all.count, 60); assert.equal(all.pages, 3); assert.equal(all.page, 2); assert.equal(all.shown.length, 10);
  assert.equal(R.selectRows(a, { scope: 'all', query: ' coin1 ' }).count, 11); assert.equal(R.selectRows(a, { scope: 'all', query: 'not-a-token' }).count, 0);
});
test('sort uses signed taker delta rather than trade-size magnitude and keeps missing last', () => {
  const a = rows().slice(0, 4); [-8e6, 2e6, -1e6, null].forEach((v, i) => a[i].metrics.delta7 = v);
  assert.deepEqual(R.selectRows(a, { scope: 'all', sort: 'delta7' }).shown.map(x => x.metrics.delta7), [2e6, -1e6, -8e6, null]);
  const html = R.table([a[0]]); assert.match(html, /class="negative"/); assert.match(html, /-8/); assert.match(html, /triệu USDT/);
});
test('table and scatter escape untrusted token labels, IDs and tooltip text', () => {
  const a = rows()[0]; a.base = '<img src=x onerror="alert(1)">'; a.instrument = '<script>alert(2)</script>'; a.key = 'binance:" onload="alert(3)'; a.label = '</title><svg onload=alert(4)>';
  for (const html of [R.table([a]), R.scatter([a])]) { assert.ok(!html.includes('<script>')); assert.ok(!html.includes('<img src=')); assert.ok(!html.includes('</title><svg onload=')); assert.match(html, /&lt;(img|script|\/title)/); }
});
test('scatter and pressure SVG contain finite coordinates and explicit native-data labels', () => {
  const plot = R.scatter(rows(), { width: 375 }); assert.match(plot, /^<svg/); assert.match(plot, /data-research-key/); assert.match(plot, /chưa xác nhận ví lớn/); assert.ok(!/NaN|Infinity|undefined/.test(plot));
  const h = Object.values(full.histories)[0], a = S.analyze(h, { now: OBSERVED_NOW, windowDays: 180 });
  const pressure = R.pressureChart(a.series); assert.match(pressure, /^<svg/); assert.match(pressure, /không chồng lấn/); assert.match(pressure, /Taker mua 7D/); assert.match(pressure, /Taker mua 30D/); assert.ok(!/NaN|Infinity|undefined/.test(pressure));
  assert.match(R.scatter([]), /Chưa có cặp đủ dữ liệu/);
});
