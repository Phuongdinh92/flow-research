/* Historical native HBAR custody balances from Hedera's public Mirror Node.
   Rank cohorts are accounts, not identified whales, people or purchases. */
(function(root, factory) { 'use strict'; const api = factory(); if (typeof module === 'object' && module.exports) module.exports = api; root.FlowHolderHistory = api; })(typeof globalThis === 'object' ? globalThis : this, function() {
  'use strict';
  const BASE = 'https://mainnet.mirrornode.hedera.com';
  const ASSET = Object.freeze({ id: 'hedera-hbar', symbol: 'HBAR', chain: 'hedera-mainnet', assetType: 'native', decimals: 8, identityUrl: 'https://docs.hedera.com/hedera/core-concepts/hbars' });
  const GROUPS = Object.freeze([[1, 100], [101, 200], [201, 300], [301, 500], [501, 1000]].map(Object.freeze));
  const CLASSIFICATION_AS_OF = '2026-10-06';
  const TREASURY_SOURCE = 'https://hederacouncil.org/treasury';
  const INFRASTRUCTURE_SOURCE = 'https://hedera.com/blog/hip-1261-a-developer-guide-to-simple-fees/';
  // Exact account lists/ranges published by the Council. No memo-based guessing,
  // numeric "small account" inference or community exchange labels are applied.
  function knownAccountInfo(id) {
    account(id); const n = BigInt(id.split('.')[2]); let classification = null, label = null, sourceUrl = null, sourceAsOf = null;
    if (n === 2n || n === 49n || (n >= 400n && n <= 438n)) { classification = 'council_unallocated_supply_account'; label = 'Hedera Council · unallocated supply account list'; sourceUrl = TREASURY_SOURCE; sourceAsOf = CLASSIFICATION_AS_OF; }
    else if ((n >= 42n && n <= 48n) || (n >= 50n && n <= 71n) || (n >= 73n && n <= 87n) || (n >= 99n && n <= 102n) || n === 111n || n === 112n || (n >= 439n && n <= 499n)) { classification = 'council_allocated_supply_account'; label = 'Hedera Council · allocated supply account list'; sourceUrl = TREASURY_SOURCE; sourceAsOf = CLASSIFICATION_AS_OF; }
    else if ([98n, 800n, 801n, 802n].includes(n)) { classification = 'network_fee_or_reward_account'; label = ({ '98': 'Council operations', '800': 'Staking rewards', '801': 'Node rewards', '802': 'Fee collection' })[String(n)]; sourceUrl = INFRASTRUCTURE_SOURCE; sourceAsOf = '2026-05-14'; }
    return { account: id, classification: classification || 'unclassified', label, sourceUrl, sourceAsOf, exclusionEligible: classification !== null, meaning: classification ? 'Current official account-purpose classification; applying it to older observations is retrospective, not point-in-time trading evidence.' : 'No verified classification in this registry; may still be infrastructure, exchange custody or multiple beneficial owners.' };
  }
  function raw(v) { if (typeof v !== 'string' || !/^(0|[1-9][0-9]{0,30})$/.test(v)) throw Error('Expected exact nonnegative tinybar integer string'); return BigInt(v); }
  function account(v) { if (typeof v !== 'string' || !/^0\.0\.(0|[1-9][0-9]{0,19})$/.test(v)) throw Error('Invalid Hedera mainnet account ID'); return v; }
  function stamp(v) { if (typeof v !== 'string' || !/^[1-9][0-9]{8,10}\.[0-9]{9}$/.test(v)) throw Error('Invalid consensus timestamp'); return BigInt(v.replace('.', '')); }
  function timestampMs(v) { return Number(stamp(v) / 1000000n); }
  function integer(v, min = 0, max = Number.MAX_SAFE_INTEGER) { if (!Number.isSafeInteger(v) || v < min || v > max) throw Error('Invalid integer'); return v; }
  function idCompare(a, b) { const aa = BigInt(a.split('.')[2]), bb = BigInt(b.split('.')[2]); return aa < bb ? -1 : aa > bb ? 1 : 0; }
  function balanceCompare(a, b) { const aa = raw(a.balanceRaw), bb = raw(b.balanceRaw); return aa > bb ? -1 : aa < bb ? 1 : idCompare(a.account, b.account); }
  // The provider encodes int64 balances as JSON numbers. Preserve source digits
  // before JSON.parse; converting an already parsed Number to a string loses data.
  function parseSource(body) {
    if (typeof body !== 'string') throw Error('Expected source JSON text');
    const value = JSON.parse(body.replace(/("balance"\s*:\s*)(-?[0-9]+)(?=\s*[,}])/g, '$1"$2"'));
    if (!Array.isArray(value.balances) || !value.links || !('next' in value.links)) throw Error('Invalid Mirror Node balance page');
    // A complete 100-row last page can still link to a final empty response;
    // Mirror Node returns timestamp:null for that empty terminal page.
    if (value.timestamp === null) { if (value.balances.length !== 0 || value.links.next !== null) throw Error('Null timestamp is only valid on an empty terminal page'); } else stamp(value.timestamp);
    value.balances.forEach(r => { account(r.account); raw(r.balance); });
    if (value.links.next !== null && (typeof value.links.next !== 'string' || !value.links.next.startsWith('/api/v1/balances?'))) throw Error('Invalid Mirror Node next link');
    return value;
  }
  function validateObservation(o) {
    if (!o || typeof o !== 'object' || !(o.id === 'latest' || (/^[1-9][0-9]{0,2}d$/.test(o.id) && Number(o.id.slice(0, -1)) <= 366))) throw Error('Invalid holder history observation');
    if (stamp(o.timestamp) > stamp(o.requestedCutoff)) throw Error('Source snapshot is after requested cutoff');
    if (stamp(o.requestedCutoff) - stamp(o.timestamp) > 900000000000n) throw Error('Source snapshot is older than the documented 15-minute granularity');
    const c = o.coverage;
    if (!c || c.selection !== 'all_accounts_at_or_above_minimum_then_locally_balance_ranked' || c.atomicProviderSnapshot !== true || c.truncatedBelowMinimum !== true) throw Error('Missing historical coverage semantics');
    const minimum = raw(c.minimumBalanceRaw); if (minimum <= 0n) throw Error('Historical threshold must be positive'); integer(c.requestedTopN, 1, 1000); integer(c.returnedUniverseCount); integer(c.completeTopN, 0, 1000);
    if (!Array.isArray(o.rows) || o.rows.length !== c.returnedUniverseCount || c.completeTopN !== Math.min(c.requestedTopN, o.rows.length)) throw Error('Holder coverage count mismatch');
    if (c.topNComplete !== (o.rows.length >= c.requestedTopN) || c.allFilteredPagesComplete !== true) throw Error('Incomplete filtered universe');
    const seen = new Set(); o.rows.forEach((r, i) => { account(r.account); raw(r.balanceRaw); if (r.rank !== i + 1 || raw(r.balanceRaw) < minimum || seen.has(r.account) || (i && balanceCompare(o.rows[i - 1], r) > 0)) throw Error('Invalid holder ranking'); if (r.providerLabel !== null || r.classification !== 'unclassified') throw Error('Unverified identity label'); seen.add(r.account); });
    integer(o.startedAt, 946684800000); integer(o.fetchedAt, o.startedAt);
    if (!Array.isArray(o.provenance) || !o.provenance.length) throw Error('Missing holder source proof');
    let lastAccount = null; const proofRows = o.provenance.reduce((sum, p, i) => {
      const url = new URL(p.url), emptyTerminal = p.timestamp === null && p.returnedCount === 0 && p.next === null && i === o.provenance.length - 1;
      if (url.origin !== BASE || url.pathname !== '/api/v1/balances' || url.searchParams.get('timestamp') !== 'lte:' + o.requestedCutoff || url.searchParams.get('account.balance') !== 'gte:' + c.minimumBalanceRaw || url.searchParams.get('order') !== 'asc' || p.httpStatus !== 200 || !/^[a-f0-9]{64}$/.test(p.sha256) || (p.timestamp !== o.timestamp && !emptyTerminal) || p.page !== i + 1) throw Error('Invalid source provenance');
      integer(p.fetchedAt, o.startedAt, o.fetchedAt); integer(p.returnedCount, 0, 100);
      if (p.returnedCount) { account(p.firstAccount); account(p.lastAccount); if (lastAccount !== null && idCompare(p.firstAccount, lastAccount) <= 0) throw Error('Nonadvancing historical pagination'); lastAccount = p.lastAccount; }
      if (i + 1 < o.provenance.length && !p.next) throw Error('Missing next page'); if (i + 1 === o.provenance.length && p.next !== null) throw Error('Unfinished historical pagination');
      if (p.next !== null && new URL(p.next, BASE).href !== o.provenance[i + 1]?.url) throw Error('Broken page chain');
      return sum + p.returnedCount;
    }, 0);
    if (proofRows !== o.rows.length) throw Error('Source row count mismatch');
    return o;
  }
  function validateSnapshot(s, { now = Date.now() } = {}) {
    if (!s || s.schemaVersion !== 1 || s.source?.id !== 'hedera-mirror-node' || s.source.baseUrl !== BASE || s.source.snapshotGranularitySeconds !== 900) throw Error('Unsupported holder history snapshot');
    for (const key of Object.keys(ASSET)) if (s.asset?.[key] !== ASSET[key]) throw Error('Holder history asset identity mismatch');
    integer(s.generatedAt, 946684800000, now + 300000); if (!Array.isArray(s.observations) || !s.observations.length) throw Error('Missing historical observations');
    const seen = new Set(); s.observations.forEach(o => { validateObservation(o); if (seen.has(o.id) || o.fetchedAt > s.generatedAt || timestampMs(o.timestamp) > o.startedAt) throw Error('Invalid historical observation time'); seen.add(o.id); });
    if (!seen.has('latest')) throw Error('Missing latest historical observation');
    const latest = s.observations.find(o => o.id === 'latest'), sourceTimes = new Set(); s.observations.forEach(o => {
      if (sourceTimes.has(o.timestamp)) throw Error('Duplicate historical source timestamp'); sourceTimes.add(o.timestamp);
      const days = o.id === 'latest' ? 0n : BigInt(o.id.slice(0, -1));
      if (stamp(latest.requestedCutoff) - stamp(o.requestedCutoff) !== days * 86400000000000n) throw Error('Observation ID does not match requested day offset');
      if (days > 0n && stamp(o.timestamp) >= stamp(latest.timestamp)) throw Error('Historical snapshot is not older');
    });
    if (s.history !== undefined) {
      const h = s.history; integer(h.requestedDailySnapshotCount, 1, 120);
      if (h.cutoffPolicy !== 'UTC_midnight_at_or_before_with_15_minute_source_granularity' || h.requestedLatestCutoff !== latest.requestedCutoff || stamp(h.requestedLatestCutoff) % 86400000000000n !== 0n || h.interpolation !== false) throw Error('Invalid daily history policy');
      for (let i = 0; i < h.requestedDailySnapshotCount; i++) if (!seen.has(i ? i + 'd' : 'latest')) throw Error('Missing requested daily observation');
    }
    if (s.meaning !== 'Native HBAR account custody balances, including unclassified infrastructure; not purchases, beneficial owners or validated whale accumulation.') throw Error('Missing measurement limits');
    return s;
  }
  function normalizeObservation(id, requestedCutoff, pages, minimumBalanceRaw, { startedAt, fetchedAt, requestedTopN = 1000 } = {}) {
    raw(minimumBalanceRaw); stamp(requestedCutoff); if (!Array.isArray(pages) || !pages.length) throw Error('Missing balance pages');
    const timestamp = pages[0].value.timestamp, seen = new Set(), rows = [];
    stamp(timestamp); pages.forEach((p, i) => { const emptyTerminal = p.value.timestamp === null && p.value.balances.length === 0 && p.value.links.next === null && i === pages.length - 1; if (p.value.timestamp !== timestamp && !emptyTerminal) throw Error('Source snapshot changed during pagination'); p.value.balances.forEach(r => { if (seen.has(r.account)) throw Error('Duplicate source account'); seen.add(r.account); rows.push({ account: account(r.account), balanceRaw: String(r.balance), providerLabel: null, classification: 'unclassified' }); }); });
    rows.sort(balanceCompare).forEach((r, i) => r.rank = i + 1);
    return validateObservation({ id, requestedCutoff, timestamp, startedAt, fetchedAt, rows, coverage: { selection: 'all_accounts_at_or_above_minimum_then_locally_balance_ranked', minimumBalanceRaw, requestedTopN, returnedUniverseCount: rows.length, completeTopN: Math.min(requestedTopN, rows.length), topNComplete: rows.length >= requestedTopN, allFilteredPagesComplete: true, atomicProviderSnapshot: true, truncatedBelowMinimum: true }, provenance: pages.map((p, i) => ({ ...p.proof, page: i + 1, timestamp: p.value.timestamp, returnedCount: p.value.balances.length, firstAccount: p.value.balances[0]?.account ?? null, lastAccount: p.value.balances.at(-1)?.account ?? null, next: p.value.links.next })) });
  }
  function rankedRows(o, { excludeKnownInfrastructure = false } = {}) {
    validateObservation(o); const rows = o.rows.filter(r => !excludeKnownInfrastructure || !knownAccountInfo(r.account).exclusionEligible).map((r, i) => ({ ...r, originalRank: r.rank, rank: i + 1 }));
    return { rows, topNComplete: rows.length >= o.coverage.requestedTopN, excludedCount: o.rows.length - rows.length, selection: excludeKnownInfrastructure ? 'balance_rank_after_current_official_council_and_network_exclusions' : 'all_account_balance_rank', classificationAsOf: excludeKnownInfrastructure ? CLASSIFICATION_AS_OF : null };
  }
  function distribution(o, options = {}) {
    const selection = rankedRows(o, options); return GROUPS.map(([rankStart, rankEnd]) => {
      const rows = selection.rows.filter(r => r.rank >= rankStart && r.rank <= rankEnd), expectedCount = rankEnd - rankStart + 1;
      const complete = rows.length === expectedCount && selection.topNComplete;
      return { rankStart, rankEnd, label: rankStart + '–' + rankEnd, expectedCount, count: rows.length, complete, selection: selection.selection, excludedCount: selection.excludedCount, classificationAsOf: selection.classificationAsOf, balanceRaw: complete ? rows.reduce((a, r) => a + raw(r.balanceRaw), 0n).toString() : null, knownBalanceRaw: rows.reduce((a, r) => a + raw(r.balanceRaw), 0n).toString() };
    });
  }
  function compare(older, newer, options = {}) {
    validateObservation(older); validateObservation(newer); if (stamp(newer.timestamp) <= stamp(older.timestamp)) throw Error('Comparison requires two ordered source snapshots');
    const oldSelection = rankedRows(older, options), newSelection = rankedRows(newer, options), map = new Map(newSelection.rows.map(r => [r.account, r])), anchorRows = oldSelection.rows.filter(r => r.rank <= older.coverage.requestedTopN);
    const groups = distribution(older, options).map(g => {
      const rows = anchorRows.filter(r => r.rank >= g.rankStart && r.rank <= g.rankEnd), covered = rows.filter(r => map.has(r.account));
      const missing = rows.filter(r => !map.has(r.account)), knownDelta = covered.reduce((s, r) => s + raw(map.get(r.account).balanceRaw) - raw(r.balanceRaw), 0n), complete = g.complete && covered.length === g.expectedCount;
      // Full pagination of the >=threshold universe proves each absent account's
      // balance lies in [0, threshold-1] tinybars. This yields bounds, never an
      // invented exact balance. No such bound is asserted for an incomplete anchor.
      const lower = knownDelta - missing.reduce((s, r) => s + raw(r.balanceRaw), 0n), upper = lower + BigInt(missing.length) * (raw(newer.coverage.minimumBalanceRaw) - 1n);
      return { rankStart: g.rankStart, rankEnd: g.rankEnd, label: g.label, expectedCount: g.expectedCount, anchorCount: rows.length, coveredCount: covered.length, missingAccountCount: missing.length, complete, knownDeltaRaw: knownDelta.toString(), deltaRaw: complete ? knownDelta.toString() : null, deltaLowerBoundRaw: g.complete ? lower.toString() : null, deltaUpperBoundRaw: g.complete ? upper.toString() : null, boundedDirection: !g.complete ? 'unknown' : lower > 0n ? 'increase' : upper < 0n ? 'decrease' : lower === 0n && upper === 0n ? 'unchanged' : 'uncertain', boundMeaning: 'Missing account custody balances are bounded by the complete minimum-balance filter; this does not establish purchases or sales.' };
    });
    const olderTop = new Set(anchorRows.map(r => r.account)), newerTop = new Set(newSelection.rows.filter(r => r.rank <= newer.coverage.requestedTopN).map(r => r.account));
    return { assetId: ASSET.id, olderTimestamp: older.timestamp, newerTimestamp: newer.timestamp, elapsedNanosecondsRaw: (stamp(newer.timestamp) - stamp(older.timestamp)).toString(), elapsedSeconds: Number(stamp(newer.timestamp) - stamp(older.timestamp)) / 1e9, anchor: 'older_snapshot_balance_rank_fixed_account_set', selection: oldSelection.selection, excludedOlderCount: oldSelection.excludedCount, excludedNewerCount: newSelection.excludedCount, classificationAsOf: oldSelection.classificationAsOf, meaning: 'Custody balance change of fixed account cohorts; not net buys, capital inflow or whale identity.', groups,
      changedAccounts: anchorRows.filter(r => map.has(r.account) && map.get(r.account).balanceRaw !== r.balanceRaw).map(r => ({ account: r.account, anchorRank: r.rank, newerRank: map.get(r.account).rank, olderBalanceRaw: r.balanceRaw, newerBalanceRaw: map.get(r.account).balanceRaw, deltaRaw: (raw(map.get(r.account).balanceRaw) - raw(r.balanceRaw)).toString() })),
      missingAccounts: anchorRows.filter(r => !map.has(r.account)).map(r => ({ account: r.account, anchorRank: r.rank, olderBalanceRaw: r.balanceRaw, newerBalanceRaw: null, deltaRaw: null })),
      rankMembership: { complete: oldSelection.topNComplete && newSelection.topNComplete, enteredTopN: [...newerTop].filter(a => !olderTop.has(a)), exitedTopN: [...olderTop].filter(a => !newerTop.has(a)), meaning: 'Changes in rank-set membership, not newly created accounts, purchases or sales.' } };
  }
  function cohortSeries(s, { anchorObservationId, excludeKnownInfrastructure = false } = {}) {
    validateSnapshot(s); const observations = [...s.observations].sort((a, b) => stamp(a.timestamp) < stamp(b.timestamp) ? -1 : 1), anchor = anchorObservationId ? observations.find(o => o.id === anchorObservationId) : observations[0];
    if (!anchor) throw Error('Unknown cohort anchor');
    const options = { excludeKnownInfrastructure }, selected = rankedRows(anchor, options);
    return { assetId: ASSET.id, anchorObservationId: anchor.id, anchorTimestamp: anchor.timestamp, selection: selected.selection, excludedAnchorCount: selected.excludedCount, classificationAsOf: selected.classificationAsOf, meaning: 'Fixed account groups ranked at the anchor snapshot; missing balances remain null.', groups: distribution(anchor, options).map(g => {
      const rows = selected.rows.filter(r => r.rank >= g.rankStart && r.rank <= g.rankEnd), anchorBalance = rows.reduce((s, r) => s + raw(r.balanceRaw), 0n);
      const points = observations.map(o => {
        const map = new Map(o.rows.map(r => [r.account, r])), covered = rows.filter(r => map.has(r.account)), sum = covered.reduce((s, r) => s + raw(map.get(r.account).balanceRaw), 0n), complete = g.complete && covered.length === g.expectedCount;
        const upper = sum + BigInt(rows.length - covered.length) * (raw(o.coverage.minimumBalanceRaw) - 1n);
        return { id: o.id, timestamp: o.timestamp, timeMs: timestampMs(o.timestamp), expectedCount: g.expectedCount, coveredCount: covered.length, missingAccountCount: rows.length - covered.length, complete, knownBalanceRaw: sum.toString(), balanceRaw: complete ? sum.toString() : null, balanceLowerBoundRaw: g.complete ? sum.toString() : null, balanceUpperBoundRaw: g.complete ? upper.toString() : null, deltaFromAnchorRaw: complete ? (sum - anchorBalance).toString() : null, deltaFromAnchorLowerBoundRaw: g.complete ? (sum - anchorBalance).toString() : null, deltaFromAnchorUpperBoundRaw: g.complete ? (upper - anchorBalance).toString() : null };
      });
      points.forEach((p, i) => { const previous = points[i - 1]; p.elapsedSecondsFromPrevious = previous ? Number(stamp(p.timestamp) - stamp(previous.timestamp)) / 1e9 : null; p.deltaFromPreviousRaw = previous && p.complete && previous.complete ? (raw(p.balanceRaw) - raw(previous.balanceRaw)).toString() : null; p.deltaFromPreviousLowerBoundRaw = previous && g.complete ? (raw(p.balanceLowerBoundRaw) - raw(previous.balanceUpperBoundRaw)).toString() : null; p.deltaFromPreviousUpperBoundRaw = previous && g.complete ? (raw(p.balanceUpperBoundRaw) - raw(previous.balanceLowerBoundRaw)).toString() : null; });
      return { rankStart: g.rankStart, rankEnd: g.rankEnd, label: g.label, points };
    }) };
  }
  function formatRaw(v, { decimals = 8, maxFraction = 4, group = true } = {}) {
    const neg = typeof v === 'string' && v.startsWith('-'), n = raw(neg ? v.slice(1) : v); integer(decimals, 0, 30); integer(maxFraction, 0, 30); const places = Math.min(decimals, maxFraction), trim = decimals - places, rounded = trim ? (n + 10n ** BigInt(trim) / 2n) / (10n ** BigInt(trim)) : n, scale = 10n ** BigInt(places), whole = (rounded / scale).toString(), fraction = places ? (rounded % scale).toString().padStart(places, '0').replace(/0+$/, '') : '';
    return (neg && rounded ? '−' : '') + (group ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : whole) + (fraction ? '.' + fraction : '');
  }
  async function loadSnapshot(url = './data/holder-history-snapshot.json', fetchImpl = globalThis.fetch) { const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 30000); try { const r = await fetchImpl(url, { credentials: 'omit', cache: 'no-store', signal: controller.signal }); if (!r.ok) throw Error('Holder history HTTP ' + r.status); return validateSnapshot(await r.json()); } finally { clearTimeout(timer); } }
  return Object.freeze({ ASSET, GROUPS, CLASSIFICATION_AS_OF, knownAccountInfo, rankedRows, parseSource, timestampMs, validateObservation, validateSnapshot, normalizeObservation, distribution, compare, cohortSeries, formatRaw, loadSnapshot });
});
