/* Read-only Hyperliquid perpetual context. Native instrument identity is never a token-contract join. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FlowDerivatives = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const HOUR = 3600000, DAY = 24 * HOUR, FRESH_MS = 15 * 60000;
  const SOURCE_ID = 'hyperliquid', DEX = '', ENDPOINT = 'https://api.hyperliquid.xyz/info';
  const DOCS = Object.freeze({
    api: 'https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals',
    funding: 'https://hyperliquid.gitbook.io/hyperliquid-docs/trading/funding',
    contracts: 'https://hyperliquid.gitbook.io/hyperliquid-docs/trading/contract-specifications',
    limits: 'https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/rate-limits-and-user-limits'
  });
  const LIMITATIONS = Object.freeze([
    'Chỉ DEX perpetual gốc Hyperliquid (dex=""); không phải toàn thị trường phái sinh, không gồm mọi HIP-3 DEX.',
    'Metadata chứa cả hợp đồng đã delist; phải lọc isDelisted trước khi xếp hạng hợp đồng đang hoạt động.',
    'Ảnh chụp theo thời gian đồng hồ bộ thu thập; API context không trả timestamp thị trường hay block nguyên tử.',
    'OI là lượng hợp đồng còn mở; mỗi hợp đồng có hai phía. OI không cho biết cá mập mua spot hoặc tổng thị trường nghiêng long/short.',
    'Funding là phí giữa long và short, không phải vốn mới vào token; rate hiện tại có thể thay đổi trước kỳ thanh toán.',
    'Giá và notional giữ đơn vị quote của hợp đồng. Margin USDC; phần lớn oracle theo USDT, HYPE/PURR theo USDC theo tài liệu; không áp đổi tỷ giá USDC/USDT.',
    'Tên BTC, kPEPE… là định danh native của hợp đồng, không xác minh token contract, chain hay chủ sở hữu ví.',
    'Không có tập vị thế đầy đủ và giá thanh lý từng tài khoản; không tạo heatmap thanh lý từ giá, OI hoặc OHLCV.'
  ]);
  function fail(code, message) { throw Object.assign(new Error(message), { code }); }
  function object(v, name) { if (!v || typeof v !== 'object' || Array.isArray(v)) fail('object', name + ' không hợp lệ'); return v; }
  function stamp(v, name) { if (!Number.isSafeInteger(v) || v < 1500000000000 || v > 4500000000000) fail('timestamp', name + ' phải là epoch millisecond UTC'); return v; }
  function decimal(value, name, { nullable = false, nonnegative = false, positive = false } = {}) {
    if (value === null || value === undefined) { if (nullable) return null; fail('missing_decimal', name + ' bị thiếu'); }
    if (typeof value !== 'string' || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) fail('decimal', name + ' phải giữ chuỗi thập phân nguồn');
    const n = Number(value); if (!Number.isFinite(n) || nonnegative && n < 0 || positive && n <= 0) fail('decimal_range', name + ' ngoài miền hợp lệ');
    return n;
  }
  function nativeKey(name) { if (typeof name !== 'string' || !name || name.length > 100 || /[\s\u0000-\u001f]/.test(name)) fail('native_name', 'Tên hợp đồng native không hợp lệ'); return 'hyperliquid:perp:main:' + name; }
  function normalizeAsset(meta, ctx, index) {
    object(meta, 'Metadata'); object(ctx, 'Asset context');
    const key = nativeKey(meta.name);
    if (!Number.isSafeInteger(index) || index < 0 || !Number.isInteger(meta.szDecimals) || meta.szDecimals < 0 || meta.szDecimals > 18) fail('metadata', 'Index/size decimals sai');
    if (!Number.isInteger(meta.maxLeverage) || meta.maxLeverage <= 0 || meta.maxLeverage > 1000) fail('metadata', 'Max leverage sai');
    if (meta.isDelisted !== undefined && typeof meta.isDelisted !== 'boolean') fail('metadata', 'isDelisted sai');
    const markPrice = decimal(ctx.markPx, 'markPx', { nullable: true, nonnegative: true });
    const oraclePrice = decimal(ctx.oraclePx, 'oraclePx', { nullable: true, nonnegative: true });
    const midPrice = decimal(ctx.midPx, 'midPx', { nullable: true, nonnegative: true });
    const previousDayPrice = decimal(ctx.prevDayPx, 'prevDayPx', { nullable: true, nonnegative: true });
    const volume24hQuote = decimal(ctx.dayNtlVlm, 'dayNtlVlm', { nonnegative: true });
    const volume24hBase = decimal(ctx.dayBaseVlm, 'dayBaseVlm', { nullable: true, nonnegative: true });
    const fundingRateHourly = decimal(ctx.funding, 'funding');
    const openInterestBase = decimal(ctx.openInterest, 'openInterest', { nonnegative: true });
    const premiumRate = decimal(ctx.premium, 'premium', { nullable: true });
    if (ctx.impactPxs !== null && ctx.impactPxs !== undefined) {
      if (!Array.isArray(ctx.impactPxs) || ctx.impactPxs.length !== 2) fail('impact', 'impactPxs phải gồm hai giá');
      ctx.impactPxs.forEach(v => decimal(v, 'impactPxs', { nonnegative: true }));
    }
    const multiply = p => {
      const value = p !== null && p > 0 ? openInterestBase * p : openInterestBase === 0 ? 0 : null;
      if (value !== null && !Number.isFinite(value)) fail('notional_overflow', 'OI notional vượt miền số hữu hạn');
      return value;
    };
    const markOracleBasis = markPrice !== null && oraclePrice > 0 ? markPrice / oraclePrice - 1 : null;
    return { key, sourceId: SOURCE_ID, dex: DEX, marketType: 'perpetual', nativeName: meta.name, nativeIndex: index,
      sizeDecimals: meta.szDecimals, maxLeverage: meta.maxLeverage, isDelisted: meta.isDelisted === true,
      onlyIsolated: meta.onlyIsolated === true, marginMode: meta.marginMode || null,
      collateral: 'USDC', quoteUnit: 'native_contract_quote', baseUnit: meta.name,
      fundingRateHourly, openInterestBase, openInterestQuoteAtMark: multiply(markPrice), openInterestQuoteAtOracle: multiply(oraclePrice),
      markPrice, oraclePrice, midPrice, previousDayPrice, volume24hQuote, volume24hBase, premiumRate, markOracleBasis,
      priceChange24h: markPrice !== null && previousDayPrice > 0 ? markPrice / previousDayPrice - 1 : null,
      rawMetadata: meta, rawContext: ctx };
  }
  function normalizeContext(raw) {
    if (!Array.isArray(raw) || raw.length !== 2 || !raw[0] || !Array.isArray(raw[0].universe) || !Array.isArray(raw[1])) fail('context_shape', 'Cần [metadata, contexts]');
    const [meta, contexts] = raw;
    if (!meta.universe.length || meta.universe.length !== contexts.length) fail('alignment', 'Metadata và context không cùng số phần tử');
    if (meta.collateralToken !== 0) fail('collateral', 'Collector chỉ hỗ trợ USDC collateralToken 0 trên DEX gốc');
    const assets = meta.universe.map((m, i) => normalizeAsset(m, contexts[i], i));
    if (new Set(assets.map(a => a.key)).size !== assets.length) fail('duplicate_asset', 'Trùng tên native');
    return { assets, metadata: meta };
  }
  function normalizeFunding(raw, nativeName, startTime, endTime) {
    nativeKey(nativeName); stamp(startTime, 'startTime'); stamp(endTime, 'endTime');
    if (endTime < startTime) fail('range', 'Khoảng thời gian đảo ngược');
    if (!Array.isArray(raw)) fail('funding_shape', 'Funding history phải là mảng');
    const seen = new Set(), buckets = new Set();
    const rows = raw.map(v => {
      object(v, 'Funding record'); stamp(v.time, 'Funding time');
      if (v.coin !== nativeName || v.time < startTime || v.time > endTime) fail('funding_identity', 'Funding khác hợp đồng/khoảng truy vấn');
      const bucket = Math.floor(v.time / HOUR) * HOUR;
      if (seen.has(v.time) || buckets.has(bucket)) fail('funding_duplicate', 'Trùng giờ thanh toán funding');
      seen.add(v.time); buckets.add(bucket);
      return { time: v.time, hour: bucket, fundingRate: decimal(v.fundingRate, 'fundingRate'), premiumRate: decimal(v.premium, 'funding premium', { nullable: true }), raw: v };
    }).sort((a, b) => a.time - b.time);
    const firstHour = Math.ceil(startTime / HOUR) * HOUR, finalHour = Math.floor(endTime / HOUR) * HOUR;
    const expectedHours = Math.max(0, Math.floor((finalHour - firstHour) / HOUR) + 1);
    const missingHours = [];
    for (let h = firstHour; h <= finalHour; h += HOUR) if (!buckets.has(h)) missingHours.push(h);
    return { key: nativeKey(nativeName), nativeName, startTime, endTime, intervalMs: HOUR, rows,
      coverage: { expectedHours, returnedHours: rows.length, missingHours, complete: missingHours.length === 0, firstTime: rows[0]?.time ?? null, lastTime: rows.at(-1)?.time ?? null },
      cumulativeRateObserved: rows.reduce((s, r) => s + r.fundingRate, 0),
      methodology: 'Arithmetic sum of observed hourly funding rates on a hypothetical constant quote notional; not compounded return, account PnL or new capital. Missing hours are not filled.' };
  }
  function validReceipt(r) {
    object(r, 'Receipt');
    if (r.url !== ENDPOINT || r.method !== 'POST' || r.httpStatus !== 200 || !/^[a-f0-9]{64}$/.test(r.sha256 || '') || !Number.isSafeInteger(r.bytes) || r.bytes < 2) fail('receipt', 'Thiếu bằng chứng nguồn hợp lệ');
    stamp(r.startedAt, 'startedAt'); stamp(r.fetchedAt, 'fetchedAt');
    if (r.fetchedAt < r.startedAt) fail('receipt_time', 'Thời gian nhận trước thời gian gửi');
    object(r.requestBody, 'requestBody');
    return r;
  }
  function validateSnapshot(s, options = {}) {
    object(s, 'Snapshot');
    const now = options.now === undefined ? Date.now() : options.now; stamp(now, 'now');
    if (s.schemaVersion !== 1 || s.kind !== 'derivatives-context' || s.sourceId !== SOURCE_ID || s.dex !== DEX || s.marketType !== 'perpetual') fail('schema', 'Snapshot không đúng schema/nguồn');
    stamp(s.generatedAt, 'generatedAt'); stamp(s.asOf, 'asOf'); stamp(s.finishedAt, 'finishedAt');
    if (s.generatedAt > now + 60000 || s.asOf > now + 60000 || s.finishedAt > now + 60000 || s.finishedAt < s.asOf) fail('future_source', 'Thời gian nguồn sai/tương lai');
    if (s.providerAsOf !== null || s.timestampBasis !== 'collector_response_received_utc') fail('timestamp_basis', 'API context không có timestamp thị trường');
    const receipt = validReceipt(s.contextReceipt);
    if (receipt.requestBody.type !== 'metaAndAssetCtxs' || receipt.requestBody.dex !== '' || receipt.fetchedAt !== s.asOf) fail('context_receipt', 'Receipt metadata sai');
    if (!Array.isArray(s.assets) || !s.assets.length || !s.metadata) fail('assets', 'Thiếu assets/metadata');
    if (!Array.isArray(s.metadata.universe) || s.metadata.universe.length !== s.assets.length || s.metadata.collateralToken !== 0) fail('alignment', 'Metadata không khớp tài sản');
    const ids = new Set();
    for (let i = 0; i < s.assets.length; i++) {
      const a = object(s.assets[i], 'Asset'), rebuilt = normalizeAsset(a.rawMetadata, a.rawContext, i);
      if (JSON.stringify(a.rawMetadata) !== JSON.stringify(s.metadata.universe[i])) fail('asset_metadata', 'Asset không khớp metadata tại nativeIndex');
      for (const [k, v] of Object.entries(rebuilt)) if (k !== 'rawMetadata' && k !== 'rawContext' && a[k] !== v) fail('asset_derived', 'Field ' + k + ' không khớp dữ liệu nguồn');
      if (ids.has(a.key)) fail('duplicate_asset', 'Trùng asset'); ids.add(a.key);
    }
    object(s.fundingHistories, 'Funding histories');
    for (const [key, h] of Object.entries(s.fundingHistories)) {
      if (!ids.has(key) || h.key !== key || !Array.isArray(h.rows)) fail('funding_key', 'History không thuộc native universe');
      if (!Array.isArray(h.receipts) || !h.receipts.length) fail('funding_receipt', 'Thiếu receipt funding');
      for (let p = 0; p < h.receipts.length; p++) {
        const proof = validReceipt(h.receipts[p]);
        if (proof.requestBody.type !== 'fundingHistory' || proof.requestBody.coin !== h.nativeName || proof.requestBody.startTime < h.startTime || proof.requestBody.startTime > h.endTime || proof.requestBody.endTime !== h.endTime || p === 0 && proof.requestBody.startTime !== h.startTime) fail('funding_receipt', 'Truy vấn funding không khớp history');
        if (proof.fetchedAt > s.finishedAt) fail('funding_time', 'Receipt sau khi kết thúc snapshot');
      }
      const rebuilt = normalizeFunding(h.rows.map(r => r.raw), h.nativeName, h.startTime, h.endTime);
      for (const k of ['key','nativeName','startTime','endTime','intervalMs','rows','coverage','cumulativeRateObserved','methodology']) if (JSON.stringify(h[k]) !== JSON.stringify(rebuilt[k])) fail('funding_derived', 'Funding ' + k + ' không khớp nguồn');
      if (h.endTime >= Math.floor(s.asOf / HOUR) * HOUR) fail('funding_unclosed', 'History không được gồm giờ đang chạy khi chụp context');
    }
    const c = object(s.coverage, 'Coverage');
    if (c.metadataEntries !== s.assets.length || c.activeMarkets !== s.assets.filter(a => !a.isDelisted).length || c.delistedMarkets !== s.assets.filter(a => a.isDelisted).length || c.fundingCaptured !== Object.keys(s.fundingHistories).length) fail('coverage', 'Bộ đếm coverage không khớp dữ liệu');
    if (!Number.isInteger(c.fundingRequested) || c.fundingRequested < c.fundingCaptured || !Array.isArray(s.errors) || s.collectionState !== (s.errors.length ? 'partial' : 'complete')) fail('collection_state', 'Trạng thái thu thập sai');
    if (!s.capabilities || s.capabilities.liquidationHeatmap !== false || s.capabilities.whaleAttribution !== false || s.capabilities.openInterestHistory !== false) fail('capabilities', 'Không được quảng bá tính năng thiếu dữ liệu');
    return { valid: true, ageMs: Math.max(0, now - s.asOf), stale: now - s.asOf > FRESH_MS, assets: s.assets.length, active: c.activeMarkets, fundingHistories: c.fundingCaptured };
  }
  function findExactNativeAsset(s, nativeName) {
    const key = nativeKey(nativeName); return Array.isArray(s?.assets) ? s.assets.find(a => a.key === key && a.nativeName === nativeName) || null : null;
  }
  function summary(s, options = {}) {
    const status = validateSnapshot(s, options), active = s.assets.filter(a => !a.isDelisted);
    const positiveFunding = active.filter(a => a.fundingRateHourly > 0).length, negativeFunding = active.filter(a => a.fundingRateHourly < 0).length;
    const totalOI = active.reduce((n, a) => n + (a.openInterestQuoteAtMark ?? 0), 0), totalVolume = active.reduce((n, a) => n + a.volume24hQuote, 0);
    return { ...status, asOf: s.asOf, timestampBasis: s.timestampBasis, delisted: s.coverage.delistedMarkets,
      totalOpenInterestQuoteAtMark: totalOI, totalVolume24hQuote: totalVolume, quoteUnit: 'native_contract_quote_aggregate_no_fx',
      openInterestNotionalCoverage: { valuedMarkets: active.filter(a => a.openInterestQuoteAtMark !== null).length, totalActiveMarkets: active.length, complete: active.every(a => a.openInterestQuoteAtMark !== null) },
      positiveFunding, negativeFunding, zeroFunding: active.length - positiveFunding - negativeFunding,
      fundingHistoryHours: Object.values(s.fundingHistories).reduce((n, h) => n + h.rows.length, 0),
      topByVolume: [...active].sort((a,b) => b.volume24hQuote - a.volume24hQuote),
      limitations: LIMITATIONS, capabilities: s.capabilities };
  }
  function fundingSummary(history, windowHours = 24) {
    if (!history || !Array.isArray(history.rows) || ![24, 72, 168, 720].includes(windowHours)) return null;
    const endHour = Math.floor(history.endTime / HOUR) * HOUR, startHour = endHour - (windowHours - 1) * HOUR;
    const rows = history.rows.filter(r => r.hour >= startHour && r.hour <= endHour);
    return { requestedHours: windowHours, observedHours: rows.length, complete: rows.length === windowHours,
      startHour, endHour, cumulativeRate: rows.length === windowHours ? rows.reduce((n, r) => n + r.fundingRate, 0) : null,
      observedCumulativeRate: rows.reduce((n, r) => n + r.fundingRate, 0), positiveHours: rows.filter(r => r.fundingRate > 0).length, negativeHours: rows.filter(r => r.fundingRate < 0).length };
  }
  function aggregateFunding(history, interval = 'day') {
    if (!history || !Array.isArray(history.rows) || !['hour','day','week','month'].includes(interval)) return null;
    function period(time) {
      const d = new Date(time);
      if (interval === 'hour') return Math.floor(time / HOUR) * HOUR;
      if (interval === 'day') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
      if (interval === 'week') { const day = Math.floor(time / DAY) * DAY; return day - ((d.getUTCDay() + 6) % 7) * DAY; }
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    }
    function next(time) { const d = new Date(time); return interval === 'month' ? Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) : time + ({hour:HOUR,day:DAY,week:7*DAY})[interval]; }
    const bins = new Map();
    for (const r of history.rows) { const t = period(r.hour), group = bins.get(t) || []; group.push(r); bins.set(t, group); }
    const out = [];
    for (let t = period(history.startTime); t <= history.endTime; t = next(t)) {
      const end = next(t) - 1, rows = bins.get(t) || [], expectedHours = (end + 1 - t) / HOUR;
      const queryStart = Math.max(t, history.startTime), queryEnd = Math.min(end, history.endTime);
      const withinQueryHours = Math.max(0, Math.floor(queryEnd / HOUR) - Math.ceil(queryStart / HOUR) + 1);
      const sumRateObserved = rows.reduce((n,r) => n + r.fundingRate, 0), complete = rows.length === expectedHours && queryStart === t && queryEnd === end;
      out.push({ time:t, end, interval, observedHours:rows.length, expectedHours, withinQueryHours,
        missingWithinQuery:Math.max(0,withinQueryHours - rows.length), complete,
        sumRateObserved, sumRate:complete ? sumRateObserved : null,
        measure:'Arithmetic sum of observed hourly funding rates on constant quote notional; not compounded PnL' });
    }
    return out;
  }
  return Object.freeze({ HOUR, DAY, FRESH_MS, SOURCE_ID, ENDPOINT, DOCS, LIMITATIONS, nativeKey, normalizeContext, normalizeFunding, validateSnapshot, findExactNativeAsset, summary, fundingSummary, aggregateFunding });
});
