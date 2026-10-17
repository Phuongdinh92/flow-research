#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const H = require('./holder-history.js');
const BASE = 'https://mainnet.mirrornode.hedera.com';
const proofDir = path.resolve(__dirname, '../probes/holder-history-v9');
const output = path.resolve(__dirname, 'data/holder-history-snapshot.json');
const MINIMUM = process.env.HBAR_MINIMUM_RAW || '100000000000000'; // 1 million native HBAR, not 1 million tinybars.
const args = process.argv.slice(2);
function option(name, fallback) { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; }
const days = Number(option('--days', '30'));
if (!Number.isInteger(days) || days < 1 || days > 120) throw Error('--days must be an integer from 1 to 120');
const cutoff = option('--cutoff', process.env.HBAR_CUTOFF || (Math.floor(Date.now() / 86400000) * 86400) + '.000000000');
if (!/^[1-9][0-9]{8,10}\.000000000$/.test(cutoff) || BigInt(cutoff.split('.')[0]) % 86400n !== 0n) throw Error('--cutoff must be a UTC-midnight seconds.000000000 timestamp');
if (!/^[1-9][0-9]{0,30}$/.test(MINIMUM)) throw Error('Invalid HBAR_MINIMUM_RAW');
const offsets = [...new Set([...Array.from({ length: days }, (_, i) => i), 1, 7, 30, 90])].sort((a, b) => a - b);
const IDS = offsets.map(n => [n === 0 ? 'latest' : n + 'd', n]);
fs.mkdirSync(proofDir, { recursive: true });
const wait = ms => new Promise(r => setTimeout(r, ms));
let nextRequestAt = 0, stopped = false;
async function request(url) {
  if (stopped) throw Error('Collection halted after an earlier source error');
  const key = crypto.createHash('sha256').update(url).digest('hex');
  const bodyPath = path.join(proofDir, key + '.raw.json'), metaPath = path.join(proofDir, key + '.meta.json');
  if (fs.existsSync(bodyPath) && fs.existsSync(metaPath)) {
    const body = fs.readFileSync(bodyPath, 'utf8'), proof = JSON.parse(fs.readFileSync(metaPath));
    if (proof.url !== url || crypto.createHash('sha256').update(body).digest('hex') !== proof.sha256 || proof.httpStatus !== 200) throw Error('Invalid cached source proof');
    return { value: H.parseSource(body), proof };
  }
  // Global 500ms start spacing also applies across independent historical dates.
  const reservedAt = Math.max(Date.now(), nextRequestAt); nextRequestAt = reservedAt + 500;
  await wait(Math.max(0, reservedAt - Date.now())); if (stopped) throw Error('Collection halted after an earlier source error');
  const requestedAt = Date.now(); let response;
  try { response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(45000), headers: { Accept: 'application/json' } }); }
  catch (e) { stopped = true; throw e; }
  const body = await response.text(), proof = { url, requestedAt, fetchedAt: Date.now(), httpStatus: response.status, sha256: crypto.createHash('sha256').update(body).digest('hex'), rawFile: path.basename(bodyPath) };
  fs.writeFileSync(bodyPath, body); fs.writeFileSync(metaPath, JSON.stringify(proof, null, 2) + '\n');
  if (!response.ok) { stopped = true; throw Error('Mirror Node HTTP ' + response.status + '; collection stopped without retry or alternative route'); }
  try { return { value: H.parseSource(body), proof }; } catch (e) { stopped = true; throw e; }
}
async function collect(id, days) {
  const requestedCutoff = (BigInt(cutoff.replace('.', '')) - BigInt(days) * 86400000000000n).toString().replace(/([0-9]{9})$/, '.$1');
  const params = new URLSearchParams({ limit: '100', order: 'asc', 'account.balance': 'gte:' + MINIMUM, timestamp: 'lte:' + requestedCutoff });
  let url = BASE + '/api/v1/balances?' + params.toString(), pages = [], timestamp = null;
  while (url) {
    if (pages.length >= 150) throw Error(id + ': exceeded bounded 150-page budget');
    const page = await request(url); pages.push(page); const emptyTerminal = page.value.timestamp === null && page.value.balances.length === 0 && page.value.links.next === null; if (timestamp && timestamp !== page.value.timestamp && !emptyTerminal) throw Error('Historical snapshot changed across pages'); if (!emptyTerminal) timestamp = page.value.timestamp;
    process.stdout.write(JSON.stringify({ id, page: pages.length, rows: page.value.balances.length, timestamp }) + '\n');
    const next = page.value.links.next;
    if (next) {
      const u = new URL(next, BASE); if (u.origin !== BASE || u.pathname !== '/api/v1/balances' || u.searchParams.get('timestamp') !== 'lte:' + requestedCutoff || u.searchParams.get('account.balance') !== 'gte:' + MINIMUM || u.searchParams.get('order') !== 'asc') throw Error('Unexpected pagination URL');
      if (pages.some(p => p.proof.url === u.href)) throw Error('Pagination loop'); url = u.href;
    } else url = null;
  }
  const observation = H.normalizeObservation(id, requestedCutoff, pages, MINIMUM, { startedAt: Math.min(...pages.map(p => p.proof.requestedAt)), fetchedAt: Math.max(...pages.map(p => p.proof.fetchedAt)) });
  fs.writeFileSync(path.join(proofDir, id + '-observation.json'), JSON.stringify(observation) + '\n'); return observation;
}
async function main() {
  const observations = [], queue = [...IDS];
  // Independent historical cutoffs, bounded concurrency. Pages for one cutoff are sequential.
  await Promise.all([0, 1].map(async () => { try { while (queue.length) { if (stopped) throw Error('Collection halted after an earlier source error'); const [id, days] = queue.shift(); observations.push(await collect(id, days)); } } catch (e) { stopped = true; throw e; } }));
  observations.sort((a, b) => IDS.findIndex(x => x[0] === a.id) - IDS.findIndex(x => x[0] === b.id));
  const snapshot = H.validateSnapshot({ schemaVersion: 1, asset: H.ASSET, source: { id: 'hedera-mirror-node', baseUrl: BASE, docsUrl: BASE + '/api/v1/docs/', snapshotGranularitySeconds: 900 }, history: { requestedDailySnapshotCount: days, cutoffPolicy: 'UTC_midnight_at_or_before_with_15_minute_source_granularity', requestedLatestCutoff: cutoff, interpolation: false }, generatedAt: Date.now(), meaning: 'Native HBAR account custody balances, including unclassified infrastructure; not purchases, beneficial owners or validated whale accumulation.', observations });
  const temp = output + '.tmp'; fs.writeFileSync(temp, JSON.stringify(snapshot) + '\n'); fs.renameSync(temp, output);
  fs.writeFileSync(path.join(proofDir, 'collection-report.json'), JSON.stringify({ generatedAt: snapshot.generatedAt, cutoff, minimumBalanceRaw: MINIMUM, observations: observations.map(o => ({ id: o.id, requestedCutoff: o.requestedCutoff, timestamp: o.timestamp, rows: o.rows.length, pages: o.provenance.length, topNComplete: o.coverage.topNComplete })), comparisons: observations.filter(o => o.id !== 'latest').map(o => H.compare(o, observations[0])), sha256: crypto.createHash('sha256').update(fs.readFileSync(output)).digest('hex') }, null, 2) + '\n');
  process.stdout.write('SAVED ' + output + '\n');
}
if (require.main === module) main().catch(e => { console.error(e.stack || e); process.exitCode = 1; });
module.exports = { collect, request };
