#!/usr/bin/env node
'use strict';
// Acquisitions are discovered in the provider's limited latest-trades sample,
// then verified against successful receipts. No inferred complete swap history.
// A prior eth_getLogs free-plan restriction is recorded; it is not retried.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Ledger = require('./chain-ledger.js');
const RPC = 'https://eth.drpc.org/';
const FACTORY = '0x1f98431c8ad98523631ae4a59f267346ea31f984';
const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
const TOKENS = [
  { address: '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984', symbol: 'UNI', name: 'Uniswap', decimals: 18, poolAddress: '0x1d42064fc4beb5f8aaf85f4617ae8b3b5b8bd801' },
  { address: '0x514910771af9ca656af840dff83e8264ecf986ca', symbol: 'LINK', name: 'Chainlink', decimals: 18, poolAddress: '0xa6cc3c2531fdaa6ae1a3ca84c2855806728693e8' },
  { address: '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9', symbol: 'AAVE', name: 'Aave', decimals: 18, poolAddress: '0x5ab53ee1d50eef2c1dd3d5402789cd27bb52c1bb' }
];
const KNOWN_POOL_CANDIDATES = [{ address: '0xfad57d2039c21811c8f2b5d5b65308aa99d31559',
  token0: '0x514910771af9ca656af840dff83e8264ecf986ca', token1: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', fee: 3000 }];
const argv = process.argv.slice(2), option = (flag, fallback) => argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : fallback;
const proofRoot = path.resolve(option('--probes', '../probes/chain-ledger-v9'));
// New runs always receive fresh mutable finalized/latest discovery. --resume
// explicitly replays an interrupted fixed-cutoff run, preserving its old times.
const probes = argv.includes('--resume') ? proofRoot : path.join(proofRoot, 'runs', new Date().toISOString().replace(/[:.]/g, '-'));
const output = path.resolve(option('--output', 'data/chain-ledger-snapshot.json'));
const selectedPerPool = Number(option('--per-pool', '10'));
const historyDays = Number(option('--history-days', '30'));
if (!Number.isInteger(selectedPerPool) || selectedPerPool < 1 || selectedPerPool > 30) throw new Error('--per-pool must be 1..30');
if (!Number.isInteger(historyDays) || historyDays < 0 || historyDays > 90) throw new Error('--history-days must be 0..90');
fs.mkdirSync(probes, { recursive: true });
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const rpcCall = (id, method, params) => ({ jsonrpc: '2.0', id, method, params });
const hex = n => '0x' + n.toString(16);
const word = a => a.replace(/^0x/, '').padStart(64, '0');
let lastRpc = 0, lastHttp = 0;
async function request(name, url, payload) {
  const rawPath = path.join(probes, name + '.raw.json'), metaPath = path.join(probes, name + '.meta.json');
  if (fs.existsSync(rawPath) && fs.existsSync(metaPath)) {
    const raw = fs.readFileSync(rawPath), meta = JSON.parse(fs.readFileSync(metaPath));
    if (meta.status !== 200 || meta.sha256 !== sha(raw) || meta.url !== url || JSON.stringify(meta.payload) !== JSON.stringify(payload)) throw new Error('Invalid cache identity: ' + name);
    return { data: JSON.parse(raw), meta };
  }
  if (url === RPC && Array.isArray(payload) && payload.length > 3) throw new Error('RPC batch limit is 3');
  const since = Date.now() - (url === RPC ? lastRpc : lastHttp), pace = url === RPC ? 1100 : 2500;
  if (since < pace) await new Promise(r => setTimeout(r, pace - since));
  if (url === RPC) lastRpc = Date.now(); else lastHttp = Date.now();
  const fetchedAt = new Date().toISOString();
  const response = await fetch(url, { method: payload ? 'POST' : 'GET', redirect: 'error',
    headers: { Accept: 'application/json', ...(payload ? { 'Content-Type': 'application/json' } : {}) },
    body: payload ? JSON.stringify(payload) : undefined, signal: AbortSignal.timeout(30000) });
  const raw = await response.text(), meta = { url, fetchedAt, status: response.status, sha256: sha(raw), ...(payload ? { payload } : {}) };
  fs.writeFileSync(rawPath, raw); fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  if (!response.ok) throw new Error(name + ': HTTP ' + response.status + '; stopped, no retry');
  const data = JSON.parse(raw), errors = (Array.isArray(data) ? data : [data]).filter(x => x?.error);
  if (errors.length) throw new Error(name + ': ' + JSON.stringify(errors[0].error) + '; stopped, no retry');
  return { data, meta };
}
function result(data, id) {
  const rows = (Array.isArray(data) ? data : [data]).filter(x => x.id === id);
  if (rows.length !== 1 || rows[0].error || !Object.hasOwn(rows[0], 'result')) throw new Error('Invalid RPC result ' + id);
  return rows[0].result;
}
function uintResult(value) { if (!/^0x[0-9a-f]{64}$/.test(value || '')) throw new Error('Invalid uint256 result'); return BigInt(value).toString(); }
function addressResult(value) { if (!/^0x0{24}[0-9a-f]{40}$/.test(value || '')) throw new Error('Invalid address result'); return Ledger.address('0x' + value.slice(-40)); }
function block(value) {
  if (!value || !/^0x[0-9a-f]{64}$/.test(value.hash || '')) throw new Error('Missing block identity');
  return { number: Ledger.quantity(value.number), hash: value.hash, timestamp: new Date(Ledger.quantity(value.timestamp) * 1000).toISOString() };
}
async function batches(name, calls) {
  const values = [], sources = [];
  for (let i = 0; i < calls.length; i += 3) {
    const payload = calls.slice(i, i + 3).map((x, j) => rpcCall(j + 1, x.method, x.params));
    const r = await request(name + '_' + Math.floor(i / 3), RPC, payload);
    values.push(...payload.map(c => result(r.data, c.id))); sources.push(r.meta);
  }
  return { values, sources };
}
function readLimit(name, chainId) {
  const directory = fs.existsSync(path.join(probes, name + '.meta.json')) ? probes : proofRoot;
  const p = path.join(directory, name + '.meta.json');
  if (!fs.existsSync(p)) return null;
  const meta = JSON.parse(fs.readFileSync(p)), raw = fs.readFileSync(path.join(directory, name + '.raw.json'));
  if (sha(raw) !== meta.sha256) throw new Error('Invalid source restriction proof');
  const error = JSON.parse(raw).error;
  return { chainId, method: 'eth_getLogs', status: meta.status, code: error?.code, message: error?.message, retried: false,
    fromBlock: meta.payload.params[0].fromBlock, toBlock: meta.payload.params[0].toBlock, rawSha256: meta.sha256,
    recordedAt: meta.fetchedAt || null, meaning: 'Previously observed response to this exact bounded request; no claim about other plans/endpoints.' };
}
async function main() {
  const sources = [];
  const start = await request('ledger_finalized_before', RPC, [rpcCall(1, 'eth_chainId', []), rpcCall(2, 'eth_getBlockByNumber', ['finalized', false])]);
  if (BigInt(result(start.data, 1)) !== 1n) throw new Error('Wrong chain');
  const fixed = block(result(start.data, 2)), tag = hex(fixed.number); sources.push(start.meta);
  const factoryCalls = TOKENS.map(t => ({ method: 'eth_call', params: [{ to: FACTORY, data: '0x1698ee82' + word(t.address) + word(WETH) + word(hex(3000)) }, tag] }));
  const discovery = await batches('ledger_factory', factoryCalls); sources.push(...discovery.sources);
  TOKENS.forEach((t, i) => { if (addressResult(discovery.values[i]) !== t.poolAddress) throw new Error('Factory registry mismatch ' + t.symbol); });
  const poolCalls = TOKENS.flatMap(t => ['0x0dfe1681', '0xd21220a7', '0xc45a0155'].map(data => ({ method: 'eth_call', params: [{ to: t.poolAddress, data }, tag] })));
  const identities = await batches('ledger_pool_identity', poolCalls); sources.push(...identities.sources);
  const pools = TOKENS.map((t, i) => {
    const token0 = addressResult(identities.values[i * 3]), token1 = addressResult(identities.values[i * 3 + 1]);
    if (addressResult(identities.values[i * 3 + 2]) !== FACTORY || ![token0, token1].includes(t.address) || ![token0, token1].includes(WETH)) throw new Error('Pool immutable identity mismatch');
    return { address: t.poolAddress, baseTokenAddress: t.address, quoteTokenAddress: WETH, token0, token1, fee: 3000, protocol: 'uniswap-v3', factory: FACTORY, identityBlockNumber: fixed.number };
  });
  const decimals = await batches('ledger_decimals', [...TOKENS, { address: WETH, decimals: 18 }].map(t => ({ method: 'eth_call', params: [{ to: t.address, data: '0x313ce567' }, tag] })));
  sources.push(...decimals.sources);
  [...TOKENS, { address: WETH, decimals: 18 }].forEach((t, i) => { if (Number(uintResult(decimals.values[i])) !== t.decimals) throw new Error('Token decimals mismatch'); });
  const sampled = [], discoveryByPool = [];
  for (const pool of pools) {
    const url = 'https://api.geckoterminal.com/api/v2/networks/eth/pools/' + pool.address + '/trades';
    const r = await request('gt-' + pool.address, url); sources.push(r.meta);
    if (!Array.isArray(r.data.data) || r.data.data.length > 300) throw new Error('Invalid provider trades sample');
    const rows = r.data.data.map(x => ({ ...x.attributes, poolAddress: pool.address })).filter(x => x.block_number <= fixed.number);
    for (const t of rows) {
      if (![pool.baseTokenAddress, WETH].includes(t.from_token_address?.toLowerCase()) || ![pool.baseTokenAddress, WETH].includes(t.to_token_address?.toLowerCase())) throw new Error('Provider token identity mismatch');
    }
    const times = rows.map(x => x.block_timestamp).sort();
    discoveryByPool.push({ poolAddress: pool.address, returnedCount: r.data.data.length, finalizedCount: rows.length, firstObservedAt: times[0], lastObservedAt: times.at(-1), complete: false });
    sampled.push(...rows);
    console.log('Discovered', pool.address, rows.length, 'finalized provider trades (limited sample)');
  }
  // This is an explicit size-biased acquisition investigation, not a random
  // sample and not a complete flow statistic. Provider USD estimates rank only.
  const chosen = pools.flatMap(p => sampled.filter(t => t.poolAddress === p.address && t.to_token_address.toLowerCase() === p.baseTokenAddress)
    .sort((a, b) => Number(b.volume_in_usd) - Number(a.volume_in_usd) || a.tx_hash.localeCompare(b.tx_hash)).slice(0, selectedPerPool));
  const hashes = [...new Set(chosen.map(t => t.tx_hash.toLowerCase()))];
  const receipts = await batches('ledger_receipts', hashes.map(hash => ({ method: 'eth_getTransactionReceipt', params: [hash] })));
  sources.push(...receipts.sources);
  const byHash = new Map(hashes.map((h, i) => [h, receipts.values[i]]));
  const blocksWanted = [...new Set(receipts.values.map(r => Ledger.quantity(r.blockNumber)))].sort((a, b) => a - b);
  const blockResponses = await batches('ledger_swap_blocks', blocksWanted.map(n => ({ method: 'eth_getBlockByNumber', params: [hex(n), false] })));
  sources.push(...blockResponses.sources);
  const headers = new Map(blockResponses.values.map(r => { const b = block(r); return [b.number, b]; }));
  const checkpoints = await batches('ledger_checkpoint_blocks', [fixed.number - 7200, fixed.number - 50400].map(n => ({ method: 'eth_getBlockByNumber', params: [hex(n), false] })));
  sources.push(...checkpoints.sources);
  let checkpointBlocks = checkpoints.values.map(block).map(b => ({ ...b, daysBeforeFinalized: (Date.parse(fixed.timestamp) - Date.parse(b.timestamp)) / 86400000 }));
  const swaps = [], acquisitions = [], seen = new Set();
  for (const t of chosen) {
    const pool = pools.find(p => p.address === t.poolAddress), receipt = byHash.get(t.tx_hash.toLowerCase());
    if (!receipt || receipt.status !== '0x1') throw new Error('Failed or missing receipt');
    const matches = receipt.logs.filter(l => l.address.toLowerCase() === pool.address && l.topics?.[0] === Ledger.SWAP_TOPIC).map(l => Ledger.decodeSwap(l, pool)).filter(s => s.kind === 'buy');
    for (const s of matches) {
      if (seen.has(s.id)) continue; seen.add(s.id);
      const h = headers.get(s.blockNumber);
      if (!h || h.hash !== s.blockHash || s.blockNumber > fixed.number || s.blockNumber !== t.block_number) throw new Error('Receipt/header/discovery block mismatch');
      s.timestamp = h.timestamp; swaps.push(s);
      const route = Ledger.resolveAcquisition(receipt, s);
      acquisitions.push({ swapId: s.id, tokenAddress: s.tokenAddress, poolAddress: s.poolAddress,
        txHash: s.txHash, blockNumber: s.blockNumber, blockHash: s.blockHash, timestamp: s.timestamp,
        baseAmountRaw: s.baseAmountRaw, quoteAmountRaw: s.quoteAmountRaw,
        discoveryEstimatedUsd: t.volume_in_usd, ...route, balances: null });
    }
  }
  // Only conservatively resolved recipients have balances attributed. A token
  // contract or router is never silently promoted to a person/whale.
  for (const a of acquisitions.filter(x => x.finalRecipient)) {
    const balanceCall = n => ({ method: 'eth_call', params: [{ to: a.tokenAddress, data: '0x70a08231' + word(a.finalRecipient) }, hex(n)] });
    const responses = await batches('ledger_balances_' + a.txHash.slice(2, 18) + '_' + a.tokenAddress.slice(2, 10), [
      balanceCall(a.blockNumber - 1), balanceCall(a.blockNumber), balanceCall(fixed.number),
      ...checkpointBlocks.map(b => balanceCall(b.number)), { method: 'eth_getCode', params: [a.finalRecipient, tag] }
    ]);
    sources.push(...responses.sources);
    const values = responses.values, code = values[5];
    if (!/^0x(?:[0-9a-f]{2})*$/.test(code || '')) throw new Error('Invalid recipient code');
    a.recipientHasCode = code !== '0x';
    a.recipientCodeKind = code === '0x' ? 'empty-code' : /^0xef0100[0-9a-f]{40}$/.test(code) ? 'eip7702-delegation' : 'contract-code';
    a.recipientCodeBytes = (code.length - 2) / 2;
    a.recipientCodeSha256 = sha(code);
    a.balances = { ...Ledger.retentionBounds(a.transactionAcquiredRaw, uintResult(values[0]), uintResult(values[1]), uintResult(values[2])),
      beforeBlockNumber: a.blockNumber - 1, afterBlockNumber: a.blockNumber, finalizedBlockNumber: fixed.number,
      finalizedBlockHash: fixed.hash, checkpoints: checkpointBlocks.map((b, i) => ({ ...b, balanceRaw: uintResult(values[3 + i]) })) };
    console.log('Verified recipient', TOKENS.find(t => t.address === a.tokenAddress).symbol, a.finalRecipient, 'final balance', Ledger.formatUnits(a.balances.balanceFinalizedRaw, 18));
  }
  if (historyDays > 0) {
    const historyHeights = Array.from({ length: historyDays }, (_, i) => fixed.number - (i + 1) * 7200);
    const historyHeaders = await batches('ledger_daily_blocks_' + historyDays, historyHeights.map(n => ({ method: 'eth_getBlockByNumber', params: [hex(n), false] })));
    sources.push(...historyHeaders.sources);
    checkpointBlocks = historyHeaders.values.map(block).map(b => ({ ...b, daysBeforeFinalized: (Date.parse(fixed.timestamp) - Date.parse(b.timestamp)) / 86400000 }));
    const histories = new Map();
    for (const a of acquisitions.filter(x => x.finalRecipient && x.balances)) {
      const key = a.tokenAddress + ':' + a.finalRecipient;
      if (!histories.has(key)) {
        const response = await batches('ledger_position_history_' + historyDays + '_' + a.tokenAddress.slice(2) + '_' + a.finalRecipient.slice(2), checkpointBlocks.map(b => ({ method: 'eth_call', params: [{ to: a.tokenAddress, data: '0x70a08231' + word(a.finalRecipient) }, hex(b.number)] })));
        sources.push(...response.sources);
        histories.set(key, checkpointBlocks.map((b, i) => ({ ...b, balanceRaw: uintResult(response.values[i]) })));
        console.log('Verified historical balance checkpoints', histories.size, 'positions x', historyDays, 'days');
      }
      a.balances.checkpoints = histories.get(key);
    }
  }
  const recipientRoles = [];
  for (const candidate of KNOWN_POOL_CANDIDATES.filter(p => acquisitions.some(a => a.finalRecipient === p.address))) {
    const r = await request('recipient-pool-role', RPC, [
      rpcCall(1, 'eth_call', [{ to: FACTORY, data: '0x1698ee82' + word(candidate.token0) + word(candidate.token1) + word(hex(candidate.fee)) }, tag]),
      rpcCall(2, 'eth_call', [{ to: candidate.address, data: '0x0dfe1681' }, tag]),
      rpcCall(3, 'eth_call', [{ to: candidate.address, data: '0xd21220a7' }, tag])
    ]);
    if (addressResult(result(r.data, 1)) !== candidate.address || addressResult(result(r.data, 2)) !== candidate.token0 || addressResult(result(r.data, 3)) !== candidate.token1) throw new Error('Recipient pool role verification failed');
    sources.push(r.meta);
    recipientRoles.push({ ...candidate, chainId: 1, role: 'verified-liquidity-pool', protocol: 'uniswap-v3', factory: FACTORY,
      verifiedAtBlockNumber: fixed.number, verifiedAtBlockHash: fixed.hash, sourceSha256: r.meta.sha256 });
  }
  for (const a of acquisitions) {
    const role = recipientRoles.find(r => r.address === a.finalRecipient);
    a.recipientRole = role ? role.role : !a.finalRecipient ? 'unresolved' : a.recipientCodeKind === 'contract-code' ? 'unclassified-contract' : a.recipientCodeKind === 'eip7702-delegation' ? 'delegated-eoa' : 'unclassified-address';
    a.excludeFromAccumulation = !!role;
    a.exclusionReason = role ? 'Factory-verified liquidity pool inventory; token receipt is a routing/liquidity-pool change, not evidence of a buyer holding an investment position.' : null;
    // A balance in a verified LP is real inventory but it cannot stand in for a
    // retained purchase by a trader. Keep state history for the routing audit.
    if (role && a.balances) a.balances.retentionApplicable = false;
    else if (a.balances) a.balances.retentionApplicable = true;
  }
  const finish = await request('ledger_finalized_after', RPC, rpcCall(1, 'eth_getBlockByNumber', [tag, false]));
  sources.push(finish.meta); const checked = block(result(finish.data, 1));
  if (JSON.stringify(checked) !== JSON.stringify(fixed)) throw new Error('Finalized block identity changed; discard evidence');
  const times = discoveryByPool.flatMap(p => [p.firstObservedAt, p.lastObservedAt]).filter(Boolean).sort();
  const limits = [readLimit('canonical500-getlogs', 1), readLimit('bsc-getlogs', 56)].filter(Boolean);
  const snapshot = { schemaVersion: 1, kind: 'verified-acquisition-ledger', chainId: 1,
    generatedAt: new Date().toISOString(), finalizedBlock: fixed, blockChecks: { before: fixed, after: checked },
    quoteToken: { address: WETH, symbol: 'WETH', decimals: 18 },
    tokens: TOKENS.map(({ poolAddress, ...t }) => t), pools, recipientRoles, checkpointBlocks,
    coverage: { discoveryCount: sampled.length, discoveryByPool, firstObservedAt: times[0], lastObservedAt: times.at(-1),
      selectedPerPool, selectedReceiptCount: hashes.length, verifiedSwapCount: swaps.length,
      historicalBalanceCheckpointsPerPosition: checkpointBlocks.length,
      historicalBalanceSampling: 'One state every 7200 Ethereum blocks; exact observed timestamps are supplied. These are balance snapshots, not daily transfer or trade totals.',
      completePoolLogs: false, completeTransferHistory: false, fullMarketCoverage: false,
      selection: 'Largest estimated-USD token acquisitions within each provider latest <=300 trades sample, restricted to the named finalized cutoff. Size-biased selection, not a complete or representative sample.',
      sourceLimits: limits },
    swaps: swaps.sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex), acquisitions,
    method: {
      decoding: 'Uniswap V3 Swap amount0/amount1 are signed int256 pool balance deltas. Exact integer values decoded from successful canonical transaction receipts, token0/token1/factory/decimals checked by fixed-block eth_call.',
      routing: 'Resolve acquisition only when ERC20 receipt transfers have exactly one token net source equal to the sampled pool, exactly one net receiver, and pool output equals decoded acquisition. Other cases stay ambiguous.',
      balances: 'balanceOf at named historical block heights. ~1D/~7D are actual block checkpoints with their measured timestamps, not inferred flow histories.',
      retention: 'No intervening complete transfer history is available. Later balance gives only [0,min(acquired,final balance)] retained-token bounds, not a proved retained purchase. Transfers, replacements, bridges, custody, bots and common ownership are not inferred.',
      quote: 'Trade quote is WETH native amount, not USD. Provider estimated USD is used only for selecting the investigation sample.',
      costBasis: 'Swap execution ratio is known; lifetime/holder-age cost basis and realized profit remain unavailable without full transfer and disposal history.',
      identity: 'Addresses may be contracts, routers, market makers or custodians. Beneficial owners and whales have not been identified.' },
    sources, documentation: [
      'https://github.com/Uniswap/v3-core/blob/main/contracts/interfaces/pool/IUniswapV3PoolEvents.sol',
      'https://ethereum.org/developers/docs/apis/json-rpc/',
      'https://developers.uniswap.org/docs/ecosystem/subgraphs/overview',
      'https://apiguide.geckoterminal.com/faq'
    ] };
  Ledger.validateSnapshot(snapshot); fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output + '.tmp', JSON.stringify(snapshot, null, 2)); fs.renameSync(output + '.tmp', output);
  console.log('Saved', output, JSON.stringify(Ledger.summarize(snapshot)));
}
if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
module.exports = { uintResult, addressResult, block, result, TOKENS, FACTORY, WETH };
