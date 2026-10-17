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
    const ids = new Set(), entries = []; let contractMappingCount = 0, incompleteMetadataCount = 0;
    for (const r of list(raw, 'Catalog')) {
      const id = text(r && r.id, 'Coin ID');
      if (ids.has(id)) throw Error('Duplicate catalog coin ID');
      ids.add(id);
      if (typeof r.symbol !== 'string' || !r.symbol.trim() || typeof r.name !== 'string' || !r.name.trim()) incompleteMetadataCount++;
      const platforms = {};
      if (r.platforms && typeof r.platforms === 'object' && !Array.isArray(r.platforms)) {
        for (const [chain, address] of Object.entries(r.platforms)) if (typeof address === 'string' && address.trim()) { platforms[chain] = address; contractMappingCount++; }
      }
      entries.push({ id, symbol: typeof r.symbol === 'string' ? r.symbol : '', name: typeof r.name === 'string' ? r.name : '', platforms });
    }
    entries.sort((a,b) => a.id.localeCompare(b.id));
    return { catalogCount: ids.size, contractMappingCount, incompleteMetadataCount, entries };
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
          return1hPct: optional(r.price_change_percentage_1h_in_currency, '1h percentage'),
          return7dPct: optional(r.price_change_percentage_7d_in_currency, '7d percentage'), return30dPct: optional(r.price_change_percentage_30d_in_currency, '30d percentage'),
          return1yPct: optional(r.price_change_percentage_1y_in_currency, '1y percentage'),
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
    if (!g || g.provider !== 'CoinGecko' || g.currency !== 'USD' || !['top_market_cap', 'active_catalog'].includes(g.rankScope)) throw Error('Invalid market scope');
    count(g.catalogCount, 'Catalog count'); count(g.pricedCount, 'Priced count');
    if (g.pricedCount !== list(g.pricedRows, 'Priced rows').length || g.pricedCount > g.catalogCount) throw Error('Inconsistent catalog/priced coverage');
    const ids = new Set();
    for (const r of g.pricedRows) {
      const id = text(r.id, 'Coin ID'); if (ids.has(id)) throw Error('Duplicate normalized coin'); ids.add(id);
      if (r.sourceId !== 'coingecko' || r.key !== 'coingecko:' + id) throw Error('Wrong market identity');
      text(r.symbol, 'Symbol'); text(r.name, 'Name'); numeric(r.priceUsd, 'USD price', true); if (r.priceUsd === 0) throw Error('Zero USD price');
      optional(r.marketCapUsd, 'Market cap', true); optional(r.volume24hUsd, 'Volume', true);
      for (const k of ['return1hPct', 'return24hPct', 'return7dPct', 'return30dPct', 'return1yPct']) optional(r[k], k);
      timestamp(r.providerUpdatedAt); timestamp(r.fetchedAt);
    }
    let previous = 0;
    for (const r of list(raw.stablecoinHistory, 'Stablecoin history')) { timestamp(r.time); numeric(r.supplyUsd, 'Supply USD', true); if (r.time <= previous) throw Error('Unsorted/duplicate stablecoin dates'); previous = r.time; }
    const chains = new Set();
    for (const r of list(raw.chains, 'Chains')) { const chain = text(r.chain, 'Chain'); if (chains.has(chain)) throw Error('Duplicate normalized chain'); chains.add(chain); optional(r.tvlUsd, 'TVL', true); optional(r.stablecoinSupplyUsd, 'Supply USD', true); }
    for (const r of list(raw.provenance, 'Provenance')) { text(r.id, 'Source ID'); sourceUrl(r.sourceUrl); timestamp(r.fetchedAt); count(r.recordCount, 'Record count'); if (!/^[a-f0-9]{64}$/.test(r.sha256)) throw Error('Invalid SHA256'); }
    return raw;
  }
  const COVERAGE_STATUSES = Object.freeze(['priced', 'no_quote', 'missing', 'invalid', 'error', 'unattempted']);
  const ROW_BIND_FIELDS = Object.freeze(['id','sourceId','key','symbol','name','priceUsd','marketCapUsd','volume24hUsd','rank','return24hPct','return1hPct','return7dPct','return30dPct','return1yPct','providerUpdatedAt','fetchedAt','sourcePage','sourceBatch','sourceSha256']);
  function rowBinding(row) { return JSON.stringify(ROW_BIND_FIELDS.map(k => row[k] === undefined ? null : row[k])); }
  function hash(v, name = 'SHA256') { if (typeof v !== 'string' || !/^[a-f0-9]{64}$/.test(v)) throw Error('Invalid ' + name); return v; }
  function sourceUrl(v) { if (typeof v !== 'string' || v.length > 65536 || !/^https:\/\//.test(v)) throw Error('Invalid source URL'); return v; }
  function requestSource(v, name) {
    if (!v || typeof v !== 'object') throw Error('Missing ' + name);
    sourceUrl(v.sourceUrl); timestamp(v.startedAt); timestamp(v.fetchedAt); hash(v.sha256);
    if (v.fetchedAt < v.startedAt) throw Error('Source receipt precedes request');
    return v;
  }
  function coverageCounts(entries) {
    const out = { catalogCount: entries.length, attempted: 0, priced: 0, no_quote: 0, missing: 0, invalid: 0, error: 0, unattempted: 0 };
    for (const r of entries) { if (!COVERAGE_STATUSES.includes(r.status)) throw Error('Unknown coverage status'); out[r.status]++; if (r.status !== 'unattempted') out.attempted++; }
    return out;
  }
  function validateCoverageLedger(raw) {
    if (!raw || raw.schemaVersion !== 1 || raw.provider !== 'CoinGecko' || raw.currency !== 'USD' || raw.scope !== 'active_catalog_frozen_at_start') throw Error('Unsupported market coverage ledger');
    hash(raw.generationId, 'generation ID');
    const c = raw.collection; if (!c || typeof c.complete !== 'boolean' || typeof c.frozenCatalogComplete !== 'boolean' || typeof c.activeAfterCovered !== 'boolean') throw Error('Invalid coverage collection');
    timestamp(c.startedAt); timestamp(c.finishedAt); if (c.finishedAt < c.startedAt) throw Error('Invalid collection interval');
    const before = requestSource(raw.catalogBefore, 'catalog before'), after = requestSource(raw.catalogAfter, 'catalog after');
    count(before.count, 'Catalog before count'); count(after.count, 'Catalog after count');
    if (before.startedAt < c.startedAt || after.fetchedAt > c.finishedAt || after.startedAt < before.fetchedAt) throw Error('Invalid catalog source interval');
    if (before.sourceUrl !== SOURCE_URLS.catalog || after.sourceUrl !== SOURCE_URLS.catalog) throw Error('Wrong catalog source');
    const entries = list(raw.entries, 'Coverage entries'), entryMap = new Map();
    for (const e of entries) {
      const id = text(e.id, 'Coverage coin ID'); if (entryMap.has(id)) throw Error('Duplicate coverage coin ID'); entryMap.set(id,e);
      if (typeof e.symbol !== 'string' || typeof e.name !== 'string' || !e.platforms || typeof e.platforms !== 'object' || Array.isArray(e.platforms)) throw Error('Invalid catalog metadata');
      for (const [chain,address] of Object.entries(e.platforms)) { text(chain,'Platform'); if (typeof address !== 'string' || !address.trim() || address.length > 1000) throw Error('Invalid catalog contract'); }
      if (!COVERAGE_STATUSES.includes(e.status) || typeof e.activeAfter !== 'boolean') throw Error('Invalid coverage status');
      if (e.status !== 'priced' && (typeof e.reason !== 'string' || !e.reason)) throw Error('Missing coverage exclusion reason');
    }
    const counts = coverageCounts(entries); if (before.count !== entries.length) throw Error('Catalog count does not match frozen entries');
    for (const [k,v] of Object.entries(counts)) if (raw.counts?.[k] !== v) throw Error('Coverage count mismatch: ' + k);
    const added = list(raw.churn?.addedIds, 'Added catalog IDs'), removed = list(raw.churn?.removedIds, 'Removed catalog IDs');
    if (new Set(added).size !== added.length || new Set(removed).size !== removed.length) throw Error('Duplicate catalog churn ID');
    for (const id of added) if (entryMap.has(text(id,'Added ID'))) throw Error('Added ID already frozen');
    const removedSet = new Set(removed); for (const id of removed) if (!entryMap.has(text(id,'Removed ID'))) throw Error('Removed ID was not frozen');
    if (after.count !== before.count - removed.length + added.length) throw Error('Catalog churn count mismatch');
    for (const e of entries) if (e.activeAfter === removedSet.has(e.id)) throw Error('Catalog membership differs from churn');
    const batches = list(raw.batches, 'Coverage batches'), batchMap = new Map(), owned = new Set(); let previousRequest = before;
    for (const b of batches) {
      const id = text(b.batchId, 'Batch ID'); if (batchMap.has(id)) throw Error('Duplicate coverage batch'); batchMap.set(id,b); requestSource(b,'market batch');
      if (b.startedAt < before.fetchedAt || b.fetchedAt > after.startedAt || b.startedAt < previousRequest.fetchedAt || b.startedAt - previousRequest.startedAt < 8000) throw Error('Market batch outside catalog interval');
      previousRequest = b;
      const owns = list(b.ownedIds,'Batch owned IDs'), requested = list(b.requestedIds,'Batch requested IDs');
      if (!owns.length || owns.length > 249 || new Set(owns).size !== owns.length || requested.length > 250 || new Set(requested).size !== requested.length) throw Error('Invalid market batch size');
      const expected = [...owns]; if (!expected.includes('bitcoin')) expected.push('bitcoin');
      if (JSON.stringify(expected) !== JSON.stringify(requested)) throw Error('Wrong market batch anchor membership');
      const u = new URL(b.sourceUrl); if (u.origin !== 'https://api.coingecko.com' || u.pathname !== '/api/v3/coins/markets' || u.searchParams.get('vs_currency') !== 'usd' || u.searchParams.get('per_page') !== '250' || u.searchParams.get('order') !== 'id_asc' || u.searchParams.get('page') !== '1' || u.searchParams.get('ids') !== requested.join(',')) throw Error('Wrong explicit market request');
      count(b.inputCount,'Market input count');
      for (const coinId of owns) { if (!entryMap.has(coinId) || owned.has(coinId)) throw Error('Invalid duplicate or foreign batch owner'); owned.add(coinId); const e=entryMap.get(coinId); if(e.batchId !== id || e.fetchedAt !== b.fetchedAt || e.sourceSha256 !== b.sha256 || e.status === 'unattempted') throw Error('Coverage entry differs from owned batch'); }
      const benchmark=raw.benchmarksByBatch?.[id];
      if (benchmark !== null && benchmark !== undefined) {
        if (benchmark.id !== 'bitcoin' || benchmark.sourceId !== 'coingecko' || benchmark.key !== 'coingecko:bitcoin' || benchmark.sourceBatch !== id || benchmark.sourceSha256 !== b.sha256 || benchmark.fetchedAt !== b.fetchedAt) throw Error('Wrong market BTC anchor');
        numeric(benchmark.priceUsd,'BTC price',true); if (!benchmark.priceUsd) throw Error('Zero BTC price'); timestamp(benchmark.providerUpdatedAt);
        for (const k of ['return1hPct','return24hPct','return7dPct','return30dPct','return1yPct']) optional(benchmark[k],k);
        if (benchmark.providerUpdatedAt > benchmark.fetchedAt + 300000) throw Error('BTC anchor is in the future');
      }
    }
    for (const id of Object.keys(raw.benchmarksByBatch || {})) if (!batchMap.has(id)) throw Error('Foreign BTC anchor batch');
    for (const e of entries) {
      if (e.status === 'unattempted') { if (e.batchId !== null || e.fetchedAt !== null || e.sourceSha256 !== null) throw Error('Unattempted ID has a source'); }
      else if (!owned.has(e.id)) throw Error('Attempted ID has no owned batch');
      if (e.status === 'priced' && typeof e.rowBinding !== 'string') throw Error('Priced ID has no row binding');
      if (e.status !== 'priced' && e.rowBinding !== null) throw Error('Unpriced ID has market row binding');
    }
    const frozenComplete = counts.unattempted === 0 && counts.error === 0 && owned.size === entries.length;
    const activeCovered = frozenComplete && added.length === 0;
    if (c.frozenCatalogComplete !== frozenComplete || c.activeAfterCovered !== activeCovered || c.complete !== activeCovered) throw Error('False collection completeness');
    return raw;
  }
  function validateCollectionAttempt(raw) {
    if (!raw || raw.schemaVersion !== 1 || raw.provider !== 'CoinGecko' || !['collecting','failed','complete','frozen_catalog_complete_with_churn'].includes(raw.state)) throw Error('Unsupported market collection attempt');
    timestamp(raw.startedAt); timestamp(raw.observedAt); if (raw.observedAt < raw.startedAt) throw Error('Invalid attempt interval');
    count(raw.completedBatches,'Completed batches');
    if (raw.state === 'failed' && (raw.previousPublishedPairRetained !== true || typeof raw.message !== 'string' || !raw.message)) throw Error('Invalid failed attempt');
    if (raw.counts === null) { if (raw.entries?.length) throw Error('Attempt entries without a frozen catalog'); return raw; }
    const entries=list(raw.entries,'Attempt catalog entries'), ids=new Set(), counts=coverageCounts(entries);
    for (const [k,v] of Object.entries(counts)) if (raw.counts?.[k] !== v) throw Error('Attempt coverage partition mismatch: ' + k);
    if (raw.scope !== 'active_catalog_frozen_at_start') throw Error('Wrong attempt catalog scope');
    const catalog=requestSource(raw.catalogBefore,'Attempt catalog'); count(catalog.count,'Attempt catalog count'); if(catalog.count!==entries.length || catalog.sourceUrl!==SOURCE_URLS.catalog || catalog.startedAt<raw.startedAt || catalog.fetchedAt>raw.observedAt) throw Error('Attempt catalog differs');
    hash(raw.generationId,'Attempt generation ID');
    const requests=list(raw.requests,'Attempt requests'), byBatch=new Map(), requestKeys=new Set(); let successfulBatches=0, previousRequest=null;
    for (const r of requests) {
      requestSource(r,'Attempt request'); count(r.status,'HTTP status'); count(r.bytes,'Response bytes'); text(r.key,'Request key');
      if(requestKeys.has(r.key))throw Error('Duplicate attempt request');requestKeys.add(r.key);
      if(r.startedAt<raw.startedAt || r.fetchedAt>raw.observedAt || (previousRequest && (r.startedAt<previousRequest.fetchedAt || r.startedAt-previousRequest.startedAt<8000))) throw Error('Attempt request outside ordered source interval'); previousRequest=r;
      if(/^market-batch-\d{4}$/.test(r.key)) {
        const index=Number(r.key.slice(-4)),owned=entries.slice((index-1)*249,index*249).map(e=>e.id),requested=[...owned];if(!requested.includes('bitcoin'))requested.push('bitcoin');
        const u=new URL(r.sourceUrl);if(!owned.length||u.origin!=='https://api.coingecko.com'||u.pathname!=='/api/v3/coins/markets'||u.searchParams.get('vs_currency')!=='usd'||u.searchParams.get('per_page')!=='250'||u.searchParams.get('page')!=='1'||u.searchParams.get('order')!=='id_asc'||u.searchParams.get('ids')!==requested.join(','))throw Error('Attempt request differs from frozen owned-ID batch');
        byBatch.set('coingecko_market_batch_'+r.key.slice(-4),r); if(r.status===200)successfulBatches++;
      }
    }
    if(successfulBatches!==raw.completedBatches)throw Error('Attempt successful batch count mismatch');
    for (const e of entries) {
      const id=text(e.id,'Attempt ID');if(ids.has(id))throw Error('Duplicate attempt ID');ids.add(id);
      if(typeof e.symbol!=='string'||typeof e.name!=='string'||!e.platforms||typeof e.platforms!=='object'||Array.isArray(e.platforms))throw Error('Invalid attempt metadata');
      if(e.status==='unattempted'){if(e.batchId!==null||e.fetchedAt!==null||e.sourceSha256!==null)throw Error('Unattempted ID has a source');}
      else { const r=byBatch.get(e.batchId); if(r){if(e.fetchedAt!==r.fetchedAt||e.sourceSha256!==r.sha256)throw Error('Attempt entry differs from source');const u=new URL(r.sourceUrl);if(u.origin!=='https://api.coingecko.com'||u.pathname!=='/api/v3/coins/markets'||!u.searchParams.get('ids')?.split(',').includes(id))throw Error('Attempt ID was not requested');if(e.status==='error'&&r.status===200)throw Error('HTTP-success record labeled provider error');if(e.status!=='error'&&r.status!==200)throw Error('HTTP-failed record labeled success');}else if(e.status!=='error'||e.fetchedAt!==null||e.sourceSha256!==null)throw Error('Attempted ID lacks source receipt'); }
      if(e.status!=='priced'&&(typeof e.reason!=='string'||!e.reason))throw Error('Missing attempt exclusion reason');
    }
    if (raw.state==='complete' && (counts.error || counts.unattempted)) throw Error('False complete attempt');
    return raw;
  }

  function validateMarketCoveragePair(snapshot, ledger, { coverageSha256 } = {}) {
    validateSnapshot(snapshot); validateCoverageLedger(ledger); hash(coverageSha256, 'decoded coverage SHA256');
    const g=snapshot.global, reference=g.catalogCoverage;
    if (g.rankScope !== 'active_catalog' || !reference || reference.scope !== ledger.scope || reference.generationId !== ledger.generationId || reference.coverageSha256 !== coverageSha256 || reference.complete !== ledger.collection.complete || g.catalogCount !== ledger.counts.catalogCount || g.pricedCount !== ledger.counts.priced || JSON.stringify(g.collection) !== JSON.stringify(ledger.collection)) throw Error('Market snapshot and coverage ledger differ');
    const entries=new Map(ledger.entries.map(e=>[e.id,e]));
    for (const r of g.pricedRows) { const e=entries.get(r.id); if (!e || e.status !== 'priced' || e.batchId !== r.sourceBatch || e.sourceSha256 !== r.sourceSha256 || e.fetchedAt !== r.fetchedAt || e.rowBinding !== rowBinding(r)) throw Error('Market row differs from coverage evidence'); }
    const catalogProof=snapshot.provenance.filter(p=>p.id==='coingecko_catalog_before' || p.id==='coingecko_catalog_after');
    for (const [id,p] of [['coingecko_catalog_before',ledger.catalogBefore],['coingecko_catalog_after',ledger.catalogAfter]]) if (!catalogProof.some(q=>q.id===id&&q.sha256===p.sha256&&q.fetchedAt===p.fetchedAt&&q.sourceUrl===p.sourceUrl&&q.recordCount===p.count)) throw Error('Catalog provenance differs');
    for (const b of ledger.batches) if (!snapshot.provenance.some(p=>p.id===b.batchId&&p.sourceUrl===b.sourceUrl&&p.sha256===b.sha256&&p.fetchedAt===b.fetchedAt&&p.recordCount===b.inputCount)) throw Error('Market batch provenance differs');
    return {snapshot,ledger};
  }
  async function loadCoverageLedger(url = './data/market-coverage.json', fetchImpl = globalThis.fetch) {
    const controller = new AbortController(), timer=setTimeout(()=>controller.abort(),15000);
    try { const res=await fetchImpl(url,{method:'GET',credentials:'omit',cache:'no-store',signal:controller.signal,headers:{Accept:'application/json'}}); if (!res.ok) throw Error('Market coverage HTTP ' + res.status); return validateCoverageLedger(await res.json()); } finally {clearTimeout(timer);}
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
    if (previous.global.rankScope === 'active_catalog') throw Error('Bản quét toàn danh mục phải được đọc lại cùng bằng chứng độ phủ đã xác minh; không thay bằng bốn trang xếp hạng.');
    const pages = [], provenance = [];
    for (let page = 1; page <= 4; page++) {
      if (page > 1) await wait(8000);
      const url = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=' + page + '&sparkline=false&price_change_percentage=1h%2C24h%2C7d%2C30d%2C1y';
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
  return { DAY, SOURCE_URLS, COVERAGE_STATUSES, ROW_BIND_FIELDS, rowBinding, coverageCounts, validateCoverageLedger, validateCollectionAttempt, validateMarketCoveragePair, loadCoverageLedger, parseCatalog, parseMarkets, mergeMarkets, parseGlobal, parseStablecoinHistory, mergeChains, validateSnapshot, loadSnapshot, refresh };
});
