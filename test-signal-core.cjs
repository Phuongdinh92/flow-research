'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const S = require('./signal-core.js');
const DAY = S.DAY, NOW = Date.UTC(2026, 9, 16, 12), END = Date.UTC(2026, 9, 16) - 1;
function bars(n = 401) {
  return Array.from({ length: n }, (_, i) => ({ time: END + 1 - (n - i) * DAY, end: END - (n - 1 - i) * DAY, open: 100, high: 102, low: 98, close: 100, quote: i >= n - 7 ? 200 : 100, buy: i >= n - 7 ? 120 : 55 }));
}
const history = (b = bars(), extra = {}) => ({ key: 'binance:BTCUSDT', sourceId: 'binance', instrument: 'BTCUSDT', base: 'BTC', quote: 'USDT', bars: b, asOf: NOW, fetchedAt: NOW, ...extra });
const run = (h = history(), options = {}) => S.analyze(h, { now: NOW, ...options });
const approx = (a, b, e = 1e-10) => assert.ok(Math.abs(a - b) < e, a + ' != ' + b);

test('candidate uses declared independent criteria and retains venue/pair', () => {
  const x = run(); assert.equal(x.key, 'binance:BTCUSDT'); assert.equal(x.sourceId, 'binance'); assert.equal(x.quote, 'USDT');
  assert.equal(x.status, 'candidate'); assert.equal(x.candidate, true); assert.equal(x.label, S.LABEL);
  assert.equal(x.methodology.classification, 'independent_descriptive_filter');
  assert.deepEqual(x.config, S.DEFAULT_CRITERIA); assert.equal(x.criteria.length, 5); assert.ok(x.criteria.every(c => c.pass));
  assert.equal(x.coverage.contiguousTailDays, 401); assert.equal(x.coverage.requiredDays, 37);
});
test('7/30-day taker fractions are volume-weighted, not means of daily shares', () => {
  const x = run(); approx(x.metrics.buyShare7, 0.6); approx(x.metrics.buyShare30, (7 * 120 + 23 * 55) / (7 * 200 + 23 * 100));
  assert.notEqual(x.metrics.buyShare30, (7 * .6 + 23 * .55) / 30);
  assert.equal(x.metrics.delta7, 280); assert.equal(x.metrics.delta30, 510); assert.equal(x.metrics.cvd7, 280);
});
test('volume comparison uses two complete NON-overlapping windows with correct lengths', () => {
  const b = bars(211); for (let i = b.length - 37; i < b.length - 7; i++) { b[i].quote = 80; b[i].buy = 44; }
  const x = run(history(b)), m = x.metrics;
  assert.equal(m.quoteMean7, 200); assert.equal(m.quoteMeanPrior30, 80); assert.equal(m.volumeRatio7vsPrior30, 2.5);
  assert.equal(m.volumeWindows.priorTo + 1, m.volumeWindows.recentFrom); assert.equal(m.volumeWindows.overlapDays, 0);
  assert.equal(m.volumeWindows.priorTo - m.volumeWindows.priorFrom + 1, 30 * DAY);
  assert.equal(m.volumeWindows.recentTo - m.volumeWindows.recentFrom + 1, 7 * DAY);
});
test('return7 and return30 compare the close exactly 7/30 days earlier', () => {
  const b = bars(211); b.at(-8).close = 80; b.at(-8).low = 79; b.at(-31).close = 50; b.at(-31).low = 49;
  const x = run(history(b)); approx(x.metrics.return7, .25); approx(x.metrics.return30, 1); assert.equal(x.metrics.close7, 80); assert.equal(x.metrics.close30, 50);
  assert.equal(x.candidate, false); assert.equal(x.criteria.find(c => c.id === 'return30Max').pass, false);
});
test('strict share thresholds and inclusive range/volume thresholds are transparent', () => {
  const b = bars(211).map(x => ({ ...x, quote: 100, buy: 52 }));
  const x = run(history(b), { criteria: { buyShare7Min: .52, buyShare30Min: .5, return30Min: 0, return30Max: 0, volumeRatioMin: 1 } });
  assert.equal(x.criteria.find(c => c.id === 'buyShare7').pass, false); assert.equal(x.candidate, false);
  const y = run(history(b), { criteria: { buyShare7Min: .51, buyShare30Min: .5, return30Min: 0, return30Max: 0, volumeRatioMin: 1 } });
  assert.equal(y.candidate, true);
});
test('37 completed continuous days are required, while shorter charts remain descriptive', () => {
  const a = run(history(bars(36))); assert.equal(a.candidate, null); assert.equal(a.status, 'unavailable'); assert.ok(a.reasons.some(x => x.code === 'short_history'));
  const b = run(history(bars(37))); assert.equal(b.candidate, true); assert.equal(b.seriesFull[35].candidateAtClose, null); assert.equal(b.seriesFull[36].candidateAtClose, true); assert.equal(b.seriesFull[36].ema200, null);
});
test('missing taker data is null, never converted to zero or attributed to a wallet', () => {
  const b = bars(); b.at(-10).buy = null; const x = run(history(b));
  assert.equal(x.metrics.buyShare30, null); assert.equal(x.metrics.buyShare7, .6); assert.equal(x.metrics.delta30, null); assert.equal(x.candidate, null); assert.equal(x.series.at(-1).cvd, null);
  const z = run(history(bars().map(x => ({ ...x, buy: 0 })))); assert.equal(z.metrics.buyShare7, 0); assert.equal(z.candidate, false);
});
test('zero or missing volume baselines remain unavailable', () => {
  for (const value of [0, null]) {
    const b = bars(211); for (let i = b.length - 37; i < b.length - 7; i++) { b[i].quote = value; b[i].buy = value === null ? null : 0; }
    const x = run(history(b)); assert.equal(x.metrics.volumeRatio7vsPrior30, null); assert.equal(x.candidate, null);
  }
});
test('a non-taker source retains price indicators but cannot produce this screening result', () => {
  const b = bars().map(x => ({ ...x, buy: null })), h = history(b, { key: 'bitget:BTCUSDT', sourceId: 'bitget' });
  const x = run(h); assert.equal(x.candidate, null); assert.equal(x.metrics.buyShare7, null); assert.equal(x.series.at(-1).ema200, 100);
  assert.throws(() => run(history(bars(), { key: 'bitget:BTCUSDT', sourceId: 'bitget' })), /taker buy/);
});
test('stale saved history cannot become a current candidate', () => {
  const x = S.analyze(history(), { now: NOW + DAY, windowDays: 180 });
  assert.equal(x.status, 'stale'); assert.equal(x.candidate, null); assert.ok(x.criteria.every(c => c.pass));
  assert.equal(x.seriesFull.at(-1).candidateAtClose, true);
});
test('SMA20, EMA50 and EMA200 seed from complete history before display cropping', () => {
  const b = bars(401).map((x, i) => ({ ...x, open: i + 1, high: i + 2, low: i + .5, close: i + 1 }));
  const x = run(history(b), { windowDays: 180 }), y = run(history(b), { windowDays: 365 });
  assert.equal(x.seriesFull[18].sma20, null); assert.equal(x.seriesFull[19].sma20, 10.5);
  assert.equal(x.seriesFull[48].ema50, null); assert.equal(x.seriesFull[49].ema50, 25.5);
  assert.equal(x.seriesFull[198].ema200, null); assert.equal(x.seriesFull[199].ema200, 100.5);
  approx(x.seriesFull[200].ema200, 101.5);
  assert.equal(x.series.length, 180); assert.equal(y.series.length, 365); assert.equal(x.series.at(-1).ema200, y.series.at(-1).ema200);
  assert.equal(y.coverage.ema200ValidPoints, 202); assert.equal(x.coverage.ema200ValidPoints, 180);
});
test('appending later candles cannot change earlier indicators or point annotations', () => {
  const all = bars(401), original = all.slice(0, 300), cutNow = original.at(-1).end + 3600001;
  const old = S.analyze(history(original, { asOf: cutNow, fetchedAt: cutNow }), { now: cutNow, windowDays: 365 });
  const full = run(history(all), { windowDays: 365 });
  assert.deepEqual(full.seriesFull.slice(0, 300), old.seriesFull);
});
test('a volume spike cannot train its own preceding baseline', () => {
  const b = bars(211).map(x => ({ ...x, quote: 100, buy: 60 })); b.at(-1).quote = 800; b.at(-1).buy = 480;
  const x = run(history(b)); assert.equal(x.metrics.quoteMeanPrior30, 100); assert.equal(x.metrics.quoteMean7, 200); assert.equal(x.metrics.volumeRatio7vsPrior30, 2);
});
test('close drawdown is chronological peak-to-later-trough, not unordered range', () => {
  const b = bars(211); for (const q of b.slice(-30)) { q.open = 90; q.high = 150; q.low = 50; q.close = 90; }
  b.at(-30).close = 80; b.at(-20).close = 100; b.at(-10).close = 70; b.at(-1).close = 90;
  const x = run(history(b)); approx(x.metrics.maxDrawdown30, .3); assert.equal(x.metrics.range30, 2);
});
test('calendar gaps reset EMA/CVD and block screening until a new 37-day segment exists', () => {
  const b = bars(401).filter((_, i) => i !== 364), x = run(history(b), { windowDays: 365 });
  assert.equal(x.coverage.gaps.length, 1); assert.equal(x.coverage.contiguousTailDays, 36); assert.equal(x.candidate, null);
  const firstAfterGap = x.seriesFull.findIndex(z => z.time === b[364].time); assert.equal(x.seriesFull[firstAfterGap].ema200, null); assert.equal(x.seriesFull[firstAfterGap].sma20, null);
  assert.equal(x.seriesFull[firstAfterGap].cvdResetAt, x.seriesFull[firstAfterGap].time);
  assert.equal(x.series.length, 364); assert.equal(x.coverage.completeDisplayWindow, false);
});
test('invalid identities, UTC closes, duplicate days and impossible amounts are rejected', () => {
  for (const h of [history(bars(), { key: 'bitget:BTCUSDT' }), history(bars(), { quote: 'USD' }), history([...bars(), bars()[0]])]) assert.throws(() => run(h));
  for (const edit of [b => b.at(-1).end = NOW, b => b.at(-1).time++, b => b.at(-1).high = 1, b => b.at(-1).buy = 999, b => b.at(-1).quote = NaN]) {
    const b = bars(); edit(b); assert.throws(() => run(history(b)));
  }
});
test('unknown or invalid settings cannot silently change the screening meaning', () => {
  for (const criteria of [{ magicASI: 80 }, { buyShare7Min: -1 }, { return30Min: .2, return30Max: .1 }, { volumeRatioMin: NaN }, { volumeRatioMin: -2 }]) assert.throws(() => run(history(), { criteria }));
  assert.throws(() => run(history(), { windowDays: 90 }));
});
test('Unicode source-pair identifiers survive without merging ticker names', () => {
  const x = run(history(bars(), { key: 'binance:币安人生USDT', instrument: '币安人生USDT', base: '币安人生' })); assert.equal(x.key, 'binance:币安人生USDT');
});
