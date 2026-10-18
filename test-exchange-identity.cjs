'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), crypto = require('node:crypto');
const I = require('./exchange-identity.js');
const saved = JSON.parse(fs.readFileSync('data/exchange-identity.json'));
const sha = body => crypto.createHash('sha256').update(body).digest('hex');
function copy() { return structuredClone(saved); }
function replacePage(snapshot, index, transform) {
  const page = snapshot.sourcePages[index], body = JSON.parse(page.body);
  transform(body); page.body = JSON.stringify(body); page.sha256 = sha(page.body);
  Object.assign(snapshot, I.derive(snapshot.sourcePages));
  return snapshot;
}
test('actual partial exchange receipts reproduce every explicit coin_id binding', async () => {
  assert.equal(await I.validateSnapshot(saved), saved);
  assert.equal(saved.collectionComplete, false);
  assert.equal(saved.sourcePages.length, 5);
  assert.equal(saved.bindings.length, 198);
  for (const binding of saved.bindings) {
    const page = saved.sourcePages.find(p => p.url === binding.sourceUrl);
    const row = JSON.parse(page.body).tickers[binding.sourceIndex];
    assert.equal(binding.sourceSha256, sha(page.body));
    assert.equal(row.coin_id, binding.coinId);
    assert.equal(row.target_coin_id, 'tether');
    assert.equal(row.market.identifier, 'binance');
    assert.equal(binding.key, 'binance:' + row.base + 'USDT');
  }
});
test('tampered provider body or rewritten derived coin identity fails replay', async () => {
  const raw = copy(); raw.sourcePages[0].body += ' ';
  await assert.rejects(I.validateSnapshot(raw), /SHA256 mismatch/);
  const binding = copy(); binding.bindings[0].coinId = 'another-asset';
  await assert.rejects(I.validateSnapshot(binding), /differs from raw/);
  const receipt = copy(); receipt.bindings[0].sourceIndex++;
  await assert.rejects(I.validateSnapshot(receipt), /differs from raw/);
});
test('conflicting coin_ids for the same Binance instrument are excluded, never ticker-matched', async () => {
  const s = copy(), first = JSON.parse(s.sourcePages[0].body).tickers.find(t => t.target === 'USDT');
  replacePage(s, 1, body => { body.tickers[0] = {...first, coin_id: 'different-asset'}; });
  const key = 'binance:' + first.base + 'USDT';
  assert.ok(s.conflicts.includes(key));
  assert.equal(s.bindings.some(b => b.key === key), false);
  await I.validateSnapshot(s);
});
test('wrong venue, quote asset identity or trade venue cannot produce a binding', () => {
  for (const change of [t => {t.market.identifier = 'other-exchange';}, t => {t.target_coin_id = 'other-usdt';}, t => {t.trade_url = 'https://example.com/trade/' + t.base + '_USDT';}]) {
    const s = copy(), p = JSON.parse(s.sourcePages[0].body), i = p.tickers.findIndex(t => t.target === 'USDT'), key = 'binance:' + p.tickers[i].base + 'USDT';
    replacePage(s, 0, body => change(body.tickers[i]));
    assert.equal(s.bindings.some(b => b.key === key), false);
    assert.ok(s.excluded.some(e => e.page === s.sourcePages[0].url && e.sourceIndex === i));
  }
});
test('gapped, duplicate, post-collection pages and false completion are rejected', async () => {
  const missing = copy(); missing.sourcePages.splice(1, 1); Object.assign(missing, I.derive(missing.sourcePages));
  await assert.rejects(I.validateSnapshot(missing), /pagination gap/);
  const duplicate = copy(); duplicate.sourcePages.push(structuredClone(duplicate.sourcePages[0]));
  await assert.rejects(I.validateSnapshot(duplicate), /chronology/);
  const late = copy(); late.sourcePages[0].receivedAt = late.generatedAt + 1;
  await assert.rejects(I.validateSnapshot(late), /chronology/);
  const complete = copy(); complete.collectionComplete = true;
  await assert.rejects(I.validateSnapshot(complete), /terminal empty/);
});
