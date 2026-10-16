/* Descriptive public observations. No address is classified as a beneficial owner. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.FlowOnchainView = api; api.init(); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number = (x, places = 2) => Number(x).toLocaleString('en-US', { maximumFractionDigits: places });
  const date = x => new Date(x).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC').replace('Z', ' UTC');
  const short = a => a.slice(0, 9) + '…' + a.slice(-7);
  const usd = x => (x < 0 ? '−' : '') + '$' + number(Math.abs(x));
  const link = (url, text) => {try {const u = new URL(url); if (u.protocol !== 'https:' || u.username || u.password) return esc(text); return '<a href="' + esc(u.href) + '" target="_blank" rel="noopener noreferrer">' + esc(text) + ' ↗</a>';} catch (_) {return esc(text);}};
  const signedRaw = (x, decimals, H) => x === null ? 'Thiếu quan sát' : (BigInt(x) > 0n ? '+' : BigInt(x) < 0n ? '−' : '') + H.formatRaw(x.replace(/^-/, ''), decimals, {maxFraction: decimals});
  const address = a => '<code class="wallet-address" title="' + esc(a) + '">' + esc(a) + '</code>';
  const percent = x => x === null ? '—' : number(x, 6) + '%';
  function svg(content, width, height, label) {
    return '<svg class="chart-svg onchain-svg" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="' + esc(label) + '">' + content + '</svg>';
  }
  function distributionChart(token, H) {
    const groups = H.distribution(token), width = 700, left = 102, right = 112, plot = width - left - right;
    let out = [0, 25, 50, 75, 100].map(p => '<line class="chart-grid" x1="' + (left + plot * p / 100) + '" x2="' + (left + plot * p / 100) + '" y1="25" y2="237"/><text x="' + (left + plot * p / 100) + '" y="259" text-anchor="middle">' + p + '%</text>').join('');
    groups.forEach((g, i) => {
      const y = 38 + i * 40, p = g.supplySharePct;
      out += '<text x="88" y="' + (y + 17) + '" text-anchor="end">' + g.label + '</text><rect class="holder-track" x="' + left + '" y="' + y + '" width="' + plot + '" height="24" rx="3"/>';
      if (p !== null) out += '<rect class="holder-bar" x="' + left + '" y="' + y + '" width="' + (plot * p / 100) + '" height="24" rx="3"><title>Hạng ' + g.label + ': ' + esc(H.formatRaw(g.balanceRaw, token.decimals, {maxFraction: token.decimals})) + ' ' + esc(token.symbol) + '; ' + percent(p) + ' tổng cung nguồn</title></rect>';
      out += '<text class="onchain-value" x="' + (width - 8) + '" y="' + (y + 17) + '" text-anchor="end">' + percent(p) + '</text>';
    });
    return svg(out, width, 275, token.symbol + ': phân bố số dư theo nhóm thứ hạng tại lần đọc, phần trăm tổng cung do nguồn báo cáo');
  }
  function comparison(snapshot, token, H) {
    const previous = (snapshot.observations || []).filter(t => t.id === token.id && t.fetchedAt < token.fetchedAt).sort((a, b) => b.rows.length - a.rows.length || a.fetchedAt - b.fetchedAt)[0];
    return previous ? { previous, result: H.compare(previous, token) } : null;
  }
  function deltaChart(c, token, H) {
    if (!c) return '<div class="chart-empty"><strong>Chưa có mốc trước để so</strong><p>Đã có số dư hiện tại. Cần lần đọc khác của đúng token.</p></div>';
    const groups = c.result.groups, vals = groups.filter(g => g.deltaRaw !== null).map(g => Math.abs(Number(g.deltaRaw) / 10 ** token.decimals));
    const max = Math.max(...vals, 0), center = 265, scale = max ? 145 / max : 0;
    let out = '<line class="chart-zero" x1="' + center + '" x2="' + center + '" y1="23" y2="235"/><text x="' + center + '" y="259" text-anchor="middle">0 ' + esc(token.symbol) + '</text>';
    groups.forEach((g, i) => {
      const y = 38 + i * 40, delta = g.deltaRaw === null ? null : Number(g.deltaRaw) / 10 ** token.decimals;
      out += '<text x="88" y="' + (y + 17) + '" text-anchor="end">' + g.label + '</text>';
      if (delta !== null && delta !== 0) out += '<rect class="' + (delta > 0 ? 'holder-bar' : 'holder-negative') + '" x="' + (delta > 0 ? center : center + delta * scale) + '" y="' + y + '" width="' + Math.abs(delta * scale) + '" height="24" rx="3"><title>' + esc(signedRaw(g.deltaRaw, token.decimals, H)) + ' ' + esc(token.symbol) + '; cùng ' + g.coveredCount + ' địa chỉ gốc</title></rect>';
      out += '<text class="onchain-value" x="692" y="' + (y + 17) + '" text-anchor="end">' + esc(g.deltaRaw === null ? 'Thiếu · ' + g.coveredCount + '/' + g.expectedCount : signedRaw(g.deltaRaw, token.decimals, H) + ' ' + token.symbol) + '</text>';
    });
    return svg(out, 700, 275, 'Thay đổi số dư cùng nhóm địa chỉ, cố định theo hạng ở lần đọc trước; thiếu không phải bằng không');
  }
  function changedOwners(previous, token) {
    const next = new Map(token.rows.map(r => [r.owner, r]));
    return previous.rows.filter(r => next.has(r.owner) && r.balanceRaw !== next.get(r.owner).balanceRaw).map(r => ({...r, next: next.get(r.owner), deltaRaw: (BigInt(next.get(r.owner).balanceRaw) - BigInt(r.balanceRaw)).toString()}));
  }
  function holderDetails(token, snapshot, H) {
    const groups = H.distribution(token), total = token.rows.reduce((n, r) => n + BigInt(r.balanceRaw), 0n).toString(), c = comparison(snapshot, token, H);
    let html = '<div class="onchain-stats"><div><span>ĐỊA CHỈ ĐƯỢC ĐỌC</span><strong>' + number(token.rows.length, 0) + ' <small>/ ' + number(token.holderCountReported, 0) + '</small></strong><p>Tổng địa chỉ giữ token do nguồn báo cáo</p></div><div><span>TỶ TRỌNG CỦA TOP ĐÃ ĐỌC</span><strong>' + percent(H.sharePercent(total, token.totalSupplyRaw)) + '</strong><p>Trong tổng cung, gồm ví lưu ký và contract</p></div><div><span>LẦN NHẬN DỮ LIỆU</span><strong class="onchain-time">' + date(token.fetchedAt) + '</strong><p>Bản quan sát TonAPI · không có block chung</p></div></div>';
    html += '<div class="onchain-chart-grid"><div><h3>Phân bố theo hạng số dư</h3><p class="small">% tổng cung do nguồn báo cáo · tại lần đọc này</p>' + distributionChart(token, H) + '</div><div><h3>Thay đổi của cùng nhóm địa chỉ</h3><p class="small">' + (c ? date(c.previous.fetchedAt) + ' → ' + date(token.fetchedAt) : 'Chưa đủ hai lần đọc') + '</p>' + deltaChart(c, token, H) + '</div></div>';
    html += '<p class="chart-note">Các nhóm 1–100 / 101–200 / 201–300 / 301–500 / 501–1.000 là thứ hạng địa chỉ tài khoản, không phải nhóm người cùng chủ. Phân bố hiện tại dùng hạng ở lần đọc này; thay đổi cố định nhóm theo hạng ở lần đọc trước. Chưa loại địa chỉ sàn, DEX, dự án hoặc khóa token.</p>';
    if (c) {
      const changes = changedOwners(c.previous, token);
      html += '<div class="observation-note"><strong>Đối chiếu hai lần đọc thật · ' + number((token.fetchedAt - c.previous.fetchedAt) / 60000, 2) + ' phút</strong><p>Quan sát trước có ' + c.previous.rows.length + ' địa chỉ. ' + changes.length + ' địa chỉ có số dư thay đổi trong phần giao nhau. Chưa có chuỗi ngày / tuần / tháng; dữ liệu thiếu giữ nguyên là thiếu.</p>';
      if (changes.length > 25) html += '<p class="small">Hiển thị 25/' + changes.length + ' địa chỉ thay đổi theo thứ hạng gốc; các tổng nhóm vẫn dùng toàn bộ địa chỉ quan sát được.</p>';
      if (changes.length) html += '<div class="table-scroll"><table><thead><tr><th>Hạng gốc / nhãn nguồn</th><th>Địa chỉ tài khoản</th><th>Thay đổi ' + esc(token.symbol) + '</th></tr></thead><tbody>' + changes.slice(0, 25).map(r => '<tr><td>#' + r.sourceRank + ' · ' + esc(r.providerLabel || 'Chưa có nhãn') + '</td><td>' + address(r.owner) + '</td><td>' + esc(signedRaw(r.deltaRaw, token.decimals, H)) + '</td></tr>').join('') + '</tbody></table></div>';
      html += '<p class="small">Nhãn do TonAPI cung cấp. Thay đổi số dư lưu giữ có thể đến từ chuyển nội bộ, thanh khoản hoặc nhiều hoạt động khác; chưa xác định mua/bán hay chủ sở hữu hưởng lợi.</p></div>';
    }
    html += '<details class="source-proof"><summary>Hợp đồng, nguồn và số dư từng nhóm</summary><p class="small">TON mainnet · master ' + address(token.master) + ' · decimals ' + token.decimals + '</p><p class="small">Tổng cung nguồn: ' + esc(H.formatRaw(token.totalSupplyRaw, token.decimals, {maxFraction: token.decimals})) + ' ' + esc(token.symbol) + '. Thu thập ' + date(token.startedAt) + ' → ' + date(token.fetchedAt) + '. Các API trả trạng thái indexer gần nhất, không bảo đảm cùng một block.</p><p>' + link(token.identityUrl, 'Nguồn đối chiếu định danh') + ' · ' + link('https://docs.tonconsole.com/tonapi/rest-api/jettons/', 'TonAPI Jettons') + '</p><div class="table-scroll"><table><thead><tr><th>Hạng</th><th>Đã đọc / nhóm</th><th>Số dư ' + esc(token.symbol) + '</th><th>% tổng cung</th></tr></thead><tbody>' + groups.map(g => '<tr><td>' + g.label + '</td><td>' + g.count + '/' + g.expectedCount + '</td><td>' + esc(H.formatRaw(g.balanceRaw, token.decimals, {maxFraction: token.decimals})) + '</td><td>' + percent(g.supplySharePct) + '</td></tr>').join('') + '</tbody></table></div>' + token.provenance.map(p => '<p class="small proof-line">' + link(p.url, p.id) + ' · ' + date(p.fetchedAt) + '<br>SHA-256 <code>' + p.sha256 + '</code></p>').join('') + '</details>';
    return html;
  }
  function holderTable(token, H, {search = '', group = 'all', page = 0, pageSize = 10} = {}) {
    const range = group === 'all' ? null : H.distribution(token).find(g => g.label === group), q = search.trim().toLowerCase();
    const rows = token.rows.filter(r => (!range || r.sourceRank >= range.rankStart && r.sourceRank <= range.rankEnd) && (!q || [r.owner, r.jettonWallet, r.providerLabel || ''].some(v => v.toLowerCase().includes(q))));
    const pages = Math.max(1, Math.ceil(rows.length / pageSize)); page = Math.max(0, Math.min(page, pages - 1));
    return {page, pages, count: rows.length, html: rows.length ? '<div class="table-scroll"><table class="holders-table"><thead><tr><th>Hạng / tài khoản chủ</th><th>Nhãn nguồn</th><th>Số dư ' + esc(token.symbol) + '</th><th>% tổng cung</th><th>Giao diện ví*</th></tr></thead><tbody>' + rows.slice(page * pageSize, (page + 1) * pageSize).map(r => '<tr><td><strong>#' + r.sourceRank + '</strong><details><summary><code>' + esc(short(r.owner)) + '</code> · xem địa chỉ</summary><p>Tài khoản chủ<br>' + address(r.owner) + '</p><p>Jetton wallet contract<br>' + address(r.jettonWallet) + '</p></details></td><td>' + esc(r.providerLabel || 'Chưa có nhãn') + '</td><td title="raw=' + r.balanceRaw + '; decimals=' + token.decimals + '">' + esc(H.formatRaw(r.balanceRaw, token.decimals, {maxFraction: token.decimals})) + '</td><td>' + percent(H.sharePercent(r.balanceRaw, token.totalSupplyRaw)) + '</td><td>' + (r.isWallet ? 'Có' : 'Không') + '</td></tr>').join('') + '</tbody></table></div>' : '<div class="chart-empty">Không có địa chỉ khớp bộ lọc.</div>'};
  }
  function dexChart(snapshot, D) {
    const buckets = D.aggregateBuckets(snapshot, 5), width = 1000, height = 275, left = 85, plot = 895, center = 125;
    const start = buckets[0].start, end = buckets.at(-1).start + 300000, max = Math.max(...buckets.map(b => Math.abs(b.deltaUsd)), 1), sx = t => left + (t - start) / (end - start) * plot;
    let html = [-1, 0, 1].map(n => '<line class="' + (n === 0 ? 'chart-zero' : 'chart-grid') + '" x1="' + left + '" x2="980" y1="' + (center - n * 85) + '" y2="' + (center - n * 85) + '"/><text x="73" y="' + (center - n * 85 + 4) + '" text-anchor="end">' + esc(usd(n * max)) + '</text>').join('');
    buckets.forEach(b => { const h = Math.abs(b.deltaUsd) / max * 85, x = sx(b.start) + 2, w = Math.max(1, sx(b.start + 300000) - sx(b.start) - 4); html += '<rect class="' + (b.deltaUsd >= 0 ? 'holder-bar' : 'holder-negative') + '" x="' + x + '" y="' + (b.deltaUsd >= 0 ? center - h : center) + '" width="' + w + '" height="' + h + '"><title>' + date(b.start) + ' · ' + b.count + ' swaps trong mẫu · mua ' + usd(b.buyUsd) + ' · bán ' + usd(b.sellUsd) + ' · chênh lệch ' + usd(b.deltaUsd) + '</title></rect>'; });
    [start, Math.floor((start + end) / 600000) * 300000, end].forEach(t => { html += '<text x="' + sx(t) + '" y="239" text-anchor="' + (t === end ? 'end' : t === start ? 'start' : 'middle') + '">' + new Date(t).toISOString().slice(11, 16) + ' UTC</text>'; });
    return svg(html, width, height, 'Chênh lệch giá trị USD ước tính của swap mua trừ bán WETH theo nhóm 5 phút trong mẫu được trả về, không phải toàn bộ giao dịch');
  }
  function dexDetails(s, D) {
    const c = s.coverage, b = s.finalizedBlock, base = s.pool.baseToken, quote = s.pool.quoteToken;
    let html = '<div class="onchain-stats"><div><span>SWAP TRONG MẪU</span><strong>' + c.returnedCount + ' <small>/ ' + number(c.reported24hBuys + c.reported24hSells, 0) + ' nguồn báo 24H</small></strong><p>' + c.observedUniqueSenders + ' địa chỉ gửi · chỉ một pool</p></div><div><span>CHÊNH LỆCH MUA − BÁN TRONG MẪU</span><strong class="' + (s.sampleTotals.netBuyUsd >= 0 ? 'positive' : 'negative') + '">' + usd(s.sampleTotals.netBuyUsd) + '</strong><p>Giá trị quy đổi USD ước tính của nhà cung cấp</p></div><div><span>BLOCK ĐỐI CHIẾU SỐ DƯ</span><strong>' + number(b.number, 0) + '</strong><p>Finalized · ' + date(b.timestamp) + '</p></div></div>';
    html += '<h3>Swap WETH mua − bán trong mẫu · mỗi 5 phút</h3><p class="small">' + date(c.firstTradeAt) + ' → ' + date(c.lastTradeAt) + ' · dữ liệu nhận ' + date(s.sources.trades.fetchedAt) + '</p>' + dexChart(s, D) + '<p class="chart-note">API trả tối đa 300 giao dịch gần nhất trong 24 giờ. Biểu đồ dùng đúng mẫu trả về, gồm ' + c.eligibleFinalizedCount + ' swap có block ≤ block finalized và ' + (c.returnedCount - c.eligibleFinalizedCount) + ' swap sau block đó. Hai cột biên có thể thiếu giao dịch; không suy ra dòng mua ròng 24H hoặc toàn Ethereum.</p>';
    html += '<h3>Đối chiếu số dư của ' + c.checkedSenderCount + ' địa chỉ gửi</h3><p class="small">Chọn theo giao dịch có giá trị USD lớn nhất của từng địa chỉ trong phần mẫu đã finalized. Cột mua − bán chỉ cộng swap có block ≤ ' + b.number + '. Số dư đọc từ balanceOf tại đúng block này; không phải số token còn giữ từ các lệnh đã mua.</p><div class="table-scroll"><table><thead><tr><th>Địa chỉ gửi giao dịch</th><th>Swap đã finalized</th><th>Mua − bán ước tính</th><th>Số dư WETH tại block</th><th>Số dư USDC tại block</th><th>Có mã contract*</th></tr></thead><tbody>' + s.senders.map(r => '<tr><td><details><summary><code>' + esc(short(r.address)) + '</code></summary>' + address(r.address) + '<p>' + link('https://etherscan.io/address/' + r.address, 'Xem địa chỉ') + '</p></details></td><td>' + r.finalizedTradeCount + '</td><td>' + usd(r.netFinalizedBuyUsd) + '</td><td title="raw=' + esc(r.balanceBaseRaw) + '">' + (r.balanceBaseRaw === null ? 'Thiếu' : D.formatToken(r.balanceBaseRaw, base.decimals, base.decimals)) + '</td><td title="raw=' + esc(r.balanceQuoteRaw) + '">' + (r.balanceQuoteRaw === null ? 'Thiếu' : D.formatToken(r.balanceQuoteRaw, quote.decimals, quote.decimals)) + '</td><td>' + (r.hasCode === null ? 'Chưa đọc được' : r.hasCode ? 'Có' : 'Không') + '</td></tr>').join('') + '</tbody></table></div><p class="small">*eth_getCode tại block này. Không có mã contract không xác định người dùng, cá mập hoặc chủ sở hữu hưởng lợi.</p>';
    const e = s.routingExample;
    if (e) html += '<div class="observation-note"><strong>Một lệnh mua thực tế: người gửi khác nơi nhận token</strong><p>Receipt ghi nhận chuyển ' + D.formatToken(e.baseTransferRaw, base.decimals, base.decimals) + ' WETH tới ' + address(e.recipient) + ', khác sender ' + address(e.sender) + '.</p><p>Số dư recipient ở block ngay trước giao dịch: ' + D.formatToken(e.recipientBalanceBeforeRaw, base.decimals, base.decimals) + ' WETH; ở block finalized: ' + D.formatToken(e.recipientBalanceFinalizedRaw, base.decimals, base.decimals) + ' WETH. Hai mốc không chứng minh giữ lại lượng đã mua hoặc cùng chủ sở hữu.</p><p>' + link('https://etherscan.io/tx/' + e.txHash, 'Mở giao dịch và token transfers') + '</p></div>';
    html += '<details class="source-proof"><summary>Pool, hợp đồng và bằng chứng nguồn</summary><p>' + link(s.pool.url, 'Uniswap v3 · ' + s.pool.name) + '</p><p class="small">Pool ' + address(s.pool.address) + '<br>WETH ' + address(base.address) + ' · decimals ' + base.decimals + '<br>USDC ' + address(quote.address) + ' · decimals ' + quote.decimals + '<br>Block hash ' + address(b.hash) + '</p><p class="small">Hash của block được đọc trước và sau loạt truy vấn số dư, không đổi. Nhận dạng token theo chain + contract; không ghép với token cùng ticker trên sàn. Các số dư này không tạo thành lịch sử ví hoặc giá vốn.</p>' + ['trades', 'pool', 'catalog', 'tokenIdentity', 'blockBefore', 'blockAfter'].map(k => {const p = s.sources[k]; return '<p class="small proof-line">' + link(p.url, k) + ' · ' + date(p.fetchedAt) + '<br>SHA-256 <code>' + p.sha256 + '</code></p>';}).join('') + '</details>';
    return html;
  }
  function init() {
    const $ = id => document.getElementById(id), H = globalThis.FlowHolders, D = globalThis.FlowDexEvidence;
    if (!$('holders-body') || !H || !D) return;
    const state = {snapshot: null, tokenId: 'ston', page: 0, busy: false};
    if (location.hash === '#onchain') document.querySelector('[data-panel="onchain"]')?.click();
    const token = () => state.snapshot.tokens.find(t => t.id === state.tokenId);
    function renderTable() { const result = holderTable(token(), H, {page: state.page, search: $('holder-search').value, group: $('holder-group').value}); state.page = result.page; $('holders-table').innerHTML = result.html; $('holder-page').textContent = number(result.count, 0) + ' địa chỉ khớp · Trang ' + (result.page + 1) + '/' + result.pages; $('holder-prev').disabled = result.page === 0; $('holder-next').disabled = result.page + 1 >= result.pages; }
    function render() {
      $('holders-body').innerHTML = holderDetails(token(), state.snapshot, H);
      document.querySelectorAll('[data-holder-token]').forEach(b => { const selected = b.dataset.holderToken === state.tokenId; b.classList.toggle('selected', selected); b.setAttribute('aria-pressed', selected); b.disabled = state.busy || !state.snapshot.tokens.some(t => t.id === b.dataset.holderToken); });
      $('holder-controls').hidden = false; $('holder-refresh').disabled = state.busy; renderTable();
    }
    $('holder-tokens').addEventListener('click', e => { const b = e.target.closest('[data-holder-token]'); if (!b || b.disabled || !state.snapshot) return; state.tokenId = b.dataset.holderToken; state.page = 0; $('holder-group').value = 'all'; $('holder-search').value = ''; render(); $('holder-status').textContent = 'Đang xem bản quan sát ' + date(token().fetchedAt) + '. Cập nhật chỉ đọc token đang chọn.'; });
    $('holder-search').addEventListener('input', () => {if (state.snapshot) {state.page = 0; renderTable();}});
    $('holder-group').addEventListener('change', () => {if (state.snapshot) {state.page = 0; renderTable();}});
    $('holder-prev').addEventListener('click', () => {state.page--; renderTable();}); $('holder-next').addEventListener('click', () => {state.page++; renderTable();});
    $('holder-refresh').addEventListener('click', async () => {
      if (!state.snapshot || state.busy) return; state.busy = true; render(); $('holder-status').textContent = 'Đang đọc lại thông tin và top 1.000 địa chỉ của ' + token().symbol + ' từ TonAPI; hai yêu cầu cách nhau ít nhất 5 giây…';
      try {state.snapshot = await H.refresh(state.snapshot, state.tokenId); state.page = 0; $('holder-status').textContent = 'Đã cập nhật ' + token().symbol + ' lúc ' + date(token().fetchedAt) + '. Các lần đọc mới chỉ giữ trong phiên trang hiện tại.';}
      catch (e) {$('holder-status').textContent = 'Chưa đọc được mới: ' + e.message + ' Đang giữ bản quan sát ' + date(token().fetchedAt) + '.';}
      finally {state.busy = false; render();}
    });
    Promise.allSettled([
      H.loadSnapshot().then(s => { state.snapshot = s; render(); $('holder-status').textContent = 'Đã kiểm tra cấu trúc bản quan sát · ' + s.tokens.length + ' token TON · ' + number(s.tokens.reduce((n, t) => n + t.rows.length, 0), 0) + ' dòng token/địa chỉ. Thời điểm hiển thị là thời gian nhận nguồn, không phải giá trực tiếp.'; $('wallet-scope').textContent = s.tokens.length + ' token TON'; }),
      D.loadSnapshot('./data/dex-evidence-snapshot.json').then(s => {$('dex-body').innerHTML = dexDetails(s, D); $('dex-status').textContent = 'Bản quan sát có nguồn · ' + date(s.sources.trades.fetchedAt) + (s.freshness.isStale ? ' · Đã quá 15 phút, không phải dữ liệu trực tiếp.' : '') + ' · Ethereum / một pool Uniswap v3.';})
    ]).then(results => {if (results[0].status === 'rejected') {$('holder-status').textContent = 'Không đọc được bản số dư: ' + results[0].reason.message; $('holders-body').innerHTML = '<div class="chart-empty">Chưa có bản số dư hợp lệ.</div>';} if (results[1].status === 'rejected') {$('dex-status').textContent = 'Không đọc được bằng chứng DEX: ' + results[1].reason.message; $('dex-body').innerHTML = '<div class="chart-empty">Chưa có mẫu DEX hợp lệ.</div>';}});
  }
  return {distributionChart, comparison, deltaChart, changedOwners, holderDetails, holderTable, dexChart, dexDetails, init};
});
