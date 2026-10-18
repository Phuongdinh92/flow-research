'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const H = require('./holder-history.js');
const file = path.join(__dirname, 'data/holder-history-snapshot.json');
const archive = path.join(__dirname, 'data/source-receipts/hedera-history-20261017-120d');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
function readArchive() {
  if (fs.existsSync(archive + '.json.gz')) {
    const compressed = fs.readFileSync(archive + '.json.gz'), decoded = zlib.gunzipSync(compressed);
    return { compressed, decoded, data: JSON.parse(decoded) };
  }
  return require('./pack-data.cjs').readPacked(archive + '.json');
}
function readSnapshot() {
  if (fs.existsSync(file)) { const decoded = fs.readFileSync(file); return { decoded, data: JSON.parse(decoded) }; }
  return require('./pack-data.cjs').readPacked(file);
}
test('retained HBAR source archive verifies every byte and replays all 89 original observations', () => {
  const { compressed, decoded, data: bundle } = readArchive();
  const manifest = JSON.parse(fs.readFileSync(archive + '.manifest.json'));
  assert.equal(compressed.length, manifest.compressedBytes); assert.equal(sha(compressed), manifest.compressedSha256);
  assert.equal(decoded.length, manifest.decodedBytes); assert.equal(sha(decoded), manifest.decodedSha256);
  assert.equal(bundle.kind, 'hedera-historical-balance-source-receipts');
  assert.equal(bundle.sourceId, 'hedera-mirror-node');
  assert.equal(bundle.observations.length, 89); assert.equal(manifest.observationCount, 89);
  const current = readSnapshot(), snapshot = H.validateSnapshot(current.data);
  if (snapshot.history.requestedLatestCutoff === bundle.requestedLatestCutoff) assert.equal(sha(current.decoded), bundle.snapshotDecodedSha256);
  const currentByCutoff = new Map(snapshot.observations.map(o => [o.requestedCutoff, o]));
  const cutoffs = new Set(); let responses = 0;
  for (const o of bundle.observations) {
    assert.ok(!cutoffs.has(o.requestedCutoff)); cutoffs.add(o.requestedCutoff);
    const pages = o.receipts.map(r => {
      assert.equal(r.proof.httpStatus, 200); assert.equal(sha(r.body), r.proof.sha256);
      responses++; return { value: H.parseSource(r.body), proof: r.proof };
    });
    const normalized = H.normalizeObservation(o.id, o.requestedCutoff, pages, o.minimumBalanceRaw, { startedAt: o.startedAt, fetchedAt: o.fetchedAt, requestedTopN: o.requestedTopN });
    assert.equal(normalized.rows.length, o.expectedRows); assert.equal(normalized.timestamp, o.timestamp);
    assert.equal(sha(JSON.stringify(normalized)), o.normalizedSha256);
    const retained = currentByCutoff.get(o.requestedCutoff);
    if (retained) assert.deepEqual({ ...retained, id: o.id }, normalized);
  }
  assert.equal(responses, 1516); assert.equal(responses, manifest.responseCount);
  assert.equal(bundle.unavailableOriginalReceiptObservations.length, 32);
  assert.equal(manifest.unavailableOriginalReceiptObservationCount, 32);
  for (const o of bundle.unavailableOriginalReceiptObservations) {
    assert.ok(!cutoffs.has(o.requestedCutoff)); cutoffs.add(o.requestedCutoff);
    assert.match(o.reason, /not retained/);
  }
  assert.equal(cutoffs.size, 121);
  const ordered = [...cutoffs].map(v => BigInt(v.replace('.', ''))).sort((a, b) => a < b ? -1 : 1);
  ordered.slice(1).forEach((v, i) => assert.equal(v - ordered[i], 86400000000000n));
});
test('source archive preserves the failed 502 response and exactly one later successful request to the same URL', () => {
  const { data: bundle } = readArchive();
  assert.equal(bundle.failedAttempts.length, 1);
  const failure = bundle.failedAttempts[0];
  assert.equal(failure.proof.httpStatus, 502); assert.equal(sha(failure.body), failure.proof.sha256);
  const recovered = bundle.observations.flatMap(o => o.receipts).filter(r => r.proof.url === failure.proof.url);
  assert.equal(recovered.length, 1); assert.equal(recovered[0].proof.httpStatus, 200);
  assert.ok(recovered[0].proof.requestedAt > failure.proof.fetchedAt);
});
test('published daily history covers 120 intervals and does not hide accounts below the source threshold', () => {
  const s = H.validateSnapshot(readSnapshot().data);
  assert.equal(s.history.requestedDailySnapshotCount, 121);
  assert.equal(s.observations.length, 121);
  const latest = s.observations.find(o => o.id === 'latest');
  // Historical release regression: later valid rolling snapshots can differ.
  if (s.history.requestedLatestCutoff !== '1792195200.000000000') return;
  for (const [days, missing] of [[1, 0], [7, 0], [30, 38], [90, 110], [120, 134]]) {
    const c = H.compare(s.observations.find(o => o.id === days + 'd'), latest, { excludeKnownInfrastructure: true });
    assert.equal(c.missingAccounts.length, missing);
    for (const g of c.groups) {
      if (g.missingAccountCount) { assert.equal(g.deltaRaw, null); assert.ok(BigInt(g.deltaUpperBoundRaw) >= BigInt(g.deltaLowerBoundRaw)); }
    }
  }
});
