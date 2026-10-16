/* Public exchange data adapters and descriptive fields only. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.FlowMarket = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const DAY = 86400000, TTL = 900000, TIMEOUT = 15000;
  const SOURCES = Object.freeze([
    Object.freeze({ id: 'binance', name: 'Binance', origin: 'https://data-api.binance.vision', supportsDaily: true, capabilities: Object.freeze({ rolling24h: true, quoteTurnover: true, dailyUTC: true, takerBuyQuote: true, perInstrumentTimestamp: true, assetClass: false }) }),
    Object.freeze({ id: 'bitget', name: 'Bitget', origin: 'https://api.bitget.com', supportsDaily: true, capabilities: Object.freeze({ rolling24h: true, quoteTurnover: true, dailyUTC: true, takerBuyQuote: false, perInstrumentTimestamp: true, assetClass: true }) }),
    Object.freeze({ id: 'gate', name: 'Gate', origin: 'https://api.gateio.ws', supportsDaily: true, timestampKind: 'source_response', capabilities: Object.freeze({ rolling24h: true, quoteTurnover: true, dailyUTC: true, takerBuyQuote: false, perInstrumentTimestamp: false, assetClass: false, browserDirect: true }) }),
    Object.freeze({ id: 'whitebit', name: 'WhiteBIT', origin: 'https://whitebit.com', supportsDaily: false, timestampKind: 'response_received', capabilities: Object.freeze({ rolling24h: true, quoteTurnover: true, dailyUTC: false, takerBuyQuote: false, perInstrumentTimestamp: false, assetClass: false, browserDirect: false }) })
  ]);
  const NAMES = Object.freeze(Object.fromEntries(SOURCES.map(s => [s.id, s.name])));
  function source(id) { const s = SOURCES.find(x => x.id === id); if (!s) throw Error('Nguồn không được hỗ trợ'); return s; }
  function number(value, field = 'Số') {
    if (value === null || value === undefined || typeof value === 'boolean' || (typeof value === 'string' && !value.trim())) throw Error(field + ': thiếu số');
    if (typeof value !== 'number' && typeof value !== 'string') throw Error(field + ': không phải số');
    const n = Number(value); if (!Number.isFinite(n)) throw Error(field + ': số không hợp lệ'); return n;
  }
  function positive(value, field) { const n = number(value, field); if (n <= 0) throw Error(field + ': phải dương'); return n; }
  function nonnegative(value, field) { const n = number(value, field); if (n < 0) throw Error(field + ': âm'); return n; }
  function stamp(value) { const n = number(value, 'Timestamp'); if (!Number.isInteger(n) || n < 946684800000 || n >= 4102444800000) throw Error('Timestamp millisecond không hợp lệ'); return n; }
  function clock(value, now = Date.now()) { const t = stamp(value); if (Math.abs(t - stamp(now)) > TTL) throw Error('Đồng hồ nguồn lệch hơn 15 phút'); return t; }
  function identifier(value, field = 'Mã') { if (typeof value !== 'string' || !/^[\p{L}\p{N}_.-]{1,80}$/u.test(value)) throw Error(field + ' không hợp lệ'); return value; }
  function array(value, label) { if (!Array.isArray(value)) throw Error(label + ': nguồn không trả danh sách'); return value; }
  function envelope(value) {
    if (!value || typeof value !== 'object' || value.code !== '00000') throw Error('Bitget trả lỗi: ' + String(value && (value.code || value.msg) || 'sai định dạng'));
    return { data: array(value.data, 'Bitget'), asOf: stamp(value.requestTime) };
  }
  function failure(instrument, e) { return { instrument: typeof instrument === 'string' ? instrument : '(không rõ)', message: e.message }; }
  function registry(sourceId, raw) {
    source(sourceId);
    const items = sourceId === 'binance' ? array(raw && raw.symbols, 'Binance registry') : sourceId === 'gate' || sourceId === 'whitebit' ? array(raw, sourceId + ' registry') : envelope(raw).data;
    const instruments = [], errors = [], seen = new Set(); let excludedCount = 0;
    for (const x of items) {
      try {
        if (!x || typeof x !== 'object') throw Error('Bản ghi niêm yết không hợp lệ');
        const active = sourceId === 'binance' ? x.status === 'TRADING' && x.isSpotTradingAllowed === true && x.quoteAsset === 'USDT' : sourceId === 'gate' ? x.trade_status === 'tradable' && x.quote === 'USDT' && x.type === 'normal' : sourceId === 'whitebit' ? x.type === 'spot' && x.money === 'USDT' && x.tradesEnabled === true : x.status === 'online' && x.category === 'SPOT' && x.quoteCoin === 'USDT' && x.symbolType === 'crypto' && x.instrumentType === 'crypto';
        if (!active) { excludedCount++; continue; }
        const instrument = identifier(sourceId === 'gate' ? x.id : sourceId === 'whitebit' ? x.name : x.symbol), base = identifier(sourceId === 'binance' ? x.baseAsset : sourceId === 'gate' ? x.base : sourceId === 'whitebit' ? x.stock : x.baseCoin, 'Base'), quote = 'USDT';
        if (seen.has(instrument)) throw Error('Mã niêm yết trùng');
        seen.add(instrument); instruments.push({ instrument, base, quote });
      } catch (e) { errors.push(failure(x && (x.symbol || x.id || x.name), e)); }
    }
    return { instruments, errors, excludedCount };
  }
  function parseScan(sourceId, metaRaw, tickRaw, asOf, fetchedAt = Date.now()) {
    const s = source(sourceId); asOf = stamp(asOf); fetchedAt = stamp(fetchedAt);
    const listed = registry(sourceId, metaRaw), lookup = new Map(listed.instruments.map(x => [x.instrument, x]));
    let raw;
    if (sourceId === 'whitebit') {
      if (!tickRaw || typeof tickRaw !== 'object' || Array.isArray(tickRaw)) throw Error('WhiteBIT ticker: nguồn không trả dictionary');
      raw = Object.entries(tickRaw).map(([symbol, value]) => ({ ...value, symbol }));
    } else raw = sourceId === 'binance' || sourceId === 'gate' ? array(tickRaw, s.name + ' ticker') : envelope(tickRaw).data;
    const rows = [], errors = [...listed.errors], index = new Map(), duplicates = new Set();
    for (const x of raw) {
      const key = x && (sourceId === 'gate' ? x.currency_pair : x.symbol);
      if (!x || !lookup.has(key)) continue;
      if (index.has(key)) duplicates.add(key);
      index.set(key, x);
    }
    for (const meta of listed.instruments) {
      try {
        if (duplicates.has(meta.instrument)) throw Error('Ticker trùng');
        const x = index.get(meta.instrument); if (!x) throw Error('Không có ticker cho mã đang niêm yết');
        if (sourceId === 'whitebit' && x.isFrozen !== false) throw Error('WhiteBIT ticker bị đóng băng hoặc không xác nhận trạng thái');
        const last = positive(sourceId === 'binance' ? x.lastPrice : sourceId === 'gate' ? x.last : sourceId === 'whitebit' ? x.last_price : x.lastPr, 'Giá');
        const turnover24 = nonnegative(sourceId === 'gate' || sourceId === 'whitebit' ? x.quote_volume : x.quoteVolume, 'Giá trị giao dịch quote');
        const return24 = sourceId === 'binance' ? number(x.priceChangePercent, 'Biến động 24h') / 100 : sourceId === 'gate' ? number(x.change_percentage, 'Biến động 24h') / 100 : sourceId === 'whitebit' ? number(x.change, 'Biến động 24h') / 100 : number(x.change24h, 'Biến động 24h');
        if (return24 < -1) throw Error('Biến động 24h dưới -100%');
        const t = stamp(sourceId === 'binance' ? x.closeTime : sourceId === 'gate' || sourceId === 'whitebit' ? asOf : x.ts);
        if (asOf - t > TTL) throw Error('Ticker cũ hơn 15 phút');
        if (t - asOf > 60000) throw Error('Ticker nằm trong tương lai');
        rows.push({ key: sourceId + ':' + meta.instrument, sourceId, ...meta, last, return24, turnover24, asOf: t, timestampKind: s.timestampKind || (sourceId === 'binance' ? 'ticker_interval_end' : 'source_generated') });
      } catch (e) { errors.push(failure(meta.instrument, e)); }
    }
    return { sourceId, name: s.name, asOf, fetchedAt, instrumentCount: listed.instruments.length, rows, errors, excludedCount: listed.excludedCount, capabilities: s.capabilities, supportsDaily: s.supportsDaily, timestampKind: s.timestampKind || 'per_instrument' };
  }
  function parseHistory(sourceId, raw, asOf, fetchedAt = Date.now()) {
    if (!source(sourceId).supportsDaily) throw Error('Nguồn này chưa hỗ trợ nến ngày UTC đã kiểm chứng'); asOf = stamp(asOf); fetchedAt = stamp(fetchedAt);
    const items = sourceId === 'binance' || sourceId === 'gate' ? array(raw, sourceId + ' candles') : envelope(raw).data;
    const map = new Map(); let dropped = 0;
    for (const a of items) {
      if (!Array.isArray(a) || a.length < (sourceId === 'binance' ? 11 : 8)) throw Error('Nến thiếu trường');
      const time = stamp(sourceId === 'gate' ? number(a[0], 'Gate candle seconds') * 1000 : a[0]), end = sourceId === 'binance' ? stamp(a[6]) : time + DAY - 1;
      if (time % DAY !== 0 || end !== time + DAY - 1) throw Error('Nến không phải ngày UTC');
      if (time > asOf + 60000) throw Error('Nến nằm trong tương lai');
      if (end >= asOf) { dropped++; continue; }
      if (sourceId === 'gate') { if (a[7] === false || a[7] === 'false') { dropped++; continue; } if (a[7] !== true && a[7] !== 'true') throw Error('Gate candle close flag không hợp lệ'); }
      const b = { time, end, open: positive(sourceId === 'gate' ? a[5] : a[1], 'Open'), high: positive(sourceId === 'gate' ? a[3] : a[2], 'High'), low: positive(sourceId === 'gate' ? a[4] : a[3], 'Low'), close: positive(sourceId === 'gate' ? a[2] : a[4], 'Close'), quote: nonnegative(sourceId === 'gate' ? a[1] : a[7], 'Quote volume'), buy: sourceId === 'binance' ? nonnegative(a[10], 'Taker buy quote') : null };
      nonnegative(sourceId === 'gate' ? a[6] : a[5], 'Base volume');
      if (sourceId === 'bitget') nonnegative(a[6], 'USDT volume');
      if (b.high < Math.max(b.open, b.close, b.low) || b.low > Math.min(b.open, b.close, b.high)) throw Error('Nến có OHLC mâu thuẫn');
      if (b.buy !== null && b.buy > b.quote * (1 + 1e-9)) throw Error('Taker mua vượt quote volume');
      if (map.has(time) && JSON.stringify(map.get(time)) !== JSON.stringify(b)) throw Error('Hai nến cùng ngày mâu thuẫn');
      map.set(time, b);
    }
    const bars = [...map.values()].sort((a, b) => a.time - b.time).slice(-121);
    return { bars, asOf, fetchedAt, dropped };
  }
  async function request(url, fetchImpl) {
    const controller = new AbortController(); let timer;
    try {
      const timeout = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(Error('Nguồn hết thời gian sau 15 giây')); }, TIMEOUT); });
      return await Promise.race([(async () => {
        const res = await fetchImpl(url, { method: 'GET', signal: controller.signal, credentials: 'omit', cache: 'no-store', headers: { Accept: 'application/json' } });
        if (!res.ok) {
          const error=Error('Nguồn từ chối hoặc lỗi HTTP ' + res.status);
          if ([418,429].includes(res.status)) {
            const retry=res.headers&&res.headers.get?res.headers.get('Retry-After'):null;
            const seconds=Number(retry),at=Date.parse(retry);
            error.retryAfterMs=Math.max(60000,Number.isFinite(seconds)&&seconds>0?seconds*1000:Number.isFinite(at)?at-Date.now():0);
          }
          throw error;
        }
        const type = res.headers && res.headers.get ? res.headers.get('content-type') : '';
        if (type && !/application\/json/i.test(type)) throw Error('Nguồn trả nội dung không phải JSON');
        const value = await res.json();
        if (value && !Array.isArray(value) && typeof value === 'object' && 'code' in value && value.code !== '00000') throw Error('Nguồn trả mã lỗi ' + value.code);
        return value;
      })(), timeout]);
    } finally { clearTimeout(timer); }
  }
  async function scanSource(sourceId, fetchImpl = fetch) {
    const s = source(sourceId);
    if (sourceId === 'binance') {
      const time = await request(s.origin + '/api/v3/time', fetchImpl), asOf = clock(time.serverTime);
      const [meta, tickers] = await Promise.all([request(s.origin + '/api/v3/exchangeInfo?permissions=SPOT&showPermissionSets=false', fetchImpl), request(s.origin + '/api/v3/ticker/24hr', fetchImpl)]);
      return parseScan(sourceId, meta, tickers, asOf, Date.now());
    }
    if (sourceId === 'gate') {
      const time = await request(s.origin + '/api/v4/spot/time', fetchImpl), asOf = clock(time.server_time);
      const [meta, tickers] = await Promise.all([request(s.origin + '/api/v4/spot/currency_pairs', fetchImpl), request(s.origin + '/api/v4/spot/tickers', fetchImpl)]);
      return parseScan(sourceId, meta, tickers, asOf, Date.now());
    }
    if (sourceId === 'whitebit') {
      let receivedAt;
      const [meta, tickers] = await Promise.all([request(s.origin + '/api/v4/public/markets', fetchImpl), request(s.origin + '/api/v4/public/ticker', fetchImpl).then(value => { receivedAt = Date.now(); return value; })]);
      return parseScan(sourceId, meta, tickers, receivedAt, Date.now());
    }
    const [meta, tickers] = await Promise.all([request(s.origin + '/api/v3/market/instruments?category=SPOT', fetchImpl), request(s.origin + '/api/v2/spot/market/tickers', fetchImpl)]);
    const metaTime = envelope(meta).asOf, asOf = clock(envelope(tickers).asOf); clock(metaTime);
    return parseScan(sourceId, meta, tickers, asOf, Date.now());
  }
  async function history(sourceId, instrument, fetchImpl = fetch) {
    const s = source(sourceId); identifier(instrument);
    if (!s.supportsDaily) throw Error('Nguồn này chưa hỗ trợ nến ngày UTC đã kiểm chứng');
    if (sourceId === 'binance') {
      const time = await request(s.origin + '/api/v3/time', fetchImpl), asOf = clock(time.serverTime);
      const raw = await request(s.origin + '/api/v3/klines?' + new URLSearchParams({ symbol: instrument, interval: '1d', limit: '122' }), fetchImpl);
      return parseHistory(sourceId, raw, asOf, Date.now());
    }
    if (sourceId === 'gate') {
      const time = await request(s.origin + '/api/v4/spot/time', fetchImpl), asOf = clock(time.server_time);
      const raw = await request(s.origin + '/api/v4/spot/candlesticks?' + new URLSearchParams({ currency_pair: instrument, interval: '1d', limit: '122' }), fetchImpl);
      return parseHistory(sourceId, raw, asOf, Date.now());
    }
    const raw = await request(s.origin + '/api/v2/spot/market/candles?' + new URLSearchParams({ symbol: instrument, granularity: '1Dutc', limit: '122' }), fetchImpl);
    return parseHistory(sourceId, raw, clock(envelope(raw).asOf), Date.now());
  }
  return Object.freeze({ DAY, TTL, NAMES, SOURCES, sources: SOURCES, list: () => SOURCES.map(x => ({ ...x })), number, stamp, clock, registry, parseScan, parseHistory, scanSource, history });
});
