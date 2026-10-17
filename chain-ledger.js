(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ChainLedger = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const SWAP_TOPIC = '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67';
  const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
  const ADDRESS = /^0x[0-9a-f]{40}$/;
  const HASH = /^0x[0-9a-f]{64}$/;
  const UINT = /^(0|[1-9][0-9]*)$/;
  const SINT = /^-?(0|[1-9][0-9]*)$/;
  function assert(ok, message) { if (!ok) throw new Error(message); }
  function address(value) {
    const a = String(value || '').toLowerCase();
    assert(ADDRESS.test(a), 'Invalid address'); return a;
  }
  function integer(value) { assert(UINT.test(String(value)), 'Invalid unsigned integer'); return BigInt(value); }
  function quantity(value) {
    assert(/^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(value || ''), 'Invalid RPC quantity');
    const n = Number(BigInt(value)); assert(Number.isSafeInteger(n), 'Unsafe RPC quantity'); return n;
  }
  function words(data, count) {
    assert(new RegExp('^0x[0-9a-f]{' + (64 * count) + '}$').test(data || ''), 'Invalid ABI event data');
    return data.slice(2).match(/.{64}/g);
  }
  function indexedAddress(topic) {
    assert(/^0x0{24}[0-9a-f]{40}$/.test(topic || ''), 'Invalid indexed address');
    return address('0x' + topic.slice(-40));
  }
  function int256(word) { const n = BigInt('0x' + word); return n >= (1n << 255n) ? n - (1n << 256n) : n; }
  function decodeSwap(log, pool) {
    assert(log && log.removed === false && log.topics?.length === 3 && log.topics[0] === SWAP_TOPIC, 'Not a canonical Uniswap V3 Swap');
    assert(address(log.address) === address(pool.address), 'Pool address mismatch');
    assert(HASH.test(log.transactionHash || '') && HASH.test(log.blockHash || ''), 'Invalid log identity');
    const w = words(log.data, 5), a0 = int256(w[0]), a1 = int256(w[1]);
    assert((a0 > 0n && a1 < 0n) || (a0 < 0n && a1 > 0n), 'Swap must have opposite nonzero token deltas');
    assert(BigInt('0x' + w[2]) < (1n << 160n) && BigInt('0x' + w[3]) < (1n << 128n), 'Invalid pool state integer width');
    const tick = int256(w[4]); assert(tick >= -887272n && tick <= 887272n, 'Invalid Uniswap V3 tick');
    const baseIndex = address(pool.token0) === address(pool.baseTokenAddress) ? 0 : 1;
    assert([pool.token0, pool.token1].map(address).includes(address(pool.baseTokenAddress)), 'Base token missing from pool');
    const baseDelta = baseIndex === 0 ? a0 : a1, quoteDelta = baseIndex === 0 ? a1 : a0;
    return { id: log.transactionHash + ':' + quantity(log.logIndex), poolAddress: address(pool.address),
      tokenAddress: address(pool.baseTokenAddress), quoteTokenAddress: address(baseIndex === 0 ? pool.token1 : pool.token0),
      txHash: log.transactionHash, blockNumber: quantity(log.blockNumber), blockHash: log.blockHash,
      transactionIndex: quantity(log.transactionIndex), logIndex: quantity(log.logIndex),
      sender: indexedAddress(log.topics[1]), recipient: indexedAddress(log.topics[2]),
      kind: baseDelta < 0n ? 'buy' : 'sell', baseAmountRaw: (baseDelta < 0n ? -baseDelta : baseDelta).toString(),
      quoteAmountRaw: (quoteDelta < 0n ? -quoteDelta : quoteDelta).toString(),
      amount0Raw: a0.toString(), amount1Raw: a1.toString(), sqrtPriceX96: BigInt('0x' + w[2]).toString(),
      liquidityRaw: BigInt('0x' + w[3]).toString(), tick: Number(tick) };
  }
  function tokenTransfers(receipt, tokenAddress) {
    return (receipt.logs || []).filter(l => l.address?.toLowerCase() === address(tokenAddress) && l.topics?.[0] === TRANSFER_TOPIC)
      .map(l => {
        assert(l.removed === false && l.topics.length === 3 && /^0x[0-9a-f]{64}$/.test(l.data), 'Invalid ERC20 Transfer log');
        return { from: indexedAddress(l.topics[1]), to: indexedAddress(l.topics[2]), amountRaw: BigInt(l.data).toString(), logIndex: quantity(l.logIndex) };
      }).sort((a, b) => a.logIndex - b.logIndex);
  }
  // Resolve only the conservative case: exactly one net source (the sampled
  // pool) and exactly one net receiver for this token over the entire receipt.
  // Routers with zero net movement may be intermediate; no ownership inference.
  function resolveAcquisition(receipt, swap) {
    assert(receipt && receipt.status === '0x1' && receipt.transactionHash?.toLowerCase() === swap.txHash, 'Receipt transaction mismatch');
    assert(quantity(receipt.blockNumber) === swap.blockNumber && receipt.blockHash?.toLowerCase() === swap.blockHash, 'Receipt block mismatch');
    const transfers = tokenTransfers(receipt, swap.tokenAddress), net = new Map();
    for (const t of transfers) {
      const n = integer(t.amountRaw);
      net.set(t.from, (net.get(t.from) || 0n) - n); net.set(t.to, (net.get(t.to) || 0n) + n);
    }
    const positives = [...net].filter(x => x[1] > 0n), negatives = [...net].filter(x => x[1] < 0n);
    const poolOutput = transfers.filter(t => t.from === swap.poolAddress).reduce((sum, t) => sum + integer(t.amountRaw), 0n);
    const matchesOutput = swap.kind === 'buy' && poolOutput === integer(swap.baseAmountRaw);
    const resolved = matchesOutput && positives.length === 1 && negatives.length === 1 && negatives[0][0] === swap.poolAddress && positives[0][1] === integer(swap.baseAmountRaw);
    return { txSender: address(receipt.from), immediateRecipient: swap.recipient,
      finalRecipient: resolved ? positives[0][0] : null,
      routeStatus: resolved ? 'unique-net-recipient' : 'ambiguous-or-roundtrip',
      transactionAcquiredRaw: resolved ? positives[0][1].toString() : null,
      poolOutputMatchesSwap: matchesOutput, transfers,
      netRecipients: positives.map(([a, n]) => ({ address: a, amountRaw: n.toString() })),
      netSources: negatives.map(([a, n]) => ({ address: a, amountRaw: (-n).toString() })),
      ownershipVerified: false };
  }
  function retentionBounds(acquiredRaw, beforeRaw, afterRaw, finalizedRaw) {
    const acquired = integer(acquiredRaw), before = integer(beforeRaw), after = integer(afterRaw), final = integer(finalizedRaw);
    assert(acquired > 0n, 'Acquired amount must be positive');
    const upper = final < acquired ? final : acquired;
    return { balanceBeforeRaw: before.toString(), balanceAfterRaw: after.toString(), balanceFinalizedRaw: final.toString(),
      blockBalanceDeltaRaw: (after - before).toString(), laterBalanceDeltaRaw: (final - after).toString(),
      netBalanceIncreaseRaw: (final - before).toString(),
      retentionLowerBoundRaw: '0', retentionUpperBoundRaw: upper.toString(),
      balanceCoversAcquiredFraction: Number(upper * 1000000n / acquired) / 1000000,
      retainedPurchaseConfirmed: false,
      interpretation: 'Balances are state checkpoints. Without complete intervening transfers, a later balance cannot identify which purchased units remain; the retained acquisition is bounded by zero and min(acquired, final balance).' };
  }
  function formatUnits(raw, decimals, maxDecimals = 6) {
    assert(Number.isInteger(decimals) && decimals >= 0 && decimals <= 36, 'Invalid decimals');
    assert(SINT.test(String(raw)), 'Invalid integer');
    let n = BigInt(raw), sign = n < 0n ? '-' : ''; if (n < 0n) n = -n;
    const scale = 10n ** BigInt(decimals), whole = (n / scale).toString();
    const fraction = (n % scale).toString().padStart(decimals, '0').slice(0, Math.min(decimals, maxDecimals)).replace(/0+$/, '');
    return sign + whole + (fraction ? '.' + fraction : '');
  }
  function tokenSeries(snapshot, tokenAddress) {
    const a = address(tokenAddress), grouped = new Map();
    for (const s of snapshot.swaps.filter(x => x.tokenAddress === a)) {
      const day = s.timestamp.slice(0, 10); let row = grouped.get(day);
      if (!row) { row = { day, tokenAddress: a, buyTokenRaw: 0n, sellTokenRaw: 0n, buyQuoteRaw: 0n, sellQuoteRaw: 0n, buys: 0, sells: 0, selectedSample: true }; grouped.set(day, row); }
      const buy = s.kind === 'buy'; row[buy ? 'buyTokenRaw' : 'sellTokenRaw'] += integer(s.baseAmountRaw);
      row[buy ? 'buyQuoteRaw' : 'sellQuoteRaw'] += integer(s.quoteAmountRaw); row[buy ? 'buys' : 'sells']++;
    }
    return [...grouped.values()].sort((a, b) => a.day.localeCompare(b.day)).map(r => ({ ...r,
      buyTokenRaw: r.buyTokenRaw.toString(), sellTokenRaw: r.sellTokenRaw.toString(),
      buyQuoteRaw: r.buyQuoteRaw.toString(), sellQuoteRaw: r.sellQuoteRaw.toString(),
      netTokenRaw: (r.buyTokenRaw - r.sellTokenRaw).toString(), netQuoteRaw: (r.buyQuoteRaw - r.sellQuoteRaw).toString() }));
  }
  function acquisitionCandidates(snapshot, tokenAddress) {
    return snapshot.acquisitions.filter(x => (!tokenAddress || x.tokenAddress === address(tokenAddress)));
  }
  function executionPrice(quoteRaw, baseRaw, baseDecimals = 18, quoteDecimals = 18) {
    const q = integer(quoteRaw), b = integer(baseRaw);
    assert(b > 0n && Number.isInteger(baseDecimals) && Number.isInteger(quoteDecimals) && baseDecimals >= 0 && quoteDecimals >= 0 && baseDecimals <= 36 && quoteDecimals <= 36, 'Invalid price inputs');
    return formatUnits(q * 10n ** BigInt(baseDecimals + 18) / (b * 10n ** BigInt(quoteDecimals)), 18, 18);
  }
  // Repeated receipt rows can reach one address. Aggregate exact address-token
  // identities once; summing repeated final balances would double-count assets.
  function addressActivity(snapshot, tokenAddress) {
    const grouped = new Map();
    for (const a of acquisitionCandidates(snapshot, tokenAddress)) {
      if (!a.finalRecipient || !a.balances) continue;
      const key = a.tokenAddress + ':' + a.finalRecipient; let g = grouped.get(key);
      if (!g) {
        g = { tokenAddress: a.tokenAddress, address: a.finalRecipient, recipientHasCode: a.recipientHasCode,
          recipientRole: a.recipientRole || 'unclassified', excludeFromAccumulation: a.excludeFromAccumulation === true,
          purchaseCount: 0, acquiredRaw: 0n, spentQuoteRaw: 0n, firstObservedAt: a.timestamp, lastObservedAt: a.timestamp,
          balanceFinalizedRaw: a.balances.balanceFinalizedRaw, checkpoints: a.balances.checkpoints,
          ownershipVerified: false, retainedPurchaseConfirmed: false, selectedSample: true };
        grouped.set(key, g);
      }
      assert(g.balanceFinalizedRaw === a.balances.balanceFinalizedRaw, 'Inconsistent final balance for address-token');
      g.purchaseCount++; g.acquiredRaw += integer(a.transactionAcquiredRaw); g.spentQuoteRaw += integer(a.quoteAmountRaw);
      if (a.timestamp < g.firstObservedAt) g.firstObservedAt = a.timestamp;
      if (a.timestamp > g.lastObservedAt) g.lastObservedAt = a.timestamp;
    }
    return [...grouped.values()].map(g => {
      const token = snapshot.tokens.find(t => t.address === g.tokenAddress);
      return { ...g, acquiredRaw: g.acquiredRaw.toString(), spentQuoteRaw: g.spentQuoteRaw.toString(),
        sampleAcquisitionVwapQuotePerToken: executionPrice(g.spentQuoteRaw.toString(), g.acquiredRaw.toString(), token.decimals, snapshot.quoteToken.decimals),
        balanceChanges: g.checkpoints.map(c => ({ blockNumber: c.number, timestamp: c.timestamp,
          daysBeforeFinalized: c.daysBeforeFinalized, balanceThenRaw: c.balanceRaw,
          deltaRaw: (integer(g.balanceFinalizedRaw) - integer(c.balanceRaw)).toString() })),
        retentionApplicable: !g.excludeFromAccumulation,
        retentionLowerBoundRaw: g.excludeFromAccumulation ? null : '0',
        retentionUpperBoundRaw: g.excludeFromAccumulation ? null : (integer(g.balanceFinalizedRaw) < g.acquiredRaw ? integer(g.balanceFinalizedRaw) : g.acquiredRaw).toString() };
    }).sort((a, b) => {
      const qa = integer(a.spentQuoteRaw), qb = integer(b.spentQuoteRaw); return qa === qb ? a.address.localeCompare(b.address) : qa > qb ? -1 : 1;
    });
  }
  function summarize(snapshot) {
    return { tokenCount: snapshot.tokens.length, poolCount: snapshot.pools.length,
      discoveryCount: snapshot.coverage.discoveryCount, receiptVerifiedSwaps: snapshot.swaps.length,
      examinedAcquisitions: snapshot.acquisitions.length,
      resolvedRecipients: snapshot.acquisitions.filter(a => a.routeStatus === 'unique-net-recipient').length,
      checkedRecipients: snapshot.acquisitions.filter(a => a.balances).length,
      uniqueResolvedAddresses: new Set(snapshot.acquisitions.filter(a => a.finalRecipient).map(a => a.finalRecipient)).size,
      uniqueAddressTokenPositions: new Set(snapshot.acquisitions.filter(a => a.finalRecipient).map(a => a.tokenAddress + ':' + a.finalRecipient)).size,
      excludedLiquidityPoolRows: snapshot.acquisitions.filter(a => a.excludeFromAccumulation === true).length,
      retainedPurchaseConfirmed: 0, fullHistoricalCoverage: false,
      firstObservedAt: snapshot.coverage.firstObservedAt, lastObservedAt: snapshot.coverage.lastObservedAt };
  }
  function validateSnapshot(s) {
    assert(s?.schemaVersion === 1 && s.kind === 'verified-acquisition-ledger' && s.chainId === 1, 'Invalid ledger identity');
    assert(Number.isFinite(Date.parse(s.generatedAt)) && Number.isInteger(s.finalizedBlock?.number) && HASH.test(s.finalizedBlock.hash), 'Invalid finalized state');
    assert(Number.isFinite(Date.parse(s.finalizedBlock.timestamp)) && s.blockChecks?.before?.hash === s.finalizedBlock.hash && s.blockChecks?.after?.hash === s.finalizedBlock.hash && s.blockChecks?.before?.number === s.finalizedBlock.number && s.blockChecks?.after?.number === s.finalizedBlock.number, 'Missing fixed-block recheck');
    assert(Array.isArray(s.tokens) && Array.isArray(s.pools) && Array.isArray(s.swaps) && Array.isArray(s.acquisitions), 'Missing ledger collections');
    assert(s.coverage?.completePoolLogs === false && s.coverage?.completeTransferHistory === false, 'Unsupported complete coverage claim');
    const tokens = new Map(s.tokens.map(t => [address(t.address), t]));
    assert(tokens.size === s.tokens.length, 'Duplicate token identity');
    for (const t of s.tokens) assert(Number.isInteger(t.decimals) && t.decimals >= 0 && t.decimals <= 36, 'Invalid token decimals');
    const pools = new Map(s.pools.map(p => [address(p.address), p])); assert(pools.size === s.pools.length, 'Duplicate pool');
    for (const p of s.pools) {
      assert(tokens.has(address(p.baseTokenAddress)) && address(p.quoteTokenAddress) === address(s.quoteToken.address), 'Unknown pool token identity');
      assert([address(p.token0), address(p.token1)].includes(p.baseTokenAddress) && [p.token0, p.token1].includes(p.quoteTokenAddress) && p.token0 !== p.token1, 'Invalid pool token pair');
    }
    const ids = new Set();
    for (const row of s.swaps) {
      assert(!ids.has(row.id), 'Duplicate swap'); ids.add(row.id);
      assert(tokens.has(address(row.tokenAddress)) && pools.has(address(row.poolAddress)), 'Unknown swap identity');
      const pool = pools.get(row.poolAddress);
      assert(pool.baseTokenAddress === row.tokenAddress && pool.quoteTokenAddress === row.quoteTokenAddress, 'Swap token/pool mismatch');
      assert(Number.isInteger(row.blockNumber) && row.blockNumber <= s.finalizedBlock.number && Number.isFinite(Date.parse(row.timestamp)), 'Unfinalized/undated swap');
      assert(HASH.test(row.txHash) && HASH.test(row.blockHash), 'Invalid swap hash');
      assert(integer(row.baseAmountRaw) > 0n && integer(row.quoteAmountRaw) > 0n, 'Zero swap amount'); assert(['buy', 'sell'].includes(row.kind), 'Invalid swap direction');
    }
    for (const a of s.acquisitions) {
      assert(ids.has(a.swapId) && a.ownershipVerified === false, 'Acquisition identity/ownership mismatch');
      const swap = s.swaps.find(x => x.id === a.swapId);
      assert(swap.kind === 'buy' && swap.tokenAddress === a.tokenAddress && swap.txHash === a.txHash && swap.blockHash === a.blockHash && swap.blockNumber === a.blockNumber && swap.baseAmountRaw === a.baseAmountRaw && swap.quoteAmountRaw === a.quoteAmountRaw, 'Acquisition/Swap mismatch');
      if (a.finalRecipient !== null) address(a.finalRecipient);
      assert((a.routeStatus === 'unique-net-recipient') === (a.finalRecipient !== null), 'Ambiguous route must have no resolved recipient');
      const proof = (s.recipientRoles || []).find(r => r.address === a.finalRecipient && r.chainId === s.chainId && r.role === 'verified-liquidity-pool');
      if (a.recipientRole === 'verified-liquidity-pool' || proof) {
        assert(proof && a.recipientRole === proof.role && proof.verifiedAtBlockNumber === s.finalizedBlock.number && proof.verifiedAtBlockHash === s.finalizedBlock.hash && a.excludeFromAccumulation === true && a.balances?.retentionApplicable === false, 'Liquidity pool must have fixed-block role proof and be excluded from accumulation');
      }
      if (a.balances) {
        assert(a.finalRecipient && a.balances.retainedPurchaseConfirmed === false, 'Unsupported retained purchase claim');
        const b = a.balances, expected = retentionBounds(a.transactionAcquiredRaw, b.balanceBeforeRaw, b.balanceAfterRaw, b.balanceFinalizedRaw);
        for (const key of ['retentionLowerBoundRaw', 'retentionUpperBoundRaw', 'netBalanceIncreaseRaw', 'blockBalanceDeltaRaw', 'laterBalanceDeltaRaw', 'balanceCoversAcquiredFraction']) assert(b[key] === expected[key], 'Incorrect retention metric ' + key);
        assert(b.beforeBlockNumber === a.blockNumber - 1 && b.afterBlockNumber === a.blockNumber && b.finalizedBlockNumber === s.finalizedBlock.number && b.finalizedBlockHash === s.finalizedBlock.hash, 'Incorrect balance block tag');
        assert(Array.isArray(b.checkpoints) && b.checkpoints.length >= 2, 'Missing historical checkpoints');
        const heights = new Set();
        for (const c of b.checkpoints) {
          integer(c.balanceRaw);
          assert(Number.isInteger(c.number) && c.number < s.finalizedBlock.number && HASH.test(c.hash) && Number.isFinite(Date.parse(c.timestamp)) && !heights.has(c.number), 'Invalid checkpoint identity');
          heights.add(c.number);
          assert(c.daysBeforeFinalized === (Date.parse(s.finalizedBlock.timestamp) - Date.parse(c.timestamp)) / 86400000, 'Incorrect checkpoint duration');
        }
      }
    }
    return true;
  }
  return { SWAP_TOPIC, TRANSFER_TOPIC, decodeSwap, tokenTransfers, resolveAcquisition, retentionBounds, formatUnits, tokenSeries, acquisitionCandidates, addressActivity, executionPrice, summarize, validateSnapshot, quantity, address };
}));
