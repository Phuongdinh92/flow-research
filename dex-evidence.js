(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FlowDexEvidence = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const ADDRESS = /^0x[0-9a-f]{40}$/;
  const HASH = /^0x[0-9a-f]{64}$/;
  const SHA = /^[0-9a-f]{64}$/;
  const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
  const RAW = /^(?:0|[1-9]\d*)$/;
  const POOL = '0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640';
  const BASE = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
  const QUOTE = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
  const fail = (message) => { throw new Error('DEX evidence: ' + message); };
  const isObject = x => x && typeof x === 'object' && !Array.isArray(x);
  const time = (x, name) => {
    if (typeof x !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(x) || !Number.isFinite(Date.parse(x))) fail('invalid ' + name);
    return Date.parse(x);
  };
  const finiteDecimal = (x, name) => {
    if (typeof x !== 'string' || !DECIMAL.test(x) || !Number.isFinite(Number(x))) fail('invalid ' + name);
    return x;
  };
  const source = (x, name) => {
    if (!isObject(x) || !SHA.test(x.sha256 || '') || typeof x.url !== 'string') fail('missing provenance for ' + name);
    const u = new URL(x.url);
    if (u.protocol !== 'https:' || u.username || u.password || !['api.geckoterminal.com', 'api.coingecko.com', 'eth.drpc.org'].includes(u.hostname)) fail('invalid source URL');
    time(x.fetchedAt, 'source time');
    return x;
  };
  const block = x => {
    if (!isObject(x) || !Number.isSafeInteger(x.number) || x.number < 1 || !HASH.test(x.hash || '')) fail('invalid finalized block');
    time(x.timestamp, 'block timestamp');
    return x;
  };

  function formatToken(raw, decimals, places = 6) {
    if (typeof raw !== 'string' || !RAW.test(raw) || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) return '—';
    if (!Number.isInteger(places) || places < 0 || places > 36) return '—';
    const s = raw.padStart(decimals + 1, '0');
    const integer = decimals ? s.slice(0, -decimals) : s;
    const fraction = decimals ? s.slice(-decimals) : '';
    const shown = fraction.slice(0, places).replace(/0+$/, '');
    const omitted = fraction.slice(places).replace(/0/g, '').length > 0;
    if (integer === '0' && !shown && omitted) return places ? '<0.' + '0'.repeat(places - 1) + '1' : '<1';
    return integer + (shown ? '.' + shown : '') + (omitted ? '…' : '');
  }

  function validateSnapshot(raw, options = {}) {
    if (!isObject(raw) || raw.schemaVersion !== 1 || raw.kind !== 'sampled-dex-evidence') fail('unsupported schema');
    const now = options.now === undefined ? Date.now() : options.now;
    if (!Number.isFinite(now)) fail('invalid clock');
    const generated = time(raw.generatedAt, 'generatedAt');
    if (generated > now + 120000) fail('snapshot from the future');
    if (!isObject(raw.network) || raw.network.id !== 'eth' || raw.network.chainId !== 1) fail('unsupported network');
    if (!isObject(raw.pool) || raw.pool.address !== POOL || raw.pool.dexId !== 'uniswap_v3') fail('unsupported pool');
    for (const [key, address, decimals, coingeckoId] of [['baseToken', BASE, 18, 'weth'], ['quoteToken', QUOTE, 6, 'usd-coin']]) {
      const token = raw.pool[key];
      if (!isObject(token) || token.address !== address || token.decimals !== decimals || token.coingeckoId !== coingeckoId || !token.symbol) fail('invalid token identity or decimals');
    }
    if (!isObject(raw.sources)) fail('missing sources');
    source(raw.sources.trades, 'trades'); source(raw.sources.pool, 'pool'); source(raw.sources.catalog, 'catalog'); source(raw.sources.tokenIdentity, 'RPC token identity');
    const tradesFetched = time(raw.sources.trades.fetchedAt, 'trades fetch');
    if (tradesFetched > generated + 120000) fail('trade source fetched after snapshot');
    const finalized = block(raw.finalizedBlock);
    if (Date.parse(finalized.timestamp) > generated + 120000) fail('finalized block is from the future');
    const before = block(raw.blockChecks && raw.blockChecks.before);
    const after = block(raw.blockChecks && raw.blockChecks.after);
    if ([before, after].some(x => x.number !== finalized.number || x.hash !== finalized.hash || x.timestamp !== finalized.timestamp)) fail('block hash/time changed during collection');
    source(raw.sources.blockBefore, 'block before'); source(raw.sources.blockAfter, 'block after');
    if (!Array.isArray(raw.trades) || raw.trades.length > 300 || raw.trades.length === 0) fail('invalid trade count');
    const ids = new Set();
    let buyUsd = 0, sellUsd = 0;
    const senders = new Map();
    let firstMs = Infinity, lastMs = -Infinity, finalizedCount = 0;
    const trades = raw.trades.map(t => {
      if (!isObject(t) || typeof t.id !== 'string' || ids.has(t.id) || !HASH.test(t.txHash || '') || !ADDRESS.test(t.sender || '')) fail('invalid or duplicate trade');
      ids.add(t.id);
      if (!Number.isSafeInteger(t.blockNumber) || t.blockNumber < 1) fail('invalid trade block');
      const ms = time(t.blockTimestamp, 'trade timestamp');
      if (ms > tradesFetched + 120000 || tradesFetched - ms > 26 * 3600000) fail('trade outside returned 24h lookback');
      if (!['buy', 'sell'].includes(t.kind)) fail('invalid side');
      if (t.kind === 'buy' ? t.fromTokenAddress !== QUOTE || t.toTokenAddress !== BASE : t.fromTokenAddress !== BASE || t.toTokenAddress !== QUOTE) fail('trade side/token mismatch');
      finiteDecimal(t.fromTokenAmount, 'from amount'); finiteDecimal(t.toTokenAmount, 'to amount'); finiteDecimal(t.volumeUsd, 'USD estimate');
      const done = t.blockNumber <= finalized.number;
      if (done && ms > Date.parse(finalized.timestamp)) fail('trade block/time inconsistent');
      if (done) finalizedCount++;
      firstMs = Math.min(firstMs, ms); lastMs = Math.max(lastMs, ms);
      const usd = Number(t.volumeUsd);
      if (t.kind === 'buy') buyUsd += usd; else sellUsd += usd;
      let s = senders.get(t.sender);
      if (!s) { s = { address: t.sender, observedTradeCount: 0, finalizedTradeCount: 0, observedBuyUsd: 0, observedSellUsd: 0, finalizedBuyUsd: 0, finalizedSellUsd: 0, maxFinalizedTradeUsd: 0 }; senders.set(t.sender, s); }
      s.observedTradeCount++; if (done) { s.finalizedTradeCount++; s.maxFinalizedTradeUsd = Math.max(s.maxFinalizedTradeUsd, usd); s[t.kind === 'buy' ? 'finalizedBuyUsd' : 'finalizedSellUsd'] += usd; }
      s[t.kind === 'buy' ? 'observedBuyUsd' : 'observedSellUsd'] += usd;
      return Object.assign({}, t, { isFinalized: done });
    });
    const c = raw.coverage;
    if (!isObject(c) || c.returnedCount !== trades.length || c.limit !== 300 || c.eligibleFinalizedCount !== finalizedCount || c.observedUniqueSenders !== senders.size) fail('coverage count mismatch');
    if (time(c.firstTradeAt, 'first trade') !== firstMs || time(c.lastTradeAt, 'last trade') !== lastMs) fail('sample window mismatch');
    for (const name of ['reported24hBuys', 'reported24hSells']) if (!Number.isSafeInteger(c[name]) || c[name] < 0) fail('invalid reported 24h trades');
    finiteDecimal(c.reported24hVolumeUsd, 'reported 24h USD volume');
    if (!Array.isArray(raw.senders) || raw.senders.length > 20 || c.checkedSenderCount !== raw.senders.filter(x => x.balanceBaseRaw !== null && x.balanceQuoteRaw !== null).length) fail('invalid balance coverage');
    const balanceAddresses = new Set();
    const rows = raw.senders.map(x => {
      const stat = senders.get(x.address);
      if (!stat || !stat.finalizedTradeCount || balanceAddresses.has(x.address) || x.ownershipVerified !== false) fail('invalid sender selection');
      balanceAddresses.add(x.address);
      if (x.blockNumber !== finalized.number || x.blockHash !== finalized.hash) fail('balance state block mismatch');
      for (const key of ['balanceBaseRaw', 'balanceQuoteRaw']) if (x[key] !== null && (typeof x[key] !== 'string' || !RAW.test(x[key]) || BigInt(x[key]) >= 2n ** 256n)) fail('invalid raw token balance');
      if (![true, false, null].includes(x.hasCode)) fail('invalid account code flag');
      if (x.balanceBaseRaw === null || x.balanceQuoteRaw === null || x.hasCode === null) {
        if (typeof x.error !== 'string' || !x.error) fail('missing unavailable-balance reason');
      }
      source(x.provenance, 'sender RPC');
      return Object.assign({}, x, stat, { netObservedBuyUsd: stat.observedBuyUsd - stat.observedSellUsd, netFinalizedBuyUsd: stat.finalizedBuyUsd - stat.finalizedSellUsd });
    });
    const routing = raw.routingExample;
    if (routing !== null && routing !== undefined) {
      const trade = trades.find(t => t.txHash === routing.txHash && t.sender === routing.sender && t.kind === 'buy' && t.isFinalized);
      if (!trade || !ADDRESS.test(routing.recipient || '') || routing.baseTokenAddress !== BASE || routing.blockNumber !== trade.blockNumber || !HASH.test(routing.blockHash || '') || !Number.isSafeInteger(routing.logIndex) || routing.logIndex < 0) fail('invalid routing receipt');
      if (routing.finalizedBlockNumber !== finalized.number || routing.finalizedBlockHash !== finalized.hash || routing.recipientBalanceBeforeBlockNumber !== trade.blockNumber - 1 || typeof routing.recipientHasCode !== 'boolean') fail('routing balance block mismatch');
      for (const key of ['baseTransferRaw', 'recipientBalanceBeforeRaw', 'recipientBalanceFinalizedRaw']) if (typeof routing[key] !== 'string' || !RAW.test(routing[key]) || BigInt(routing[key]) >= 2n ** 256n) fail('invalid routing balance');
      source(routing.receiptProvenance, 'routing receipt'); source(routing.balanceProvenance, 'routing balance');
    }
    return Object.assign({}, raw, {
      trades, senders: rows,
      sampleTotals: { buyUsd, sellUsd, netBuyUsd: buyUsd - sellUsd },
      freshness: { ageMs: Math.max(0, now - tradesFetched), isStale: now - tradesFetched > 15 * 60000 },
      limitations: ['Only the latest returned trades of one liquidity pool; not the whole market or a full 24-hour trade ledger.', 'Transaction sender is not necessarily swap recipient or beneficial owner.', 'Balances are token quantities at the named finalized block, not verified purchase retention, cost basis, whale identity, or historical holder cohorts.', 'USD trade values are provider valuations; they are not settled US dollars.']
    });
  }

  async function loadSnapshot(url, options = {}) {
    const fetcher = options.fetch || (typeof fetch === 'function' && fetch);
    if (!fetcher) fail('fetch unavailable');
    const response = await fetcher(url, { cache: 'no-store', signal: options.signal });
    if (!response || !response.ok) fail('snapshot HTTP ' + (response && response.status));
    return validateSnapshot(await response.json(), options);
  }

  function aggregateBuckets(snapshot, minutes = 5) {
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60) fail('invalid bucket interval');
    const width = minutes * 60000, buckets = new Map();
    for (const t of snapshot.trades) {
      const start = Math.floor(Date.parse(t.blockTimestamp) / width) * width;
      if (!buckets.has(start)) buckets.set(start, { start, buyUsd: 0, sellUsd: 0, count: 0 });
      const b = buckets.get(start); b[t.kind === 'buy' ? 'buyUsd' : 'sellUsd'] += Number(t.volumeUsd); b.count++;
    }
    return [...buckets.values()].sort((a, b) => a.start - b.start).map(x => Object.assign(x, { deltaUsd: x.buyUsd - x.sellUsd }));
  }
  return { validateSnapshot, loadSnapshot, formatToken, aggregateBuckets };
});
