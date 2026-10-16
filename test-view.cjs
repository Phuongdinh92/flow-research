'use strict';
const assert = require('node:assert/strict');
const V = require('./charts-view.js');
const C = require('./charts-core.js');
const DAY = C.DAY, now = Date.now(), today = Math.floor(now / DAY) * DAY;
const row = (n, sourceId = 'binance') => ({ key: sourceId + ':COIN' + n + 'USDT', sourceId, instrument: 'COIN' + n + 'USDT', base: 'COIN' + n, quote: 'USDT', last: 100, return24: n / 100, turnover24: 1000 + n * 100, asOf: now });
const bars = Array.from({ length: 31 }, (_, i) => ({ time: today - (31 - i) * DAY, end: today - (30 - i) * DAY - 1, open: 100 + i, high: 104 + i, low: 97 + i, close: 102 + i, quote: 10000 + i * 100, buy: 5000 + i * 100 }));
const tests = [];
function test(name, run) { tests.push({ name, run }); }
function finiteSVG(svg) { assert(!/(?:NaN|Infinity|undefined)/.test(svg), svg.slice(0, 100)); assert(!/style=|<script|<style/.test(svg)); }

test('scatter plots every source-key, exact tooltips, axes and keyboard buttons', () => {
  const points = C.scatter24([row(1), row(2, 'bitget')], { now }).points;
  const svg = V.scatter(points, { kind: '24h', maxLabels: 0 });
  assert.equal((svg.match(/data-key=/g) || []).length, 2);
  assert(svg.includes('binance:COIN1USDT')); assert(svg.includes('bitget:COIN2USDT'));
  assert(svg.includes('log₁₀')); assert(svg.includes('1100 USDT')); assert(svg.includes('role="button"')); assert(svg.includes('tabindex="0"')); assert(svg.includes('venue-bitget'));
  assert(!svg.includes('class="chart-point-label"')); finiteSVG(svg);
});
test('untrusted labels and keys cannot escape SVG markup or attributes', () => {
  const evil = { ...C.scatter24([row(1)], { now }).points[0], base: '<img src=x onerror=bad()>', key: 'a" onclick="bad()' };
  const svg = V.scatter([evil]);
  assert(!svg.includes('<img')); assert(!svg.includes('data-key="a" onclick=')); assert(svg.includes('&lt;img')); assert(svg.includes('&quot; onclick=&quot;')); finiteSVG(svg);
});
test('seven-day scatter has a genuine 50% reference and descriptive units', () => {
  const points = [{ ...row(1), x: -0.1, y: 0.51 }, { ...row(2), x: 0.04, y: 0.48 }];
  const svg = V.scatter(points, { kind: '7d', width: 260 });
  assert(svg.includes('50%')); assert(svg.includes('TAKER MUA 7D')); assert(svg.includes('0.51')); assert(!svg.includes('log₁₀')); finiteSVG(svg);
});
test('seven-day tooltips do not relabel an inherited old ticker as a new history price', () => {
  const end = today - 1, fetchedAt = now - 7;
  const point = { ...row(1), x: 0.04, y: 0.51, last: 987654321, end, asOf: now, fetchedAt };
  const historical = V.scatter([point], { kind: '7d' });
  assert(!historical.includes('Giá ticker')); assert(!historical.includes('987654321'));
  assert(historical.includes('Nến ngày UTC mới nhất kết thúc: ' + new Date(end).toISOString()));
  assert(historical.includes('Lấy lịch sử lúc: ' + new Date(fetchedAt).toISOString()));
  const ticker = V.scatter([{ ...point, y: 1000 }], { kind: '24h' });
  assert(ticker.includes('Giá ticker: 987654321 USDT'));
  assert(ticker.includes('Thời điểm ticker: ' + new Date(now).toISOString()));
  assert(!ticker.includes('Lấy lịch sử lúc:')); finiteSVG(historical); finiteSVG(ticker);
});
test('constant, singleton, tiny and enormous outlier scatter values stay finite', () => {
  for (const points of [[{ ...row(1), x: 0, y: 1 }], [{ ...row(1), x: 1e308, y: Number.MAX_VALUE }, { ...row(2), x: -1, y: Number.MIN_VALUE }]]) finiteSVG(V.scatter(points, { width: 240 }));
  assert(V.scatter([{ ...row(1), x: 0, y: 0 }]).includes('không hợp lệ'));
});
test('packed bubbles stay bounded, deterministic, capped at 80 and never overlap', () => {
  const points = C.scatter24(Array.from({ length: 100 }, (_, i) => row(i, i % 2 ? 'bitget' : 'binance')), { now }).points;
  const svg = V.bubble(points, { width: 300 });
  assert.equal(svg, V.bubble([...points].reverse(), { width: 300 })); assert.equal((svg.match(/data-key=/g) || []).length, 80);
  const circles = [...svg.matchAll(/class="chart-bubble" cx="([\d.-]+)" cy="([\d.-]+)" r="([\d.-]+)"/g)].map(m => m.slice(1).map(Number));
  assert.equal(circles.length, 80);
  const viewBox = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/).slice(1).map(Number);
  assert(viewBox[1] <= 600);
  for (const [x, y, r] of circles) { assert(x - r >= -0.001 && x + r <= viewBox[0] + 0.001); assert(y - r >= -0.001 && y + r <= viewBox[1] + 0.001); }
  for (let i = 0; i < circles.length; i++) for (let j = i + 1; j < circles.length; j++) assert(Math.hypot(circles[i][0] - circles[j][0], circles[i][1] - circles[j][1]) + 0.001 >= circles[i][2] + circles[j][2]);
  assert(svg.includes('Binance')); assert(svg.includes('Bitget')); assert(svg.includes('kích thước bằng nhau')); finiteSVG(svg);
});
test('bubble areas reflect relative quote turnover, with exact values retained', () => {
  const points = [{ ...row(1), x: 0.03, y: 400 }, { ...row(2), x: -0.02, y: 100 }];
  const svg = V.bubble(points, { width: 500, sizeBy: 'turnover' });
  const radii = [...svg.matchAll(/class="chart-bubble"[^>]+r="([\d.]+)"/g)].map(m => Number(m[1]));
  assert(Math.abs(radii[0] / radii[1] - 2) < 1e-10); assert(svg.includes('400 USDT')); assert(svg.includes('chart-up')); assert(svg.includes('chart-down')); finiteSVG(svg);
});
test('an outsized-volume bubble fills useful space while tiny circles keep exact size and tooltips', () => {
  const points = [{ ...row(1), x: 0.01, y: 1e9 }, ...Array.from({ length: 39 }, (_, i) => ({ ...row(i + 2), x: -0.02, y: 1e5 + i * 1000 }))];
  const svg = V.bubble(points, { width: 1200, sizeBy: 'turnover' });
  const circles = [...svg.matchAll(/class="chart-bubble" cx="([\d.-]+)" cy="([\d.-]+)" r="([\d.-]+)"/g)].map(m => m.slice(1).map(Number));
  assert(circles[0][2] > 150); assert.equal(circles.length, 40);
  assert((svg.match(/class="chart-bubble-label"/g) || []).length < 40);
  assert.equal((svg.match(/data-key=/g) || []).length, 40);
  assert(svg.includes('100000 USDT')); assert(svg.includes('class="chart-bubble-source"'));
  assert(Math.abs((circles[0][2] / circles.at(-1)[2]) ** 2 - 1e9 / 1e5) < 1e-5);
  finiteSVG(svg);
});
test('equal-size mode gives every desktop bubble readable coin, venue and return labels', () => {
  const points = C.scatter24(Array.from({ length: 80 }, (_, i) => ({ ...row(i), turnover24: i === 0 ? 1e12 : i + 1 })), { now }).points;
  const svg = V.bubble(points, { width: 1200 });
  const radii = [...svg.matchAll(/class="chart-bubble"[^>]* r="([^\"]+)"/g)].map(m => Number(m[1]));
  assert.equal(radii.length, 80); assert(radii.every(r => r === radii[0]));
  assert.equal((svg.match(/class="chart-bubble-label"/g) || []).length, 80);
  assert.equal((svg.match(/class="chart-bubble-source"/g) || []).length, 80);
  assert.equal((svg.match(/class="chart-bubble-change"/g) || []).length, 80);
  assert(svg.includes('diện tích không biểu thị khối lượng hay vốn hóa')); finiteSVG(svg);
});
test('friendly new-source names and longer return windows keep source keys and correct time meaning', () => {
  const point = { ...row(1), sourceId: 'new_venue', sourceName: 'New Market <Spot>', key: 'new_venue:COIN1USDT', x: 0.3, y: 12345, windowLabel: '30 ngày', reference: 'closed_daily', close: 99, end: today - 1, fetchedAt: now - 7, last: 99999 };
  const bubbles = V.bubble([point], { windowLabel: '30 ngày' });
  const scatter = V.scatter([point], { windowLabel: '30 ngày' });
  for (const svg of [bubbles, scatter]) { assert(svg.includes('New Market &lt;Spot&gt;')); assert(svg.includes('new_venue:COIN1USDT')); assert(svg.includes('Giá 30 ngày:')); assert(svg.includes('GD 24H: 12345 USDT')); assert(!svg.includes('Giá ticker')); assert(svg.includes('Giá đóng cửa: 99 USDT')); finiteSVG(svg); }
  assert(scatter.includes('BIẾN ĐỘNG GIÁ 30 NGÀY'));
});
test('global USD bubbles retain the exact provider identity and never relabel USD as USDT', () => {
  const point = { key: 'coingecko:bitcoin', sourceId: 'coingecko', sourceName: 'CoinGecko', instrument: 'bitcoin', base: 'BTC', quote: 'USD', x: 0.03, y: 12345, last: 70000, asOf: now };
  for (const sizeBy of ['equal', 'turnover']) {
    const svg = V.bubble([point], { sizeBy });
    assert(svg.includes('coingecko:bitcoin')); assert(svg.includes('CoinGecko'));
    assert(svg.includes('GD 24H: 12345 USD')); assert(svg.includes('Giá tổng hợp: 70000 USD')); assert(!svg.includes('USDT')); finiteSVG(svg);
  }
});
test('OHLC candles preserve true wick/body values and independent volume pane', () => {
  const series = C.summaryDaily(bars, now, { now }).series;
  const svg = V.daily(series, { mode: 'price', width: 300 });
  assert.equal((svg.match(/class="chart-candle /g) || []).length, 30);
  assert.equal((svg.match(/class="chart-wick"/g) || []).length, 30);
  assert.equal((svg.match(/class="chart-volume"/g) || []).length, 30);
  assert(svg.includes('Open: 101 USDT')); assert(svg.includes('High: 105 USDT')); assert(svg.includes('Low: 98 USDT')); assert(svg.includes('Close: 103 USDT')); assert(svg.includes('GD NGÀY')); assert(svg.includes(new Date(bars.at(-1).end).toISOString().slice(0, 10))); finiteSVG(svg);
});
test('delta uses distinct price axis and CVD explicitly resets at window start', () => {
  const summary = C.summaryDaily(bars, now, { now });
  const delta = V.daily(summary.series, { mode: 'delta' }), cvd = V.daily(summary, { mode: 'cvd' });
  assert.equal((delta.match(/class="chart-delta /g) || []).length, 30); assert(delta.includes('chart-price-overlay')); assert(delta.includes('TAKER DELTA · USDT')); assert(delta.includes('GIÁ · USDT'));
  assert(cvd.includes('RESET ĐẦU CỬA SỔ')); assert(cvd.includes('đặt lại 0')); assert(cvd.includes('CVD từ đầu cửa sổ: ' + summary.series.at(-1).cvd)); finiteSVG(delta); finiteSVG(cvd);
});
test('missing taker data produces explicit text rather than invented zero curves', () => {
  const series = C.summaryDaily(bars.map(b => ({ ...b, buy: null })), now, { now }).series;
  for (const mode of ['delta', 'cvd']) { const html = V.daily(series, { mode }); assert(html.includes('không thay dữ liệu thiếu bằng 0')); assert(!html.includes('<svg')); }
  assert(V.daily(series, { mode: 'price' }).includes('<svg'));
});
test('one constant candle and extreme OHLC values remain renderable at narrow widths', () => {
  const b = { ...bars[0], open: 100, high: 100, low: 100, close: 100, quote: 0, buy: 0, sell: 0, delta: 0, cvd: 0 };
  for (const mode of ['price', 'delta', 'cvd']) finiteSVG(V.daily([b], { mode, width: 1 }));
  finiteSVG(V.daily([{ ...b, open: 1e308, high: Number.MAX_VALUE, low: 1, close: 1e308, quote: Number.MAX_VALUE }], { mode: 'price' }));
  assert(V.daily([{ ...b, high: 1 }]).includes('không hợp lệ'));
});
test('weekly and calendar-month candles use actual spans, correct volume units and UTC labels', () => {
  const weekly = { ...bars[0], time: Date.UTC(2026, 8, 7), end: Date.UTC(2026, 8, 14) - 1, buy: 6000, sell: 4000, delta: 2000, cvd: 2000 };
  const monthly = { ...weekly, time: Date.UTC(2026, 8, 1), end: Date.UTC(2026, 9, 1) - 1 };
  for (const [interval, b, unit] of [['1w', weekly, 'TUẦN'], ['1M', monthly, 'THÁNG']]) {
    const price = V.daily([b], { interval, mode: 'price', width: 360 });
    assert(price.includes('GD ' + unit + ' · USDT')); assert(price.includes(unit + ' UTC'));
    assert(price.includes(new Date(b.time).toISOString().slice(0, 10) + ' đến ' + new Date(b.end).toISOString().slice(0, 10)));
    assert(!price.includes('GD NGÀY')); assert.equal((price.match(/class="chart-wick"/g) || []).length, 1);
    for (const mode of ['price', 'delta', 'cvd']) finiteSVG(V.daily([b], { interval, mode, width: 300 }));
  }
  assert(V.daily([weekly], { interval: 'bad' }).includes('Khung nến không được hỗ trợ'));
});
test('optional daily averages share the price axis, respect missing warmup and never bridge gaps', () => {
  const series = bars.slice(0, 4).map((b, i) => ({ ...b, sma20: [200, null, 200, 300][i], ema50: i === 0 ? b.close : null }));
  const svg = V.daily(series, { mode: 'price', width: 960 });
  const path = svg.match(/<path class="chart-sma20" d="([^\"]+)"/)[1];
  assert.equal((path.match(/M/g) || []).length, 2); assert.equal((path.match(/L/g) || []).length, 1);
  const samples = [...svg.matchAll(/class="chart-sma20 chart-indicator-sample" cx="([\d.-]+)" cy="([\d.-]+)"/g)].map(m => m.slice(1).map(Number));
  assert.equal(samples.length, 3); assert(samples.every(([, y]) => y >= 40 && y <= 270));
  assert(svg.includes('SMA20 ngày: 300 USDT')); assert(svg.includes('SMA20 ngày')); assert(svg.includes('EMA50 ngày'));
  const body = svg.match(/class="chart-candle-body" x="([\d.-]+)" y="([\d.-]+)"/);
  const ema = svg.match(/class="chart-ema50 chart-indicator-sample" cx="([\d.-]+)" cy="([\d.-]+)"/);
  assert.equal(Number(body[2]), Number(ema[2])); // First close > open: EMA equal to close shares body's top pixel.
  const noWarmup = V.daily(series.map(b => ({ ...b, sma20: null, ema50: null })), { mode: 'price' });
  assert(!noWarmup.includes('chart-sma20')); assert(!noWarmup.includes('chart-ema50'));
  const skippedDay = V.daily([series[0], series[2]], { mode: 'price' }).match(/<path class="chart-sma20" d="([^\"]+)"/)[1];
  assert.equal((skippedDay.match(/M/g) || []).length, 2); assert(!skippedDay.includes('L'));
  assert(!V.daily(series, { mode: 'delta' }).includes('chart-sma20')); finiteSVG(svg);
});

for (const t of tests) { t.run(); console.log('ok - ' + t.name); }
console.log(tests.length + ' meaningful chart view tests passed');
