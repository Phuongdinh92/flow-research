'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const H = require('./holders.js'), D = require('./dex-evidence.js'), V = require('./onchain-ui.js');
const copy = value => JSON.parse(JSON.stringify(value));
const holderRaw = JSON.parse(fs.readFileSync('./data/holders-snapshot.json', 'utf8'));
const holders = H.validateSnapshot(holderRaw, {now: Math.max(Date.now(), holderRaw.generatedAt)});
const dexRaw = JSON.parse(fs.readFileSync('./data/dex-evidence-snapshot.json', 'utf8'));
const dex = D.validateSnapshot(dexRaw, {now: Math.max(Date.now(), Date.parse(dexRaw.generatedAt))});
const ston = holders.tokens.find(t => t.id === 'ston');
const ranks = html => [...html.matchAll(/<strong>#(\d+)<\/strong>/g)].map(m => Number(m[1]));
const escaped = text => String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const usd = value => (value < 0 ? '−' : '') + '$' + Math.abs(value).toLocaleString('en-US', {maximumFractionDigits: 2});
const senderRows = html => [...html.matchAll(/<tbody>([\s\S]*?)<\/tbody>/g)][0][1].match(/<tr>[\s\S]*?<\/tr>/g);
// Independent exact decimal expansion for checking presentation of real source balances.
function exactTokens(raw, decimals) {
  const text = raw.padStart(decimals + 1, '0'), whole = text.slice(0, -decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fraction = text.slice(-decimals).replace(/0+$/, '');
  return whole + (fraction ? '.' + fraction : '');
}

test('holder comparison chooses the earliest full baseline rather than an older top-100 page', () => {
  const earlier = holders.observations.filter(t => t.id === ston.id && t.fetchedAt < ston.fetchedAt);
  assert.ok(earlier.some(t => t.rows.length === 100), 'real fixture retains the earlier limited observation');
  const full = earlier.filter(t => t.rows.length === 1000).sort((a, b) => a.fetchedAt - b.fetchedAt);
  assert.ok(full.length, 'real fixture has a complete earlier observation');
  const laterFull = copy(full[0]); laterFull.fetchedAt = full[0].fetchedAt + 1;
  const s = {...holders, observations: [...copy(earlier).reverse(), laterFull]};
  const comparison = V.comparison(s, ston, H);
  assert.equal(comparison.previous.rows.length, 1000);
  assert.equal(comparison.previous.fetchedAt, full[0].fetchedAt);
  assert.equal(comparison.result.olderFetchedAt, full[0].fetchedAt);
});

test('missing cohort observations remain missing while observed unchanged cohorts display zero', () => {
  const baseline = V.comparison(holders, ston, H).previous, current = copy(ston);
  current.rows = copy(baseline.rows);
  const replacement = '0:' + 'f'.repeat(64);
  assert.ok(!current.rows.some(r => r.owner === replacement));
  current.rows[0].owner = replacement;
  const result = H.compare(baseline, current), chart = V.deltaChart({previous: baseline, result}, current, H);
  assert.equal(result.groups[0].deltaRaw, null); assert.equal(result.groups[0].knownDeltaRaw, '0');
  assert.equal(result.groups[1].deltaRaw, '0');
  assert.match(chart, /Thiếu · 99\/100/);
  assert.match(chart, />0 STON<\/text>/);
  assert.doesNotMatch(chart, /NaN|undefined/);
});

test('delta labels keep signed raw precision beyond JavaScript safe integers', () => {
  const groups = ['1–100', '101–200', '201–300', '301–500', '501–1000'].map((label, i) => ({label, deltaRaw: ['9007199254740993123', '-9007199254740993124', '0', null, null][i], coveredCount: i < 3 ? 100 : 0, expectedCount: 100}));
  const chart = V.deltaChart({result: {groups}}, ston, H);
  assert.match(chart, /\+9,007,199,254\.740993123 STON/);
  assert.match(chart, /−9,007,199,254\.740993124 STON/);
  assert.match(chart, /class="holder-negative"/);
  assert.match(chart, /Thiếu · 0\/100/);
});

test('holder group pagination preserves provider ranks and clamps out-of-range pages', () => {
  const page = V.holderTable(ston, H, {group: '101–200', page: 2, pageSize: 10});
  assert.equal(page.count, 100); assert.equal(page.pages, 10); assert.equal(page.page, 2);
  assert.deepEqual(ranks(page.html), Array.from({length: 10}, (_, i) => 121 + i));
  const last = V.holderTable(ston, H, {group: '101–200', page: 999, pageSize: 10});
  assert.equal(last.page, 9); assert.deepEqual(ranks(last.html), Array.from({length: 10}, (_, i) => 191 + i));
});

test('holder filtering finds either account address and keeps original source rank', () => {
  const row = ston.rows[134]; assert.notEqual(row.owner, row.jettonWallet);
  for (const search of [row.owner, row.jettonWallet]) {
    const result = V.holderTable(ston, H, {search, page: 90});
    assert.equal(result.count, 1); assert.equal(result.page, 0); assert.deepEqual(ranks(result.html), [135]);
    assert.ok(result.html.includes('Tài khoản chủ<br><code class="wallet-address" title="' + row.owner + '">' + row.owner));
    assert.ok(result.html.includes('Jetton wallet contract<br><code class="wallet-address" title="' + row.jettonWallet + '">' + row.jettonWallet));
  }
  const empty = V.holderTable(ston, H, {search: 'not-an-address-or-provider-label'});
  assert.equal(empty.count, 0); assert.equal(empty.pages, 1); assert.match(empty.html, /Không có địa chỉ/);
});

test('provider labels are searchable, escaped, and never interpreted as HTML', () => {
  const token = copy(ston), label = '<img src=x onerror="alert(1)"> & provider'; token.rows[21].providerLabel = label;
  const table = V.holderTable(token, H, {search: 'provider'});
  assert.deepEqual(ranks(table.html), [22]); assert.ok(table.html.includes(escaped(label)));
  assert.ok(!table.html.includes(label)); assert.doesNotMatch(table.html, /<img/);
});

test('holder table and chart retain exact raw amounts and reported total-supply denominator', () => {
  const row = ston.rows.find(r => BigInt(r.balanceRaw) > BigInt(Number.MAX_SAFE_INTEGER) && r.balanceRaw.slice(-9) !== '000000000');
  assert.ok(row, 'real source has a large fractional balance');
  const table = V.holderTable(ston, H, {search: row.owner});
  assert.ok(table.html.includes(exactTokens(row.balanceRaw, ston.decimals)));
  assert.ok(table.html.includes('title="raw=' + row.balanceRaw + '; decimals=9"'));
  const chart = V.distributionChart(ston, H);
  assert.match(chart, /tổng cung do nguồn báo cáo/); assert.doesNotMatch(chart, /circulating|cá mập/);
  assert.equal((chart.match(/class="holder-bar"/g) || []).length, 5);
});

test('holder details expose exact source receipts and actual interval without inventing daily flow', () => {
  const c = V.comparison(holders, ston, H), html = V.holderDetails(ston, holders, H);
  assert.match(html, /Chưa có chuỗi ngày \/ tuần \/ tháng/);
  assert.ok(html.includes(((ston.fetchedAt - c.previous.fetchedAt) / 60000).toLocaleString('en-US', {maximumFractionDigits: 2}) + ' phút'));
  for (const proof of ston.provenance) { assert.ok(html.includes('href="' + escaped(proof.url) + '"')); assert.ok(html.includes(proof.sha256)); }
  assert.ok(html.includes(ston.master)); assert.ok(html.includes('href="' + escaped(ston.identityUrl) + '"'));
  assert.match(html, /không bảo đảm cùng một block/); assert.match(html, /Chưa loại địa chỉ sàn, DEX/);
  const single = {tokens: [ston], observations: [ston]};
  assert.equal(V.comparison(single, ston, H), null); assert.match(V.holderDetails(ston, single, H), /Chưa có mốc trước để so/);
});

test('DEX chart counts all returned swaps while explicitly separating finalized coverage', () => {
  const chart = V.dexChart(dex, D), counts = [...chart.matchAll(/ · (\d+) swaps trong mẫu/g)].map(m => Number(m[1]));
  assert.equal(counts.reduce((sum, count) => sum + count, 0), dex.trades.length);
  assert.equal(dex.trades.length, 300); assert.ok(dex.coverage.eligibleFinalizedCount < dex.trades.length);
  const details = V.dexDetails(dex, D);
  assert.ok(details.includes(dex.coverage.eligibleFinalizedCount + ' swap có block ≤ block finalized'));
  assert.ok(details.includes((300 - dex.coverage.eligibleFinalizedCount) + ' swap sau block đó'));
  assert.match(details, /không suy ra dòng mua ròng 24H hoặc toàn Ethereum/);
});

test('DEX sender table uses finalized-only counts and net values rather than all observed swaps', () => {
  const details = V.dexDetails(dex, D), rows = senderRows(details);
  assert.equal(rows.length, dex.senders.length);
  const sender = dex.senders.find(r => r.netObservedBuyUsd !== r.netFinalizedBuyUsd && usd(r.netObservedBuyUsd) !== usd(r.netFinalizedBuyUsd));
  assert.ok(sender, 'real sample contains later swaps for a checked sender');
  const row = rows.find(html => html.includes(sender.address));
  const finalized = dex.trades.filter(t => t.sender === sender.address && t.blockNumber <= dex.finalizedBlock.number);
  const net = finalized.reduce((sum, t) => sum + (t.kind === 'buy' ? 1 : -1) * Number(t.volumeUsd), 0);
  assert.ok(Math.abs(net - sender.netFinalizedBuyUsd) < 1e-8);
  assert.ok(row.includes('<td>' + finalized.length + '</td><td>' + usd(net) + '</td>'));
  assert.ok(!row.includes(usd(sender.netObservedBuyUsd)));
});

test('DEX observed zero balances stay zero and unavailable balances stay missing', () => {
  const zero = dex.senders.find(r => r.balanceBaseRaw === '0'); assert.ok(zero);
  const zeroRow = senderRows(V.dexDetails(dex, D)).find(row => row.includes(zero.address));
  assert.match(zeroRow, /<td title="raw=0">0<\/td>/);
  const missing = copy(dex); missing.senders[0].balanceBaseRaw = null; missing.senders[0].error = 'Test fixture: unavailable balance'; missing.coverage.checkedSenderCount--;
  const checked = D.validateSnapshot(missing, {now: Math.max(Date.now(), Date.parse(missing.generatedAt))});
  const missingRow = senderRows(V.dexDetails(checked, D)).find(row => row.includes(missing.senders[0].address));
  assert.match(missingRow, /<td title="raw=">Thiếu<\/td>/);
});

test('DEX proof preserves source URLs, hashes, chain contracts and sender/recipient distinction', () => {
  const html = V.dexDetails(dex, D);
  for (const key of ['trades', 'pool', 'catalog', 'tokenIdentity', 'blockBefore', 'blockAfter']) {
    assert.ok(html.includes('href="' + escaped(dex.sources[key].url) + '"')); assert.ok(html.includes(dex.sources[key].sha256));
  }
  for (const value of [dex.pool.address, dex.pool.baseToken.address, dex.pool.quoteToken.address, dex.finalizedBlock.hash]) assert.ok(html.includes(value));
  assert.notEqual(dex.routingExample.sender, dex.routingExample.recipient);
  assert.ok(html.includes(dex.routingExample.sender)); assert.ok(html.includes(dex.routingExample.recipient));
  assert.ok(html.includes('https://etherscan.io/tx/' + dex.routingExample.txHash));
  assert.match(html, /khác sender/); assert.match(html, /không chứng minh giữ lại lượng đã mua hoặc cùng chủ sở hữu/);
  assert.match(html, /không xác định người dùng, cá mập hoặc chủ sở hữu hưởng lợi/);
});

test('external pool links reject executable or credential-bearing URLs and escape labels', () => {
  for (const url of ['javascript:alert(1)', 'https://user:password@example.com/pool']) {
    const altered = copy(dex); altered.pool.url = url; altered.pool.name = '<img src=x onerror="alert(1)">';
    const html = V.dexDetails(altered, D);
    assert.ok(!html.includes('href="' + escaped(url) + '"')); assert.doesNotMatch(html, /<img/);
    assert.ok(html.includes('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'));
  }
});
