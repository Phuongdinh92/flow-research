#!/usr/bin/env node
/* Read-only unauthenticated TON holder collection. Run: node collect_holders.cjs [ston not dogs]
   Uses official documented free pacing >= 5 seconds, no retries, authentication or scheduling.
   Preserves each previous token on failure. Raw response receipts stay outside the public repository. */
'use strict';
const fs = require('node:fs'), path = require('node:path'), H = require('./holders.js');
const output = path.join(__dirname, 'data/holders-snapshot.json');
const receipts = path.join(__dirname, '..', 'probes', 'holders-v7');
fs.mkdirSync(receipts, { recursive: true });
(async () => {
  const args = process.argv.slice(2), ids = args.length ? args : H.TOKENS.map(t => t.id);
  if (new Set(ids).size !== ids.length || ids.some(id => !H.TOKENS.some(t => t.id === id))) throw Error('Use unique supported token IDs: ston not dogs');
  let snapshot = fs.existsSync(output) ? H.validateSnapshot(JSON.parse(fs.readFileSync(output, 'utf8'))) : { schemaVersion: 1, sourceId: 'tonapi', generatedAt: Date.now(), tokens: [],
    scope: 'Selected TON token owner accounts ranked by provider-reported current balance. No identified people, whale classification, purchases, historical cohort flows, or whole-market assertion.',
    method: 'Raw integer balances, identity by chain and exact jetton master, source-ranked holder cohorts. Latest indexed state observed during the per-token collection window, not one atomic chain block. Unseen owners are not assigned zero.' };
  for (const id of ids) {
    console.log('Collecting ' + id + ' top 1000 owner accounts');
    snapshot = await H.refresh(snapshot, id, fetch, { onReceipt: async r => {
      const base = id + '-' + r.sha256;
      fs.writeFileSync(path.join(receipts, base + '.raw.json'), r.body);
      const { body, ...meta } = r; fs.writeFileSync(path.join(receipts, base + '-' + r.fetchedAt + '.meta.json'), JSON.stringify(meta, null, 2));
    } });
    const tmp = output + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(snapshot)); fs.renameSync(tmp, output);
    const token = snapshot.tokens.find(t => t.id === id);
    console.log(JSON.stringify({ token: id, observedOwners: token.rows.length, providerHolderCount: token.holderCountReported, startedAt: token.startedAt, fetchedAt: token.fetchedAt, provenance: token.provenance.map(p => ({ id: p.id, httpStatus: p.httpStatus, sha256: p.sha256 })) }));
  }
})().catch(e => { console.error(e.message); process.exitCode = 1; });
