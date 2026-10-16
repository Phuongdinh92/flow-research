/* Independent descriptive CEX measurements. No A1 scores, whale attribution or validated forecast. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.FlowSignals = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const DAY = 86400000, REQUIRED_DAYS = 37;
  const LABEL = 'Áp lực mua đáng theo dõi · chưa xác nhận ví';
  const SOURCES = ['binance', 'bitget', 'gate', 'whitebit'];
  const DEFAULT_CRITERIA = Object.freeze({ buyShare7Min: 0.52, buyShare30Min: 0.50, return30Min: -0.30, return30Max: 0.15, volumeRatioMin: 1.10 });
  const fail = (code, message) => { const e = Error(message); e.code = code; throw e; };
  function numeric(x, name) { if (typeof x !== 'number' || !Number.isFinite(x)) fail('number', (name || 'Số') + ' không hợp lệ'); return x; }
  function stamp(x) { numeric(x, 'Timestamp'); if (!Number.isInteger(x) || x < 946684800000 || x >= 4102444800000) fail('timestamp', 'Cần timestamp millisecond hợp lệ'); return x; }
  function sum(rows, key) {
    if (rows.some(x => x[key] === null)) return null;
    const s = rows.reduce((n, x) => n + x[key], 0);
    return Number.isFinite(s) ? s : null;
  }
  function config(input) {
    if (input !== undefined && (!input || typeof input !== 'object' || Array.isArray(input))) fail('config', 'Điều kiện lọc không hợp lệ');
    for (const key of Object.keys(input || {})) if (!Object.hasOwn(DEFAULT_CRITERIA, key)) fail('config', 'Điều kiện chưa hỗ trợ: ' + key);
    const c = Object.assign({}, DEFAULT_CRITERIA, input);
    for (const [k, v] of Object.entries(c)) numeric(v, k);
    if (c.buyShare7Min < 0 || c.buyShare7Min > 1 || c.buyShare30Min < 0 || c.buyShare30Min > 1 || c.return30Min < -1 || c.return30Max < c.return30Min || c.volumeRatioMin < 0) fail('config', 'Ngưỡng lọc ngoài phạm vi hợp lệ');
    return c;
  }
  function identity(h) {
    if (!h || !SOURCES.includes(h.sourceId) || typeof h.instrument !== 'string' || !/^[\p{L}\p{N}_.-]{1,80}$/u.test(h.instrument) || h.key !== h.sourceId + ':' + h.instrument || h.quote !== 'USDT' || typeof h.base !== 'string' || !h.base) fail('identity', 'Định danh cặp/sàn không hợp lệ');
    return { key: h.key, sourceId: h.sourceId, instrument: h.instrument, base: h.base, quote: h.quote };
  }
  function validatedBars(h, now) {
    stamp(h.asOf); stamp(h.fetchedAt);
    if (h.asOf > now + 60000 || h.fetchedAt > now + 60000) fail('future_source', 'Thời gian nguồn nằm trong tương lai');
    if (!Array.isArray(h.bars) || !h.bars.length) fail('empty_history', 'Chưa có nến ngày');
    const bars = h.bars.map(b => {
      if (!b || typeof b !== 'object') fail('bar', 'Nến không hợp lệ');
      stamp(b.time); stamp(b.end);
      if (b.time % DAY || b.end !== b.time + DAY - 1 || b.end >= Math.min(h.asOf, now)) fail('utc_bar', 'Nến phải là ngày UTC đã đóng');
      for (const key of ['open', 'high', 'low', 'close']) numeric(b[key], key);
      if (Math.min(b.open, b.high, b.low, b.close) <= 0 || b.high < Math.max(b.open, b.low, b.close) || b.low > Math.min(b.open, b.high, b.close)) fail('ohlc', 'OHLC mâu thuẫn');
      let quote = null, buy = null;
      if (b.quote !== null && b.quote !== undefined) { numeric(b.quote, 'Quote volume'); if (b.quote < 0) fail('quote', 'Quote volume âm'); quote = b.quote; }
      if (b.buy !== null && b.buy !== undefined) {
        numeric(b.buy, 'Taker buy quote');
        if (h.sourceId !== 'binance') fail('source_taker', 'Nguồn này chưa có taker buy đã kiểm chứng');
        if (b.buy < 0 || quote === null || b.buy > quote * (1 + 1e-9)) fail('buy', 'Taker buy hoặc đơn vị quote không hợp lệ');
        buy = Math.min(b.buy, quote);
      }
      return { time: b.time, end: b.end, open: b.open, high: b.high, low: b.low, close: b.close, quote, buy };
    }).sort((a, b) => a.time - b.time);
    for (let i = 1; i < bars.length; i++) if (bars[i].time === bars[i - 1].time) fail('duplicate_day', 'Trùng ngày UTC');
    return bars;
  }
  function measures(segment) {
    const n = segment.length, last = segment.at(-1);
    const tail = days => n >= days ? segment.slice(-days) : null;
    function flow(days) {
      const rows = tail(days);
      if (!rows) return { quote: null, buy: null, delta: null, buyShare: null };
      const q = sum(rows, 'quote'), b = sum(rows, 'buy');
      return { quote: q, buy: b, delta: q !== null && b !== null ? 2 * b - q : null, buyShare: q !== null && b !== null && q > 0 ? b / q : null };
    }
    const f7 = flow(7), f30 = flow(30), recent = tail(7), prior = n >= 37 ? segment.slice(n - 37, n - 7) : null;
    const priorTotal = prior ? sum(prior, 'quote') : null;
    const quoteMean7 = f7.quote === null ? null : f7.quote / 7;
    const quoteMeanPrior30 = priorTotal === null ? null : priorTotal / 30;
    const ratio = quoteMean7 !== null && quoteMeanPrior30 !== null && quoteMeanPrior30 > 0 ? quoteMean7 / quoteMeanPrior30 : null;
    const thirty = tail(30);
    let maxDrawdown30 = null, range30 = null;
    if (thirty) {
      let peak = thirty[0].close, loss = 0;
      for (const b of thirty) { peak = Math.max(peak, b.close); loss = Math.max(loss, 1 - b.close / peak); }
      maxDrawdown30 = loss;
      range30 = Math.max(...thirty.map(x => x.high)) / Math.min(...thirty.map(x => x.low)) - 1;
    }
    return {
      end: last.end, close: last.close, close7: n >= 8 ? segment[n - 8].close : null, close30: n >= 31 ? segment[n - 31].close : null,
      return7: n >= 8 ? last.close / segment[n - 8].close - 1 : null,
      return30: n >= 31 ? last.close / segment[n - 31].close - 1 : null,
      quote7: f7.quote, quote30: f30.quote, buyQuote7: f7.buy, buyQuote30: f30.buy,
      buyShare7: f7.buyShare, buyShare30: f30.buyShare, delta7: f7.delta, delta30: f30.delta, cvd7: f7.delta, cvd30: f30.delta,
      quoteMean7, quoteMeanPrior30, volumeRatio7vsPrior30: Number.isFinite(ratio) ? ratio : null,
      maxDrawdown30, range30,
      volumeWindows: prior && recent ? { recentDays: 7, recentFrom: recent[0].time, recentTo: recent.at(-1).end, priorDays: 30, priorFrom: prior[0].time, priorTo: prior.at(-1).end, overlapDays: 0 } : null
    };
  }
  function evaluate(m, c) {
    const checks = [
      ['buyShare7', 'Tỷ trọng mua chủ động 7 ngày', '>', c.buyShare7Min, m.buyShare7, 'fraction'],
      ['buyShare30', 'Tỷ trọng mua chủ động 30 ngày', '>', c.buyShare30Min, m.buyShare30, 'fraction'],
      ['return30Min', 'Biến động 30 ngày tối thiểu', '>=', c.return30Min, m.return30, 'fraction'],
      ['return30Max', 'Biến động 30 ngày tối đa', '<=', c.return30Max, m.return30, 'fraction'],
      ['volumeRatio', 'Volume/ngày 7 ngày so với 30 ngày trước đó', '>=', c.volumeRatioMin, m.volumeRatio7vsPrior30, 'ratio']
    ];
    return checks.map(([id, label, operator, threshold, value, unit]) => ({ id, label, operator, threshold, value, unit, pass: value === null ? null : operator === '>' ? value > threshold : operator === '>=' ? value >= threshold : value <= threshold }));
  }
  function analyze(history, options = {}) {
    const now = options.now === undefined ? Date.now() : options.now;
    stamp(now); const id = identity(history), c = config(options.criteria), windowDays = options.windowDays === undefined ? 180 : options.windowDays;
    if (![180, 365].includes(windowDays)) fail('window', 'Cửa sổ phải là 180 hoặc 365 ngày');
    const all = validatedBars(history, now), seriesFull = [], gaps = [];
    let segment = [], cvd = 0, cvdKnown = true, cvdResetAt = all[0].time;
    const ema = { 50: null, 200: null };
    for (let i = 0; i < all.length; i++) {
      const b = all[i];
      if (i > 0 && b.time !== all[i - 1].end + 1) {
        gaps.push({ after: all[i - 1].end, before: b.time, missingDays: Math.round((b.time - all[i - 1].time) / DAY) - 1 });
        segment = []; ema[50] = null; ema[200] = null; cvd = 0; cvdKnown = true; cvdResetAt = b.time;
      }
      segment.push(b); const n = segment.length;
      for (const p of [50, 200]) {
        if (n === p) ema[p] = segment.slice(-p).reduce((s, x) => s + x.close, 0) / p;
        else if (n > p) ema[p] += 2 / (p + 1) * (b.close - ema[p]);
      }
      const sma20 = n >= 20 ? segment.slice(-20).reduce((s, x) => s + x.close, 0) / 20 : null;
      const sell = b.buy !== null && b.quote !== null ? b.quote - b.buy : null;
      const delta = sell === null ? null : b.buy - sell;
      if (delta === null) cvdKnown = false;
      if (cvdKnown) { cvd += delta; if (!Number.isFinite(cvd)) cvdKnown = false; }
      const metrics = measures(segment), checks = evaluate(metrics, c);
      const enough = n >= REQUIRED_DAYS, available = checks.every(x => x.pass !== null);
      seriesFull.push(Object.assign({}, b, { sell, delta, cvd: cvdKnown ? cvd : null, cvdResetAt, sma20, ema50: ema[50], ema200: ema[200],
        return7: metrics.return7, return30: metrics.return30, buyShare7: metrics.buyShare7, buyShare30: metrics.buyShare30,
        volumeRatio7vsPrior30: metrics.volumeRatio7vsPrior30,
        volumeExpansionAtClose: metrics.volumeRatio7vsPrior30 === null ? null : metrics.volumeRatio7vsPrior30 >= c.volumeRatioMin,
        candidateAtClose: enough && available ? checks.every(x => x.pass) : null,
        contiguousDays: n }));
    }
    const metrics = measures(segment), criteria = evaluate(metrics, c), latest = all.at(-1), latestExpectedEnd = Math.floor(now / DAY) * DAY - 1;
    metrics.cvd = seriesFull.at(-1).cvd; metrics.cvdResetAt = cvdResetAt;
    const current = latest.end === latestExpectedEnd, enough = segment.length >= REQUIRED_DAYS, hasInputs = criteria.every(x => x.pass !== null);
    const candidate = current && enough && hasInputs ? criteria.every(x => x.pass) : null;
    const reasons = [];
    if (!current) reasons.push({ code: 'stale_history', message: 'Thiếu ngày UTC vừa đóng; chỉ xem mô tả lịch sử' });
    if (!enough) reasons.push({ code: 'short_history', message: 'Cần ít nhất 37 ngày UTC liên tục đã đóng' });
    if (!hasInputs) reasons.push({ code: 'missing_inputs', message: 'Thiếu taker buy hoặc quote volume/volume nền hợp lệ; không suy thành 0' });
    const displayStart = latest.end + 1 - windowDays * DAY;
    const series = seriesFull.filter(x => x.time >= displayStart);
    return { ...id, metrics, criteria, config: c, candidate, status: !current ? 'stale' : !enough || !hasInputs ? 'unavailable' : candidate ? 'candidate' : 'no_match',
      label: candidate ? LABEL : candidate === false ? 'Chưa đạt bộ lọc áp lực mua · chưa xác nhận ví' : 'Chưa đủ dữ liệu hiện hành để lọc · chưa xác nhận ví',
      series, seriesFull, reasons, asOf: history.asOf, fetchedAt: history.fetchedAt, now,
      coverage: { availableDays: all.length, contiguousTailDays: segment.length, requiredDays: REQUIRED_DAYS, latestEnd: latest.end, latestExpectedEnd, current,
        gaps, requestedDays: windowDays, displayedDays: series.length, completeDisplayWindow: series.length === windowDays,
        from: series[0].time, to: series.at(-1).end, ema200ValidPoints: series.filter(x => x.ema200 !== null).length, cvdResetAt },
      methodology: { classification: 'independent_descriptive_filter', requiredDays: REQUIRED_DAYS,
        volumeRatio: 'mean quote volume of last 7 completed days / mean quote volume of immediately preceding 30 completed days; windows never overlap',
        buyShare: 'sum(taker-buy quote) / sum(total quote), weighted by quote volume; never a mean of daily percentages',
        delta: '2 × taker-buy quote − total quote; not wallet inflow or new capital',
        cvd: 'Cumulative taker delta from the first bar of each continuous segment; any missing taker input keeps this segment CVD unknown',
        movingAverages: 'SMA20; EMA50/EMA200 seed with first 50/200 closes of each continuous segment, then alpha=2/(period+1); computed before display slicing',
        drawdown: 'Maximum peak-to-later-trough loss among the last 30 daily CLOSES; range30 uses daily highs and lows separately',
        annotations: 'Each point uses only that completed daily candle and earlier candles; no subsequent prices or volumes',
        limitation: 'Descriptive research conditions, not validated predictions, A1Radar scores, wallet attribution or proof of whale accumulation' } };
  }
  return Object.freeze({ DAY, REQUIRED_DAYS, DEFAULT_CRITERIA, LABEL, analyze });
});
