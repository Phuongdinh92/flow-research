'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./holder-history.js');
const BASE = 'https://mainnet.mirrornode.hedera.com';
const oldStamp = '1789516800.000000000', newStamp = '1792108800.000000000';
function fixture(id, timestamp, rows, { emptyTerminal = false, min = '1' } = {}) {
  if (emptyTerminal && rows.length % 100) throw Error('Empty terminal fixture requires a full prior page');
  const pages = [], length = Math.ceil(rows.length / 100) + (emptyTerminal ? 1 : 0);
  const urls = Array.from({ length }, (_, i) => BASE + '/api/v1/balances?limit=100&order=asc&account.balance=gte:' + min + '&timestamp=lte:' + timestamp + (i ? '&account.id=gt:' + rows[i * 100 - 1].account : ''));
  for (let i = 0; i < length; i++) {
    pages.push({ value: { timestamp: emptyTerminal && i === length - 1 ? null : timestamp, balances: rows.slice(i * 100, i * 100 + 100).map(r => ({ account: r.account, balance: r.balanceRaw })), links: { next: i + 1 < length ? urls[i + 1].slice(BASE.length) : null } }, proof: { url: urls[i], requestedAt: H.timestampMs(timestamp) + 1000, fetchedAt: H.timestampMs(timestamp) + 2000 + i, httpStatus: 200, sha256: 'a'.repeat(64), rawFile: i + '.raw.json' } });
  }
  return H.normalizeObservation(id, timestamp, pages, min, { startedAt: H.timestampMs(timestamp) + 1000, fetchedAt: H.timestampMs(timestamp) + 2000 + length });
}
const rows = Array.from({ length: 1100 }, (_, i) => ({ account: '0.0.' + (i + 1), balanceRaw: String(2000000 - i * 1000) }));
function snapshot(observations) { return { schemaVersion: 1, asset: H.ASSET, source: { id: 'hedera-mirror-node', baseUrl: BASE, snapshotGranularitySeconds: 900 }, generatedAt: H.timestampMs(newStamp) + 100000, meaning: 'Native HBAR account custody balances, including unclassified infrastructure; not purchases, beneficial owners or validated whale accumulation.', observations }; }
test('Mirror Node int64 digits survive parsing beyond Number precision', () => {
  const p = H.parseSource('{"timestamp":"1792195200.000000000","balances":[{"account":"0.0.2","balance":4999999999999999999,"tokens":[]}],"links":{"next":null}}');
  assert.equal(p.balances[0].balance, '4999999999999999999');
  assert.equal(H.formatRaw(p.balances[0].balance, { maxFraction: 8, group: false }), '49999999999.99999999');
  assert.throws(() => H.parseSource('{"timestamp":"1792195200.000000000","balances":[{"account":"0.0.2","balance":-1}],"links":{"next":null}}'), /nonnegative/);
});
test('accepts provider timestamp:null only on a linked empty terminal page, retaining null source provenance', () => {
  assert.deepEqual(H.parseSource('{"timestamp":null,"balances":[],"links":{"next":null}}').balances, []);
  assert.throws(() => H.parseSource('{"timestamp":null,"balances":[{"account":"0.0.2","balance":1}],"links":{"next":null}}'), /empty terminal/);
  const o = fixture('latest', newStamp, rows.slice(0, 1000), { emptyTerminal: true });
  assert.equal(o.rows.length, 1000); assert.equal(o.provenance.at(-1).timestamp, null); assert.equal(o.provenance.at(-1).returnedCount, 0); assert.equal(o.coverage.topNComplete, true);
});
test('locally ranks account-ID-ordered pages by exact balance and deterministic account-ID ties', () => {
  const mixed = structuredClone(rows); mixed[0].balanceRaw = '1000000'; mixed[100].balanceRaw = '4999999999999999999';
  const o = fixture('latest', newStamp, mixed);
  assert.equal(o.rows[0].account, '0.0.101'); assert.equal(o.rows[0].balanceRaw, '4999999999999999999');
  assert.equal(o.coverage.returnedUniverseCount, 1100); assert.equal(o.coverage.completeTopN, 1000);
  assert.equal(o.coverage.topNComplete, true); assert.equal(H.distribution(o).reduce((s, g) => s + g.count, 0), 1000);
});
test('fixed older cohort preserves identity through rank crossing', () => {
  const older = fixture('30d', oldStamp, rows), next = structuredClone(rows); next[0].balanceRaw = '100000'; next[999].balanceRaw = '3000000';
  const newer = fixture('latest', newStamp, next), c = H.compare(older, newer);
  assert.equal(c.groups[0].deltaRaw, '-1900000');
  assert.equal(c.groups[4].deltaRaw, String(3000000 - Number(rows[999].balanceRaw)));
  assert.equal(c.changedAccounts.find(r => r.account === '0.0.1').newerRank, 1100);
  assert.equal(c.rankMembership.enteredTopN.length, 1); assert.equal(c.rankMembership.exitedTopN.length, 1);
});
test('missing account is unknown, never zero; group delta is null with partial known sum exposed', () => {
  const older = fixture('30d', oldStamp, rows), next = rows.filter(r => r.account !== '0.0.1');
  const newer = fixture('latest', newStamp, next), c = H.compare(older, newer);
  assert.equal(c.groups[0].complete, false); assert.equal(c.groups[0].deltaRaw, null); assert.equal(c.groups[0].missingAccountCount, 1); assert.equal(c.groups[0].knownDeltaRaw, '0');
  assert.equal(c.missingAccounts[0].newerBalanceRaw, null); assert.equal(c.groups[1].deltaRaw, '0');
});
test('complete threshold universe permits conservative balance bounds without replacing a missing account with zero', () => {
  const older = fixture('30d', oldStamp, rows, { min: '1000' }), newer = fixture('latest', newStamp, rows.slice(1), { min: '1000' }), c = H.compare(older, newer), group = c.groups[0];
  assert.equal(group.deltaRaw, null); assert.equal(group.deltaLowerBoundRaw, '-2000000'); assert.equal(group.deltaUpperBoundRaw, '-1999001'); assert.equal(group.boundedDirection, 'decrease');
  const points = H.cohortSeries(snapshot([older, newer])).groups[0].points;
  assert.equal(points[1].balanceRaw, null); assert.equal(BigInt(points[1].balanceUpperBoundRaw) - BigInt(points[1].balanceLowerBoundRaw), 999n);
  assert.equal(points[1].deltaFromPreviousRaw, null); assert.equal(points[1].deltaFromPreviousLowerBoundRaw, '-2000000'); assert.equal(points[1].deltaFromPreviousUpperBoundRaw, '-1999001');
});
test('fixed oldest cohort series does not swap new rank members into historical balances', () => {
  const older = fixture('30d', oldStamp, rows), next = structuredClone(rows); next[0].balanceRaw = '100000';
  const newer = fixture('latest', newStamp, next), series = H.cohortSeries(snapshot([newer, older]));
  assert.equal(series.anchorObservationId, '30d'); assert.deepEqual(series.groups[0].points.map(p => p.id), ['30d', 'latest']);
  assert.equal(series.groups[0].points[0].deltaFromAnchorRaw, '0'); assert.equal(series.groups[0].points[1].deltaFromAnchorRaw, '-1900000');
});
test('rejects changed snapshot timestamps, unfinished pagination and unverified labels', () => {
  const o = fixture('latest', newStamp, rows);
  const broken = structuredClone(o); broken.provenance[1].timestamp = oldStamp; assert.throws(() => H.validateObservation(broken), /provenance/);
  const unfinished = structuredClone(o); unfinished.provenance.at(-1).next = '/api/v1/balances?more'; assert.throws(() => H.validateObservation(unfinished), /Unfinished/);
  const labelled = structuredClone(o); labelled.rows[0].providerLabel = 'whale'; assert.throws(() => H.validateObservation(labelled), /Unverified/);
  const future = structuredClone(o); future.timestamp = '1792195201.000000000'; assert.throws(() => H.validateObservation(future), /cutoff/);
});
test('does not call a short threshold universe a complete top 1000', () => {
  const o = fixture('latest', newStamp, rows.slice(0, 50)); assert.equal(o.coverage.topNComplete, false); assert.equal(o.coverage.completeTopN, 50); assert.equal(H.distribution(o)[0].balanceRaw, null);
});
test('native HBAR identity and chronological comparisons are enforced', () => {
  const older = fixture('30d', oldStamp, rows), newer = fixture('latest', newStamp, rows);
  assert.throws(() => H.compare(newer, older), /ordered/);
  const s = snapshot([newer, older]); s.asset = { ...H.ASSET, assetType: 'erc20' }; assert.throws(() => H.validateSnapshot(s), /identity/);
  assert.equal(H.formatRaw('-100000001', { maxFraction: 8 }), '−1.00000001');
  const mislabeled = snapshot([newer, { ...older, id: '7d' }]); assert.throws(() => H.validateSnapshot(mislabeled), /day offset/);
});
test('only exact official Council and network account lists are classified; adjacent IDs stay unknown', () => {
  for (const n of [2, 49, 400, 438, 42, 48, 50, 71, 73, 87, 99, 102, 111, 112, 439, 499, 98, 800, 801, 802]) assert.equal(H.knownAccountInfo('0.0.' + n).exclusionEligible, true);
  for (const n of [1, 3, 41, 72, 88, 97, 103, 110, 113, 399, 500, 799, 803, 640701, 652978]) assert.equal(H.knownAccountInfo('0.0.' + n).classification, 'unclassified');
  assert.equal(H.knownAccountInfo('0.0.400').sourceAsOf, '2026-10-06');
  assert.match(H.knownAccountInfo('0.0.400').meaning, /retrospective/);
});
test('infrastructure exclusions rerank the full fetched universe but preserve raw rank and completeness bounds', () => {
  const older = fixture('30d', oldStamp, rows), newer = fixture('latest', newStamp, rows), selected = H.rankedRows(older, { excludeKnownInfrastructure: true });
  assert.equal(older.rows[1].account, '0.0.2'); assert.equal(older.rows[1].rank, 2);
  assert.equal(selected.rows[1].account, '0.0.3'); assert.equal(selected.rows[1].originalRank, 3);
  assert.ok(selected.excludedCount > 100); assert.equal(selected.topNComplete, false);
  assert.equal(H.distribution(older, { excludeKnownInfrastructure: true })[4].complete, false);
  assert.equal(H.compare(older, newer, { excludeKnownInfrastructure: true }).rankMembership.complete, false);
});
test('published historical source validates and every locally retained raw page replays exactly', () => {
  const file = path.join(__dirname, 'data/holder-history-snapshot.json');
  const s = H.validateSnapshot(fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : require('./pack-data.cjs').readPacked(file).data);
  const crypto = require('node:crypto'), dir = path.resolve(__dirname, '../probes/holder-history-v9');
  for (const o of s.observations) {
    if (!fs.existsSync(path.join(dir, o.provenance[0].rawFile))) continue;
    const pages = o.provenance.map(proof => { const body = fs.readFileSync(path.join(dir, proof.rawFile), 'utf8'); assert.equal(crypto.createHash('sha256').update(body).digest('hex'), proof.sha256); return { value: H.parseSource(body), proof }; });
    assert.deepEqual(H.normalizeObservation(o.id, o.requestedCutoff, pages, o.coverage.minimumBalanceRaw, { startedAt: o.startedAt, fetchedAt: o.fetchedAt, requestedTopN: o.coverage.requestedTopN }), o);
  }
});
test('120 daily intervals require 121 consecutive observations; missing dates and 122 daily observations are rejected', () => {
  const cutoff = BigInt(newStamp.replace('.', ''));
  const observations = Array.from({ length: 121 }, (_, i) => {
    const stamp = (cutoff - BigInt(i) * 86400000000000n).toString().replace(/([0-9]{9})$/, '.$1');
    return fixture(i ? i + 'd' : 'latest', stamp, rows.slice(0, 3));
  });
  const s = { ...snapshot(observations), history: { requestedDailySnapshotCount: 121, cutoffPolicy: 'UTC_midnight_at_or_before_with_15_minute_source_granularity', requestedLatestCutoff: newStamp, interpolation: false } };
  assert.equal(H.validateSnapshot(s).observations.length, 121);
  assert.throws(() => H.validateSnapshot({ ...s, observations: observations.filter(o => o.id !== '60d') }), /Missing requested daily observation/);
  assert.throws(() => H.validateSnapshot({ ...s, history: { ...s.history, requestedDailySnapshotCount: 122 } }), /Invalid integer/);
});
test('rolling collection reuses absolute UTC cutoffs without rewriting source provenance or retaining future observations', () => {
  const C = require('./collect_holder_history.cjs');
  const old = snapshot([0, 1, 2].map(i => fixture(i ? i + 'd' : 'latest', C.cutoffAt(newStamp, i), rows.slice(0, 3))));
  const nextCutoff = (BigInt(newStamp.split('.')[0]) + 86400n) + '.000000000';
  const next = C.reusableObservations(old, nextCutoff, [['latest', 0], ['1d', 1], ['2d', 2], ['3d', 3]], '1');
  assert.deepEqual(next.map(o => o.id), ['1d', '2d', '3d']);
  next.forEach((o, i) => assert.deepEqual({ ...o, id: old.observations[i].id }, old.observations[i]));
  const earlier = C.reusableObservations(old, C.cutoffAt(newStamp, 1), [['latest', 0], ['1d', 1]], '1');
  assert.deepEqual(earlier.map(o => o.requestedCutoff), old.observations.slice(1).map(o => o.requestedCutoff));
  assert.deepEqual(C.reusableObservations(old, nextCutoff, [['1d', 1]], '2'), []);
  assert.throws(() => C.cutoffAt('1792108801.000000000', 1), /Invalid daily cutoff/);
});
test('public holder loader uses verified compressed transport, preserves fetch injection and still enforces holder schema', async () => {
  const crypto = require('node:crypto'), zlib = require('node:zlib'), sha = b => crypto.createHash('sha256').update(b).digest('hex');
  const s = snapshot([fixture('latest', newStamp, rows.slice(0, 3))]);
  async function load(value) {
    const decoded = Buffer.from(JSON.stringify(value)), compressed = zlib.gzipSync(decoded), calls = [];
    const manifest = { schemaVersion: 1, kind: 'public-data-manifest', transportVersion: 1, identity: { schemaVersion: 1 }, payload: { url: 'sample.json.gz', compression: 'gzip', bytes: compressed.length, decodedBytes: decoded.length, sha256: sha(compressed), decodedSha256: sha(decoded) } };
    const result = H.loadSnapshot('./data/sample.json', async (url, init) => {
      calls.push(url); assert.equal(init.credentials, 'omit');
      if (url.endsWith('.manifest.json')) return new Response(JSON.stringify(manifest));
      if (url.endsWith('.json.gz')) return new Response(compressed);
      throw Error('Unverified canonical JSON must not be requested');
    });
    return { result, calls };
  }
  const good = await load(s); assert.deepEqual(await good.result, s);
  assert.deepEqual(good.calls, ['./data/sample.json.manifest.json', './data/sample.json.gz']);
  const bad = await load({ ...s, asset: { ...s.asset, chain: 'wrong-chain' } });
  await assert.rejects(bad.result, /identity mismatch/);
});
