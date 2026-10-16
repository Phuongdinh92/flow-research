/* Source-preserving descriptive chart transforms. No signals or wallet attribution. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.FlowCharts = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const DAY = 86400000, TTL = 900000;
  const SOURCES = ['binance', 'bitget'];
  function num(v, name) { if (typeof v !== 'number' || !Number.isFinite(v)) throw Error((name || 'Số') + ' không hợp lệ'); return v; }
  function stamp(v) { num(v, 'Timestamp'); if (!Number.isInteger(v) || v < 946684800000 || v >= 4102444800000) throw Error('Timestamp millisecond không hợp lệ'); return v; }
  function fail(code, message) { const e = Error(message); e.code = code; throw e; }
  function rowIdentity(r) {
    if (!r || !SOURCES.includes(r.sourceId) || typeof r.instrument !== 'string' || !/^[\p{L}\p{N}_.-]{1,80}$/u.test(r.instrument) || r.quote !== 'USDT' || r.key !== r.sourceId + ':' + r.instrument) fail('identity', 'Định danh cặp/sàn không hợp lệ');
  }
  function exclusion(r, code, reason) { return { key: r && typeof r.key === 'string' ? r.key : null, sourceId: r && r.sourceId || null, instrument: r && r.instrument || null, code, reason }; }
  function duplicates(rows) { const seen = new Set(), repeated = new Set(); for (const r of rows) { if (r && typeof r.key === 'string') { if (seen.has(r.key)) repeated.add(r.key); seen.add(r.key); } } return repeated; }
  function coverage(rows, points, excluded) {
    const reasons = {}, sources = {};
    for (const s of SOURCES) sources[s] = { input: rows.filter(r => r && r.sourceId === s).length, used: points.filter(p => p.sourceId === s).length, excluded: excluded.filter(e => e.sourceId === s).length };
    for (const e of excluded) reasons[e.code] = (reasons[e.code] || 0) + 1;
    const stamps = points.map(p => p.asOf);
    return { input: rows.length, used: points.length, excluded: excluded.length, reasons, sources, asOfMin: stamps.length ? Math.min(...stamps) : null, asOfMax: stamps.length ? Math.max(...stamps) : null };
  }
  function scatter24(rows, { now = Date.now() } = {}) {
    stamp(now); if (!Array.isArray(rows)) throw Error('Cần danh sách cặp/sàn');
    const points = [], excluded = [], repeated = duplicates(rows);
    for (const r of rows) {
      try {
        rowIdentity(r); if (repeated.has(r.key)) fail('duplicate', 'Cặp/sàn bị trùng');
        num(r.last, 'Giá'); num(r.return24, 'Biến động'); num(r.turnover24, 'Quote turnover'); stamp(r.asOf);
        if (r.last <= 0 || r.return24 < -1 || r.turnover24 < 0) fail('values', 'Giá, biến động hoặc quote turnover sai');
        if (now - r.asOf > TTL) fail('stale', 'Ticker quá 15 phút');
        if (r.asOf - now > 60000) fail('future', 'Ticker nằm trong tương lai');
        if (r.turnover24 === 0) fail('zero_turnover', 'Quote turnover bằng 0, không đặt trên trục log');
        points.push({ ...r, x: r.return24, y: r.turnover24 });
      } catch (e) { excluded.push(exclusion(r, e.code || 'invalid', e.message)); }
    }
    return { points, excluded, coverage: coverage(rows, points, excluded), xUnit: 'fraction', yUnit: 'USDT', yScale: 'log', now };
  }
  function validatedBars(bars, asOf) {
    if (!Array.isArray(bars) || !bars.length) fail('empty_history', 'Chưa có nến ngày đã đóng');
    const sorted = bars.map(b => {
      if (!b || typeof b !== 'object') fail('bar', 'Nến sai định dạng');
      stamp(b.time); stamp(b.end);
      if (b.time % DAY || b.end !== b.time + DAY - 1 || b.end >= asOf) fail('utc_bar', 'Nến sai ngày UTC hoặc chưa đóng');
      for (const k of ['open', 'high', 'low', 'close', 'quote']) num(b[k], k);
      if (Math.min(b.open, b.high, b.low, b.close) <= 0 || b.quote < 0 || b.high < Math.max(b.open, b.close, b.low) || b.low > Math.min(b.open, b.close, b.high)) fail('bar_values', 'Giá hoặc quote volume của nến không hợp lệ');
      let buy = null;
      if (b.buy !== null && b.buy !== undefined) {
        num(b.buy, 'Taker buy quote');
        if (b.buy < 0 || b.buy > b.quote * (1 + 1e-9)) fail('buy_volume', 'Taker buy vượt quote volume hoặc âm');
        buy = Math.min(b.buy, b.quote); // Permit only the upstream parser's rounding tolerance.
      }
      return { time: b.time, end: b.end, open: b.open, high: b.high, low: b.low, close: b.close, quote: b.quote, buy };
    }).sort((a, b) => a.time - b.time);
    for (let i = 1; i < sorted.length; i++) if (sorted[i].time === sorted[i - 1].time) fail('duplicate_day', 'Nến ngày bị trùng');
    return sorted;
  }
  function summaryDaily(bars, asOf, { window = 30, now = Date.now() } = {}) {
    stamp(now); stamp(asOf);
    if (![30, 90, 120].includes(window)) throw Error('Cửa sổ phải là 30, 90 hoặc 120 ngày');
    if (asOf - now > TTL) fail('future_history', 'Thời gian nguồn lịch sử nằm trong tương lai');
    const all = validatedBars(bars, asOf), selected = all.slice(-window), last = all.at(-1);
    for (let i = 1; i < selected.length; i++) if (selected[i].time - selected[i - 1].time !== DAY) fail('gap', 'Thiếu ngày UTC trong cửa sổ biểu đồ');
    const latestExpectedEnd = Math.floor(now / DAY) * DAY - 1, current = last.end === latestExpectedEnd;
    let cvd = 0, cvdKnown = true;
    const series = selected.map(b => {
      const sell = b.buy === null ? null : b.quote - b.buy, delta = b.buy === null ? null : b.buy - sell;
      if (delta === null) cvdKnown = false;
      if (cvdKnown) cvd += delta;
      return { ...b, sell, delta, cvd: cvdKnown ? cvd : null };
    });
    function tail(n) {
      if (all.length < n) return null;
      const t = all.slice(-n); for (let i = 1; i < t.length; i++) if (t[i].time - t[i - 1].time !== DAY) return null; return t;
    }
    function change(days) { const t = tail(days + 1); return t ? t.at(-1).close / t[0].close - 1 : null; }
    const seven = tail(7), twenty = tail(20), quote7 = seven ? seven.reduce((s, b) => s + b.quote, 0) : null;
    const hasBuy7 = !!seven && seven.every(b => b.buy !== null);
    const buyShare7 = hasBuy7 && quote7 > 0 ? seven.reduce((s, b) => s + b.buy, 0) / quote7 : null;
    const hasTaker = series.every(b => b.buy !== null), total = k => series.reduce((s, b) => s + b[k], 0);
    const taker = hasTaker ? { buy: total('buy'), sell: total('sell'), delta: total('delta'), cvd: series.at(-1).cvd } : null;
    const turnover20 = twenty ? twenty.reduce((s, b) => s + b.quote, 0) / 20 : null;
    return {
      series, bars: series, return7: change(7), return30: change(30), turnover20, turnover: turnover20,
      buyShare7, buyShare: buyShare7, taker, current, stale: !current, asOf, now, latestEnd: last.end, end: last.end,
      coverage: { availableDays: all.length, days: series.length, requestedDays: window, completeWindow: series.length === window, from: series[0].time, to: last.end, latestExpectedEnd, current, hasTaker, takerDays: series.filter(b => b.buy !== null).length, cvdResetAt: series[0].time, return7Days: tail(8) ? 8 : null, return30Days: tail(31) ? 31 : null }
    };
  }
  function scatter7(historiesByKey, rows, { now = Date.now() } = {}) {
    stamp(now); if (!Array.isArray(rows)) throw Error('Cần danh sách cặp/sàn');
    const points = [], excluded = [], repeated = duplicates(rows);
    const get = key => historiesByKey instanceof Map ? historiesByKey.get(key) : historiesByKey && Object.prototype.hasOwnProperty.call(historiesByKey, key) ? historiesByKey[key] : null;
    for (const r of rows) {
      try {
        rowIdentity(r); if (repeated.has(r.key)) fail('duplicate', 'Cặp/sàn bị trùng');
        if (r.sourceId !== 'binance') fail('source_no_taker', 'Nguồn nến này không cung cấp taker buy quote');
        const h = get(r.key); if (!h) fail('missing_history', 'Chưa đọc lịch sử của đúng cặp/sàn');
        stamp(h.asOf); stamp(h.fetchedAt); if (h.fetchedAt - now > TTL) fail('future_history', 'Thời điểm lấy lịch sử nằm trong tương lai');
        if (!Array.isArray(h.bars) || h.bars.length < 8) fail('short_history', 'Chưa đủ 8 nến ngày cho biến động 7 ngày');
        const d = summaryDaily(h.bars.slice(-8), h.asOf, { window: 30, now });
        if (!d.current) fail('stale_history', 'Thiếu ngày UTC đã đóng mới nhất theo thời gian hiện tại');
        if (d.return7 === null) fail('gap', 'Thiếu ngày trong chuỗi 7 ngày');
        if (d.buyShare7 === null) fail(d.coverage.takerDays === 0 ? 'taker_unavailable' : 'zero_or_missing_taker', 'Thiếu taker buy quote hoặc tổng quote 7 ngày bằng 0');
        points.push({ ...r, x: d.return7, y: d.buyShare7, return7: d.return7, buyShare7: d.buyShare7, asOf: h.asOf, fetchedAt: h.fetchedAt, end: d.latestEnd });
      } catch (e) { excluded.push(exclusion(r, e.code || 'invalid', e.message)); }
    }
    return { points, excluded, coverage: coverage(rows, points, excluded), xUnit: 'fraction', yUnit: 'fraction', now };
  }
  function summaryProvenance(value, instrument) {
    if (!value || typeof value.url !== 'string' || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(value.sha256)) fail('provenance', 'Thiếu URL hoặc SHA-256 nguồn');
    let url; try { url = new URL(value.url); } catch (_) { fail('provenance', 'URL nguồn không hợp lệ'); }
    if (url.origin !== 'https://data-api.binance.vision' || url.pathname !== '/api/v3/klines' || url.username || url.password || url.hash) fail('provenance', 'URL không phải endpoint klines công khai được phép');
    if (url.searchParams.getAll('symbol').length !== 1 || url.searchParams.get('symbol') !== instrument || url.searchParams.getAll('interval').length !== 1 || url.searchParams.get('interval') !== '1d') fail('provenance', 'URL không khớp cặp hoặc nến ngày');
    if (url.searchParams.has('timeZone') && url.searchParams.get('timeZone') !== '0') fail('provenance', 'Nguồn không dùng ngày UTC');
    return { url: value.url, sha256: value.sha256 };
  }
  function scatter7Summary(snapshot, rows, { now = Date.now() } = {}) {
    stamp(now); if (!Array.isArray(rows)) throw Error('Cần danh sách cặp/sàn');
    if (!snapshot || snapshot.schemaVersion !== 1 || snapshot.sourceId !== 'binance' || !Array.isArray(snapshot.records) || !Array.isArray(snapshot.errors)) fail('summary_schema', 'Bản lưu lịch sử sai định dạng');
    stamp(snapshot.generatedAt); stamp(snapshot.asOf);
    if (snapshot.generatedAt > now || snapshot.asOf > now + TTL) fail('future_summary', 'Bản lưu lịch sử có thời gian tương lai');
    if (!Number.isInteger(snapshot.eligibleInstrumentCount) || !Number.isInteger(snapshot.attemptedCount) || snapshot.eligibleInstrumentCount < 0 || snapshot.attemptedCount < 0 || snapshot.attemptedCount > snapshot.eligibleInstrumentCount || snapshot.records.length > snapshot.attemptedCount) fail('summary_counts', 'Số cặp hoặc số lần đọc trong bản lưu không hợp lệ');
    const index = new Map(), repeatedRecords = new Set(), repeatedRows = duplicates(rows), rowKeys = new Set(rows.filter(r => r && typeof r.key === 'string').map(r => r.key));
    const points = [], excluded = [], recordIssues = [], latestExpectedEnd = Math.floor(now / DAY) * DAY - 1;
    for (const record of snapshot.records) {
      if (!record || typeof record.key !== 'string') { recordIssues.push(exclusion(record, 'record_identity', 'Bản ghi thiếu định danh cặp/sàn')); continue; }
      if (index.has(record.key)) repeatedRecords.add(record.key);
      index.set(record.key, record);
      if (!rowKeys.has(record.key)) recordIssues.push(exclusion(record, 'orphan_record', 'Bản ghi không có cặp/sàn tương ứng trong danh mục hiện tại'));
    }
    function matchNumber(actual, derived) { return Math.abs(actual - derived) <= 1e-9 * Math.max(1, Math.abs(derived)); }
    for (const row of rows) {
      try {
        rowIdentity(row); if (repeatedRows.has(row.key)) fail('duplicate', 'Cặp/sàn hiện tại bị trùng');
        if (row.sourceId !== 'binance') fail('source_no_taker', 'Nguồn nến này không cung cấp taker buy quote');
        if (repeatedRecords.has(row.key)) fail('duplicate_record', 'Bản lưu có nhiều bản ghi cho cùng cặp/sàn');
        const r = index.get(row.key); if (!r) fail('missing_summary', 'Chưa có bản ghi lịch sử cho đúng cặp/sàn');
        rowIdentity(r);
        if (r.sourceId !== row.sourceId || r.instrument !== row.instrument || r.base !== row.base || r.quote !== row.quote) fail('record_identity', 'Bản ghi không khớp định danh cặp/sàn hiện tại');
        stamp(r.asOf); stamp(r.fetchedAt); stamp(r.end); stamp(r.firstTime);
        if (r.fetchedAt > now || r.fetchedAt > snapshot.generatedAt || r.asOf > now + TTL) fail('future_record', 'Bản ghi có thời điểm lấy dữ liệu tương lai');
        if (r.asOf !== snapshot.asOf) fail('record_asof', 'Thời gian nguồn của bản ghi không khớp bản lưu');
        if (r.end !== latestExpectedEnd) fail('stale_summary', 'Bản ghi thiếu ngày UTC đã đóng mới nhất theo thời gian hiện tại');
        if (r.end >= r.asOf || r.days !== 31 || r.firstTime !== r.end + 1 - 31 * DAY || r.firstTime % DAY) fail('summary_window', 'Bản ghi không mô tả đúng 31 ngày UTC đã đóng');
        for (const k of ['close', 'close7', 'quote7', 'buyQuote7', 'return7', 'return30', 'buyShare7', 'turnover20']) num(r[k], k);
        if (r.close <= 0 || r.close7 <= 0 || r.quote7 <= 0 || r.buyQuote7 < 0 || r.buyQuote7 > r.quote7 || r.turnover20 < 0 || r.return30 < -1) fail('summary_values', 'Giá, quote volume hoặc taker buy trong bản ghi không hợp lệ');
        if (r.lastClose !== undefined && (typeof r.lastClose !== 'number' || !Number.isFinite(r.lastClose) || !matchNumber(r.lastClose, r.close))) fail('summary_values', 'Hai trường giá đóng cửa mâu thuẫn');
        const x = r.close / r.close7 - 1, y = r.buyQuote7 / r.quote7;
        if (!Number.isFinite(x) || !Number.isFinite(y) || !matchNumber(r.return7, x) || !matchNumber(r.buyShare7, y)) fail('summary_math', 'Nhãn biến động hoặc tỷ trọng không khớp giá và khối lượng lưu lại');
        if (r.close30 !== undefined) {
          num(r.close30, 'Close 30 ngày trước');
          if (r.close30 <= 0 || !matchNumber(r.return30, r.close / r.close30 - 1)) fail('summary_math', 'Biến động 30 ngày không khớp giá đầu/cuối lưu lại');
        }
        for (const [field, expected] of [['close7End', r.end - 7 * DAY], ['close30End', r.firstTime + DAY - 1], ['quote7FirstTime', r.end + 1 - 7 * DAY]]) {
          if (r[field] !== undefined && r[field] !== expected) fail('summary_window', 'Mốc ' + field + ' không khớp cửa sổ thống kê');
        }
        const provenance = summaryProvenance(r.provenance, row.instrument);
        points.push({ ...row, x, y, return7: x, return30: r.return30, buyShare7: y, quote7: r.quote7, buyQuote7: r.buyQuote7, close: r.close, close7: r.close7, turnover20: r.turnover20, end: r.end, asOf: r.asOf, fetchedAt: r.fetchedAt, days: r.days, firstTime: r.firstTime, provenance, method: 'normalized_daily_summary' });
      } catch (e) { excluded.push(exclusion(row, e.code || 'invalid', e.message)); }
    }
    return {
      points, excluded, recordIssues, sourceErrors: snapshot.errors,
      coverage: { ...coverage(rows, points, excluded), eligibleInstrumentCount: snapshot.eligibleInstrumentCount, attemptedCount: snapshot.attemptedCount, retainedRecordCount: snapshot.records.length, collectorErrorCount: snapshot.errors.length, recordIssueCount: recordIssues.length, notAttemptedCount: snapshot.eligibleInstrumentCount - snapshot.attemptedCount, lastEnd: points.length ? latestExpectedEnd : null, latestExpectedEnd, generatedAt: snapshot.generatedAt, method: 'normalized_daily_summary', continuityCheck: 'collector', rawDailyReplayAvailable: false, provenanceHashCheck: 'format_only' },
      xUnit: 'fraction', yUnit: 'fraction', lastEnd: points.length ? latestExpectedEnd : null, now
    };
  }
  return Object.freeze({ DAY, TTL, scatter24, summaryDaily, summarizeDaily: summaryDaily, scatter7, scatter7Summary });
});
