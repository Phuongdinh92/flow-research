#!/usr/bin/env node
'use strict';
// Node >= 20. Uses only public, keyless endpoints. dRPC batches are at most 3 calls.
// No retries after a provider error. Raw API responses and SHA-256 metadata are
// kept outside the published repository for an independent replay/audit.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Evidence = require('./dex-evidence.js');
const POOL = '0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640';
const RPC = 'https://eth.drpc.org/';
const GT = 'https://api.geckoterminal.com/api/v2';
const argv = process.argv.slice(2);
const value = (flag, fallback) => argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : fallback;
const probeDir = path.resolve(value('--probes', '../probes/dex-evidence-collection'));
const reuseDir = value('--reuse-probes', null);
const output = path.resolve(value('--output', 'data/dex-evidence-snapshot.json'));
const selectedCount = Number(value('--senders', 10));
if (!Number.isInteger(selectedCount) || selectedCount < 1 || selectedCount > 20) throw new Error('--senders must be 1..20');
fs.mkdirSync(probeDir, { recursive: true });
let lastRpc = 0;
async function request(name, url, payload) {
  if (url === RPC) {
    if (Array.isArray(payload) && payload.length > 3) throw new Error('Free dRPC batch limit: 3');
    const wait = 1000 - (Date.now() - lastRpc);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lastRpc = Date.now();
  }
  const fetchedAt = new Date().toISOString();
  const response = await fetch(url, { method: payload ? 'POST' : 'GET', redirect: 'error',
    headers: { Accept: 'application/json', ...(payload ? { 'Content-Type': 'application/json' } : {}) },
    body: payload ? JSON.stringify(payload) : undefined, signal: AbortSignal.timeout(30000) });
  const text = await response.text();
  const meta = { url, fetchedAt, status: response.status, sha256: crypto.createHash('sha256').update(text).digest('hex'), ...(payload ? { payload } : {}) };
  fs.writeFileSync(path.join(probeDir, name + '.raw.json'), text);
  fs.writeFileSync(path.join(probeDir, name + '.meta.json'), JSON.stringify(meta, null, 2));
  if (!response.ok) throw new Error(name + ': HTTP ' + response.status + ' (stopped; no retry)');
  const data = JSON.parse(text);
  if (Array.isArray(data) && data.some(x => x && x.error)) throw new Error(name + ': RPC error (stopped; no retry) ' + JSON.stringify(data.find(x => x.error).error));
  if (data && data.error) throw new Error(name + ': RPC error (stopped; no retry) ' + JSON.stringify(data.error));
  return { data, meta };
}
function reused(name, expectedUrl) {
  if (!reuseDir) return null;
  const raw = fs.readFileSync(path.join(reuseDir, name + '.raw.json'));
  const meta = JSON.parse(fs.readFileSync(path.join(reuseDir, name + '.meta.json')));
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  if (meta.url !== expectedUrl || meta.sha256 !== hash || meta.status !== 200) throw new Error('Invalid reused raw response: ' + name);
  return { data: JSON.parse(raw), meta };
}
function block(result) {
  if (!result || !/^0x[0-9a-f]+$/.test(result.number || '') || !/^0x[0-9a-f]{64}$/.test(result.hash || '')) throw new Error('Invalid RPC block');
  return { number: Number(BigInt(result.number)), hash: result.hash, timestamp: new Date(Number(BigInt(result.timestamp)) * 1000).toISOString() };
}
function rpcCall(id, method, params) { return { jsonrpc: '2.0', id, method, params }; }
function resultById(data, id) {
  const rows = Array.isArray(data) ? data : [data];
  const match = rows.filter(x => x.id === id);
  if (match.length !== 1 || typeof match[0].result !== 'string') throw new Error('Missing or duplicate RPC result ' + id);
  return match[0].result;
}
function rawInteger(x) {
  if (!/^0x[0-9a-f]{64}$/.test(x)) throw new Error('Invalid balance/decimals result');
  return BigInt(x).toString();
}
function tokenFrom(poolData, key, catalog) {
  const id = poolData.data.relationships[key].data.id;
  const a = poolData.included.find(x => x.type === 'token' && x.id === id)?.attributes;
  if (!a || !Number.isInteger(a.decimals)) throw new Error('Missing token metadata');
  const coin = catalog.find(x => x.id === a.coingecko_coin_id);
  if (!coin || coin.platforms?.ethereum?.toLowerCase() !== a.address.toLowerCase()) throw new Error('CoinGecko contract registry mismatch');
  return { address: a.address.toLowerCase(), symbol: a.symbol, name: a.name, decimals: a.decimals, coingeckoId: a.coingecko_coin_id };
}
async function main() {
  const tradesUrl = GT + '/networks/eth/pools/' + POOL + '/trades';
  const poolUrl = GT + '/networks/eth/pools/' + POOL + '?include=base_token,quote_token,dex';
  const catalogUrl = 'https://api.coingecko.com/api/v3/coins/list?include_platform=true';
  const gt = reused('gt_trades', tradesUrl) || await request('gt_trades', tradesUrl);
  const info = reused('gt_pool', poolUrl) || await request('gt_pool', poolUrl);
  const catalog = reused('cg_contract_catalog', catalogUrl) || await request('cg_contract_catalog', catalogUrl);
  const base = tokenFrom(info.data, 'base_token', catalog.data), quote = tokenFrom(info.data, 'quote_token', catalog.data);
  const before = await request('rpc_block_before', RPC, rpcCall(1, 'eth_getBlockByNumber', ['finalized', false]));
  const fixed = block(before.data.result), tag = '0x' + fixed.number.toString(16);
  const tokenCheck = await request('rpc_token_identity', RPC, [rpcCall(1, 'eth_chainId', []), rpcCall(2, 'eth_call', [{ to: base.address, data: '0x313ce567' }, tag]), rpcCall(3, 'eth_call', [{ to: quote.address, data: '0x313ce567' }, tag])]);
  if (BigInt(resultById(tokenCheck.data, 1)) !== 1n || Number(rawInteger(resultById(tokenCheck.data, 2))) !== base.decimals || Number(rawInteger(resultById(tokenCheck.data, 3))) !== quote.decimals) throw new Error('RPC chain/token-decimals identity mismatch');
  const trades = gt.data.data.map(x => ({ id: x.id, blockNumber: x.attributes.block_number,
    blockTimestamp: x.attributes.block_timestamp, txHash: x.attributes.tx_hash.toLowerCase(),
    sender: x.attributes.tx_from_address.toLowerCase(), kind: x.attributes.kind,
    fromTokenAddress: x.attributes.from_token_address.toLowerCase(), toTokenAddress: x.attributes.to_token_address.toLowerCase(),
    fromTokenAmount: x.attributes.from_token_amount, toTokenAmount: x.attributes.to_token_amount, volumeUsd: x.attributes.volume_in_usd }));
  const senderMax = new Map();
  for (const t of trades) if (t.blockNumber <= fixed.number) senderMax.set(t.sender, Math.max(senderMax.get(t.sender) || 0, Number(t.volumeUsd)));
  const chosen = [...senderMax.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, selectedCount).map(x => x[0]);
  const senders = [];
  for (const address of chosen) {
    const data = '0x70a08231' + address.slice(2).padStart(64, '0');
    const response = await request('rpc_sender_' + address.slice(2), RPC, [rpcCall(1, 'eth_call', [{ to: base.address, data }, tag]), rpcCall(2, 'eth_call', [{ to: quote.address, data }, tag]), rpcCall(3, 'eth_getCode', [address, tag])]);
    const code = resultById(response.data, 3);
    if (!/^0x(?:[0-9a-f]{2})*$/.test(code)) throw new Error('Invalid code response');
    senders.push({ address, balanceBaseRaw: rawInteger(resultById(response.data, 1)), balanceQuoteRaw: rawInteger(resultById(response.data, 2)), hasCode: code !== '0x', ownershipVerified: false, blockNumber: fixed.number, blockHash: fixed.hash, provenance: response.meta });
    console.log('Checked sender ' + senders.length + '/' + chosen.length + ' at block ' + fixed.number);
  }
  // One receipt demonstrates why a transaction sender cannot stand in for the
  // recipient of a purchased token. This is evidence of routing, not ownership.
  let routingExample = null;
  const candidate = trades.filter(t => t.blockNumber <= fixed.number && t.kind === 'buy').sort((a, b) => Number(b.volumeUsd) - Number(a.volumeUsd))[0];
  if (candidate) {
    const receiptResponse = await request('rpc_routing_receipt', RPC, rpcCall(1, 'eth_getTransactionReceipt', [candidate.txHash]));
    const receipt = receiptResponse.data.result;
    if (!receipt || receipt.status !== '0x1' || receipt.transactionHash?.toLowerCase() !== candidate.txHash || receipt.from?.toLowerCase() !== candidate.sender || Number(BigInt(receipt.blockNumber)) !== candidate.blockNumber) throw new Error('Routing receipt identity mismatch');
    const topic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
    const transfers = receipt.logs.filter(l => l.address.toLowerCase() === base.address && l.topics[0] === topic && l.topics.length === 3 && ('0x' + l.topics[1].slice(-40)).toLowerCase() === POOL && l.removed === false);
    if (transfers.length === 1) {
      const log = transfers[0], recipient = ('0x' + log.topics[2].slice(-40)).toLowerCase();
      const recipientData = '0x70a08231' + recipient.slice(2).padStart(64, '0');
      const recipientResponse = await request('rpc_routing_recipient', RPC, [rpcCall(1, 'eth_call', [{ to: base.address, data: recipientData }, tag]), rpcCall(2, 'eth_call', [{ to: base.address, data: recipientData }, '0x' + (candidate.blockNumber - 1).toString(16)]), rpcCall(3, 'eth_getCode', [recipient, tag])]);
      routingExample = { txHash: candidate.txHash, sender: candidate.sender, recipient, baseTokenAddress: base.address, baseTransferRaw: rawInteger(log.data),
        blockNumber: candidate.blockNumber, blockHash: receipt.blockHash, logIndex: Number(BigInt(log.logIndex)),
        recipientBalanceBeforeRaw: rawInteger(resultById(recipientResponse.data, 2)), recipientBalanceBeforeBlockNumber: candidate.blockNumber - 1, recipientBalanceFinalizedRaw: rawInteger(resultById(recipientResponse.data, 1)),
        recipientHasCode: resultById(recipientResponse.data, 3) !== '0x', finalizedBlockNumber: fixed.number, finalizedBlockHash: fixed.hash,
        receiptProvenance: receiptResponse.meta, balanceProvenance: recipientResponse.meta,
        interpretation: 'The WETH Transfer event names the immediate token recipient, which can differ from transaction sender. Its state balances do not identify a beneficial owner or retained purchase.' };
    }
  }
  const after = await request('rpc_block_after', RPC, rpcCall(1, 'eth_getBlockByNumber', [tag, false]));
  const checked = block(after.data.result);
  if (checked.hash !== fixed.hash || checked.number !== fixed.number || checked.timestamp !== fixed.timestamp) throw new Error('Block changed; balances discarded');
  const times = trades.map(x => x.blockTimestamp).sort();
  const a = info.data.data.attributes;
  const snapshot = { schemaVersion: 1, kind: 'sampled-dex-evidence', generatedAt: new Date().toISOString(), network: { id: 'eth', chainId: 1, name: 'Ethereum' },
    pool: { address: POOL, name: a.name, dexId: info.data.data.relationships.dex.data.id, baseToken: base, quoteToken: quote, poolFeePercentage: a.pool_fee_percentage, url: 'https://www.geckoterminal.com/eth/pools/' + POOL },
    finalizedBlock: fixed, blockChecks: { before: fixed, after: checked },
    coverage: { limit: 300, returnedCount: trades.length, firstTradeAt: times[0], lastTradeAt: times.at(-1), observedUniqueSenders: new Set(trades.map(x => x.sender)).size,
      eligibleFinalizedCount: trades.filter(x => x.blockNumber <= fixed.number).length, checkedSenderCount: senders.length,
      reported24hBuys: a.transactions.h24.buys, reported24hSells: a.transactions.h24.sells, reported24hVolumeUsd: a.volume_usd.h24,
      selection: 'Top ' + selectedCount + ' distinct transaction senders by their largest USD-valued trade in the returned sample that was finalized at the named block. Not a holder ranking.' },
    trades, senders, routingExample, sources: { trades: gt.meta, pool: info.meta, catalog: catalog.meta, blockBefore: before.meta, blockAfter: after.meta, tokenIdentity: tokenCheck.meta },
    method: { balanceMethod: 'ERC20 balanceOf(address) using eth_call at one fixed finalized block; decimals and chain ID cross-checked via RPC; block hash checked again after collection.',
      sampleMethod: 'Provider latest <=300 trades in trailing 24h; no volume threshold, no pagination, no inference that returned sample is complete.',
      senderMeaning: 'tx_from_address is transaction sender. Swap recipient, beneficial owner, entity labels and retained purchases have not been established.',
      usdMeaning: 'Provider estimated USD valuations; native amounts and raw ERC20 balances are retained separately.' } };
  Evidence.validateSnapshot(snapshot);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output + '.tmp', JSON.stringify(snapshot, null, 2));
  fs.renameSync(output + '.tmp', output);
  console.log('Saved actual evidence:', output, JSON.stringify(snapshot.coverage));
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { rawInteger, block, resultById, tokenFrom };
