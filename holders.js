/* Public TON holder observations. Owner accounts are not identified people or whales.
   Exact balances remain decimal integer strings. No historical balance is inferred. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.FlowHolders = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const SOURCE = 'https://tonapi.io/v2/jettons/';
  const REGISTRY = 'https://github.com/tonkeeper/ton-assets/blob/main/jettons.json';
  const TOKENS = Object.freeze([
    { id: 'ston', symbol: 'STON', name: 'STON', chain: 'ton-mainnet', master: '0:3690254dc15b2297610cda60744a45f2b710aa4234b89adb630e99d79b01bd4f', decimals: 9, identityUrl: 'https://docs.ston.fi/developer-section/dex/sdk/legacy/v0.4/swap', identityKind: 'issuer_documentation_and_tonkeeper_registry' },
    { id: 'not', symbol: 'NOT', name: 'Notcoin', chain: 'ton-mainnet', master: '0:2f956143c461769579baef2e32cc2d7bc18283f40d20bb03e432cd603ac33ffc', decimals: 9, identityUrl: REGISTRY, identityKind: 'tonkeeper_curated_registry' },
    { id: 'dogs', symbol: 'DOGS', name: 'Dogs', chain: 'ton-mainnet', master: '0:afc49cb8786f21c87045b19ede78fc6b46c51048513f8e9a6d44060199c1bf0c', decimals: 9, identityUrl: REGISTRY, identityKind: 'tonkeeper_curated_registry' }
  ].map(Object.freeze));
  let lastRequestAt = 0, refreshing = false;
  function object(v, label) { if (!v || typeof v !== 'object' || Array.isArray(v)) throw Error(label + ': invalid object'); return v; }
  function array(v, label) { if (!Array.isArray(v)) throw Error(label + ': expected array'); return v; }
  function integer(v, label, min = 0, max = Number.MAX_SAFE_INTEGER) { if (!Number.isSafeInteger(v) || v < min || v > max) throw Error(label + ': invalid integer'); return v; }
  function time(v) { return integer(v, 'Timestamp', 946684800000, 4102444800000); }
  function raw(v, label = 'Raw balance') { if (typeof v !== 'string' || !/^(0|[1-9][0-9]{0,199})$/.test(v)) throw Error(label + ': expected exact nonnegative decimal integer string'); return BigInt(v); }
  function address(v) { if (typeof v !== 'string' || !/^0:[0-9a-f]{64}$/.test(v)) throw Error('Invalid raw TON mainnet address'); return v; }
  function label(v) { if (v === null || v === undefined) return null; if (typeof v !== 'string' || !v.trim() || v.length > 300) throw Error('Invalid provider label'); return v; }
  function tokenDefinition(id) { const d = TOKENS.find(t => t.id === id); if (!d) throw Error('Unsupported holder token ID'); return d; }
  function sharePercent(balanceRaw, totalSupplyRaw, precision = 6) {
    const b = raw(balanceRaw), supply = raw(totalSupplyRaw, 'Total supply');
    integer(precision, 'Precision', 0, 12); if (supply === 0n) return null;
    const scale = 10n ** BigInt(precision), rounded = (b * 100n * scale + supply / 2n) / supply;
    return Number(rounded) / Number(scale);
  }
  function formatRaw(value, decimals, { maxFraction = 6, group = true } = {}) {
    const n = raw(value); integer(decimals, 'Decimals', 0, 255); integer(maxFraction, 'Maximum fraction', 0, 255);
    const places = Math.min(decimals, maxFraction), trim = decimals - places;
    const rounded = trim ? (n + (10n ** BigInt(trim)) / 2n) / (10n ** BigInt(trim)) : n;
    const scale = 10n ** BigInt(places), whole = (rounded / scale).toString();
    const prefix = group ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : whole;
    const fraction = places ? (rounded % scale).toString().padStart(places, '0').replace(/0+$/, '') : '';
    return prefix + (fraction ? '.' + fraction : '');
  }
  function distribution(token) {
    validateToken(token);
    const groups = [[1, 100], [101, 200], [201, 300], [301, 500], [501, 1000]];
    return groups.map(([rankStart, rankEnd]) => {
      const rows = token.rows.filter(r => r.sourceRank >= rankStart && r.sourceRank <= rankEnd);
      const sum = rows.reduce((s, r) => s + raw(r.balanceRaw), 0n).toString();
      return { rankStart, rankEnd, label: rankStart + '–' + rankEnd, count: rows.length, expectedCount: Math.max(0, Math.min(rankEnd, token.holderCountReported) - rankStart + 1), balanceRaw: sum,
        supplySharePct: sharePercent(sum, token.totalSupplyRaw), complete: rows.length === Math.max(0, Math.min(rankEnd, token.holderCountReported) - rankStart + 1), selection: 'provider_balance_rank_at_observation' };
    });
  }
  function validateToken(t, { now = Date.now() } = {}) {
    object(t, 'Holder token'); const d = tokenDefinition(t.id);
    for (const k of ['chain', 'master', 'symbol', 'decimals']) if (t[k] !== d[k]) throw Error('Holder token identity mismatch: ' + k);
    address(t.master); if (typeof t.name !== 'string' || !t.name.trim()) throw Error('Missing token name');
    const supply = raw(t.totalSupplyRaw, 'Total supply'); if (supply <= 0n) throw Error('Nonpositive token supply');
    integer(t.holderCountReported, 'Reported holder count'); time(t.startedAt); time(t.fetchedAt); if (t.fetchedAt < t.startedAt) throw Error('Reversed collection times');
    time(now); if (t.startedAt > now + 300000 || t.fetchedAt > now + 300000) throw Error('Holder observation timestamp is in the future');
    const rows = array(t.rows, 'Holder rows'), owners = new Set(), wallets = new Set(); let previous = null, sum = 0n;
    rows.forEach((r, i) => {
      object(r, 'Holder row'); if (r.sourceRank !== i + 1) throw Error('Missing or reordered source rank');
      address(r.owner); address(r.jettonWallet);
      if (owners.has(r.owner) || wallets.has(r.jettonWallet)) throw Error('Duplicate owner or jetton wallet');
      owners.add(r.owner); wallets.add(r.jettonWallet);
      const value = raw(r.balanceRaw); if (previous !== null && value > previous) throw Error('Unsorted provider holder balances'); previous = value; sum += value;
      label(r.providerLabel); if (typeof r.isWallet !== 'boolean') throw Error('Missing provider wallet-interface flag');
    });
    if (sum > supply) throw Error('Observed holder sum exceeds reported token supply');
    const c = object(t.coverage, 'Holder coverage'); integer(c.requestedTopN, 'Requested top holders', 1, 1000);
    if (rows.length !== Math.min(c.requestedTopN, t.holderCountReported)) throw Error('Incomplete requested holder page');
    if (c.returnedCount !== rows.length || c.completeTopN !== rows.length || c.truncated !== (rows.length < t.holderCountReported) || c.selection !== 'provider_balance_desc') throw Error('Invalid holder coverage');
    const ix = object(t.indexerState, 'Indexer state'); if (ix.atomicBlock !== false || ix.blockHeight !== null) throw Error('Unsupported fixed-block assertion');
    if (typeof ix.description !== 'string' || !ix.description) throw Error('Missing indexer state explanation');
    if (t.identityUrl !== d.identityUrl || t.identityKind !== d.identityKind) throw Error('Identity provenance mismatch');
    const proof = array(t.provenance, 'Holder source proof'); if (proof.length !== 2) throw Error('Missing holder source proof');
    const expected = [SOURCE + d.master, SOURCE + d.master + '/holders?limit=' + c.requestedTopN + '&offset=0&sort_by=balance'];
    proof.forEach((p, i) => { object(p, 'Source proof'); if (p.id !== ['token_info', 'holder_page'][i] || p.url !== expected[i] || p.httpStatus !== 200 || !/^[a-f0-9]{64}$/.test(p.sha256)) throw Error('Invalid holder source proof'); time(p.fetchedAt); if (p.fetchedAt < t.startedAt || p.fetchedAt > t.fetchedAt) throw Error('Source time outside collection window'); });
    return t;
  }
  function validateSnapshot(s, { now = Date.now() } = {}) {
    object(s, 'Holder snapshot'); if (s.schemaVersion !== 1 || s.sourceId !== 'tonapi') throw Error('Unsupported holder snapshot');
    time(s.generatedAt); time(now); if (s.generatedAt > now + 300000) throw Error('Holder snapshot timestamp is in the future'); const seen = new Set();
    array(s.tokens, 'Holder tokens').forEach(t => { validateToken(t, { now }); if (seen.has(t.id)) throw Error('Duplicate holder token'); seen.add(t.id); if (t.fetchedAt > s.generatedAt) throw Error('Holder observation later than snapshot'); });
    if (s.observations !== undefined) {
      const observations = new Set();
      array(s.observations, 'Retained holder observations').forEach(t => {
        validateToken(t, { now }); const key = t.id + ':' + t.fetchedAt;
        if (observations.has(key)) throw Error('Duplicate retained holder observation');
        observations.add(key); if (t.fetchedAt > s.generatedAt) throw Error('Retained observation later than snapshot');
      });
    }
    return s;
  }
  /* Retains the older observation's ranked owner set. Only owners actually observed
     at both times contribute; missing data never becomes a zero balance. This is
     an observed custody change, not a purchase, capital flow or person classification. */
  function compare(older, newer) {
    validateToken(older); validateToken(newer);
    for (const k of ['id', 'chain', 'master', 'decimals']) if (older[k] !== newer[k]) throw Error('Cannot compare different holder identities');
    if (newer.fetchedAt <= older.fetchedAt) throw Error('Holder comparison requires two ordered observations');
    const next = new Map(newer.rows.map(r => [r.owner, r]));
    return { id: older.id, chain: older.chain, master: older.master, olderFetchedAt: older.fetchedAt, newerFetchedAt: newer.fetchedAt,
      anchor: 'older_observation_provider_balance_rank', meaning: 'Observed token balance change of the same owner accounts; no purchase or beneficial-owner inference.',
      changedOwners: older.rows.filter(r => next.has(r.owner) && next.get(r.owner).balanceRaw !== r.balanceRaw).map(r => {
        const current = next.get(r.owner);
        return { owner: r.owner, jettonWallet: r.jettonWallet, providerLabel: current.providerLabel, isWallet: current.isWallet,
          anchorRank: r.sourceRank, newerRank: current.sourceRank, olderBalanceRaw: r.balanceRaw, newerBalanceRaw: current.balanceRaw,
          deltaRaw: (raw(current.balanceRaw) - raw(r.balanceRaw)).toString() };
      }),
      groups: distribution(older).map(group => {
        const anchorRows = older.rows.filter(r => r.sourceRank >= group.rankStart && r.sourceRank <= group.rankEnd);
        const covered = anchorRows.filter(r => next.has(r.owner));
        const known = covered.reduce((sum, r) => sum + raw(next.get(r.owner).balanceRaw) - raw(r.balanceRaw), 0n).toString();
        const complete = group.expectedCount > 0 && anchorRows.length === group.expectedCount && covered.length === anchorRows.length;
        return { rankStart: group.rankStart, rankEnd: group.rankEnd, label: group.label, expectedCount: group.expectedCount, anchorCount: anchorRows.length, coveredCount: covered.length,
          missingOwnerCount: anchorRows.length - covered.length, knownDeltaRaw: known, deltaRaw: complete ? known : null, complete };
      }) };
  }
  function normalizeToken(id, info, holderPage, proof, { startedAt, fetchedAt, requestedTopN = 1000 }) {
    const d = tokenDefinition(id); object(info, 'Token info'); object(holderPage, 'Holder page'); object(info.metadata, 'Token metadata');
    if (info.metadata.address !== d.master || info.metadata.symbol !== d.symbol || String(info.metadata.decimals) !== String(d.decimals) || info.verification !== 'whitelist') throw Error('Token API identity/verification mismatch');
    const rows = array(holderPage.addresses, 'Source holders').map((r, i) => {
      object(r, 'Source holder'); object(r.owner, 'Source owner');
      raw(r.balance);
      return { sourceRank: i + 1, owner: address(r.owner.address), jettonWallet: address(r.address), balanceRaw: r.balance, providerLabel: label(r.owner.name), isWallet: r.owner.is_wallet };
    });
    return validateToken({ ...d, name: info.metadata.name, totalSupplyRaw: info.total_supply, holderCountReported: holderPage.total, rows,
      coverage: { requestedTopN, returnedCount: rows.length, completeTopN: rows.length, truncated: rows.length < holderPage.total, selection: 'provider_balance_desc' },
      indexerState: { atomicBlock: false, blockHeight: null, description: 'Latest TonAPI indexed state observed during the collection window; no common block height is returned by these endpoints.' },
      startedAt: time(startedAt), fetchedAt: time(fetchedAt), provenance: proof });
  }
  async function loadSnapshot(url = './data/holders-snapshot.json', fetchImpl = globalThis.fetch) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
    try { const r = await fetchImpl(url, { method: 'GET', credentials: 'omit', cache: 'no-store', signal: controller.signal, headers: { Accept: 'application/json' } }); if (!r.ok) throw Error('Holder snapshot HTTP ' + r.status); return validateSnapshot(await r.json()); }
    finally { clearTimeout(timer); }
  }
  function pause(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
  async function digest(body) {
    if (!globalThis.crypto || !globalThis.crypto.subtle) throw Error('SHA-256 is unavailable; prior holder observation retained.');
    const hash = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
    return [...new Uint8Array(hash)].map(n => n.toString(16).padStart(2, '0')).join('');
  }
  async function request(url, fetchImpl, { wait, now, onReceipt }) {
    const remaining = Math.max(0, 5000 - (now() - lastRequestAt)); if (remaining) await wait(remaining);
    lastRequestAt = time(now()); const requestedAt = lastRequestAt;
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 40000);
    try {
      const r = await fetchImpl(url, { method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal, headers: { Accept: 'application/json' } });
      const body = await r.text(), fetchedAt = time(now()), sha256 = await digest(body);
      const receipt = { url, requestedAt, fetchedAt, httpStatus: r.status, sha256 };
      if (onReceipt) await onReceipt({ ...receipt, body });
      if (!r.ok) { const error = Error('TonAPI HTTP ' + r.status + '; stopped without retry, prior holder observation retained.'); error.status = r.status; throw error; }
      let value; try { value = JSON.parse(body); } catch (_) { throw Error('Invalid TonAPI JSON; prior holder observation retained.'); }
      return { value, proof: receipt };
    } catch (e) { if (e.name === 'AbortError') throw Error('TonAPI timed out after 40 seconds; prior holder observation retained.'); throw e; }
    finally { clearTimeout(timer); }
  }
  /* One token per update; module-wide pacing and lock prevent parallel refreshes.
     Receipt hooks are for maintainers; raw bodies are not embedded in the public snapshot. */
  async function refresh(previousSnapshot, tokenId, fetchImpl = globalThis.fetch, { wait = pause, now = Date.now, onReceipt } = {}) {
    validateSnapshot(previousSnapshot); const d = tokenDefinition(tokenId); if (refreshing) throw Error('A holder update is already in progress.'); refreshing = true;
    try {
      const startedAt = time(now()), requestedTopN = 1000, options = { wait, now, onReceipt };
      const info = await request(SOURCE + d.master, fetchImpl, options);
      const holders = await request(SOURCE + d.master + '/holders?limit=' + requestedTopN + '&offset=0&sort_by=balance', fetchImpl, options);
      const t = normalizeToken(tokenId, info.value, holders.value, [{ id: 'token_info', ...info.proof }, { id: 'holder_page', ...holders.proof }], { startedAt, fetchedAt: holders.proof.fetchedAt, requestedTopN });
      const tokens = [...previousSnapshot.tokens.filter(x => x.id !== tokenId), t].sort((a, b) => TOKENS.findIndex(x => x.id === a.id) - TOKENS.findIndex(x => x.id === b.id));
      const history = [...(previousSnapshot.observations || []), ...previousSnapshot.tokens, t];
      const observations = [...new Map(history.map(x => [x.id + ':' + x.fetchedAt, x])).values()];
      return validateSnapshot({ ...previousSnapshot, generatedAt: time(now()), tokens, observations });
    } finally { refreshing = false; }
  }
  return Object.freeze({ TOKENS, validateToken, validateSnapshot, normalizeToken, loadSnapshot, refresh, formatRaw, sharePercent, distribution, compare });
});
