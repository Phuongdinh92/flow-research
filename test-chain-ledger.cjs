'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const L = require('./chain-ledger.js');
const A = '0x' + '11'.repeat(20), B = '0x' + '22'.repeat(20), C = '0x' + '33'.repeat(20), D = '0x' + '44'.repeat(20);
const TOKEN = '0x' + '55'.repeat(20), QUOTE = '0x' + '66'.repeat(20), H = '0x' + '77'.repeat(32), BH = '0x' + '88'.repeat(32);
const pool = { address: A, baseTokenAddress: TOKEN, quoteTokenAddress: QUOTE, token0: TOKEN, token1: QUOTE };
test('canonical event topic is exactly the independently observed 32-byte signature', () => {
  assert.equal(L.SWAP_TOPIC, '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67');
  assert.equal(L.SWAP_TOPIC.length, 66); assert.equal(L.TRANSFER_TOPIC.length, 66);
});
const word = n => (n < 0n ? (1n << 256n) + n : n).toString(16).padStart(64, '0');
const topic = a => '0x' + a.slice(2).padStart(64, '0');
function swapLog(a0 = -100n, a1 = 50n) {
  return { address: A, removed: false, topics: [L.SWAP_TOPIC, topic(B), topic(C)],
    data: '0x' + [a0, a1, 1n << 96n, 1000n, -10n].map(word).join(''),
    transactionHash: H, blockHash: BH, blockNumber: '0x64', transactionIndex: '0x0', logIndex: '0x4' };
}
function transfer(from, to, n, index) { return { address: TOKEN, removed: false, topics: [L.TRANSFER_TOPIC, topic(from), topic(to)], data: '0x' + word(n), logIndex: '0x' + index.toString(16) }; }
function receipt(logs) { return { status: '0x1', transactionHash: H, blockHash: BH, blockNumber: '0x64', from: D, logs }; }
test('decodes signed pool deltas without precision loss and maps base token direction', () => {
  const n = 10000000000000000000001n, s = L.decodeSwap(swapLog(-n, 50n), pool);
  assert.equal(s.kind, 'buy'); assert.equal(s.baseAmountRaw, n.toString()); assert.equal(s.quoteAmountRaw, '50'); assert.equal(s.tick, -10);
  const inverse = L.decodeSwap(swapLog(-100n, 50n), { ...pool, baseTokenAddress: QUOTE, quoteTokenAddress: TOKEN });
  assert.equal(inverse.kind, 'sell'); assert.equal(inverse.baseAmountRaw, '50');
});
test('rejects wrong pool, removed logs, same-sign deltas and malformed ABI', () => {
  assert.throws(() => L.decodeSwap({ ...swapLog(), address: B }, pool), /Pool address/);
  assert.throws(() => L.decodeSwap({ ...swapLog(), removed: true }, pool), /canonical/);
  assert.throws(() => L.decodeSwap(swapLog(10n, 10n), pool), /opposite/);
  assert.throws(() => L.decodeSwap({ ...swapLog(), data: '0x01' }, pool), /ABI/);
});
test('resolves direct recipient and zero-net router path, never tx sender as owner', () => {
  const s = L.decodeSwap(swapLog(), pool);
  const r = L.resolveAcquisition(receipt([transfer(A, B, 100n, 1), transfer(B, C, 100n, 2)]), s);
  assert.equal(r.finalRecipient, C); assert.equal(r.txSender, D); assert.equal(r.transactionAcquiredRaw, '100'); assert.equal(r.ownershipVerified, false);
});
test('roundtrip, multiple net recipients and unrelated token sources stay ambiguous', () => {
  const s = L.decodeSwap(swapLog(), pool);
  for (const logs of [
    [transfer(A, C, 100n, 1), transfer(C, A, 100n, 2)],
    [transfer(A, C, 100n, 1), transfer(C, B, 10n, 2)],
    [transfer(A, C, 100n, 1), transfer(D, C, 5n, 2)]
  ]) { const r = L.resolveAcquisition(receipt(logs), s); assert.equal(r.finalRecipient, null); assert.equal(r.routeStatus, 'ambiguous-or-roundtrip'); }
});
test('receipt block/hash mismatch is rejected rather than joined by ticker/address alone', () => {
  const s = L.decodeSwap(swapLog(), pool);
  assert.throws(() => L.resolveAcquisition({ ...receipt([]), blockHash: H }, s), /block mismatch/);
  assert.throws(() => L.resolveAcquisition({ ...receipt([]), transactionHash: BH }, s), /transaction mismatch/);
});
test('later balance is only an upper bound on retained purchase, including replacements', () => {
  const r = L.retentionBounds('100', '200', '300', '250');
  assert.equal(r.netBalanceIncreaseRaw, '50'); assert.equal(r.laterBalanceDeltaRaw, '-50');
  assert.equal(r.retentionLowerBoundRaw, '0'); assert.equal(r.retentionUpperBoundRaw, '100'); assert.equal(r.retainedPurchaseConfirmed, false);
  assert.equal(L.retentionBounds('100', '200', '300', '10').retentionUpperBoundRaw, '10');
  assert.equal(L.retentionBounds('100', '200', '300', '0').balanceCoversAcquiredFraction, 0);
});
test('formats large integers without Number coercion or invented precision', () => {
  assert.equal(L.formatUnits('123456789012345678901234567890', 18, 8), '123456789012.3456789');
  assert.equal(L.formatUnits('-1000000000000000001', 18, 18), '-1.000000000000000001');
  assert.throws(() => L.formatUnits('1e18', 18), /Invalid integer/);
});
test('execution ratio uses weighted token quantities and token decimals, not mean prices', () => {
  assert.equal(L.executionPrice('3000000', '2000000000000000000', 18, 6), '1.5');
  assert.equal(L.executionPrice('1000000000000000001', '1000000000000000000'), '1.000000000000000001');
  assert.throws(() => L.executionPrice('1', '0'), /Invalid price/);
});
test('actual published ledger has verified rows and fails unsupported coverage/retention claims', { skip: !fs.existsSync('data/chain-ledger-snapshot.json') }, () => {
  const s = JSON.parse(fs.readFileSync('data/chain-ledger-snapshot.json'));
  assert.equal(L.validateSnapshot(s), true); assert.ok(L.summarize(s).receiptVerifiedSwaps > 0);
  const bad = structuredClone(s); bad.coverage.completePoolLogs = true;
  assert.throws(() => L.validateSnapshot(bad), /coverage/);
  const a = s.acquisitions.find(x => x.balances);
  if (a) { const bad2 = structuredClone(s); bad2.acquisitions.find(x => x.balances).balances.retentionLowerBoundRaw = '1'; assert.throws(() => L.validateSnapshot(bad2), /retention/); }
  const activity = L.addressActivity(s);
  assert.equal(activity.length, L.summarize(s).uniqueAddressTokenPositions);
  assert.equal(activity.reduce((sum, row) => sum + row.purchaseCount, 0), L.summarize(s).checkedRecipients);
  assert.ok(activity.every(x => x.ownershipVerified === false && x.retainedPurchaseConfirmed === false));
  for (const row of s.acquisitions.filter(x => x.recipientRole === 'verified-liquidity-pool')) {
    assert.equal(row.excludeFromAccumulation, true); assert.equal(row.balances.retentionApplicable, false);
    const bad3 = structuredClone(s); bad3.acquisitions.find(x => x.swapId === row.swapId).excludeFromAccumulation = false;
    assert.throws(() => L.validateSnapshot(bad3), /Liquidity pool/);
    const bad4 = structuredClone(s); bad4.acquisitions.find(x => x.swapId === row.swapId).recipientRole = 'unclassified-contract';
    assert.throws(() => L.validateSnapshot(bad4), /Liquidity pool/);
  }
  for (const row of activity.filter(x => x.excludeFromAccumulation)) { assert.equal(row.retentionApplicable, false); assert.equal(row.retentionUpperBoundRaw, null); }
});
