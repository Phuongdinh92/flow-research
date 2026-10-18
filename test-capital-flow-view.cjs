'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), zlib = require('node:zlib');
const C = require('./capital-flow-view.js');
const I = require('./intelligence-core.js');
const DAY = C.DAY, NOW = Date.UTC(2026, 9, 18, 12), CUTOFF = Date.UTC(2026, 9, 18) - 1;
const raw = (n = 401) => Array.from({ length: n }, (_, i) => ({ time: CUTOFF + 1 - (n - i) * DAY, end: CUTOFF - (n - 1 - i) * DAY, open: 100 + i, high: 102 + i, low: 98 + i, close: 101 + i, quote: 100, buy: 60 }));
const history = (bars = raw(), extra = {}) => ({ key: 'binance:BTCUSDT', sourceId: 'binance', instrument: 'BTCUSDT', base: 'BTC', quote: 'USDT', bars, asOf: NOW, fetchedAt: NOW, ...extra });
const prepare = (h = history(), opts = {}) => C.prepare(h, { now: NOW, ...opts });
const near = (actual, expected, epsilon = 1e-9) => assert.ok(Math.abs(actual - expected) <= epsilon * Math.max(1, Math.abs(expected)), actual + ' != ' + expected);

test('complete 1D/7D/30D buckets retain exact quote, buy, sell and signed delta', () => {
  const model = prepare();
  for (const days of [1, 7, 30]) {
    const result = C.aggregate(model.rows, days, model.cutoff), last = result.at(-1);
    assert.equal(last.end, CUTOFF);
    assert.equal(last.time, CUTOFF + 1 - days * DAY);
    assert.equal(last.days, days); assert.equal(last.observedDays, days); assert.equal(last.complete, true);
    assert.equal(last.quote, days * 100); assert.equal(last.buy, days * 60); assert.equal(last.sell, days * 40); assert.equal(last.delta, days * 20);
    assert.equal(last.intensity, 1); assert.equal(last.priorTo + 1, last.time); assert.equal(last.priorTo - last.priorFrom + 1, 30 * DAY);
    for (let i = 1; i < result.length; i++) assert.equal(result[i - 1].end + 1, result[i].time);
  }
});

test('volume intensity divides means of nonoverlapping windows and cannot train its own baseline', () => {
  for (const days of [1, 7, 30]) {
    const b = raw(100);
    for (const r of b.slice(-days)) { r.quote = 800; r.buy = 480; }
    const last = prepare(history(b), { aggregationDays: days }).buckets.at(-1);
    assert.equal(last.priorQuote, 3000); assert.equal(last.intensity, 8);
    assert.equal(last.quote, 800 * days); assert.equal(last.delta, 160 * days);
  }
});

test('incomplete periods preserve coverage while withholding all partial totals', () => {
  const model = prepare(history(raw(32)), { aggregationDays: 30, windowDays: 32 });
  const first = model.buckets[0];
  assert.equal(first.observedDays, 2); assert.equal(first.missingDays, 28); assert.equal(first.complete, false);
  for (const key of ['quote', 'buy', 'sell', 'delta', 'intensity']) assert.equal(first[key], null, key);
  assert.equal(model.buckets.at(-1).complete, true);
  assert.equal(model.buckets.at(-1).intensity, null, 'only two earlier observations are not a 30-day baseline');
  assert.equal(model.fullVisibleBuckets.length, 1); assert.equal(model.clippedBuckets, 1);
});

test('a missing UTC day or missing taker input never becomes a zero flow period', () => {
  const b = raw(100).filter((_, i) => i !== 98);
  const gap = prepare(history(b), { aggregationDays: 7 });
  assert.equal(gap.gaps, 1); assert.equal(gap.buckets.at(-1).complete, false); assert.equal(gap.buckets.at(-1).delta, null);
  const missing = raw(100); missing.at(-3).buy = null;
  const last = prepare(history(missing), { aggregationDays: 7 }).buckets.at(-1);
  assert.equal(last.complete, true); assert.equal(last.delta, null); assert.equal(last.buy, null); assert.equal(last.sell, null);
  assert.equal(last.quote, 700); assert.equal(last.intensity, 1, 'quote-only intensity remains independently available');
});

test('zero baseline or missing quote baseline is unavailable, actual zero delta stays zero', () => {
  for (const value of [0, null]) {
    const b = raw(100);
    for (const r of b.slice(-31, -1)) { r.quote = value; r.buy = value === null ? null : 0; }
    assert.equal(prepare(history(b)).buckets.at(-1).intensity, null);
  }
  const zero = prepare(history(raw(100).map(r => ({ ...r, buy: 50 }))));
  assert.equal(zero.buckets.at(-1).delta, 0);
  assert.match(C.flowChart(zero, { flowMode: 'delta' }), /data-cf-value="0"/);
});

test('gapped or partial baselines are not silently interpolated', () => {
  const b = raw(100).filter((_, i) => i !== 85);
  const last = prepare(history(b), { aggregationDays: 7 }).buckets.at(-1);
  assert.equal(last.complete, true); assert.equal(last.observedDays, 7); assert.equal(last.priorQuote, null); assert.equal(last.intensity, null);
});

test('viewport selection preserves full-history EMA warmup and true archive anchor', () => {
  const h = history(), full = prepare(h, { windowDays: 365 }), zoomed = prepare(h, { windowDays: 30 });
  assert.equal(zoomed.visible.length, 30);
  assert.deepEqual(zoomed.visible, full.rows.slice(-30));
  assert.ok(zoomed.visible.every(r => r.ema50 !== null && r.ema200 !== null));
  const stale = C.prepare(h, { now: NOW + 10 * DAY, windowDays: 30 });
  assert.equal(stale.current, false); assert.equal(stale.visible.length, 30); assert.equal(stale.visible.at(-1).end, CUTOFF);
  assert.match(C.html(stale), /Bản lịch sử chưa có ngày UTC vừa đóng/);
});

test('user zoom never paints an entire 30D bucket as if it belonged to one selected day', () => {
  const base = prepare();
  const model = prepare(history(), { aggregationDays: 30, from: base.rows.at(-5).time, to: base.rows.at(-3).end });
  assert.equal(model.visible.length, 3); assert.equal(model.fullVisibleBuckets.length, 0); assert.equal(model.clippedBuckets, 1);
  const flow = C.flowChart(model, { flowMode: 'delta' });
  assert.doesNotMatch(flow, /data-cf-bucket=/); assert.match(flow, /data-cf-series="flow-price"/);
  assert.match(flow, /Chưa có kỳ taker đầy đủ/);
});

test('events match the existing independent daily rules and future prices do not rewrite old events', () => {
  const b = raw(200);
  for (const r of b.slice(90, 98)) { r.quote = 400; r.buy = 260; }
  const full = prepare(history(b), { windowDays: 365 });
  const expected = I.analyze(history(b), { now: NOW });
  assert.deepEqual(full.events, expected.events);
  const earlier = b.slice(0, 130), oldNow = earlier.at(-1).end + 3600001;
  const partial = C.prepare(history(earlier, { asOf: oldNow, fetchedAt: oldNow }), { now: oldNow, windowDays: 365 });
  assert.deepEqual(full.events.filter(e => e.signalTime <= earlier.at(-1).end), partial.events);
  assert.ok(full.events.some(e => e.signal === 'volumeAnomaly'));
});

test('event visibility toggles do not alter flow numbers or fabricate whale categories', () => {
  const b = raw(100); b.at(-2).quote = 800; b.at(-2).buy = 480;
  const model = prepare(history(b));
  const all = C.flowChart(model, { flowMode: 'delta' });
  const none = C.flowChart(model, { flowMode: 'delta', hiddenEvents: C.EVENT_ORDER });
  assert.match(all, /data-cf-event-time=/); assert.doesNotMatch(none, /data-cf-event-time=/);
  const values = s => [...s.matchAll(/data-cf-value="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(values(all), values(none));
  assert.doesNotMatch(all, /Whale|Shark|LNC|MFI Spike/);
});

test('candles, quote-volume bars, and daily exact-value focus samples have one-to-one coverage', () => {
  const model = prepare(history(raw(100)), { windowDays: 30 }), svg = C.priceChart(model);
  assert.equal((svg.match(/data-cf-candle=/g) || []).length, 30);
  assert.equal((svg.match(/data-cf-volume=/g) || []).length, 30);
  assert.equal((svg.match(/data-cf-sample=/g) || []).length, 30);
  assert.equal((svg.match(/tabindex="0"/g) || []).length, 1);
  assert.equal((svg.match(/tabindex="-1"/g) || []).length, 29);
  assert.match(svg, /data-cf-label="ema50"/); assert.doesNotMatch(svg, /data-cf-label="ema200"/);
  assert.ok(svg.includes('C ' + model.visible.at(-1).close + ' USDT'));
});

test('missing dates break line paths, missing last EMA is not backfilled as a latest label', () => {
  const b = raw(401).filter((_, i) => i !== 390), model = prepare(history(b), { windowDays: 30 });
  const svg = C.flowChart(model), priceSvg = C.priceChart(model);
  const flowPath = svg.match(/data-cf-series="flow-price" d="([^"]+)"/)[1];
  assert.equal((flowPath.match(/M/g) || []).length, 2);
  assert.doesNotMatch(priceSvg, /data-cf-label="ema(?:50|200)"/);
  assert.match(priceSvg, /data-cf-series="ema50"/);
});

test('EMA toggles remove only their paths and labels, retaining the real candles', () => {
  const model = prepare(), svg = C.priceChart(model, { ema50: false, ema200: false });
  assert.doesNotMatch(svg, /data-cf-series="ema(?:50|200)"|data-cf-label="ema(?:50|200)"/);
  assert.equal((svg.match(/data-cf-candle=/g) || []).length, model.visible.length);
  assert.match(svg, /data-cf-label="close"/);
});

test('right-edge latest price and EMA labels do not overlap', () => {
  for (const y of [20, 26, 180, 341, 400]) {
    const a = C.labels(['close', 'ema50', 'ema200'].map(key => ({ key, y })), 26, 342);
    assert.equal(a.length, 3);
    for (let i = 0; i < a.length; i++) { assert.ok(a[i].labelY >= 43 && a[i].labelY <= 325); if (i) assert.ok(a[i].labelY - a[i - 1].labelY >= 34); }
  }
});

test('Coin Metrics USD reference replaces exchange USDT axes and is explicitly identified', () => {
  const data = JSON.parse(fs.readFileSync('data/cost-reference.json'));
  const asset = data.assets.find(a => a.id === 'eth');
  const model = prepare(history());
  const rendered = C.html(model, { costAsset: asset, sourceMode: 'network' });
  const priceSection = rendered.split('<section class="cf-card cf-structure">')[1].split('<section class="cf-card cf-flow">')[0];
  assert.match(priceSection, /Price Structure · ETH/); assert.match(priceSection, /Coin Metrics · ETH native network · USD/);
  assert.match(priceSection, /data-cost-series="realized"/); assert.doesNotMatch(priceSection, /data-cf-candle=|cf-price-svg/);
  assert.match(rendered, /Flow & Price · BTC/);
  assert.match(rendered, /data-cf-series="flow-price"/);
  assert.doesNotMatch(rendered, /data-cost-series="(?:balance|delta|undervalue|diamond)"/);
});

test('empty selected network dates are missing, without replacing them with the exchange prices', () => {
  const data = JSON.parse(fs.readFileSync('data/cost-reference.json')), asset = { ...data.assets[0], rows: [] };
  const rendered = C.html(prepare(), { costAsset: asset, sourceMode: 'network' });
  assert.match(rendered, /Chưa có quan sát giá USD/); assert.match(rendered, /chưa có trong cửa sổ/);
  assert.doesNotMatch(rendered, /data-cf-candle=/);
});

test('unknown bands have availability explanations and never generate synthetic lines', () => {
  const rendered = C.html(prepare());
  for (const name of C.UNKNOWN_BANDS) assert.ok(rendered.includes('Chưa có công thức và dữ liệu nguồn đủ để tái tạo dải ' + name));
  assert.doesNotMatch(rendered, /data-cf-series="(?:realized|balance|delta|undervalue|diamond)"/);
  assert.match(rendered, /Realized · thiếu nguồn/);
});

test('invalid identity, open/future candle, duplicate dates and invalid settings fail closed', () => {
  for (const h of [history(raw(), { key: 'bitget:BTCUSDT' }), history(raw(), { quote: 'USD' }), history([...raw(), raw()[0]])]) assert.throws(() => prepare(h));
  for (const options of [{ windowDays: 0 }, { windowDays: 1.5 }, { aggregationDays: 5 }, { from: CUTOFF + DAY }, { to: CUTOFF + DAY }]) assert.throws(() => prepare(history(), options));
  const future = raw(); future.at(-1).end = NOW; assert.throws(() => prepare(history(future)));
  assert.throws(() => C.flowChart(prepare(), { flowMode: 'whale' }));
});

test('rendered source names and tooltips are escaped rather than interpreted as HTML', () => {
  const h = history(raw(), { base: '<script>bad</script>' }), rendered = C.html(prepare(h));
  assert.match(rendered, /&lt;script&gt;bad&lt;\/script&gt;/); assert.doesNotMatch(rendered, /<script>/);
});

test('tiny price values stay readable and all geometry remains finite', () => {
  const tiny = raw(401).map(r => ({ ...r, open: 1e-9, high: 1.1e-9, low: .9e-9, close: 1.01e-9 }));
  const rendered = C.html(prepare(history(tiny)));
  assert.doesNotMatch(rendered, /NaN|Infinity/); assert.match(C.price(1e-9), /e-9/);
});

test('actual archived BTC windows exactly equal direct source sums, including 30D cutoff', () => {
  const archive = JSON.parse(zlib.gunzipSync(fs.readFileSync('data/research-snapshot.json.gz')));
  const h = archive.histories['binance:BTCUSDT'];
  assert.ok(h);
  const model = C.prepare(h, { now: NOW, aggregationDays: 30, windowDays: 180 });
  const last = model.buckets.at(-1), expected = h.bars.slice(-30).reduce((s, b) => s + 2 * b.buy - b.quote, 0);
  assert.equal(last.time, Date.UTC(2026, 8, 17)); assert.equal(last.end, Date.UTC(2026, 9, 17) - 1);
  near(last.delta, expected); near(last.delta, -844561865.857288);
  const svg = C.flowChart(model, { flowMode: 'delta' });
  assert.ok(svg.includes('data-cf-value="' + last.delta + '"'));
  assert.doesNotMatch(svg, /NaN|Infinity/);
});
