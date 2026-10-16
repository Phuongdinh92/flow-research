/* Aggregated USD market and DeFi context. These datasets do not identify wallet owners. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.FlowEcosystem = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const DAY = 86400000;
  const SOURCE_URLS = Object.freeze({
    catalog: 'https://api.coingecko.com/api/v3/coins/list?include_platform=true',
    global: 'https://api.coingecko.com/api/v3/global',
    chains: 'https://api.llama.fi/v2/chains',
    stablecoinChains: 'https://stablecoins.llama.fi/stablecoinchains',
    stablecoinHistory: 'https://stablecoins.llama.fi/stablecoincharts/all',
    dexOverview: 'https://api.llama.fi/overview/dexs?excludeTotalDataChart=false&excludeTotalDataChartBreakdown=true'
  });
  function numeric(v, name, nonnegative = false) {
    if (typeof v !== 'number' || !Number.isFinite(v) || (nonnegative && v < 0)) throw Error(name + ': invalid number');
    return v;
  }
  function count(v, name) { numeric(v, name, true); if (!Number.isInteger(v)) throw Error(name + ': invalid count'); return v; }
  function optional(v, name, nonnegative = false) { return v === null || v === undefined ? null : numeric(v, name, nonnegative); }
  function text(v, name) { if (typeof v !== 'string' || !v.trim() || v.length > 300) throw Error(name + ': invalid text'); return v; }
  function list(v, name) { if (!Array.isArray(v)) throw Error(name + ': expected array'); return v; }
  function timestamp(v) { numeric(v, 'Timestamp'); if (!Number.isInteger(v) || v < 946684800000 || v >= 4102444800000) throw Error('Invalid millisecond timestamp'); return v; }
  function sourceTime(v) { const n = Date.parse(v); if (!Number.isFinite(n)) throw Error('Invalid provider timestamp'); return timestamp(n); }
  function usdTotal(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v) || !Object.keys(v).length) throw Error('Missing circulating USD values');
    return Object.values(v).reduce((sum, x) => sum + numeric(x, 'Circulating USD', true), 0);
  }
  function parseCatalog(raw) {
    const ids = new Set(); let contractMappingCount = 0, incompleteMetadataCount = 0;
    for (const r of list(raw, 'Catalog')) {
      const id = text(r && r.id, 'Coin ID');
      if (ids.has(id)) throw Error('Duplicate catalog coin ID');
      ids.add(id);
      if (typeof r.symbol !== 'string' || !r.symbol.trim() || typeof r.name !== 'string' || !r.name.trim()) incompleteMetadataCount++;
      if (r.platforms && typeof r.platforms === 'object' && !Array.isArray(r.platforms)) {
        contractMappingCount += Object.values(r.platforms).filter(v => typeof v === 'string' && v.trim()).length;
      }
    }
    return { catalogCount: ids.size, contractMappingCount, incompleteMetadataCount };
  }
  function parseMarkets(raw, { page = 1, fetchedAt = Date.now(), now = Date.now() } = {}) {
    count(page, 'Page'); timestamp(fetchedAt); timestamp(now);
    const rows = [], errors = [], ids = new Set();
    for (const r of list(raw, 'Markets')) {
      try {
        const id = text(r && r.id, 'Coin ID');
        if (ids.has(id)) throw Error('Duplicate coin ID within page');
        ids.add(id);
        const priceUsd = numeric(r.current_price, 'USD price', true);
        if (priceUsd === 0) throw Error('No positive USD price');
        const providerUpdatedAt = sourceTime(r.last_updated);
        if (providerUpdatedAt > now + 300000) throw Error('Provider timestamp is in the future');
        rows.push({ id, sourceId: 'coingecko', key: 'coingecko:' + id, symbol: text(r.symbol, 'Symbol'), name: text(r.name, 'Coin name'),
          priceUsd, marketCapUsd: optional(r.market_cap, 'Market cap', true), volume24hUsd: optional(r.total_volume, 'Volume', true),
          rank: r.market_cap_rank === null || r.market_cap_rank === undefined ? null : count(r.market_cap_rank, 'Rank'),
          return24hPct: optional(r.price_change_percentage_24h_in_currency === undefined ? r.price_change_percentage_24h : r.price_change_percentage_24h_in_currency, '24h percentage'),
          return7dPct: optional(r.price_change_percentage_7d_in_currency, '7d percentage'), return30dPct: optional(r.price_change_percentage_30d_in_currency, '30d percentage'),
          providerUpdatedAt, fetchedAt, sourcePage: page });
      } catch (e) { errors.push({ id: r && typeof r.id === 'string' ? r.id : null, message: e.message }); }
    }
    return { page, inputCount: raw.length, rows, errors, fetchedAt };
  }
  function mergeMarkets(pages) {
    const byId = new Map(); let duplicateCount = 0;
    for (const p of list(pages, 'Market pages')) for (const row of list(p.rows, 'Market rows')) {
      const old = byId.get(row.id);
      if (old) duplicateCount++;
      if (!old || row.providerUpdatedAt > old.providerUpdatedAt || (row.providerUpdatedAt === old.providerUpdatedAt && row.fetchedAt > old.fetchedAt)) byId.set(row.id, row);
    }
    return { pricedRows: [...byId.values()].sort((a, b) => (a.rank === null ? Infinity : a.rank) - (b.rank === null ? Infinity : b.rank) || a.id.localeCompare(b.id)), duplicateCount };
  }
  function parseGlobal(raw) {
    const r = raw && raw.data;
    if (!r || typeof r !== 'object') throw Error('Missing global data');
    return { providerActiveAssetCount: count(r.active_cryptocurrencies, 'Active assets'), providerExchangeCount: count(r.markets, 'Exchange count'),
      totalMarketCapUsd: numeric(r.total_market_cap && r.total_market_cap.usd, 'Total market cap', true), totalVolume24hUsd: numeric(r.total_volume && r.total_volume.usd, 'Total volume', true),
      marketCapChange24hPct: optional(r.market_cap_change_percentage_24h_usd, 'Market cap change'), providerUpdatedAt: timestamp(numeric(r.updated_at, 'Global timestamp') * 1000) };
  }
  function parseStablecoinHistory(raw) {
    const dates = new Map();
    for (const r of list(raw, 'Stablecoin history')) {
      if (!r || (typeof r.date !== 'number' && typeof r.date !== 'string') || !String(r.date).trim()) throw Error('Missing stablecoin date');
      const time = timestamp(Number(r.date) * 1000), supplyUsd = usdTotal(r.totalCirculatingUSD);
      if (dates.has(time) && dates.get(time) !== supplyUsd) throw Error('Conflicting stablecoin date');
      dates.set(time, supplyUsd);
    }
    return [...dates].sort((a, b) => a[0] - b[0]).map(([time, supplyUsd]) => ({ time, supplyUsd }));
  }
  function mergeChains(tvlRaw, stableRaw) {
    const rows = new Map(), tvlSeen = new Set(), stableSeen = new Set();
    for (const r of list(tvlRaw, 'Chain TVL')) {
      const chain = text(r && r.name, 'Chain');
      if (tvlSeen.has(chain)) throw Error('Duplicate chain TVL row');
      tvlSeen.add(chain); rows.set(chain, { chain, tvlUsd: numeric(r.tvl, 'TVL', true), stablecoinSupplyUsd: null });
    }
    for (const r of list(stableRaw, 'Chain stablecoins')) {
      const chain = text(r && r.name, 'Chain');
      if (stableSeen.has(chain)) throw Error('Duplicate chain stablecoin row');
      stableSeen.add(chain);
      const row = rows.get(chain) || { chain, tvlUsd: null, stablecoinSupplyUsd: null };
      row.stablecoinSupplyUsd = usdTotal(r.totalCirculatingUSD); rows.set(chain, row);
    }
    return [...rows.values()].sort((a, b) => (b.tvlUsd === null ? -1 : b.tvlUsd) - (a.tvlUsd === null ? -1 : a.tvlUsd) || a.chain.localeCompare(b.chain));
  }
  function validateSnapshot(raw) {
    if (!raw || raw.schemaVersion !== 1) throw Error('Unsupported ecosystem snapshot');
    timestamp(raw.generatedAt);
    const g = raw.global;
    if (!g || g.provider !== 'CoinGecko' || g.currency !== 'USD' || g.rankScope !== 'top_market_cap') throw Error('Invalid market scope');
    count(g.catalogCount, 'Catalog count'); count(g.pricedCount, 'Priced count');
    if (g.pricedCount !== list(g.pricedRows, 'Priced rows').length || g.pricedCount > g.catalogCount) throw Error('Inconsistent catalog/priced coverage');
    const ids = new Set();
    for (const r of g.pricedRows) {
      const id = text(r.id, 'Coin ID'); if (ids.has(id)) throw Error('Duplicate normalized coin'); ids.add(id);
      if (r.sourceId !== 'coingecko' || r.key !== 'coingecko:' + id) throw Error('Wrong market identity');
      text(r.symbol, 'Symbol'); text(r.name, 'Name'); numeric(r.priceUsd, 'USD price', true); if (r.priceUsd === 0) throw Error('Zero USD price');
      optional(r.marketCapUsd, 'Market cap', true); optional(r.volume24hUsd, 'Volume', true);
      for (const k of ['return24hPct', 'return7dPct', 'return30dPct']) optional(r[k], k);
      timestamp(r.providerUpdatedAt); timestamp(r.fetchedAt);
    }
    let previous = 0;
    for (const r of list(raw.stablecoinHistory, 'Stablecoin history')) { timestamp(r.time); numeric(r.supplyUsd, 'Supply USD', true); if (r.time <= previous) throw Error('Unsorted/duplicate stablecoin dates'); previous = r.time; }
    const chains = new Set();
    for (const r of list(raw.chains, 'Chains')) { const chain = text(r.chain, 'Chain'); if (chains.has(chain)) throw Error('Duplicate normalized chain'); chains.add(chain); optional(r.tvlUsd, 'TVL', true); optional(r.stablecoinSupplyUsd, 'Supply USD', true); }
    for (const r of list(raw.provenance, 'Provenance')) { text(r.id, 'Source ID'); text(r.sourceUrl, 'Source URL'); timestamp(r.fetchedAt); count(r.recordCount, 'Record count'); if (!/^[a-f0-9]{64}$/.test(r.sha256)) throw Error('Invalid SHA256'); }
    return raw;
  }
  async function loadSnapshot(url = './data/ecosystem-snapshot.json', fetchImpl = globalThis.fetch) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetchImpl(url, { method: 'GET', credentials: 'omit', cache: 'no-store', signal: controller.signal, headers: { Accept: 'application/json' } });
      if (!res.ok) throw Error('Ecosystem snapshot HTTP ' + res.status);
      return validateSnapshot(await res.json());
    } finally { clearTimeout(timer); }
  }
  function pause(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
  async function requestRaw(url, fetchImpl, now) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetchImpl(url, { method: 'GET', credentials: 'omit', cache: 'no-store', signal: controller.signal, headers: { Accept: 'application/json' } });
      if (!res.ok) {
        const error = Error(res.status === 429 ? 'CoinGecko giới hạn lượt gọi (HTTP 429); đã dừng cập nhật, giữ bản trước.' : 'CoinGecko HTTP ' + res.status + '; đã dừng cập nhật, giữ bản trước.');
        error.status = res.status; throw error;
      }
      const body = await res.text();
      let raw; try { raw = JSON.parse(body); } catch (_) { throw Error('CoinGecko không trả JSON hợp lệ; giữ bản trước.'); }
      if (!globalThis.crypto || !globalThis.crypto.subtle) throw Error('Trình duyệt không hỗ trợ xác minh SHA-256; giữ bản trước.');
      const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
      return { raw, fetchedAt: timestamp(now()), sha256: [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, '0')).join('') };
    } catch (e) {
      if (e.name === 'AbortError') throw Error('CoinGecko hết thời gian sau 15 giây; giữ bản trước.');
      if (e instanceof TypeError) throw Error('Không truy cập được CoinGecko (mạng hoặc CORS); giữ bản trước.');
      throw e;
    } finally { clearTimeout(timer); }
  }
  /* Only USD market rows/global aggregates refresh. Catalog and DeFi observations retain their source times.
     The injected wait/clock support offline checks; production pacing is eight seconds, with no retries. */
  async function refresh(previousSnapshot, fetchImpl = globalThis.fetch, { wait = pause, now = Date.now } = {}) {
    const previous = validateSnapshot(previousSnapshot || await loadSnapshot('./data/ecosystem-snapshot.json', fetchImpl));
    const pages = [], provenance = [];
    for (let page = 1; page <= 4; page++) {
      if (page > 1) await wait(8000);
      const url = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=' + page + '&sparkline=false&price_change_percentage=7d%2C30d';
      const result = await requestRaw(url, fetchImpl, now);
      const parsed = parseMarkets(result.raw, { page, fetchedAt: result.fetchedAt, now: now() });
      if (!parsed.rows.length) throw Error('Trang CoinGecko ' + page + ' không có giá hợp lệ; giữ bản trước.');
      pages.push(parsed); provenance.push({ id: 'coingecko_markets_page' + page, sourceUrl: url, fetchedAt: result.fetchedAt, sha256: result.sha256, recordCount: parsed.inputCount,
        meaning: 'Aggregated USD market data; sequential market-cap page with original provider observation times.' });
    }
    await wait(8000);
    const globalResult = await requestRaw(SOURCE_URLS.global, fetchImpl, now), aggregate = parseGlobal(globalResult.raw), merged = mergeMarkets(pages);
    provenance.push({ id: 'coingecko_global', sourceUrl: SOURCE_URLS.global, fetchedAt: globalResult.fetchedAt, sha256: globalResult.sha256, recordCount: 1, meaning: 'Provider global aggregates; distinct scope from catalog and priced sample.' });
    const preservedProvenance = previous.provenance.filter(p => !p.id.startsWith('coingecko_markets_page') && p.id !== 'coingecko_global');
    const out = { ...previous, generatedAt: timestamp(now()),
      global: { ...previous.global, ...aggregate, pricedCount: merged.pricedRows.length, pricedRows: merged.pricedRows, duplicatePageRowCount: merged.duplicateCount,
        excludedMarketRowCount: pages.reduce((sum, p) => sum + p.errors.length, 0), requestPages: pages.map(p => ({ page: p.page, status: 'ok', inputCount: p.inputCount, pricedCount: p.rows.length, fetchedAt: p.fetchedAt, errors: p.errors })) },
      provenance: [...preservedProvenance, ...provenance], refreshedSections: ['global.pricedRows', 'global.aggregates'], preservedSections: ['global.catalogCount', 'stablecoinHistory', 'chains'] };
    return validateSnapshot(out);
  }
  return { DAY, SOURCE_URLS, parseCatalog, parseMarkets, mergeMarkets, parseGlobal, parseStablecoinHistory, mergeChains, validateSnapshot, loadSnapshot, refresh };
});
