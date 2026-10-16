'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Evidence = require('./dex-evidence.js');
const Collector = require('./collect_dex_evidence.cjs');
const fixture = require('./data/dex-evidence-snapshot.json');
const NOW = Date.parse(fixture.generatedAt) + 60000;
const clone = () => structuredClone(fixture);

test('actual snapshot preserves sampled window, native units and fixed state block', () => {
  const s = Evidence.validateSnapshot(fixture, { now: NOW });
  assert.equal(s.trades.length, 300);
  assert.equal(s.coverage.eligibleFinalizedCount, 197);
  assert.equal(s.senders.length, 10);
  assert.equal(s.pool.baseToken.decimals, 18);
  assert.equal(s.pool.quoteToken.decimals, 6);
  assert.equal(s.finalizedBlock.number, 26204700);
  assert.ok(s.coverage.reported24hBuys + s.coverage.reported24hSells > s.trades.length);
  assert.ok(Date.parse(s.coverage.lastTradeAt) - Date.parse(s.coverage.firstTradeAt) < 2 * 3600000);
  assert.equal(s.senders[0].balanceBaseRaw, '0');
  assert.equal(s.senders[0].hasCode, false);
  assert.equal(s.senders[0].ownershipVerified, false);
});
test('zero balances remain zero, missing balances remain unavailable', () => {
  const x = clone();
  x.senders[0].balanceBaseRaw = null; x.senders[0].error = 'RPC unavailable'; x.coverage.checkedSenderCount--;
  const s = Evidence.validateSnapshot(x, { now: NOW });
  assert.equal(s.senders[0].balanceBaseRaw, null);
  assert.equal(Evidence.formatToken(null, 18), '—');
  assert.equal(Evidence.formatToken('0', 18), '0');
});
test('missing balance without an explicit error is rejected', () => {
  const x = clone(); x.senders[0].balanceBaseRaw = null; x.coverage.checkedSenderCount--;
  assert.throws(() => Evidence.validateSnapshot(x, { now: NOW }), /unavailable-balance reason/);
});
test('raw integer quantities retain precision beyond Number.MAX_SAFE_INTEGER', () => {
  assert.equal(Evidence.formatToken('123456789012345678901234567890', 18, 18), '123456789012.34567890123456789');
  assert.equal(Evidence.formatToken('100000000001', 18, 6), '<0.000001');
  assert.equal(Evidence.formatToken('100000000000', 18, 12), '0.0000001');
  assert.equal(Evidence.formatToken('1234567', 6), '1.234567');
  assert.equal(Collector.rawInteger('0x' + (2n ** 200n).toString(16).padStart(64, '0')), (2n ** 200n).toString());
});
test('malformed or already-rounded raw balances are rejected', () => {
  for (const raw of [0, '-1', '1e18', '', '01', (2n ** 256n).toString()]) {
    const x = clone(); x.senders[0].balanceBaseRaw = raw;
    assert.throws(() => Evidence.validateSnapshot(x, { now: NOW }), /raw token balance/);
  }
});
test('contract identity, chain ID and token decimals cannot be silently mixed', () => {
  for (const edit of [x => x.network.chainId = 56, x => x.pool.baseToken.decimals = 6, x => x.pool.quoteToken.address = x.pool.baseToken.address, x => x.pool.baseToken.coingeckoId = 'ethereum']) {
    const x = clone(); edit(x); assert.throws(() => Evidence.validateSnapshot(x, { now: NOW }));
  }
});
test('block hash changing during balances invalidates snapshot', () => {
  const x = clone(); x.blockChecks.after.hash = '0x' + 'a'.repeat(64);
  assert.throws(() => Evidence.validateSnapshot(x, { now: NOW }), /changed during collection/);
});
test('balances from a different block are rejected', () => {
  const x = clone(); x.senders[0].blockNumber--;
  assert.throws(() => Evidence.validateSnapshot(x, { now: NOW }), /state block mismatch/);
});
test('transaction sender cannot be promoted to verified beneficial owner', () => {
  const x = clone(); x.senders[0].ownershipVerified = true;
  assert.throws(() => Evidence.validateSnapshot(x, { now: NOW }), /sender selection/);
});
test('duplicate event IDs and incompatible token direction are rejected', () => {
  const x = clone(); x.trades[1].id = x.trades[0].id;
  assert.throws(() => Evidence.validateSnapshot(x, { now: NOW }), /duplicate trade/);
  const y = clone(); y.trades[0].kind = y.trades[0].kind === 'buy' ? 'sell' : 'buy';
  assert.throws(() => Evidence.validateSnapshot(y, { now: NOW }), /side\/token mismatch/);
});
test('reported coverage cannot present sampled trades as a complete ledger', () => {
  for (const edit of [x => x.coverage.returnedCount++, x => x.coverage.observedUniqueSenders++, x => x.coverage.eligibleFinalizedCount++, x => x.coverage.firstTradeAt = x.coverage.lastTradeAt]) {
    const x = clone(); edit(x); assert.throws(() => Evidence.validateSnapshot(x, { now: NOW }));
  }
});
test('fetch time controls age even when the snapshot is repackaged later', () => {
  const x = clone(); x.generatedAt = new Date(Date.parse(x.generatedAt) + 3600000).toISOString();
  const s = Evidence.validateSnapshot(x, { now: Date.parse(x.generatedAt) });
  assert.equal(s.freshness.isStale, true);
});
test('future snapshots and trades outside the returned lookback are rejected', () => {
  assert.throws(() => Evidence.validateSnapshot(fixture, { now: Date.parse(fixture.generatedAt) - 180000 }), /future/);
  const x = clone(); x.trades[0].blockTimestamp = '2020-01-01T00:00:00Z';
  assert.throws(() => Evidence.validateSnapshot(x, { now: NOW }), /lookback/);
});
test('provenance is mandatory and limited to the named public providers', () => {
  const x = clone(); delete x.sources.tokenIdentity;
  assert.throws(() => Evidence.validateSnapshot(x, { now: NOW }), /provenance/);
  const y = clone(); y.sources.pool.url = 'https://example.com/fake';
  assert.throws(() => Evidence.validateSnapshot(y, { now: NOW }), /source URL/);
});
test('sender summaries are computed from trades and separate finalized amounts', () => {
  const x = clone(); x.senders[0].observedBuyUsd = -123;
  const s = Evidence.validateSnapshot(x, { now: NOW }), a = s.senders[0];
  assert.ok(a.observedBuyUsd > 0); assert.ok(a.observedBuyUsd >= a.finalizedBuyUsd);
  const actual = s.trades.filter(t => t.sender === a.address && t.isFinalized && t.kind === 'buy').reduce((n, t) => n + Number(t.volumeUsd), 0);
  assert.ok(Math.abs(actual - a.finalizedBuyUsd) < 1e-8);
});
test('time buckets conserve sample USD-valued amounts', () => {
  const s = Evidence.validateSnapshot(fixture, { now: NOW }), buckets = Evidence.aggregateBuckets(s, 5);
  assert.equal(buckets.reduce((n, b) => n + b.count, 0), 300);
  assert.ok(Math.abs(buckets.reduce((n, b) => n + b.buyUsd, 0) - s.sampleTotals.buyUsd) < 1e-7);
  assert.ok(Math.abs(buckets.reduce((n, b) => n + b.sellUsd, 0) - s.sampleTotals.sellUsd) < 1e-7);
});
test('loadSnapshot exposes fetch failures and validates received data', async () => {
  await assert.rejects(Evidence.loadSnapshot('local', { fetch: async () => ({ ok: false, status: 503 }) }), /HTTP 503/);
  const s = await Evidence.loadSnapshot('local', { now: NOW, fetch: async () => ({ ok: true, json: async () => fixture }) });
  assert.equal(s.senders.length, 10);
});
test('actual transfer receipt exposes a different immediate recipient', () => {
  const s = Evidence.validateSnapshot(fixture, { now: NOW }), r = s.routingExample;
  assert.notEqual(r.sender, r.recipient);
  assert.equal(Evidence.formatToken(r.baseTransferRaw, 18, 18), '28.493604173305397647');
  assert.equal(r.recipientHasCode, true);
  assert.equal(r.recipientBalanceBeforeBlockNumber, r.blockNumber - 1);
  assert.ok(BigInt(r.recipientBalanceFinalizedRaw) < BigInt(r.recipientBalanceBeforeRaw));
});
test('routing receipt must refer to a known finalized buy and exact cutoff blocks', () => {
  for (const edit of [x => x.routingExample.txHash = '0x' + 'a'.repeat(64), x => x.routingExample.recipientBalanceBeforeBlockNumber--, x => x.routingExample.finalizedBlockHash = '0x' + 'b'.repeat(64), x => x.routingExample.baseTransferRaw = null]) {
    const x = clone(); edit(x); assert.throws(() => Evidence.validateSnapshot(x, { now: NOW }), /routing/);
  }
});
