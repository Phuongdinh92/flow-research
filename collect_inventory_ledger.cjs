#!/usr/bin/env node
'use strict';
// Offline only. Replays retained HTTP bytes; never retries a restricted RPC.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const Chain = require('./chain-ledger.js'), Inventory = require('./inventory-ledger.js');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const hex = n => '0x' + n.toString(16), word = address => address.slice(2).padStart(64, '0');
// Runs created by collect_chain_ledger use descriptive *.raw.json names;
// private audit exports use <sha256>.json. Resolve only inside the requested
// root, without following symlinks or silently fetching missing responses.
function indexRetainedSources(rawRoot, requiredHashes) {
  const root = path.resolve(rawRoot), found = new Map(), needed = new Set(requiredHashes);
  assert(needed.size > 0 && [...needed].every(s => /^[0-9a-f]{64}$/.test(s)), 'Invalid required raw source hashes');
  assert(fs.existsSync(root) && fs.lstatSync(root).isDirectory() && !fs.lstatSync(root).isSymbolicLink(), 'Missing or unsafe retained raw root: ' + root);
  let examined = 0, readBytes = 0;
  const inspect = (filename, expectedSha) => {
    const stat = fs.lstatSync(filename);
    assert(stat.isFile() && !stat.isSymbolicLink(), 'Unsafe retained raw source file');
    assert(++examined <= 20000 && stat.size <= 16 * 1024 * 1024 && (readBytes += stat.size) <= 256 * 1024 * 1024, 'Retained raw source index limit exceeded');
    const bytes = fs.readFileSync(filename), hash = sha(bytes);
    if (expectedSha) assert(hash === expectedSha, 'Raw HTTP SHA mismatch: ' + expectedSha);
    if (needed.has(hash) && !found.has(hash)) found.set(hash, bytes);
  };
  for (const hash of needed) {
    const filename = path.join(root, hash + '.json');
    if (fs.existsSync(filename)) inspect(filename, hash);
  }
  if (found.size === needed.size) return found;
  const queue = [root]; let directories = 0;
  while (queue.length && found.size < needed.size) {
    const directory = queue.shift(); assert(++directories <= 5000, 'Retained raw directory index limit exceeded');
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink()) continue;
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) queue.push(filename);
      else if (entry.isFile() && /(?:\.raw\.json|^[0-9a-f]{64}\.json)$/.test(entry.name)) {
        if (directory === root && /^[0-9a-f]{64}\.json$/.test(entry.name) && needed.has(entry.name.slice(0, 64))) continue;
        inspect(filename);
      }
      if (found.size === needed.size) break;
    }
  }
  return found;
}
function replaySnapshot(chainBytes, rawRoot, generatedAt = new Date().toISOString()) {
  const chain = JSON.parse(chainBytes); Chain.validateSnapshot(chain);
  const rawSources = indexRetainedSources(rawRoot, chain.sources.map(s => s.sha256));
  const calls = new Map(), evidenceSources = [], seenSha = new Set();
  let verifiedBytes = 0;
  for (const source of chain.sources) {
    assert(source.status === 200 && /^[0-9a-f]{64}$/.test(source.sha256), 'Invalid retained HTTP source');
    const bytes = rawSources.get(source.sha256);
    assert(bytes, 'Missing retained raw HTTP bytes: ' + source.sha256);
    assert(sha(bytes) === source.sha256, 'Raw HTTP SHA mismatch: ' + source.sha256);
    const response = JSON.parse(bytes);
    if (!seenSha.has(source.sha256)) {
      seenSha.add(source.sha256); verifiedBytes += bytes.length;
      evidenceSources.push({ sha256: source.sha256, url: source.url, status: source.status, fetchedAt: source.fetchedAt });
    }
    if (!source.payload) continue;
    assert(source.url === 'https://eth.drpc.org/', 'Unexpected RPC provenance');
    const requests = Array.isArray(source.payload) ? source.payload : [source.payload];
    const responses = Array.isArray(response) ? response : [response];
    assert(requests.length === responses.length, 'RPC request/result cardinality mismatch');
    for (const request of requests) {
      const rows = responses.filter(r => r.id === request.id);
      assert(rows.length === 1 && !rows[0].error && Object.hasOwn(rows[0], 'result'), 'Missing exact RPC result');
      const id = JSON.stringify([request.method, request.params]), previous = calls.get(id);
      assert(!previous || isDeepStrictEqual(previous.result, rows[0].result), 'Conflicting fixed-block RPC result: ' + id);
      if (!previous) calls.set(id, { result: rows[0].result, sourceSha256: source.sha256 });
    }
  }
  const lookup = (method, params) => { const r = calls.get(JSON.stringify([method, params])); assert(r, 'Missing retained RPC call: ' + method + ' ' + JSON.stringify(params)); return r; };
  const block = number => {
    const r = lookup('eth_getBlockByNumber', [hex(number), false]), b = r.result;
    assert(Chain.quantity(b.number) === number && /^0x[0-9a-f]{64}$/.test(b.hash), 'Invalid raw block identity');
    return { blockNumber: number, blockHash: b.hash, timestamp: new Date(Chain.quantity(b.timestamp) * 1000).toISOString(), blockSourceSha256: r.sourceSha256 };
  };
  assert(BigInt(lookup('eth_chainId', []).result) === BigInt(chain.chainId), 'Raw chain ID mismatch');
  const final = block(chain.finalizedBlock.number);
  assert(final.blockHash === chain.finalizedBlock.hash && final.timestamp === chain.finalizedBlock.timestamp, 'Finalized source changed');
  const finalizedBefore = lookup('eth_getBlockByNumber', ['finalized', false]).result;
  assert(finalizedBefore.hash === final.blockHash && Chain.quantity(finalizedBefore.number) === final.blockNumber, 'Finalized before/after mismatch');
  const balanceValue = (tokenAddress, address, number) => {
    const r = lookup('eth_call', [{ to: tokenAddress, data: '0x70a08231' + word(address) }, hex(number)]);
    assert(/^0x[0-9a-f]{64}$/.test(r.result), 'Invalid raw uint256 balance');
    return { balanceRaw: BigInt(r.result).toString(), sourceSha256: r.sourceSha256 };
  };
  const balance = (tokenAddress, address, number) => ({ tokenAddress, address, ...block(number), ...balanceValue(tokenAddress, address, number) });
  const receipts = [], transfers = [], byHash = new Map();
  for (const txHash of [...new Set(chain.swaps.map(s => s.txHash))].sort()) {
    const r = lookup('eth_getTransactionReceipt', [txHash]), receipt = r.result;
    assert(receipt.transactionHash === txHash && receipt.status === '0x1', 'Raw receipt status/identity mismatch');
    const header = block(Chain.quantity(receipt.blockNumber));
    assert(receipt.blockHash === header.blockHash && header.blockNumber <= final.blockNumber, 'Raw receipt canonical block mismatch');
    byHash.set(txHash, receipt);
    receipts.push({ txHash, blockNumber: header.blockNumber, blockHash: header.blockHash, transactionIndex: Chain.quantity(receipt.transactionIndex), sourceSha256: r.sourceSha256 });
    transfers.push(...Inventory.decodeTransfers(receipt, chain.tokens.map(t => t.address), r.sourceSha256));
  }
  // Confirm the previously published selection/routing claims before deriving
  // any new residual from these receipts. Check every acquisition, including
  // ambiguous routes, and all reused fixed-block balance checkpoints.
  const states = [], positionKeys = new Set();
  for (const a of chain.acquisitions) {
    const receipt = byHash.get(a.txHash), pool = chain.pools.find(p => p.address === a.poolAddress);
    const log = receipt.logs.find(l => l.address.toLowerCase() === pool.address && Chain.quantity(l.logIndex) === Number(a.swapId.split(':').at(-1)));
    assert(log, 'Missing published swap log');
    const swap = Chain.decodeSwap(log, pool), route = Chain.resolveAcquisition(receipt, swap);
    for (const field of ['id', 'tokenAddress', 'poolAddress', 'txHash', 'blockNumber', 'blockHash', 'baseAmountRaw', 'quoteAmountRaw']) {
      assert(swap[field] === (field === 'id' ? a.swapId : a[field]), 'Published swap differs from raw source: ' + field);
    }
    for (const field of ['finalRecipient', 'transactionAcquiredRaw', 'routeStatus', 'transfers', 'netRecipients', 'netSources']) assert(JSON.stringify(a[field]) === JSON.stringify(route[field]), 'Published routing differs from raw source: ' + field);
    if (!a.finalRecipient || !a.balances) continue;
    const b = a.balances;
    for (const [number, value] of [[b.beforeBlockNumber, b.balanceBeforeRaw], [b.afterBlockNumber, b.balanceAfterRaw], [b.finalizedBlockNumber, b.balanceFinalizedRaw]]) assert(balanceValue(a.tokenAddress, a.finalRecipient, number).balanceRaw === value, 'Published acquisition balance differs from source');
    const id = a.tokenAddress + ':' + a.finalRecipient;
    for (const checkpoint of b.checkpoints) {
      const state = balance(a.tokenAddress, a.finalRecipient, checkpoint.number);
      assert(state.balanceRaw === checkpoint.balanceRaw && state.blockHash === checkpoint.hash && state.timestamp === checkpoint.timestamp, 'Published historical state differs from source');
      if (!positionKeys.has(id)) states.push(state);
    }
    if (!positionKeys.has(id)) states.push(balance(a.tokenAddress, a.finalRecipient, final.blockNumber));
    positionKeys.add(id);
  }
  states.sort((a, b) => (a.tokenAddress + ':' + a.address).localeCompare(b.tokenAddress + ':' + b.address) || a.blockNumber - b.blockNumber);
  transfers.sort((a, b) => a.blockNumber - b.blockNumber || a.transactionIndex - b.transactionIndex || a.logIndex - b.logIndex || a.tokenAddress.localeCompare(b.tokenAddress));
  const evidence = { replayVerified: true, replayedRawByteCount: verifiedBytes, sources: evidenceSources, states, receipts, transfers };
  const sourceSnapshotSha256 = sha(chainBytes);
  const report = Inventory.buildReport(chain, evidence, { sourceSnapshotSha256, generatedAt });
  Inventory.validateReport(report, chain, { sourceSnapshotSha256 });
  return report;
}
if (require.main === module) {
  const argv = process.argv.slice(2), option = (flag, fallback) => argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : fallback;
  const input = path.resolve(option('--input', 'data/chain-ledger-snapshot.json'));
  const rawRoot = path.resolve(option('--raw-root', '../probes/chain-ledger-v9'));
  const output = path.resolve(option('--output', 'data/inventory-ledger.json'));
  const report = replaySnapshot(fs.readFileSync(input), rawRoot);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const temporary = output + '.tmp-' + process.pid;
  fs.writeFileSync(temporary, JSON.stringify(report, null, 2) + '\n'); fs.renameSync(temporary, output);
  console.log(JSON.stringify({ output, sourceSnapshotSha256: report.sourceSnapshotSha256, ...report.summary, sourceReplayVerified: true, completeTransferHistory: false }));
}
module.exports = { replaySnapshot, indexRetainedSources };
