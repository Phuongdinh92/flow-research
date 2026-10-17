(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.InventoryLedger = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const ADDRESS = /^0x[0-9a-f]{40}$/, HASH = /^0x[0-9a-f]{64}$/, SHA = /^[0-9a-f]{64}$/;
  const UINT = /^(0|[1-9][0-9]*)$/, TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
  function assert(ok, message) { if (!ok) throw new Error(message); }
  function uint(raw) { assert(typeof raw === 'string' && UINT.test(raw), 'Invalid exact unsigned integer'); return BigInt(raw); }
  function key(token, address) { assert(ADDRESS.test(token) && ADDRESS.test(address), 'Invalid position identity'); return token + ':' + address; }
  function quantity(raw) { assert(/^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(raw), 'Invalid RPC quantity'); const n = Number(BigInt(raw)); assert(Number.isSafeInteger(n), 'Unsafe RPC quantity'); return n; }
  function decodeTransfers(receipt, tokenAddresses, sourceSha256) {
    assert(receipt?.status === '0x1' && HASH.test(receipt.transactionHash) && HASH.test(receipt.blockHash) && SHA.test(sourceSha256), 'Invalid successful receipt proof');
    const tokens = new Set(tokenAddresses); for (const t of tokens) assert(ADDRESS.test(t), 'Invalid token address');
    const blockNumber = quantity(receipt.blockNumber), transactionIndex = quantity(receipt.transactionIndex), out = [], seen = new Set();
    for (const log of receipt.logs || []) {
      const tokenAddress = String(log.address || '').toLowerCase();
      if (!tokens.has(tokenAddress) || log.topics?.[0] !== TOPIC) continue;
      assert(log.removed === false && log.topics.length === 3 && /^0x[0-9a-f]{64}$/.test(log.data), 'Invalid canonical ERC20 Transfer');
      assert(log.transactionHash === receipt.transactionHash && log.blockHash === receipt.blockHash && quantity(log.blockNumber) === blockNumber && quantity(log.transactionIndex) === transactionIndex, 'Transfer/receipt identity mismatch');
      const addresses = log.topics.slice(1).map(t => { assert(/^0x0{24}[0-9a-f]{40}$/.test(t), 'Invalid indexed ERC20 address'); return '0x' + t.slice(-40); });
      const logIndex = quantity(log.logIndex), id = receipt.transactionHash + ':' + tokenAddress + ':' + logIndex;
      assert(!seen.has(id), 'Duplicate Transfer identity'); seen.add(id);
      out.push({ id, tokenAddress, txHash: receipt.transactionHash, blockNumber, blockHash: receipt.blockHash,
        transactionIndex, logIndex, from: addresses[0], to: addresses[1], amountRaw: BigInt(log.data).toString(), sourceSha256 });
    }
    return out.sort((a, b) => a.logIndex - b.logIndex);
  }
  function validateTransfer(t) {
    key(t.tokenAddress, t.from); key(t.tokenAddress, t.to); uint(t.amountRaw);
    assert(HASH.test(t.txHash) && HASH.test(t.blockHash) && SHA.test(t.sourceSha256) && Number.isSafeInteger(t.blockNumber) && t.blockNumber >= 0 && Number.isSafeInteger(t.logIndex) && t.logIndex >= 0 && Number.isSafeInteger(t.transactionIndex) && t.transactionIndex >= 0, 'Invalid transfer proof');
    assert(t.id === t.txHash + ':' + t.tokenAddress + ':' + t.logIndex, 'Invalid transfer identity');
  }
  function validateState(s) {
    key(s.tokenAddress, s.address); uint(s.balanceRaw);
    assert(Number.isSafeInteger(s.blockNumber) && s.blockNumber >= 0 && HASH.test(s.blockHash) && SHA.test(s.sourceSha256) && SHA.test(s.blockSourceSha256) && Number.isFinite(Date.parse(s.timestamp)), 'Invalid balance state proof');
  }
  // Balances are end-of-block states, so only transfers in (opening, closing]
  // enter this equation. The residual is an algebraic difference, not a sale.
  function reconcile(opening, closing, transfers, positionAddress) {
    validateState(opening); validateState(closing);
    assert(opening.tokenAddress === closing.tokenAddress && opening.address === closing.address && positionAddress === opening.address && closing.blockNumber > opening.blockNumber && Date.parse(closing.timestamp) > Date.parse(opening.timestamp), 'Invalid reconciliation interval');
    const seen = new Set(); let inflow = 0n, outflow = 0n; const ids = [];
    for (const t of transfers) {
      validateTransfer(t); assert(!seen.has(t.id), 'Duplicate observed Transfer'); seen.add(t.id);
      if (t.tokenAddress !== opening.tokenAddress || t.blockNumber <= opening.blockNumber || t.blockNumber > closing.blockNumber || (t.from !== positionAddress && t.to !== positionAddress)) continue;
      if (t.to === positionAddress) inflow += uint(t.amountRaw);
      if (t.from === positionAddress) outflow += uint(t.amountRaw);
      ids.push(t.id);
    }
    const delta = uint(closing.balanceRaw) - uint(opening.balanceRaw), knownNet = inflow - outflow, unexplained = delta - knownNet;
    return { openingBlockNumber: opening.blockNumber, closingBlockNumber: closing.blockNumber,
      openingAt: opening.timestamp, closingAt: closing.timestamp, elapsedDays: (Date.parse(closing.timestamp) - Date.parse(opening.timestamp)) / 86400000,
      openingBalanceRaw: opening.balanceRaw, closingBalanceRaw: closing.balanceRaw, balanceChangeRaw: delta.toString(),
      observedInflowRaw: inflow.toString(), observedOutflowRaw: outflow.toString(), observedNetRaw: knownNet.toString(),
      unexplainedNetRaw: unexplained.toString(), unexplainedNetIsZero: unexplained === 0n,
      observedTransferCount: ids.length, transferIds: ids,
      completeTransferHistory: false, accumulationConfirmed: false, retainedPurchaseConfirmed: false };
  }
  function derivePositions(chain, evidence) {
    const grouped = new Map(), stateKeys = new Set(), transferIds = new Set();
    for (const s of evidence.states) { validateState(s); const id = key(s.tokenAddress, s.address) + ':' + s.blockNumber; assert(!stateKeys.has(id), 'Duplicate position balance state'); stateKeys.add(id); }
    for (const t of evidence.transfers) { validateTransfer(t); assert(!transferIds.has(t.id), 'Duplicate observed Transfer'); transferIds.add(t.id); }
    for (const a of chain.acquisitions) {
      if (!a.finalRecipient || !a.balances) continue;
      const id = key(a.tokenAddress, a.finalRecipient); let p = grouped.get(id);
      if (!p) { const token = chain.tokens.find(t => t.address === a.tokenAddress); assert(token, 'Missing token identity');
        p = { id, chainId: chain.chainId, tokenAddress: a.tokenAddress, address: a.finalRecipient, symbol: token.symbol, decimals: token.decimals,
          recipientRole: a.recipientRole, excludedFromAccumulation: a.excludeFromAccumulation === true,
          sampleAcquisitionCount: 0, sampleAcquiredRaw: 0n, ownershipVerified: false, holderCostBasisAvailable: false };
        grouped.set(id, p);
      }
      assert(p.recipientRole === a.recipientRole && p.excludedFromAccumulation === (a.excludeFromAccumulation === true), 'Inconsistent role');
      p.sampleAcquisitionCount++; p.sampleAcquiredRaw += uint(a.transactionAcquiredRaw);
    }
    const positions = [...grouped.values()].sort((a, b) => a.id.localeCompare(b.id));
    for (const p of positions) {
      const states = evidence.states.filter(s => key(s.tokenAddress, s.address) === p.id).sort((a, b) => a.blockNumber - b.blockNumber);
      assert(states.length >= 2 && states.at(-1).blockNumber === chain.finalizedBlock.number && states.at(-1).blockHash === chain.finalizedBlock.hash && states.at(-1).timestamp === chain.finalizedBlock.timestamp, 'Missing fixed-cutoff balance states');
      p.states = states; p.stateCount = states.length;
      p.intervals = states.slice(1).map((s, i) => reconcile(states[i], s, evidence.transfers, p.address));
      p.summary = reconcile(states[0], states.at(-1), evidence.transfers, p.address);
      const seven = states.filter(s => s.blockNumber < states.at(-1).blockNumber).reduce((best, s) => !best || Math.abs((Date.parse(states.at(-1).timestamp) - Date.parse(s.timestamp)) / 86400000 - 7) < Math.abs((Date.parse(states.at(-1).timestamp) - Date.parse(best.timestamp)) / 86400000 - 7) ? s : best, null);
      p.recent7d = seven && Math.abs((Date.parse(states.at(-1).timestamp) - Date.parse(seven.timestamp)) / 86400000 - 7) <= 0.2 ? reconcile(seven, states.at(-1), evidence.transfers, p.address) : null;
      p.sampleAcquiredRaw = p.sampleAcquiredRaw.toString();
      const upper = uint(p.sampleAcquiredRaw) < uint(states.at(-1).balanceRaw) ? p.sampleAcquiredRaw : states.at(-1).balanceRaw;
      p.retentionLowerBoundRaw = p.excludedFromAccumulation ? null : '0'; p.retentionUpperBoundRaw = p.excludedFromAccumulation ? null : upper;
      p.completeTransferHistory = false; p.accumulationConfirmed = false; p.retainedPurchaseConfirmed = false;
    }
    assert(evidence.states.every(s => grouped.has(key(s.tokenAddress, s.address))), 'Unmatched balance state');
    return positions;
  }
  function summary(positions, evidence) {
    return { positionCount: positions.length, addressCount: new Set(positions.map(p => p.address)).size,
      tokenCount: new Set(positions.map(p => p.tokenAddress)).size, balanceStateCount: evidence.states.length,
      checkedReceiptCount: evidence.receipts.length, observedTokenTransferCount: evidence.transfers.length,
      excludedPoolPositionCount: positions.filter(p => p.excludedFromAccumulation).length,
      nonzeroUnexplainedPositionCount: positions.filter(p => !p.summary.unexplainedNetIsZero).length,
      completeTransferHistoryPositionCount: 0, confirmedAccumulationPositionCount: 0 };
  }
  function assertChainBindings(chain, evidence) {
    const canonicalSources = new Map();
    for (const s of chain.sources) if (!canonicalSources.has(s.sha256)) canonicalSources.set(s.sha256, { sha256: s.sha256, url: s.url, status: s.status, fetchedAt: s.fetchedAt });
    assert(evidence.sources.length === canonicalSources.size && evidence.sources.every(s => JSON.stringify(s) === JSON.stringify(canonicalSources.get(s.sha256))), 'Replay source metadata differs from chain source');
    const expectedStates = new Map(), expectedReceipts = new Map(), receiptSourceHashes = new Map(), requiredTransfers = new Map();
    for (const s of chain.sources) {
      const calls = Array.isArray(s.payload) ? s.payload : s.payload ? [s.payload] : [];
      for (const call of calls) if (call.method === 'eth_getTransactionReceipt') {
        const set = receiptSourceHashes.get(call.params[0]) || new Set(); set.add(s.sha256); receiptSourceHashes.set(call.params[0], set);
      }
    }
    for (const swap of chain.swaps) {
      const previous = expectedReceipts.get(swap.txHash);
      const identity = { blockNumber: swap.blockNumber, blockHash: swap.blockHash, transactionIndex: swap.transactionIndex };
      assert(!previous || JSON.stringify(previous) === JSON.stringify(identity), 'Conflicting source receipt identity'); expectedReceipts.set(swap.txHash, identity);
    }
    const actualReceipts = new Map();
    for (const r of evidence.receipts) {
      const e = expectedReceipts.get(r.txHash);
      assert(!actualReceipts.has(r.txHash) && e && r.blockNumber === e.blockNumber && r.blockHash === e.blockHash && r.transactionIndex === e.transactionIndex && receiptSourceHashes.get(r.txHash)?.has(r.sourceSha256), 'Receipt set differs from bound chain source'); actualReceipts.set(r.txHash, r);
    }
    assert(actualReceipts.size === expectedReceipts.size, 'Missing bound receipt');
    for (const a of chain.acquisitions) {
      for (const t of a.transfers) {
        const id = a.txHash + ':' + a.tokenAddress + ':' + t.logIndex;
        const expected = { tokenAddress: a.tokenAddress, txHash: a.txHash, blockNumber: a.blockNumber, blockHash: a.blockHash,
          logIndex: t.logIndex, from: t.from, to: t.to, amountRaw: t.amountRaw };
        const previous = requiredTransfers.get(id); assert(!previous || JSON.stringify(previous) === JSON.stringify(expected), 'Conflicting source Transfer'); requiredTransfers.set(id, expected);
      }
      if (!a.finalRecipient || !a.balances) continue;
      const stateKey = number => key(a.tokenAddress, a.finalRecipient) + ':' + number;
      const list = a.balances.checkpoints.map(c => ({ blockNumber: c.number, blockHash: c.hash, timestamp: c.timestamp, balanceRaw: c.balanceRaw }));
      list.push({ blockNumber: chain.finalizedBlock.number, blockHash: chain.finalizedBlock.hash, timestamp: chain.finalizedBlock.timestamp, balanceRaw: a.balances.balanceFinalizedRaw });
      for (const s of list) { const id = stateKey(s.blockNumber), previous = expectedStates.get(id); assert(!previous || JSON.stringify(previous) === JSON.stringify(s), 'Conflicting source balance state'); expectedStates.set(id, s); }
    }
    assert(evidence.states.length === expectedStates.size, 'Balance state set differs from chain source');
    for (const s of evidence.states) {
      const e = expectedStates.get(key(s.tokenAddress, s.address) + ':' + s.blockNumber);
      assert(e && s.blockHash === e.blockHash && s.timestamp === e.timestamp && s.balanceRaw === e.balanceRaw, 'Balance state differs from bound chain source');
      const balanceCall = ['eth_call', [{ to: s.tokenAddress, data: '0x70a08231' + s.address.slice(2).padStart(64, '0') }, '0x' + s.blockNumber.toString(16)]];
      const contains = (source, method, params) => (Array.isArray(source?.payload) ? source.payload : source?.payload ? [source.payload] : []).some(c => c.method === method && JSON.stringify(c.params) === JSON.stringify(params));
      assert(chain.sources.some(source => source.sha256 === s.sourceSha256 && contains(source, ...balanceCall)) && chain.sources.some(source => source.sha256 === s.blockSourceSha256 && contains(source, 'eth_getBlockByNumber', ['0x' + s.blockNumber.toString(16), false])), 'Balance/header request proof mismatch');
    }
    const actualTransfers = new Map(evidence.transfers.map(t => [t.id, t]));
    for (const [id, e] of requiredTransfers) {
      const t = actualTransfers.get(id);
      assert(t && Object.keys(e).every(field => t[field] === e[field]), 'Known chain Transfer missing or changed');
    }
    const tokens = new Set(chain.tokens.map(t => t.address));
    for (const t of evidence.transfers) {
      const r = actualReceipts.get(t.txHash);
      assert(tokens.has(t.tokenAddress) && r && t.blockNumber === r.blockNumber && t.blockHash === r.blockHash && t.transactionIndex === r.transactionIndex && t.sourceSha256 === r.sourceSha256, 'Transfer proof does not match bound receipt');
    }
  }
  function buildReport(chain, evidence, options) {
    assert(options && SHA.test(options.sourceSnapshotSha256) && Number.isFinite(Date.parse(options.generatedAt)), 'Missing source snapshot binding');
    assert(chain?.schemaVersion === 1 && chain.kind === 'verified-acquisition-ledger' && chain.coverage?.completeTransferHistory === false && chain.chainId === 1, 'Unsupported chain source');
    assert(evidence?.replayVerified === true && Array.isArray(evidence.sources) && Array.isArray(evidence.states) && Array.isArray(evidence.transfers) && Array.isArray(evidence.receipts), 'Missing replay evidence');
    const hashes = new Set();
    for (const s of evidence.sources) { assert(SHA.test(s.sha256) && s.status === 200 && Number.isFinite(Date.parse(s.fetchedAt)), 'Invalid replay source'); assert(!hashes.has(s.sha256), 'Duplicate replay source'); hashes.add(s.sha256); }
    assert(evidence.states.every(s => hashes.has(s.sourceSha256) && hashes.has(s.blockSourceSha256)) && evidence.transfers.every(t => hashes.has(t.sourceSha256)) && evidence.receipts.every(r => hashes.has(r.sourceSha256) && HASH.test(r.txHash) && HASH.test(r.blockHash)), 'Unbound raw source evidence');
    assertChainBindings(chain, evidence);
    const positions = derivePositions(chain, evidence);
    return { schemaVersion: 1, kind: 'partial-inventory-reconciliation', chainId: chain.chainId,
      generatedAt: options.generatedAt, sourceGeneratedAt: chain.generatedAt, sourceSnapshotSha256: options.sourceSnapshotSha256,
      asOf: chain.finalizedBlock, evidence, positions, summary: summary(positions, evidence),
      coverage: { sourceReplayVerified: true, completeTransferHistory: false, fullMarketCoverage: false, ownershipVerified: false,
        selection: chain.coverage.selection, sourceLimits: chain.coverage.sourceLimits,
        meaning: 'Exact reconciliation of historical balance states against ERC20 Transfers in the retained selected transaction receipts only. Other transactions were not exhaustively collected. A zero residual cannot prove complete history.' },
      method: { equation: 'closingBalance = openingBalance + observedInflow - observedOutflow + unexplainedNet',
        interval: 'Opening and closing balances are end-of-block states. Count checked receipt transfers only where openingBlock < transferBlock <= closingBlock.',
        residual: 'Unexplained net means balance change not explained by the checked receipts. It does not identify a sale, withdrawal, owner, purpose, gross flow or number of missing transactions. Equal unseen inflows/outflows can cancel.',
        timing: 'Before/after block balances can include other transactions in that block. Exact transaction execution and ownership are distinct claims.',
        retention: 'Lower bound remains zero; upper bound is min(sample acquired, closing balance). Factory-verified liquidity pools have no trader-retention interpretation.',
        costBasis: 'No full acquisition/disposal ledger: no FIFO/LIFO lots, realized profit, holder-age cost basis or ASI score is published.' } };
  }
  function validateReport(report, chain, options) {
    assert(report?.schemaVersion === 1 && report.kind === 'partial-inventory-reconciliation', 'Invalid inventory report');
    assert(options?.sourceSnapshotSha256 === report.sourceSnapshotSha256, 'Inventory source SHA mismatch');
    const expected = buildReport(chain, report.evidence, { sourceSnapshotSha256: options.sourceSnapshotSha256, generatedAt: report.generatedAt });
    assert(JSON.stringify(expected) === JSON.stringify(report), 'Inventory reconciliation differs from exact replay'); return true;
  }
  function positionRows(report, tokenAddress) { return report.positions.filter(p => !tokenAddress || p.tokenAddress === tokenAddress); }
  return { TRANSFER_TOPIC: TOPIC, decodeTransfers, reconcile, buildReport, validateReport, positionRows };
}));
