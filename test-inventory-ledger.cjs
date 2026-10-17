'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const I = require('./inventory-ledger.js'), { replaySnapshot, indexRetainedSources } = require('./collect_inventory_ledger.cjs');
const A = '0x' + '11'.repeat(20), B = '0x' + '22'.repeat(20), T = '0x' + '33'.repeat(20), U = '0x' + '44'.repeat(20);
const TX = '0x' + '55'.repeat(32), BH = '0x' + '66'.repeat(32), S = '77'.repeat(32);
const state = (number, raw) => ({ tokenAddress: T, address: A, blockNumber: number, blockHash: BH,
  timestamp: new Date(Date.UTC(2026, 9, number)).toISOString(), balanceRaw: raw, sourceSha256: S, blockSourceSha256: S });
const transfer = (number, from, to, raw, index = 0, tokenAddress = T) => ({ id: TX + ':' + tokenAddress + ':' + index,
  tokenAddress, txHash: TX, blockNumber: number, blockHash: BH, transactionIndex: 0, logIndex: index, from, to, amountRaw: raw, sourceSha256: S });
test('reconciliation keeps exact integer precision and signed unexplained net', () => {
  const r = I.reconcile(state(1, '900719925474099300000'), state(3, '900719925474099300005'), [transfer(2, B, A, '100000000000000000000')], A);
  assert.equal(r.balanceChangeRaw, '5'); assert.equal(r.observedNetRaw, '100000000000000000000');
  assert.equal(r.unexplainedNetRaw, '-99999999999999999995'); assert.equal(r.accumulationConfirmed, false);
});
test('end-of-block interval is opening-exclusive/closing-inclusive, and self transfers cancel', () => {
  const events = [transfer(1, B, A, '999', 0), transfer(2, B, A, '25', 1), transfer(3, A, B, '5', 2),
    transfer(3, A, A, '1000', 3), transfer(4, B, A, '888', 4), transfer(2, B, A, '777', 5, U)];
  const r = I.reconcile(state(1, '100'), state(3, '120'), events, A);
  assert.equal(r.observedInflowRaw, '1025'); assert.equal(r.observedOutflowRaw, '1005');
  assert.equal(r.observedNetRaw, '20'); assert.equal(r.unexplainedNetRaw, '0'); assert.equal(r.observedTransferCount, 3);
  assert.equal(r.completeTransferHistory, false); assert.equal(r.retainedPurchaseConfirmed, false);
});
test('zero unexplained residual does not certify missing offsetting flows or accumulation', () => {
  const r = I.reconcile(state(1, '100'), state(3, '100'), [], A);
  assert.equal(r.unexplainedNetIsZero, true); assert.equal(r.completeTransferHistory, false); assert.equal(r.accumulationConfirmed, false);
});
test('duplicate log identities, wrong position, reverse intervals and lossy number inputs fail', () => {
  const t = transfer(2, B, A, '10');
  assert.throws(() => I.reconcile(state(1, '1'), state(3, '11'), [t, t], A), /Duplicate/);
  assert.throws(() => I.reconcile(state(1, '1'), state(3, '11'), [t], B), /interval/);
  assert.throws(() => I.reconcile(state(3, '1'), state(1, '11'), [], A), /interval/);
  assert.throws(() => I.reconcile(state(1, 100), state(3, '100'), [], A), /exact unsigned/);
});
function rawReceipt() {
  const word = a => '0x' + a.slice(2).padStart(64, '0');
  return { status: '0x1', transactionHash: TX, blockHash: BH, blockNumber: '0x2', transactionIndex: '0x0', logs: [{
    address: T, removed: false, transactionHash: TX, blockHash: BH, blockNumber: '0x2', transactionIndex: '0x0', logIndex: '0x1',
    topics: [I.TRANSFER_TOPIC, word(B), word(A)], data: '0x' + 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' }] };
}
test('raw receipt decoder binds token, tx, block and 256-bit amount without precision loss', () => {
  const [t] = I.decodeTransfers(rawReceipt(), [T], S);
  assert.equal(t.amountRaw, ((1n << 256n) - 1n).toString()); assert.equal(t.from, B); assert.equal(t.to, A);
  assert.equal(I.decodeTransfers(rawReceipt(), [U], S).length, 0);
  for (const change of [r => { r.logs[0].removed = true; }, r => { r.logs[0].blockHash = TX; }, r => { r.logs.push(r.logs[0]); }]) {
    const r = rawReceipt(); change(r); assert.throws(() => I.decodeTransfers(r, [T], S));
  }
});
const input = 'data/chain-ledger-snapshot.json', output = 'data/inventory-ledger.json';
const available = fs.existsSync(input) && fs.existsSync(output);
const bytes = available ? fs.readFileSync(input) : null, chain = available ? JSON.parse(bytes) : null;
const report = available ? JSON.parse(fs.readFileSync(output)) : null;
const options = available ? { sourceSnapshotSha256: crypto.createHash('sha256').update(bytes).digest('hex') } : null;
test('published report reproduces exact residuals, actual intervals and pool exclusion', { skip: !available }, () => {
  assert.equal(I.validateReport(report, chain, options), true); assert.equal(report.summary.positionCount, 7);
  assert.equal(report.summary.balanceStateCount, 217); assert.equal(report.summary.observedTokenTransferCount, 84);
  for (const p of report.positions) {
    const s = p.summary;
    assert.equal(BigInt(s.openingBalanceRaw) + BigInt(s.observedInflowRaw) - BigInt(s.observedOutflowRaw) + BigInt(s.unexplainedNetRaw), BigInt(s.closingBalanceRaw));
    assert.ok(s.elapsedDays > 30 && s.elapsedDays < 31); assert.ok(p.recent7d.elapsedDays > 7 && p.recent7d.elapsedDays < 7.2);
    assert.equal(p.completeTransferHistory, false); assert.equal(p.ownershipVerified, false); assert.equal(p.holderCostBasisAvailable, false);
    assert.equal(p.retentionLowerBoundRaw, p.excludedFromAccumulation ? null : '0');
  }
  assert.equal(report.positions.filter(p => p.excludedFromAccumulation).length, 1);
});
test('pair validator rejects a mismatching source snapshot and modified summary', { skip: !available }, () => {
  assert.throws(() => I.validateReport(report, chain, { sourceSnapshotSha256: S }), /SHA mismatch/);
  const changed = structuredClone(report); changed.positions[0].summary.unexplainedNetRaw = '0';
  assert.throws(() => I.validateReport(changed, chain, options), /differs/);
});
test('coherent fabricated balance state cannot be rebuilt against bound chain history', { skip: !available }, () => {
  const evidence = structuredClone(report.evidence); evidence.states[0].balanceRaw = '1';
  assert.throws(() => I.buildReport(chain, evidence, { ...options, generatedAt: report.generatedAt }), /bound chain/);
});
test('coherent omission, duplicate, or identity change of a known receipt Transfer fails', { skip: !available }, () => {
  const first = chain.acquisitions.find(a => a.transfers.length).transfers[0];
  const acq = chain.acquisitions.find(a => a.transfers.includes(first));
  const id = acq.txHash + ':' + acq.tokenAddress + ':' + first.logIndex;
  for (const mutate of [e => { e.transfers = e.transfers.filter(t => t.id !== id); },
    e => { const t = e.transfers.find(t => t.id === id); t.amountRaw = (BigInt(t.amountRaw) + 1n).toString(); },
    e => { e.transfers.push(e.transfers[0]); }]) {
    const evidence = structuredClone(report.evidence); mutate(evidence);
    assert.throws(() => I.buildReport(chain, evidence, { ...options, generatedAt: report.generatedAt }));
  }
});
test('wrong source request, missing receipt, altered cutoff and unsupported completion flags fail', { skip: !available }, () => {
  for (const mutate of [e => { e.states[0].sourceSha256 = e.states[0].blockSourceSha256; },
    e => { e.receipts.pop(); }, e => { e.sources[0].fetchedAt = report.generatedAt; }]) {
    const evidence = structuredClone(report.evidence); mutate(evidence);
    assert.throws(() => I.buildReport(chain, evidence, { ...options, generatedAt: report.generatedAt }));
  }
  const altered = structuredClone(chain); altered.coverage.completeTransferHistory = true;
  assert.throws(() => I.buildReport(altered, report.evidence, { ...options, generatedAt: report.generatedAt }), /Unsupported/);
  const changed = structuredClone(report); changed.coverage.completeTransferHistory = true;
  assert.throws(() => I.validateReport(changed, chain, options), /differs/);
});
const rawRoot = '../funding-recovery-20261017/extracted/raw/sha256';
test('offline compiler replays authentic raw bytes and refuses a changed raw response', { skip: !available || !fs.existsSync(rawRoot) }, () => {
  const rebuilt = replaySnapshot(bytes, path.resolve(rawRoot), report.generatedAt);
  assert.deepEqual(rebuilt, report);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inventory-raw-'));
  try {
    fs.writeFileSync(path.join(dir, chain.sources[0].sha256 + '.json'), '{}');
    assert.throws(() => replaySnapshot(bytes, dir), /Raw HTTP SHA mismatch/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('production run names resolve exact hashes inside only the supplied root', { skip: !available || !fs.existsSync(rawRoot) }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inventory-runs-'));
  try {
    const run = path.join(dir, 'runs', 'fixed-cutoff'); fs.mkdirSync(run, { recursive: true });
    let count = 0;
    for (const hash of new Set(chain.sources.map(s => s.sha256))) {
      fs.copyFileSync(path.join(rawRoot, hash + '.json'), path.join(run, 'ledger-response_' + count++ + '.raw.json'));
    }
    const rebuilt = replaySnapshot(bytes, dir, report.generatedAt);
    assert.deepEqual(rebuilt, report);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('source index ignores symlinks and metadata; missing or changed raw data fails without replacing output', { skip: !available }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inventory-boundary-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'inventory-outside-'));
  try {
    const content = Buffer.from('{"authentic":true}'), hash = crypto.createHash('sha256').update(content).digest('hex');
    fs.writeFileSync(path.join(outside, 'ledger.raw.json'), content);
    fs.symlinkSync(outside, path.join(dir, 'linked-directory'), 'dir');
    fs.symlinkSync(path.join(outside, 'ledger.raw.json'), path.join(dir, 'linked.raw.json'));
    fs.writeFileSync(path.join(dir, 'not-a-source.meta.json'), content);
    assert.equal(indexRetainedSources(dir, [hash]).size, 0);
    assert.throws(() => indexRetainedSources(path.join(dir, 'linked-directory'), [hash]), /unsafe/);
    fs.writeFileSync(path.join(dir, 'changed.raw.json'), '{}');
    assert.equal(indexRetainedSources(dir, [hash]).size, 0);
    const sentinel = path.join(dir, 'published.json'); fs.writeFileSync(sentinel, 'existing validated publication');
    const { spawnSync } = require('node:child_process');
    const result = spawnSync(process.execPath, ['collect_inventory_ledger.cjs', '--input', input, '--raw-root', dir, '--output', sentinel], { encoding: 'utf8' });
    assert.notEqual(result.status, 0); assert.match(result.stderr, /Missing retained raw HTTP bytes/);
    assert.equal(fs.readFileSync(sentinel, 'utf8'), 'existing validated publication');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); }
});
