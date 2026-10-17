#!/usr/bin/env node
/* Ordinary public info reads only. No wallet login, trading, API key, hidden endpoint or retries.
   node collect_derivatives.cjs [--history-markets 32] [--history-days 90] [--selection-from data/derivatives-snapshot.json]
   Any failed request/validation preserves the previous published capture. */
'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const D = require('./derivatives-core.js');
const RECEIPTS = path.join(__dirname, '..', 'probes', 'derivatives-v9');
const OUTPUT = path.join(__dirname, 'data', 'derivatives-snapshot.json');
const REQUEST_GAP_MS = 2500, PAGE_LIMIT = 500;
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function saveAtomic(file, value) {
  const text = JSON.stringify(value), temp = file + '.tmp';
  fs.writeFileSync(temp, text); fs.renameSync(temp, file); return { bytes: Buffer.byteLength(text), sha256: digest(text) };
}
function argumentsFrom(argv) {
  const out = { historyMarkets: 32, historyDays: 90 };
  for (let i = 0; i < argv.length; i += 2) {
    const key = { '--history-markets': 'historyMarkets', '--history-days': 'historyDays', '--selection-from': 'selectionFrom' }[argv[i]];
    if (!key || !argv[i + 1] || key !== 'selectionFrom' && !/^\d+$/.test(argv[i + 1])) throw Error('Usage: --history-markets 0..200 --history-days 1..90 [--selection-from snapshot.json]');
    out[key] = key === 'selectionFrom' ? argv[i + 1] : Number(argv[i + 1]);
  }
  if (!Number.isInteger(out.historyMarkets) || out.historyMarkets < 0 || out.historyMarkets > 200 || !Number.isInteger(out.historyDays) || out.historyDays < 1 || out.historyDays > 90) throw Error('History limits out of range');
  return out;
}
function selectMarkets(normalized, historyMarkets, selectionFrom) {
  const active = normalized.assets.filter(a => !a.isDelisted);
  if (!selectionFrom) return { selected: [...active].sort((a,b) => b.volume24hQuote - a.volume24hQuote || a.nativeIndex - b.nativeIndex).slice(0, historyMarkets),
    policy: 'top active original-DEX markets by dayNtlVlm at this context capture, deterministic tie break nativeIndex', baseline: null };
  const bytes = fs.readFileSync(selectionFrom), previous = JSON.parse(bytes);
  D.validateSnapshot(previous);
  const keys = previous.fundingSelection?.selectedNativeKeys;
  if (!Array.isArray(keys) || !keys.length || keys.length !== historyMarkets || new Set(keys).size !== keys.length || keys.some(k => !previous.fundingHistories[k])) throw Error('Frozen funding selection missing, duplicated or does not match requested market count');
  const byKey = new Map(normalized.assets.map(a => [a.key,a]));
  const selected = keys.map(k => byKey.get(k));
  if (selected.some(a => !a || a.isDelisted)) throw Error('Frozen native market absent or delisted in current metadata; previous capture preserved');
  return { selected, policy: 'Exact native key membership and order frozen from validated prior snapshot; no ticker aliases or volume reranking',
    baseline: { sha256: digest(bytes), asOf: previous.asOf, selectedNativeKeys: keys } };
}
function createRequester({ fetchImpl = fetch, receiptsDir = RECEIPTS, gapMs = REQUEST_GAP_MS, clock = Date.now } = {}) {
  let lastStarted = 0, halted = false;
  return async function request(requestBody, label) {
    if (halted) throw Error('Source collection already halted; no automatic retries');
    await pause(Math.max(0, gapMs - (clock() - lastStarted)));
    const startedAt = clock(); lastStarted = startedAt;
    let response, body;
    try {
      response = await fetchImpl(D.ENDPOINT, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(requestBody), signal: AbortSignal.timeout(25000) });
      body = await response.text();
    } catch (error) { halted = true; throw Object.assign(Error('Source/network collection halted: ' + error.message), { stage: 'network', requestBody }); }
    const fetchedAt = clock(), sha256 = digest(body), file = label + '-' + sha256 + '.json';
    fs.mkdirSync(receiptsDir, { recursive: true }); fs.writeFileSync(path.join(receiptsDir, file), body);
    const receipt = { url: D.ENDPOINT, method: 'POST', requestBody, startedAt, fetchedAt, timestampBasis: 'collector_clock_utc', httpStatus: response.status,
      contentType: response.headers.get('content-type'), bytes: Buffer.byteLength(body), sha256, archiveFile: file };
    fs.writeFileSync(path.join(receiptsDir, file + '.receipt.json'), JSON.stringify(receipt));
    if (!response.ok) { halted = true; throw Object.assign(Error('HTTP ' + response.status + '; no retries'), { stage: [403, 418, 429].includes(response.status) ? 'source-restriction' : 'http', receipt }); }
    if (!/application\/json/i.test(receipt.contentType || '')) { halted = true; throw Object.assign(Error('Source did not return JSON'), { stage: 'content-type', receipt }); }
    let value; try { value = JSON.parse(body); } catch (_) { halted = true; throw Object.assign(Error('Invalid source JSON'), { stage: 'json', receipt }); }
    return { value, receipt };
  };
}
async function collectFunding(request, asset, startTime, endTime) {
  let cursor = startTime, pages = [], receipts = [], unique = new Map();
  // Up to 90 days (2160 hourly records) needs at most five inclusive pages of 500.
  for (let p = 0; p < 5; p++) {
    const captured = await request({ type: 'fundingHistory', coin: asset.nativeName, startTime: cursor, endTime }, 'funding-' + asset.nativeIndex + '-page-' + p);
    const normalized = D.normalizeFunding(captured.value, asset.nativeName, cursor, endTime);
    receipts.push(captured.receipt); pages.push({ startTime: cursor, returnedRows: normalized.rows.length, sha256: captured.receipt.sha256 });
    let added = 0;
    for (const r of captured.value) {
      const old = unique.get(r.time);
      if (old && JSON.stringify(old) !== JSON.stringify(r)) throw Error('Conflicting source records at funding timestamp');
      if (!old) { unique.set(r.time, r); added++; }
    }
    if (captured.value.length < PAGE_LIMIT) break;
    const last = normalized.rows.at(-1)?.time;
    if (!added || !last || last <= cursor) throw Error('Funding pagination did not advance');
    if (last >= endTime) break;
    cursor = last; // Documented inclusive cursor; exact duplicate boundary record is deduplicated, never silently skipped.
    if (p === 4) throw Error('Funding pagination exhausted guard');
  }
  const history = D.normalizeFunding([...unique.values()], asset.nativeName, startTime, endTime);
  return { ...history, receipts, pages, sourceUnit: 'fraction_of_native_contract_quote_notional_per_hour', pagination: 'inclusive last timestamp; exact duplicate boundary removed; conflicting duplicate rejects capture' };
}
async function collect(options = {}) {
  const { historyMarkets = 32, historyDays = 90, selectionFrom = null, output = OUTPUT, receiptsDir = RECEIPTS, request: injectedRequest, clock = Date.now } = options;
  if (!Number.isInteger(historyMarkets) || historyMarkets < 0 || historyMarkets > 200 || !Number.isInteger(historyDays) || historyDays < 1 || historyDays > 90) throw Error('Invalid history scope');
  fs.mkdirSync(receiptsDir, { recursive: true });
  const request = injectedRequest || createRequester({ receiptsDir, clock }), startedAt = clock();
  try {
    const captured = await request({ type: 'metaAndAssetCtxs', dex: '' }, 'meta-context'), normalized = D.normalizeContext(captured.value);
    const asOf = captured.receipt.fetchedAt, endTime = Math.floor(asOf / D.HOUR) * D.HOUR - 1, startTime = endTime + 1 - historyDays * D.DAY;
    const active = normalized.assets.filter(a => !a.isDelisted), selection = selectMarkets(normalized, historyMarkets, selectionFrom), selected = selection.selected;
    const fundingHistories = {};
    for (let i = 0; i < selected.length; i++) {
      const asset = selected[i]; fundingHistories[asset.key] = await collectFunding(request, asset, startTime, endTime);
      if ((i + 1) % 8 === 0) console.log(JSON.stringify({ stage: 'funding', completedMarkets: i + 1, requestedMarkets: selected.length, observations: Object.values(fundingHistories).reduce((n,h) => n + h.rows.length, 0) }));
    }
    const finishedAt = clock(), snapshot = { schemaVersion: 1, kind: 'derivatives-context', sourceId: 'hyperliquid', dex: '', marketType: 'perpetual',
      generatedAt: finishedAt, asOf, providerAsOf: null, timestampBasis: 'collector_response_received_utc', startedAt, finishedAt, collectionState: 'complete', errors: [],
      scope: 'Dated full metadata universe of the original Hyperliquid perp DEX (dex=""), including delisted entries. Excludes HIP-3 DEXs, other venues, spot wallets and beneficial-owner attribution.',
      metadata: normalized.metadata, assets: normalized.assets, contextReceipt: captured.receipt, fundingHistories,
      fundingSelection: { policy: selection.policy, baseline: selection.baseline, requestedMarkets: selected.length,
        requestedDays: historyDays, startTime, endTime, selectedNativeKeys: selected.map(a => a.key), historicalMembership: false },
      coverage: { metadataEntries: normalized.assets.length, activeMarkets: active.length, delistedMarkets: normalized.assets.length - active.length,
        fundingRequested: selected.length, fundingCaptured: Object.keys(fundingHistories).length, fundingRecords: Object.values(fundingHistories).reduce((n,h) => n + h.rows.length, 0),
        fundingCompleteWindows: Object.values(fundingHistories).filter(h => h.coverage.complete).length },
      capabilities: { currentFunding: true, currentOpenInterest: true, markAndOracle: true, fundingHistory: selected.length > 0,
        openInterestHistory: false, liquidationHeatmap: false, whaleAttribution: false, wholeDerivativesMarket: false },
      collector: { file: 'collect_derivatives.cjs', scheduled: false, minimumRequestGapMs: REQUEST_GAP_MS, retryPolicy: 'No retry; any request or validation failure preserves previous published capture',
        publicationPolicy: 'All-or-nothing atomic rename after full snapshot validation', sourceAuthentication: 'none; public info POST only',
        rawDecimalPolicy: 'Exact source decimal strings retained under rawContext/raw records; numeric projections are JavaScript doubles for visualization' },
      units: { price: 'native contract quote per native underlying unit', openInterest: 'native underlying size, not USD and not directional net long',
        openInterestQuoteAtMark: 'openInterest × markPx, estimated notional in contract quote', openInterestQuoteAtOracle: 'openInterest × oraclePx, estimated notional in contract quote',
        volume24hQuote: 'source dayNtlVlm; native quote notional turnover, not cash flow', fundingRateHourly: 'fraction per hour; ×100 to percent; positive longs pay shorts',
        settlement: 'USDC collateral, mostly USDT oracle denomination (HYPE/PURR USDC per docs); no USDC/USDT exchange-rate conversion; aggregates USD-equivalent only' },
      sourceDocs: D.DOCS, limitations: D.LIMITATIONS };
    D.validateSnapshot(snapshot, { now: finishedAt });
    fs.mkdirSync(path.dirname(output), { recursive: true }); const saved = saveAtomic(output, snapshot);
    saveAtomic(path.join(receiptsDir, 'last-success-report.json'), { output, ...saved, startedAt, finishedAt, coverage: snapshot.coverage, sourceDocs: D.DOCS });
    console.log(JSON.stringify({ saved: output, ...saved, asOf: new Date(asOf).toISOString(), finishedAt: new Date(finishedAt).toISOString(), coverage: snapshot.coverage }));
    return snapshot;
  } catch (error) {
    saveAtomic(path.join(receiptsDir, 'last-failure-report.json'), { failedAt: Date.now(), stage: error.stage || 'validation', message: error.message, receipt: error.receipt || null, publication: 'Previous snapshot preserved; capture not published' });
    throw error;
  }
}
if (require.main === module) { let opts; try { opts = argumentsFrom(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exitCode = 1; } if (opts) collect(opts).catch(e => { console.error(e.message); process.exitCode = 1; }); }
module.exports = { collect, collectFunding, createRequester, argumentsFrom, selectMarkets, saveAtomic, digest };
