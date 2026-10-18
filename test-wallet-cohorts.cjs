'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), crypto = require('node:crypto');
const W = require('./wallet-cohorts.js');
const addr = n => '0x' + n.toString(16).padStart(40, '0');
const hash = n => '0x' + n.toString(16).padStart(64, '0');
const A = addr(1), B = addr(2), D = addr(3), E = addr(4), P = addr(10), T = addr(20), U = addr(21);
const source = 'a'.repeat(64), cutoff = '2026-10-16T23:37:59.000Z';
function edge(from, to, amountRaw, index = 1, tokenAddress = T, timestamp = '2026-10-16T12:00:00.000Z') {
  const txHash = hash(index);
  return { id: txHash + ':' + tokenAddress + ':0', tokenAddress, txHash, blockNumber: 100, blockHash: hash(100), transactionIndex: 0,
    logIndex: 0, from, to, amountRaw, sourceSha256: source, timestamp };
}
function prepared(edges) {
  return { chainId: 1, sourceReplayVerified: true, completeTransferHistory: false, tokens: [{ address: T, symbol: 'SAME', decimals: 18 }, { address: U, symbol: 'SAME', decimals: 18 }],
    boundaryAddresses: [P], asOf: { number: 100, hash: hash(100), timestamp: cutoff }, edges, sourceSnapshotSha256: source, selection: 'Test-only synthetic', sourceGeneratedAt: cutoff };
}
test('components use exact transfer connectivity, proven pools never join unrelated recipients', () => {
  const edges = [edge(P, A, '50'), edge(A, B, '25', 2), edge(P, D, '8', 3), edge(D, E, '0', 4)];
  const groups = W.components(edges, [P], T);
  assert.deepEqual(groups.map(g => g.members), [[A, B], [D]]);
  assert.equal(groups.every(g => g.ownershipVerified === false), true);
  assert.deepEqual(W.components([...edges].reverse(), [P], T), groups, 'deterministic identity regardless of receipt order');
});
test('boundary flow cancels internal and self transfers without double counting routed amounts', () => {
  const edges = [edge(P, A, '900719925474099300007'), edge(A, B, '900719925474099300007', 2), edge(B, B, '999999999999999999999999', 3), edge(B, P, '7', 4)];
  const result = W.boundaryFlow(edges, [A, B]);
  assert.equal(result.inflowRaw, '900719925474099300007'); assert.equal(result.outflowRaw, '7');
  assert.equal(result.netRaw, '900719925474099300000'); assert.equal(result.internalTransferCount, 2);
  assert.equal(result.boundaryTransferIds.length, 2); assert.equal(result.accumulationConfirmed, false);
  const summed = [A, B].map(a => W.boundaryFlow(edges, [a]).netRaw).reduce((n, raw) => n + BigInt(raw), 0n);
  assert.equal(BigInt(result.netRaw), summed);
});
test('component inflows/outflows reconcile to union boundary and raw amounts retain 256-bit precision', () => {
  const huge = ((1n << 256n) - 1n).toString(), edges = [edge(P, A, huge), edge(D, P, '100', 2)];
  const m = W.model(prepared(edges));
  assert.equal(m.groups.length, 2); assert.equal(m.positiveGroupCount, 1); assert.equal(m.negativeGroupCount, 1);
  assert.equal(m.total.netRaw, (BigInt(huge) - 100n).toString());
  assert.equal(m.groups.reduce((n, g) => n + BigInt(g.netRaw), 0n).toString(), m.total.netRaw);
  assert.equal(W.formatRaw('1000000000000000001', 18, true), '1.000000000000000001');
});
test('flow-share formulas are explicit and absent denominators remain null', () => {
  const r = W.boundaryFlow([edge(P, A, '9630'), edge(A, P, '3000', 2)], [A]);
  assert.equal(r.netRaw, '6630'); assert.equal(r.inflowSharePct, 76.247); assert.equal(r.outflowSharePct, 23.7529); assert.equal(r.spreadPct, 52.494);
  const empty = W.boundaryFlow([edge(A, A, '10')], [A]);
  assert.equal(empty.inflowSharePct, null); assert.equal(empty.outflowSharePct, null); assert.equal(empty.spreadPct, null);
});
test('token contract is authoritative even when symbols match', () => {
  const p = prepared([edge(P, A, '2'), edge(P, B, '999', 2, U)]);
  assert.equal(W.model(p, { tokenAddress: T }).total.netRaw, '2');
  assert.equal(W.model(p, { tokenAddress: U }).total.netRaw, '999');
  assert.throws(() => W.model(p, { tokenAddress: 'SAME' }), /Unknown token/);
});
test('rolling windows are opening exclusive, cutoff inclusive, and future blocks rejected', () => {
  const start = new Date(Date.parse(cutoff) - 86400000).toISOString();
  const rows = [edge(P, A, '999', 1, T, start), edge(P, A, '2', 2, T, new Date(Date.parse(start) + 1).toISOString()), edge(P, A, '3', 3, T, cutoff), edge(P, A, '888', 4, T, new Date(Date.parse(cutoff) + 1).toISOString())];
  assert.equal(W.model(prepared(rows)).total.netRaw, '5');
  const bad = edge(P, A, '5'); bad.blockNumber = 101;
  assert.throws(() => W.model(prepared([bad])), /finalized cutoff/);
});
test('unobserved days stay missing; one-day receipt sample does not become a seven-day total', () => {
  const m = W.model(prepared([edge(P, A, '10')]), { days: 7 });
  const days = W.timeline(m);
  assert.equal(days.length, 8); assert.equal(days.filter(d => d.observed).length, 1);
  assert.equal(days.filter(d => d.flow === null).length, 7); assert.equal(m.completeTransferHistory, false);
  assert.equal(m.observedDays, 1); assert.equal(m.total.netRaw, '10');
  assert.throws(() => W.timeline(m, 'missing'), /Unknown/);
});
test('duplicate events, wrong contracts, lossy number amounts and missing proof are rejected', () => {
  const e = edge(P, A, '10');
  assert.throws(() => W.components([e, e], [P], T), /Duplicate/);
  assert.throws(() => W.boundaryFlow([e, e], [A]), /Duplicate/);
  assert.throws(() => W.components([{ ...e, amountRaw: 10 }], [P], T), /exact/);
  assert.throws(() => W.components([{ ...e, sourceSha256: '' }], [P], T), /proof/);
  assert.throws(() => W.components([e], [P], U), /mismatch/);
});
const chain = JSON.parse(fs.readFileSync('data/chain-ledger-snapshot.json'));
const inventory = JSON.parse(fs.readFileSync('data/inventory-ledger.json'));
test('actual retained receipts bind raw SHA, transaction block and all 84 exact transfer edges', () => {
  const p = W.prepare(chain, inventory);
  assert.equal(p.edges.length, 84); assert.equal(p.receiptCount, 30);
  const hash = crypto.createHash('sha256').update(fs.readFileSync('data/chain-ledger-snapshot.json')).digest('hex');
  assert.equal(p.sourceSnapshotSha256, hash);
  for (const t of p.tokens) {
    const m = W.model(p, { tokenAddress: t.address });
    assert.equal(m.groups.reduce((n, g) => n + BigInt(g.netRaw), 0n).toString(), m.total.netRaw);
    assert.equal(m.observedDays, 1); assert.equal(m.ownershipVerified, false);
    const contractEdges = inventory.evidence.transfers.filter(e => e.tokenAddress === t.address);
    assert.equal(m.edges.length, contractEdges.length);
    for (const e of m.edges) assert.equal(e.amountRaw, contractEdges.find(x => x.id === e.id).amountRaw);
  }
});
test('actual observation view supplies receipt evidence and missing-window explanation', () => {
  const p = W.prepare(chain, inventory), m = W.model(p, { days: 30 });
  const html = W.view(m, { tokens: p.tokens, group: 'all', tab: 'flow' });
  assert.match(html, /Mẫu thiên về các lệnh mua lớn/); assert.match(html, /Ethereum|ETHEREUM/);
  assert.match(html, /chưa biết tổng dòng thực tế/); assert.match(html, /Không đại diện tổng dòng 30 ngày/);
  assert.match(html, /etherscan.io\/tx\//); assert.match(html, /raw /);
  assert.match(W.networkChart(m), /thành phần liên thông, không phải cùng chủ/);
  assert.doesNotMatch(html, /NaN|undefined|Infinity/);
});
test('tampered amount, source hash and block proof cannot become a new observed group', () => {
  for (const mutate of [r => { r.evidence.transfers[0].amountRaw = '1'; }, r => { r.evidence.transfers[0].sourceSha256 = 'b'.repeat(64); }, r => { r.evidence.receipts[0].blockHash = hash(999); }]) {
    const clone = structuredClone(inventory); mutate(clone); assert.throws(() => W.prepare(chain, clone));
  }
});
test('rendering obeys self-only style CSP and graph scales handle zero or absent flow', () => {
  const p = W.prepare(chain, inventory);
  for (const token of p.tokens) for (const days of [1, 7, 30]) {
    const m = W.model(p, { tokenAddress: token.address, days });
    for (const group of ['all', ...m.groups.map(g => g.id)]) for (const tab of ['flow', 'network']) {
      const html = W.view(m, { tokens: p.tokens, group, tab });
      assert.doesNotMatch(html, /\sstyle\s*=/i, 'no HTML inline style attributes under style-src self');
      assert.doesNotMatch(html, /NaN|Infinity|undefined/);
    }
  }
  const noFlow = W.model(prepared([edge(A, B, '10')]));
  const html = W.view(noFlow, { tokens: prepared([]).tokens, group: 'all', tab: 'flow' });
  assert.match(html, /wc-share-empty/); assert.match(html, /Chưa có chuyển qua biên trong mẫu/);
  assert.doesNotMatch(html, /NaN|Infinity|undefined|\sstyle\s*=/i);
  const empty = W.model(prepared([]));
  assert.match(W.networkChart(empty), /Không có Transfer phù hợp/);
  assert.doesNotMatch(W.flowChart(empty, 'all'), /NaN|Infinity|undefined/);
});
