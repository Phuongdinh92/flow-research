/* Receipt-backed transfer components. A link records a transfer, never common ownership. */
(function (root, factory) {
  'use strict';
  const api = typeof module === 'object' && module.exports
    ? factory(require('./chain-ledger.js'), require('./inventory-ledger.js'))
    : factory(root.ChainLedger, root.InventoryLedger);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FlowWalletCohorts = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (C, I) {
  'use strict';
  const ADDRESS = /^0x[0-9a-f]{40}$/, HASH = /^0x[0-9a-f]{64}$/, SHA = /^[0-9a-f]{64}$/;
  const ZERO = '0x' + '0'.repeat(40), DAY = 86400000;
  const COLORS = ['#9475ff', '#2cc8d8', '#e8b956', '#4dd7a8', '#ef6aa2', '#85aaff'];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const short = value => value.slice(0, 8) + '…' + value.slice(-6);
  const date = value => new Date(value).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  function uint(raw) { assert(typeof raw === 'string' && /^(0|[1-9][0-9]*)$/.test(raw), 'Amount must be an exact unsigned decimal string'); return BigInt(raw); }
  function formatRaw(raw, decimals, full = false) {
    assert(typeof raw === 'string' && /^-?(0|[1-9][0-9]*)$/.test(raw), 'Invalid exact amount');
    assert(Number.isInteger(decimals) && decimals >= 0 && decimals <= 36, 'Invalid decimals');
    let n = BigInt(raw); const sign = n < 0n ? '−' : ''; if (n < 0n) n = -n;
    const scale = 10n ** BigInt(decimals), whole = (n / scale).toString();
    const fraction = (n % scale).toString().padStart(decimals, '0').slice(0, full ? decimals : Math.min(5, decimals)).replace(/0+$/, '');
    if (!full && n > 0n && n < scale / 100000n) return sign + '<0.00001';
    return sign + whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction ? '.' + fraction : '');
  }
  function signed(raw, decimals, full = false) { return (BigInt(raw) > 0n ? '+' : '') + formatRaw(raw, decimals, full); }
  function percent(part, total) { return total === 0n ? null : Number(part * 1000000n / total) / 10000; }
  function validateEdge(e, tokenAddress) {
    assert(e.tokenAddress === tokenAddress && ADDRESS.test(e.from) && ADDRESS.test(e.to), 'Transfer token/address mismatch');
    uint(e.amountRaw);
    assert(HASH.test(e.txHash) && HASH.test(e.blockHash) && SHA.test(e.sourceSha256), 'Missing transfer proof');
    assert(Number.isSafeInteger(e.blockNumber) && e.blockNumber >= 0 && Number.isSafeInteger(e.logIndex) && e.logIndex >= 0, 'Invalid transfer block/log');
    assert(e.id === e.txHash + ':' + e.tokenAddress + ':' + e.logIndex, 'Invalid transfer identity');
    assert(Number.isFinite(Date.parse(e.timestamp)), 'Missing transfer timestamp');
  }
  // Connected components are computed after removing proven pool and zero-address
  // bridge nodes. Every remaining connection must be an actual positive Transfer.
  // Unknown contracts remain explicitly unclassified, never guessed to be owners.
  function components(edges, boundaryAddresses, tokenAddress) {
    assert(ADDRESS.test(tokenAddress), 'Invalid token contract');
    const boundary = new Set(boundaryAddresses); boundary.add(ZERO);
    for (const a of boundary) assert(ADDRESS.test(a), 'Invalid boundary address');
    const ids = new Set(), parent = new Map();
    const find = a => { let root = a; while (parent.get(root) !== root) root = parent.get(root); while (parent.get(a) !== a) { const next = parent.get(a); parent.set(a, root); a = next; } return root; };
    const ensure = a => { if (!boundary.has(a) && !parent.has(a)) parent.set(a, a); };
    for (const e of edges) {
      validateEdge(e, tokenAddress); assert(!ids.has(e.id), 'Duplicate transfer identity'); ids.add(e.id);
      if (uint(e.amountRaw) === 0n) continue;
      ensure(e.from); ensure(e.to);
      if (!boundary.has(e.from) && !boundary.has(e.to) && e.from !== e.to) {
        const a = find(e.from), b = find(e.to); if (a !== b) parent.set(a < b ? b : a, a < b ? a : b);
      }
    }
    const groups = new Map();
    for (const a of [...parent.keys()].sort()) { const key = find(a), members = groups.get(key) || []; members.push(a); groups.set(key, members); }
    return [...groups.values()].sort((a, b) => a[0].localeCompare(b[0])).map(members => ({ id: '1:' + tokenAddress + ':' + members[0], members, ownershipVerified: false }));
  }
  // Only edges crossing the selected member set contribute to group flow.
  // Internal edges, including self transfers, contribute exactly zero.
  function boundaryFlow(edges, members) {
    const group = new Set(members), ids = new Set();
    let inflow = 0n, outflow = 0n, internal = 0n, internalCount = 0;
    const touched = [], external = [];
    for (const e of edges) {
      assert(!ids.has(e.id), 'Duplicate transfer identity'); ids.add(e.id);
      const n = uint(e.amountRaw), from = group.has(e.from), to = group.has(e.to);
      if (!from && !to) continue;
      touched.push(e.id);
      if (from && to) { internal += n; internalCount++; }
      else { if (to) inflow += n; else outflow += n; external.push(e.id); }
    }
    const total = inflow + outflow;
    return { inflowRaw: inflow.toString(), outflowRaw: outflow.toString(), netRaw: (inflow - outflow).toString(),
      internalRaw: internal.toString(), internalTransferCount: internalCount, transferIds: touched, boundaryTransferIds: external,
      inflowSharePct: percent(inflow, total), outflowSharePct: percent(outflow, total), spreadPct: percent(inflow - outflow, total),
      completeTransferHistory: false, accumulationConfirmed: false, ownershipVerified: false };
  }
  function prepare(chain, inventory) {
    assert(C && I, 'Missing receipt validation modules');
    C.validateSnapshot(chain);
    I.validateReport(inventory, chain, { sourceSnapshotSha256: inventory.sourceSnapshotSha256 });
    const receiptTimes = new Map();
    for (const s of chain.swaps) {
      const existing = receiptTimes.get(s.txHash);
      assert(!existing || existing.timestamp === s.timestamp && existing.blockHash === s.blockHash, 'Conflicting receipt time');
      receiptTimes.set(s.txHash, { timestamp: s.timestamp, blockHash: s.blockHash });
    }
    const edges = inventory.evidence.transfers.map(t => {
      const clock = receiptTimes.get(t.txHash);
      assert(clock && clock.blockHash === t.blockHash, 'Transfer timestamp is not bound to its receipt block');
      return { ...t, timestamp: clock.timestamp };
    });
    const pools = new Set(chain.pools.map(p => p.address));
    for (const r of chain.recipientRoles || []) if (r.role === 'verified-liquidity-pool') {
      assert(r.chainId === chain.chainId && r.verifiedAtBlockNumber === chain.finalizedBlock.number && r.verifiedAtBlockHash === chain.finalizedBlock.hash, 'Unbound liquidity pool role');
      pools.add(r.address);
    }
    return { chainId: chain.chainId, tokens: chain.tokens.map(t => ({ ...t })), edges, boundaryAddresses: [...pools, ZERO],
      asOf: { ...chain.finalizedBlock }, generatedAt: inventory.generatedAt, sourceGeneratedAt: chain.generatedAt,
      sourceSnapshotSha256: inventory.sourceSnapshotSha256, receiptCount: inventory.evidence.receipts.length,
      completeTransferHistory: false, sourceReplayVerified: true, selection: chain.coverage.selection };
  }
  function model(prepared, { tokenAddress = prepared.tokens[0]?.address, days = 1 } = {}) {
    assert([1, 7, 30].includes(days), 'Unsupported observation window');
    assert(prepared.chainId === 1 && prepared.sourceReplayVerified === true && prepared.completeTransferHistory === false, 'Unverified observation set');
    const token = prepared.tokens.find(t => t.address === tokenAddress); assert(token, 'Unknown token contract');
    const end = Date.parse(prepared.asOf.timestamp), start = end - days * DAY;
    assert(Number.isFinite(end), 'Invalid observation cutoff');
    const edges = prepared.edges.filter(e => e.tokenAddress === tokenAddress && Date.parse(e.timestamp) > start && Date.parse(e.timestamp) <= end);
    for (const e of edges) assert(e.blockNumber <= prepared.asOf.number, 'Transfer is after finalized cutoff');
    const groups = components(edges, prepared.boundaryAddresses, tokenAddress).map((g, index) => ({ ...g, index: index + 1, ...boundaryFlow(edges, g.members) }));
    const total = boundaryFlow(edges, groups.flatMap(g => g.members));
    return { token, days, start, end, edges, groups, total, asOf: prepared.asOf,
      boundaryAddresses: prepared.boundaryAddresses, snapshotSha256: prepared.sourceSnapshotSha256,
      receiptCount: new Set(edges.map(e => e.txHash)).size, linkedGroupCount: groups.filter(g => g.members.length > 1).length,
      singletonCount: groups.filter(g => g.members.length === 1).length, addressCount: groups.reduce((n, g) => n + g.members.length, 0),
      positiveGroupCount: groups.filter(g => BigInt(g.netRaw) > 0n).length, negativeGroupCount: groups.filter(g => BigInt(g.netRaw) < 0n).length,
      observedDays: new Set(edges.map(e => e.timestamp.slice(0, 10))).size, completeTransferHistory: false, ownershipVerified: false,
      selection: prepared.selection, sourceGeneratedAt: prepared.sourceGeneratedAt };
  }
  function timeline(m, groupId = 'all') {
    const groups = groupId === 'all' ? m.groups : m.groups.filter(g => g.id === groupId);
    assert(groupId === 'all' || groups.length === 1, 'Unknown observed group');
    const members = groups.flatMap(g => g.members), memberSet = new Set(members), rows = [];
    const edges = m.edges.filter(e => memberSet.has(e.from) || memberSet.has(e.to));
    for (let start = Math.floor(m.start / DAY) * DAY; start <= m.end; start += DAY) {
      const observed = edges.filter(e => Date.parse(e.timestamp) >= start && Date.parse(e.timestamp) < start + DAY);
      rows.push({ day: new Date(start).toISOString().slice(0, 10), start, observed: observed.length > 0,
        sampleTransferCount: observed.length, flow: observed.length ? boundaryFlow(observed, members) : null });
    }
    return rows;
  }
  function link(url, label) { return '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(label) + ' ↗</a>'; }
  function flowChart(m, groupId) {
    const rows = timeline(m, groupId), w = 1000, h = 285, left = 85, right = 24, top = 25, bottom = 42, mid = 140;
    const amounts = rows.flatMap(r => r.flow ? [BigInt(r.flow.inflowRaw), BigInt(r.flow.outflowRaw)] : []), max = amounts.reduce((a, b) => a > b ? a : b, 0n);
    const ratio = raw => max === 0n ? 0 : Number(BigInt(raw) * 1000000n / max) / 1000000;
    const pitch = (w - left - right) / rows.length, bw = Math.min(32, pitch * .32);
    let html = '<svg class="wc-chart" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="Nhận và gửi qua biên nhóm trong các receipt đã chọn; khoảng thiếu không phải bằng không">';
    html += [-1, -.5, 0, .5, 1].map(v => '<line x1="' + left + '" x2="' + (w - right) + '" y1="' + (mid - v * 95) + '" y2="' + (mid - v * 95) + '" class="' + (v === 0 ? 'wc-zero' : 'wc-grid') + '"/><text x="' + (left - 9) + '" y="' + (mid - v * 95 + 4) + '" text-anchor="end">' + esc(formatRaw((max * BigInt(Math.round(v * 100)) / 100n).toString(), m.token.decimals)) + '</text>').join('');
    rows.forEach((r, i) => {
      const x = left + pitch * (i + .5);
      if (!r.observed) html += '<rect x="' + (x - pitch * .42) + '" y="' + top + '" width="' + (pitch * .84) + '" height="' + (h - top - bottom) + '" fill="#263047" opacity=".24"><title>' + r.day + ': không có receipt trong mẫu; tổng dòng chuyển ngày chưa biết.</title></rect><circle cx="' + x + '" cy="' + mid + '" r="2" fill="#62718a"/>';
      else {
        const label = r.day + ' · ' + r.sampleTransferCount + ' Transfers trong mẫu · nhận ' + formatRaw(r.flow.inflowRaw, m.token.decimals, true) + ' · gửi ' + formatRaw(r.flow.outflowRaw, m.token.decimals, true) + ' ' + m.token.symbol;
        const ih = ratio(r.flow.inflowRaw) * 95, oh = ratio(r.flow.outflowRaw) * 95;
        html += '<g tabindex="0" role="img" aria-label="' + esc(label) + '"><title>' + esc(label) + '</title><rect x="' + (x - bw) + '" y="' + (mid - ih) + '" width="' + bw + '" height="' + ih + '" rx="2" fill="#15c99a"/><rect x="' + x + '" y="' + mid + '" width="' + bw + '" height="' + oh + '" rx="2" fill="#f05a82"/>' + (ih === 0 && oh === 0 ? '<circle cx="' + x + '" cy="' + mid + '" r="3" fill="#a58bff"/>' : '') + '</g>';
      }
      if (rows.length < 9 || i % 5 === 0 || i === rows.length - 1) html += '<text x="' + x + '" y="268" text-anchor="middle">' + r.day.slice(5) + '</text>';
    });
    return html + '</svg>';
  }
  function networkChart(m, selected = 'all') {
    const groups = selected === 'all' ? m.groups : m.groups.filter(g => g.id === selected), members = new Set(groups.flatMap(g => g.members));
    const edges = m.edges.filter(e => BigInt(e.amountRaw) > 0n && (members.has(e.from) || members.has(e.to))), external = [...new Set(edges.flatMap(e => [e.from, e.to]).filter(a => !members.has(a)))].sort();
    if (!edges.length) return '<div class="wc-empty">Không có Transfer phù hợp trong các receipt được chọn.</div>';
    const cols = Math.min(3, groups.length), rows = Math.ceil(groups.length / cols), width = 1000, groupHeight = 250, height = rows * groupHeight + 120;
    const points = new Map();
    let background = '';
    groups.forEach((g, i) => {
      const x = (i % cols) * width / cols, y = Math.floor(i / cols) * groupHeight, cw = width / cols, color = COLORS[(g.index - 1) % COLORS.length];
      background += '<rect x="' + (x + 8) + '" y="' + (y + 8) + '" width="' + (cw - 16) + '" height="' + (groupHeight - 16) + '" rx="12" fill="#0b1423" stroke="' + color + '" stroke-opacity=".35"/><text x="' + (x + 22) + '" y="' + (y + 31) + '" fill="' + color + '">Nhóm ' + g.index + ' · ' + g.members.length + ' địa chỉ</text>';
      g.members.forEach((a, n) => { const angle = 2 * Math.PI * n / g.members.length - Math.PI / 2;
        points.set(a, { x: x + cw / 2 + (g.members.length === 1 ? 0 : Math.cos(angle) * Math.max(50, cw / 2 - 72)), y: y + 136 + (g.members.length === 1 ? 0 : Math.sin(angle) * 70), color, boundary: false, label: g.members.length > 8 ? '#' + (n + 1) : short(a) }); });
    });
    external.forEach((a, i) => points.set(a, { x: width * (i + 1) / (external.length + 1), y: height - 45, color: '#e8b956', boundary: true, label: short(a) }));
    const unique = new Map();
    for (const e of edges) { const key = e.from + ':' + e.to, entry = unique.get(key) || { from: e.from, to: e.to, count: 0, amount: 0n }; entry.count++; entry.amount += BigInt(e.amountRaw); unique.set(key, entry); }
    let paths = '';
    for (const e of unique.values()) {
      const from = points.get(e.from), to = points.get(e.to); if (!from || !to || e.from === e.to) continue;
      const len = Math.hypot(to.x - from.x, to.y - from.y), dx = (to.x - from.x) / len, dy = (to.y - from.y) / len;
      paths += '<path d="M ' + (from.x + dx * 13) + ' ' + (from.y + dy * 13) + ' L ' + (to.x - dx * 16) + ' ' + (to.y - dy * 16) + '" class="wc-edge" marker-end="url(#wc-arrow)"><title>' + esc(e.from + ' → ' + e.to + ' · ' + e.count + ' Transfers · ' + formatRaw(e.amount.toString(), m.token.decimals, true) + ' ' + m.token.symbol) + '</title></path>';
    }
    let nodes = '';
    for (const [a, p] of points) nodes += '<g class="wc-node" tabindex="0" role="img" aria-label="' + a + (p.boundary ? ' · pool đã xác minh hoặc địa chỉ zero' : ' · chưa xác minh chủ sở hữu') + '"><title>' + a + (p.boundary ? '\nPool đã xác minh / địa chỉ zero · không làm cầu nối nhóm' : '\nLiên kết qua Transfer quan sát được; không suy ra cùng chủ') + '</title><circle cx="' + p.x + '" cy="' + p.y + '" r="10" fill="' + p.color + '" stroke="#071018" stroke-width="3"/><text x="' + p.x + '" y="' + (p.y + 24) + '" text-anchor="middle">' + p.label + '</text></g>';
    return '<svg class="wc-network" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="Đồ thị các chuyển token thật. Mũi tên là chiều Transfer; nhóm là thành phần liên thông, không phải cùng chủ"><defs><marker id="wc-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7" fill="#647590"/></marker></defs>' + background + paths + nodes + '</svg>';
  }
  function view(m, state) {
    const group = state.group === 'all' ? null : m.groups.find(g => g.id === state.group), flow = group || m.total;
    const members = new Set(group ? group.members : m.groups.flatMap(g => g.members));
    const edges = m.edges.filter(e => members.has(e.from) || members.has(e.to)).sort((a, b) => b.blockNumber - a.blockNumber || b.logIndex - a.logIndex);
    const pct = x => x === null ? '—' : x.toFixed(1) + '%';
    let html = '<div class="wc-head"><div><span class="wc-eyebrow">ETHEREUM · MẪU GIAO DỊCH RIÊNG</span><h2>Nhóm liên kết giao dịch <span>· ' + esc(m.token.symbol) + '</span></h2><p>Các địa chỉ có chuyển token trực tiếp; nhận và gửi qua biên nhóm.</p></div><span class="wc-badge">Mẫu đã lưu · ' + m.asOf.timestamp.slice(0, 10) + '</span></div>';
    html += '<div class="wc-toolbar"><label>Token · đúng hợp đồng<select data-wc-token>' + state.tokens.map(t => '<option value="' + t.address + '"' + (t.address === m.token.address ? ' selected' : '') + '>' + esc(t.symbol + ' · ' + short(t.address)) + '</option>').join('') + '</select></label><div class="wc-switch" aria-label="Cửa sổ lọc receipt">' + [1, 7, 30].map(d => '<button type="button" data-wc-days="' + d + '" aria-pressed="' + (d === m.days) + '">' + d + 'D</button>').join('') + '</div><label>Nhóm quan sát<select data-wc-group><option value="all">Toàn bộ nhóm · ' + m.groups.length + '</option>' + m.groups.map(g => '<option value="' + g.id + '"' + (g.id === state.group ? ' selected' : '') + '>Nhóm ' + g.index + ' · ' + g.members.length + ' địa chỉ</option>').join('') + '</select></label><div class="wc-switch wc-view-switch"><button type="button" data-wc-view="flow" aria-pressed="' + (state.tab === 'flow') + '">Dòng chuyển</button><button type="button" data-wc-view="network" aria-pressed="' + (state.tab === 'network') + '">Đồ thị liên kết</button></div></div>';
    html += '<div class="wc-scope"><strong>' + m.receiptCount + ' receipt · ' + m.edges.length + ' Transfer · ' + m.linkedGroupCount + ' nhóm có ≥2 địa chỉ · ' + m.singletonCount + ' địa chỉ đơn</strong><span>Mẫu thiên về các lệnh mua lớn, chỉ có quan sát ở ' + m.observedDays + ' ngày trong cửa sổ. Không đại diện tổng dòng ' + m.days + ' ngày hay hành vi phối hợp.</span></div>';
    html += '<div class="wc-legend"><span><i class="wc-legend-in"></i>Nhận qua biên</span><span><i class="wc-legend-out"></i>Gửi qua biên</span><span><i class="wc-legend-internal"></i>Chuyển nội bộ triệt tiêu</span><span class="wc-muted">Đơn vị: ' + esc(m.token.symbol) + '</span></div>';
    html += state.tab === 'network' ? networkChart(m, state.group) : flowChart(m, state.group);
    html += '<div class="wc-balance"><div class="wc-balance-title"><strong>CÂN BẰNG DÒNG CHUYỂN ĐÃ QUAN SÁT</strong><span>Ròng <b class="' + (BigInt(flow.netRaw) < 0n ? 'wc-red' : 'wc-green') + '">' + esc(signed(flow.netRaw, m.token.decimals)) + ' ' + esc(m.token.symbol) + '</b></span></div><div class="wc-share' + (flow.inflowSharePct === null ? ' wc-share-empty' : '') + '">' + (flow.inflowSharePct === null ? '<span class="wc-no-share">Chưa có chuyển qua biên trong mẫu</span>' : '<svg viewBox="0 0 100 8" preserveAspectRatio="none" role="img" aria-label="Tỷ trọng nhận ' + pct(flow.inflowSharePct) + ', gửi ' + pct(flow.outflowSharePct) + '"><rect x="0" y="0" width="100" height="8" fill="#f05a82"/><rect x="0" y="0" width="' + flow.inflowSharePct + '" height="8" fill="#15c99a"/></svg>') + '</div><div class="wc-kpis"><article><span>NHẬN QUA BIÊN</span><strong class="wc-green">' + esc(formatRaw(flow.inflowRaw, m.token.decimals)) + '</strong><small>' + pct(flow.inflowSharePct) + ' tổng nhận + gửi quan sát</small></article><article><span>GỬI QUA BIÊN</span><strong class="wc-red">' + esc(formatRaw(flow.outflowRaw, m.token.decimals)) + '</strong><small>' + pct(flow.outflowSharePct) + ' tổng nhận + gửi quan sát</small></article><article><span>CHÊNH LỆCH TỶ TRỌNG</span><strong>' + pct(flow.spreadPct) + '</strong><small>(Nhận − gửi) ÷ (nhận + gửi)</small></article><article><span>CHUYỂN NỘI BỘ</span><strong>' + flow.internalTransferCount + ' <em>Transfer</em></strong><small>Không cộng vào nhận/gửi qua biên</small></article></div></div>';
    html += '<p class="wc-note">' + date(m.start) + ' &lt; thời gian receipt ≤ ' + date(m.end) + '. Khoảng tô xám: không có receipt trong mẫu, chưa biết tổng dòng thực tế. Chuyển token không tự xác định mua, bán, cá mập hoặc token còn giữ.</p>';
    html += '<details class="wc-evidence"><summary>Mở bằng chứng · địa chỉ, lượng chính xác và giao dịch</summary><p>Hợp đồng ' + link('https://etherscan.io/token/' + m.token.address, m.token.address) + ' · decimals ' + m.token.decimals + '. Mọi lượng được cộng bằng số nguyên raw trước khi hiển thị.</p><div class="wc-table-wrap"><table><thead><tr><th>Thời gian / receipt</th><th>Từ → đến</th><th>Lượng ' + esc(m.token.symbol) + '</th><th>Vai trò trong nhóm đang xem</th></tr></thead><tbody>' + edges.map(e => '<tr><td>' + date(e.timestamp) + '<br>' + link('https://etherscan.io/tx/' + e.txHash + '#eventlog', short(e.txHash) + ' · log ' + e.logIndex) + '</td><td><code>' + esc(e.from) + '</code><br>→ <code>' + esc(e.to) + '</code></td><td><span>' + esc(formatRaw(e.amountRaw, m.token.decimals, true)) + '</span><br><small>raw ' + e.amountRaw + '</small></td><td>' + (members.has(e.from) && members.has(e.to) ? 'Nội bộ · ròng 0' : members.has(e.to) ? 'Nhận qua biên' : 'Gửi qua biên') + '<br><details><summary>SHA-256 nguồn</summary><code>' + e.sourceSha256 + '</code></details></td></tr>').join('') + '</tbody></table></div></details>';
    html += '<details class="wc-method"><summary>Cách tạo nhóm và giới hạn dữ liệu</summary><p>Nhóm là thành phần liên thông từ các Transfer dương của đúng chain + hợp đồng trong cửa sổ được chọn. Chỉ địa chỉ pool đã xác minh và địa chỉ zero bị loại khỏi bước nối nhóm; contract chưa rõ vai trò vẫn hiện là chưa phân loại. Cùng router có thể nối nhiều địa chỉ độc lập, vì vậy nhóm này không xác nhận chung chủ hay phối hợp.</p><p>Chuyển nội bộ được loại khỏi tổng qua biên. Tỷ trọng chỉ là tỷ lệ nhận/gửi trong receipt đã lưu, không phải chỉ số Clustering Wallets của A1. Chưa có đường giá vì chưa gắn nguồn giá cùng định danh và thời điểm.</p><p>Nguồn gốc: ' + esc(m.selection) + '</p><p>Block finalized ' + m.asOf.number + ' · <code>' + m.asOf.hash + '</code><br>SHA-256 snapshot <code>' + m.snapshotSha256 + '</code></p></details>';
    return html;
  }
  function mount(host, { chain, inventory }) {
    assert(host && typeof host.addEventListener === 'function', 'Missing wallet cohorts host');
    let prepared;
    try { prepared = prepare(chain, inventory); }
    catch (e) { host.classList.add('wallet-cohorts'); host.innerHTML = '<div class="wc-empty"><strong>Chưa xác minh được bằng chứng chuyển token</strong><p>' + esc(e.message) + '</p></div>'; return { error: e }; }
    const state = { tokens: prepared.tokens, tokenAddress: prepared.tokens[0]?.address, days: 1, group: 'all', tab: 'flow' };
    host.classList.add('wallet-cohorts');
    function render() { const m = model(prepared, state); if (state.group !== 'all' && !m.groups.some(g => g.id === state.group)) state.group = 'all'; host.innerHTML = view(m, state); }
    function click(e) {
      const days = e.target.closest('[data-wc-days]'), tab = e.target.closest('[data-wc-view]');
      if (days) { state.days = Number(days.dataset.wcDays); state.group = 'all'; render(); }
      else if (tab) { state.tab = tab.dataset.wcView; render(); }
    }
    function change(e) {
      if (e.target.matches('[data-wc-token]')) { state.tokenAddress = e.target.value; state.group = 'all'; render(); }
      else if (e.target.matches('[data-wc-group]')) { state.group = e.target.value; render(); }
    }
    host.addEventListener('click', click); host.addEventListener('change', change); render();
    return { getModel: () => model(prepared, state), update(next) { prepared = prepare(next.chain, next.inventory); state.tokens = prepared.tokens; if (!state.tokens.some(t => t.address === state.tokenAddress)) state.tokenAddress = state.tokens[0]?.address; state.group = 'all'; render(); }, destroy() { host.removeEventListener('click', click); host.removeEventListener('change', change); } };
  }
  return { prepare, model, components, boundaryFlow, timeline, formatRaw, flowChart, networkChart, view, mount };
}));
