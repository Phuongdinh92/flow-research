'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), H = require('./holders.js');
const base = Date.now() - 3600000, addr = n => '0:' + BigInt(n).toString(16).padStart(64, '0');
function fixture(id = 'ston', fetchedAt = base) {
  const d = H.TOKENS.find(t => t.id === id), info = { metadata: { address: d.master, symbol: d.symbol, name: d.name, decimals: String(d.decimals) }, verification: 'whitelist', total_supply: '1000000000000000000000' };
  const page = { total: 5, addresses: Array.from({ length: 5 }, (_, i) => ({ address: addr(i + 100), owner: { address: addr(i + 1), is_wallet: i !== 0, ...(i === 0 ? { name: 'Protocol treasury <unknown>' } : {}) }, balance: String(500n - BigInt(i) * 100n) })) };
  const proof = [{ id: 'token_info', url: 'https://tonapi.io/v2/jettons/' + d.master, fetchedAt: fetchedAt - 5000, sha256: 'a'.repeat(64), httpStatus: 200 }, { id: 'holder_page', url: 'https://tonapi.io/v2/jettons/' + d.master + '/holders?limit=1000&offset=0&sort_by=balance', fetchedAt, sha256: 'b'.repeat(64), httpStatus: 200 }];
  return { d, info, page, proof, token: H.normalizeToken(id, info, page, proof, { startedAt: fetchedAt - 10000, fetchedAt }) };
}
const copy = v => JSON.parse(JSON.stringify(v));
function snapshot(t) { return { schemaVersion: 1, sourceId: 'tonapi', generatedAt: t.fetchedAt, tokens: [t] }; }
test('Known identities keep chain plus raw master; token symbols cannot join identities', () => {
  assert.equal(new Set(H.TOKENS.map(x => x.master)).size, 3); assert.deepEqual(H.TOKENS.map(t => t.id), ['ston', 'not', 'dogs']);
  const t = fixture().token; t.master = H.TOKENS[1].master; assert.throws(() => H.validateToken(t), /identity mismatch/);
});
test('Normalization preserves raw balance and distinct owner versus jetton-wallet identity', () => {
  const t = fixture().token; assert.equal(t.rows[0].owner, addr(1)); assert.equal(t.rows[0].jettonWallet, addr(100)); assert.equal(t.rows[0].balanceRaw, '500'); assert.equal(t.rows[0].providerLabel, 'Protocol treasury <unknown>'); assert.equal(t.rows[0].isWallet, false);
});
test('Never normalizes rounded JavaScript numbers as exact source raw balances', () => {
  const f = fixture(); f.page.addresses[0].balance = 500; assert.throws(() => H.normalizeToken('ston', f.info, f.page, f.proof, { startedAt: base - 10000, fetchedAt: base }), /exact/);
});
test('Reject duplicate owners, duplicate jetton wallets, and unsorted source ranks', () => {
  for (const mutate of [t => t.rows[1].owner = t.rows[0].owner, t => t.rows[1].jettonWallet = t.rows[0].jettonWallet, t => t.rows[0].sourceRank = 2, t => t.rows[1].balanceRaw = '1000']) {
    const t = fixture().token; mutate(t); assert.throws(() => H.validateToken(t));
  }
});
test('Reject negative, fractional, scientific, padded or missing raw balances', () => {
  for (const v of ['-1', '1.1', '1e20', '01', null, undefined]) { const t = fixture().token; t.rows[0].balanceRaw = v; assert.throws(() => H.validateToken(t)); }
});
test('Coverage requires the full requested source page and cannot label a sample as all holders', () => {
  const t = fixture().token; assert.equal(t.coverage.truncated, false); t.holderCountReported = 5000; assert.throws(() => H.validateToken(t), /Incomplete requested holder page/);
});
test('Reject inconsistent aggregate supply and fixed-block claims', () => {
  const t = fixture().token; t.totalSupplyRaw = '100'; assert.throws(() => H.validateToken(t), /exceeds/);
  const s = fixture().token; s.indexerState.atomicBlock = true; assert.throws(() => H.validateToken(s), /fixed-block/);
});
test('Identity requires the exact master, decimals and provider whitelist', () => {
  for (const mutate of [f => f.info.metadata.decimals = '18', f => f.info.verification = 'none', f => f.info.metadata.address = addr(0), f => f.info.metadata.symbol = 'fake']) {
    const f = fixture(); mutate(f); assert.throws(() => H.normalizeToken('ston', f.info, f.page, f.proof, { startedAt: base - 10000, fetchedAt: base }), /identity/);
  }
});
test('Source proof validates URL, hash and collection times', () => {
  for (const mutate of [t => t.provenance[1].url = 'https://example.com', t => t.provenance[1].sha256 = 'x', t => t.provenance[0].fetchedAt = base + 1]) { const t = fixture().token; mutate(t); assert.throws(() => H.validateToken(t)); }
});
test('Reject future collection and snapshot times while allowing old dated observations', () => {
  const t = fixture().token, s = snapshot(t); assert.equal(H.validateSnapshot(s, { now: base + 1000 }), s);
  assert.throws(() => H.validateToken(t, { now: base - 600000 }), /future/);
  s.generatedAt = base + 600001; assert.throws(() => H.validateSnapshot(s, { now: base }), /future/);
});
test('Formatting uses integer arithmetic without losing very large balances or decimals', () => {
  assert.equal(H.formatRaw('123456789012345678901234567890', 9, { maxFraction: 9 }), '123,456,789,012,345,678,901.23456789');
  assert.equal(H.formatRaw('9999999999', 9, { maxFraction: 2 }), '10'); assert.equal(H.formatRaw('1', 9, { maxFraction: 9 }), '0.000000001'); assert.throws(() => H.formatRaw('-1', 9));
});
test('Distribution uses source rank groups and a supply denominator with explicit counts', () => {
  const g = H.distribution(fixture().token); assert.equal(g.length, 5); assert.equal(g[0].balanceRaw, '1500'); assert.equal(g[0].count, 5); assert.equal(g[0].expectedCount, 5); assert.equal(g[1].count, 0); assert.equal(g[1].balanceRaw, '0');
  assert.equal(H.sharePercent('1', '3'), 33.333333);
});
test('Comparison fixes the older owner cohort and computes exact signed balance changes', () => {
  const old = fixture().token, next = fixture('ston', base + 60000).token; next.rows[0].balanceRaw = '510'; next.rows[1].balanceRaw = '380';
  const r = H.compare(old, next); assert.equal(r.groups[0].deltaRaw, '-10'); assert.equal(r.groups[0].coveredCount, 5); assert.equal(r.groups[0].complete, true); assert.equal(r.groups[1].deltaRaw, null); assert.equal(r.anchor, 'older_observation_provider_balance_rank');
  assert.equal(r.changedOwners.length, 2); assert.equal(r.changedOwners[0].providerLabel, 'Protocol treasury <unknown>'); assert.equal(r.changedOwners[1].deltaRaw, '-20');
});
test('Missing owner is unknown, never zero; partial cohort returns null complete delta', () => {
  const old = fixture().token, next = fixture('ston', base + 60000).token; next.rows[0].owner = addr(999);
  const g = H.compare(old, next).groups[0]; assert.equal(g.coveredCount, 4); assert.equal(g.missingOwnerCount, 1); assert.equal(g.knownDeltaRaw, '0'); assert.equal(g.deltaRaw, null); assert.equal(g.complete, false);
});
test('Do not compare another token or the same snapshot with itself', () => {
  assert.throws(() => H.compare(fixture().token, fixture('not', base + 100).token), /identities/); assert.throws(() => H.compare(fixture().token, fixture().token), /ordered/);
});
test('Snapshot validates retained observations and read-only loading', async () => {
  const s = snapshot(fixture().token); s.observations = [fixture('ston', base - 100000).token, s.tokens[0]];
  assert.equal(H.validateSnapshot(s), s); const result = await H.loadSnapshot('/saved.json', async (u, opts) => { assert.equal(opts.method, 'GET'); assert.equal(opts.credentials, 'omit'); return { ok: true, json: async () => s }; }); assert.equal(result, s);
  s.observations.push(s.tokens[0]); assert.throws(() => H.validateSnapshot(s), /Duplicate retained/);
});
test('Refresh respects module-wide five-second pacing and preserves prior observations', async () => {
  let clock = base + 1000000; const times = [], waits = [], f = fixture(), start = { schemaVersion: 1, sourceId: 'tonapi', generatedAt: clock, tokens: [] };
  const fake = async u => { times.push(clock); return { ok: true, status: 200, text: async () => JSON.stringify(u.includes('/holders?') ? f.page : f.info) }; };
  const opts = { now: () => clock, wait: async ms => { waits.push(ms); clock += ms; } };
  const first = await H.refresh(start, 'ston', fake, opts); clock += 1; const second = await H.refresh(first, 'ston', fake, opts);
  assert.equal(times.length, 4); assert.ok(times.every((t, i) => !i || t - times[i - 1] >= 5000)); assert.ok(waits.length >= 3); assert.equal(second.observations.length, 2); assert.equal(second.tokens.length, 1); assert.equal(first.tokens[0].fetchedAt, first.observations[0].fetchedAt);
});
test('Provider errors stop without retry or mutation of the prior snapshot', async () => {
  const s = snapshot(fixture().token), before = JSON.stringify(s); let calls = 0;
  await assert.rejects(H.refresh(s, 'ston', async () => { calls++; return { ok: false, status: 429, text: async () => '{"error":"rate limit"}' }; }, { now: () => base + 2000000, wait: async () => {} }), /HTTP 429/);
  assert.equal(calls, 1); assert.equal(JSON.stringify(s), before);
});
