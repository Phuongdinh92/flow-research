/* Flow Research: measured Binance taker share, not a proprietary accumulation score.
 * CoinGecko joins require provider-returned exchange ticker coin_id, retained raw
 * identity pages, source-bound market rows, and upstream SHA-256 validation. */
(function (root, factory) {
  'use strict';
  const api = factory(typeof module === 'object' && module.exports ? require('./trading-volume.js') : root.FlowTradingVolume);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.FlowStrengthOverview = api;
})(globalThis, function (Flow) {
  'use strict';
  const PERIODS = Object.freeze([1, 7, 30]);
  const BUCKETS = Object.freeze({all: 'Tất cả', large: '≥ 100 tr', mid: '10–100 tr', low: '1–10 tr', micro: '< 1 tr'});
  const CAP_BUCKETS = Object.freeze({all: 'Tất cả', large: 'Large · ≥ $1B', mid: 'Mid · $100M–1B', low: 'Low · $10–100M', micro: 'Micro · < $10M'});
  const hash = s => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
  const finite = n => typeof n === 'number' && Number.isFinite(n);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const date = n => new Date(n).toISOString().slice(0, 10);
  const amount = (n, signed = false) => Flow.amount(n, {compact: true, signed});
  const pct = n => finite(n) ? (n * 100).toLocaleString('vi-VN', {maximumFractionDigits: 2}) + '%' : '—';
  const hue = s => { let h = 0; for (const ch of s) h = (h * 31 + ch.codePointAt(0)) % 360; return h; };

  function deriveModel(dataset, options = {}) {
    if (!Flow?.derive) throw Error('Chưa nạp bộ kiểm tra dòng khớp lệnh.');
    const frame = Flow.derive(dataset, options);
    const rows = frame.rows.map(row => ({...row, buyShare: row.quoteVolume > 0 ? row.buy / row.quoteVolume : null}));
    const weightedBuyShare = frame.totals.quoteVolume > 0 ? frame.totals.buy / frame.totals.quoteVolume : null;
    return {...frame, rows, weightedBuyShare, plotEligible: rows.filter(row => row.quoteVolume > 0).length,
      topPositive: rows.filter(row => row.net > 0).sort((a, b) => b.net - a.net || a.key.localeCompare(b.key)).slice(0, 10)};
  }

  function safeImage(value) {
    if (typeof value !== 'string') return null;
    try { const u = new URL(value); return u.protocol === 'https:' && ['assets.coingecko.com', 'coin-images.coingecko.com'].includes(u.hostname) && !u.username && !u.password && !u.hash && /^\/(?:coins|coin-images)\/images\/\d+\//.test(u.pathname) ? u.href : null; } catch { return null; }
  }
  function joinIdentity(model, identitySnapshot, marketSnapshot, {now = Date.now()} = {}) {
    const fallback = {...model, rows: model.rows.map(row => ({...row, marketCapUsd: null, imageUrl: null, marketIdentity: null})), identityCoverage: {bound: 0, cap: 0, logos: 0, missing: model.rows.length, excluded: [], times: []}};
    if (!identitySnapshot || !marketSnapshot) return fallback;
    if (identitySnapshot.schemaVersion !== 1 || identitySnapshot.kind !== 'exchange-asset-identity' || identitySnapshot.provider !== 'CoinGecko' || identitySnapshot.exchangeId !== 'binance' || !Array.isArray(identitySnapshot.bindings)) throw Error('Hồ sơ định danh liên nguồn không hợp lệ.');
    if (marketSnapshot.sourceId !== 'coingecko' || marketSnapshot.provider !== 'CoinGecko' || marketSnapshot.currency !== 'USD' || !Array.isArray(marketSnapshot.rows) || !Array.isArray(marketSnapshot.provenance)) throw Error('Chưa có bản CoinGecko kèm nguồn đã kiểm tra.');
    const bindings = new Map(), conflicts = new Set(), excluded = [], markets = new Map(), pages = new Map();
    if (!Array.isArray(identitySnapshot.sourcePages)) throw Error('Thiếu phản hồi gốc của liên kết định danh.');
    for (const p of identitySnapshot.sourcePages) {
      if (p.httpStatus !== 200 || !hash(p.sha256) || !Number.isSafeInteger(p.receivedAt) || typeof p.body !== 'string') throw Error('Chứng từ định danh không hợp lệ.');
      const data = JSON.parse(p.body); if (!Array.isArray(data.tickers)) throw Error('Phản hồi định danh thiếu tickers.');
      pages.set(p.url + '|' + p.sha256, {...p, tickers: data.tickers});
    }
    for (const row of marketSnapshot.rows) {
      if (typeof row?.id !== 'string' || row.sourceId !== 'coingecko' || row.key !== 'coingecko:' + row.id || markets.has(row.id)) throw Error('Trùng hoặc sai định danh CoinGecko.');
      markets.set(row.id, row);
    }
    for (const b of identitySnapshot.bindings) {
      try {
        if (b.sourceId !== 'binance' || b.quote !== 'USDT' || typeof b.base !== 'string' || !b.base || b.instrument !== b.base + 'USDT' || b.key !== 'binance:' + b.instrument || typeof b.coinId !== 'string' || !b.coinId || b.targetCoinId !== 'tether' || !hash(b.sourceSha256) || !Number.isSafeInteger(b.sourceReceivedAt) || b.sourceReceivedAt > now + 60000 || !Number.isSafeInteger(b.sourceIndex) || b.sourceIndex < 0) throw Error('Thiếu định danh cặp hoặc bằng chứng coin_id của nguồn.');
        const url = new URL(b.sourceUrl);
        if (url.origin !== 'https://api.coingecko.com' || url.pathname !== '/api/v3/exchanges/binance/tickers' || url.username || url.password || url.hash || !/^[1-9]\d*$/.test(url.searchParams.get('page') || '')) throw Error('Nguồn định danh không phải ticker Binance từ CoinGecko.');
        const page = pages.get(b.sourceUrl + '|' + b.sourceSha256), raw = page?.tickers[b.sourceIndex];
        if (!page || page.receivedAt !== b.sourceReceivedAt || !raw || raw.base !== b.base || raw.target !== b.quote || raw.market?.identifier !== 'binance' || raw.coin_id !== b.coinId || raw.target_coin_id !== 'tether') throw Error('Liên kết không khớp bản ghi ticker gốc.');
        const previous = bindings.get(b.key);
        if (previous && previous.coinId !== b.coinId) { conflicts.add(b.key); throw Error('Một cặp có nhiều coin_id mâu thuẫn.'); }
        if (!previous) bindings.set(b.key, b);
      } catch (e) { if (b?.key) conflicts.add(b.key); excluded.push({key: b?.key ?? null, reason: e.message}); }
    }
    const times = new Set(); let bound = 0, cap = 0, logos = 0;
    const rows = fallback.rows.map(row => {
      const b = bindings.get(row.key); if (!b || conflicts.has(row.key) || b.base !== row.base || b.instrument !== row.instrument) return row;
      const m = markets.get(b.coinId); if (!m) return row;
      try {
        if (!hash(m.sourceSha256) || !Number.isSafeInteger(m.providerUpdatedAt) || !Number.isSafeInteger(m.receivedAt) || m.providerUpdatedAt > m.receivedAt + 60000 || m.receivedAt > now + 60000 || m.providerUpdatedAt > now + 60000 || m.receivedAt - m.providerUpdatedAt > 900000) throw Error('Giá/vốn hóa thiếu thời điểm hoặc đã cũ ngay lúc nhận.');
        const receipt = marketSnapshot.provenance.find(p => p.sha256 === m.sourceSha256 && p.url === m.sourceUrl && p.receivedAt === m.receivedAt && p.status === 200);
        if (!receipt) throw Error('Dòng vốn hóa không khớp chứng từ nguồn CoinGecko.');
        const url = new URL(m.sourceUrl);
        if (url.origin !== 'https://api.coingecko.com' || url.pathname !== '/api/v3/coins/markets' || url.searchParams.get('vs_currency') !== 'usd' || url.username || url.password || url.hash || (url.searchParams.has('ids') && !url.searchParams.get('ids').split(',').includes(b.coinId))) throw Error('Nguồn vốn hóa không chứa định danh USD yêu cầu.');
        const marketCapUsd = finite(m.marketCapUsd) && m.marketCapUsd > 0 ? m.marketCapUsd : null;
        const p = m.imageSource, image = safeImage(m.imageUrl), imageUrl = image && m.imageIdentityVerified === true && p?.id === b.coinId && p.returnedId === b.coinId && p.returnedImage === image && p.sourceSha256 === m.sourceSha256 && p.sourceUrl === m.sourceUrl && p.receivedAt === m.receivedAt ? image : null;
        bound++; if (marketCapUsd !== null) { cap++; times.add(m.providerUpdatedAt); } if (imageUrl) logos++;
        return {...row, marketCapUsd, imageUrl, marketIdentity: {coinId: b.coinId, name: m.name, providerUpdatedAt: m.providerUpdatedAt, receivedAt: m.receivedAt, sourceUrl: m.sourceUrl, sourceSha256: m.sourceSha256, binding: {...b}}};
      } catch (e) { excluded.push({key: row.key, reason: e.message}); return row; }
    });
    return {...model, rows, topPositive: rows.filter(row => row.net > 0).sort((a, b) => b.net - a.net || a.key.localeCompare(b.key)).slice(0, 10), identityCoverage: {bound, cap, logos, missing: rows.length - bound, excluded, times: [...times].sort((a, b) => a - b)}};
  }

  function selectRows(model, {query = '', bucket = 'all', axis = 'volume', limit = 150, zoomStart = 0, zoomEnd = 100} = {}) {
    if (!['volume', 'cap'].includes(axis) || !BUCKETS[bucket] || ![80, 150, 'all'].includes(limit) || !finite(zoomStart) || !finite(zoomEnd) || zoomStart < 0 || zoomEnd > 100 || zoomEnd <= zoomStart) throw Error('Bộ lọc bản đồ không hợp lệ.');
    const q = String(query).trim().toUpperCase();
    const thresholds = axis === 'cap' ? [1e9, 1e8, 1e7] : [1e8, 1e7, 1e6];
    const inBucket = n => bucket === 'all' || (bucket === 'large' ? n >= thresholds[0] : bucket === 'mid' ? n >= thresholds[1] && n < thresholds[0] : bucket === 'low' ? n >= thresholds[2] && n < thresholds[1] : n < thresholds[2]);
    const value = row => axis === 'cap' ? row.marketCapUsd : row.quoteVolume;
    const matching = model.rows.filter(row => finite(value(row)) && value(row) > 0 && row.quoteVolume > 0 && finite(row.buyShare) && (!q || row.base.toUpperCase().includes(q) || row.instrument.toUpperCase().includes(q)) && inBucket(value(row))).sort((a, b) => value(b) - value(a) || a.key.localeCompare(b.key));
    let minLog = matching.length ? Math.floor(Math.log10(Math.min(...matching.map(value)))) : 0;
    let maxLog = matching.length ? Math.ceil(Math.log10(Math.max(...matching.map(value)))) : 1;
    if (maxLog <= minLog) maxLog = minLog + 1;
    const fullDomain = [minLog, maxLog], span = maxLog - minLog;
    minLog = fullDomain[0] + span * zoomStart / 100;
    maxLog = fullDomain[0] + span * zoomEnd / 100;
    const inZoom = matching.filter(row => Math.log10(value(row)) >= minLog - 1e-12 && Math.log10(value(row)) <= maxLog + 1e-12);
    const rows = limit === 'all' ? inZoom : inZoom.slice(0, limit);
    return {rows, axis, matching: matching.length, inZoom: inZoom.length, omitted: inZoom.length - rows.length, zeroVolume: model.rows.filter(row => row.quoteVolume === 0).length, fullDomain, domain: [minLog, maxLog]};
  }

  function rowTip(row) {
    return row.instrument + ' · Binance Spot / USDT\nTỷ trọng taker mua: ' + pct(row.buyShare) + (row.buyShare === null ? '' : ' (' + row.buyShare + ')') + '\nTổng quote: ' + row.quoteVolume + ' USDT\nTaker mua: ' + row.buy + ' USDT\nTaker bán: ' + row.sell + ' USDT\nNet mua − bán: ' + row.net + ' USDT\n' + date(row.start) + ' → ' + date(row.end) + ' UTC\nNguồn: ' + new Date(row.asOf).toISOString() + '\n' + row.provenance.map(p => p.url + '\nSHA-256 ' + p.sha256).join('\n') + (row.marketIdentity ? '\nVốn hóa CoinGecko: ' + (row.marketCapUsd === null ? 'thiếu' : row.marketCapUsd + ' USD') + '\nCoinGecko ID: ' + row.marketIdentity.coinId + '\nThời điểm vốn hóa: ' + new Date(row.marketIdentity.providerUpdatedAt).toISOString() + '\nNguồn vốn hóa: ' + row.marketIdentity.sourceUrl + '\nSHA-256 vốn hóa: ' + row.marketIdentity.sourceSha256 + '\nBằng chứng định danh: ' + row.marketIdentity.binding.sourceUrl + '\nSHA-256 định danh: ' + row.marketIdentity.binding.sourceSha256 : '');
  }

  function geometry(selection, {view = 'share', width = 1200} = {}) {
    if (!['share', 'net'].includes(view)) throw Error('Cách xem không hợp lệ.');
    const w = Math.max(650, Math.min(2200, Number(width) || 1200)), h = 520;
    const pad = {left: 88, right: 46, top: 54, bottom: 72}, plotW = w - pad.left - pad.right, plotH = h - pad.top - pad.bottom;
    let lower = 0, upper = 1;
    if (view === 'net') {
      lower = Math.min(0, ...selection.rows.map(row => row.net)); upper = Math.max(0, ...selection.rows.map(row => row.net));
      if (upper === lower) { lower = -1; upper = 1; }
      const padding = (upper - lower) * .08; lower -= padding; upper += padding;
    }
    const x = n => pad.left + (Math.log10(n) - selection.domain[0]) / (selection.domain[1] - selection.domain[0]) * plotW;
    const y = n => pad.top + (upper - n) / (upper - lower) * plotH;
    return {width: w, height: h, pad, plotW, plotH, lower, upper, x, y, points: selection.rows.map(row => ({row, x: x(selection.axis === 'cap' ? row.marketCapUsd : row.quoteVolume), y: y(view === 'share' ? row.buyShare : row.net)}))};
  }

  function renderScatter(selection, {view = 'share', width = 1200} = {}) {
    if (!selection.rows.length) return '<div class="so-empty">Không có cặp đủ dữ liệu trong vùng đang chọn. Mở rộng khoảng hoặc xóa bộ lọc.</div>';
    const g = geometry(selection, {view, width});
    const baseline = view === 'share' ? .5 : 0, baseY = g.y(baseline);
    let html = '<svg class="so-scatter" viewBox="0 0 ' + g.width + ' ' + g.height + '" role="group" aria-label="' + (view === 'share' ? 'Tỷ trọng taker mua' : 'Net taker mua trừ bán') + (selection.axis === 'cap' ? ' theo vốn hóa CoinGecko' : ' theo tổng quote Binance') + '"><title>Bản đồ lực mua Binance / USDT</title><desc>Trục X logarit: ' + (selection.axis === 'cap' ? 'vốn hóa CoinGecko bằng USD với định danh coin_id từ nguồn ticker Binance' : 'tổng quote giao dịch trong kỳ bằng USDT') + '. Trục Y ' + (view === 'share' ? 'tỷ trọng taker mua từ 0 đến 1' : 'net taker USDT') + '. Các dấu tròn cùng kích thước; logo có định danh nguồn hoặc chữ viết tắt tài sản. Vị trí giữ nguyên số đo. Bấm hoặc Enter để mở đúng cặp.</desc>';
    html += '<rect class="so-region-buy" x="' + g.pad.left + '" y="' + g.pad.top + '" width="' + g.plotW + '" height="' + (baseY - g.pad.top) + '"/><rect class="so-region-sell" x="' + g.pad.left + '" y="' + baseY + '" width="' + g.plotW + '" height="' + (g.height - g.pad.bottom - baseY) + '"/>';
    const ticks = view === 'share' ? [0, .2, .4, .6, .8, 1] : Array.from({length: 6}, (_, i) => g.lower + (g.upper - g.lower) * i / 5);
    for (const value of ticks) html += '<line class="so-grid" x1="' + g.pad.left + '" x2="' + (g.width - g.pad.right) + '" y1="' + g.y(value) + '" y2="' + g.y(value) + '"/><text class="so-axis" x="' + (g.pad.left - 15) + '" y="' + (g.y(value) + 4) + '" text-anchor="end">' + esc(view === 'share' ? value.toFixed(1) : amount(value)) + '</text>';
    for (let log = Math.ceil(selection.domain[0]); log <= selection.domain[1]; log++) {
      const value = 10 ** log, x = g.x(value);
      html += '<line class="so-grid so-grid-vertical" x1="' + x + '" x2="' + x + '" y1="' + g.pad.top + '" y2="' + (g.height - g.pad.bottom) + '"/><text class="so-axis" x="' + x + '" y="' + (g.height - g.pad.bottom + 27) + '" text-anchor="middle">' + esc((selection.axis === 'cap' ? '$' : '') + amount(value)) + '</text>';
    }
    html += '<line class="so-baseline" x1="' + g.pad.left + '" x2="' + (g.width - g.pad.right) + '" y1="' + baseY + '" y2="' + baseY + '"/><text class="so-axis-label" x="' + g.pad.left + '" y="25">' + (view === 'share' ? 'TỶ TRỌNG TAKER MUA · 0–1' : 'NET MUA − BÁN · USDT') + '</text><text class="so-axis-label" text-anchor="middle" x="' + (g.pad.left + g.plotW / 2) + '" y="' + (g.height - 12) + '">' + (selection.axis === 'cap' ? 'VỐN HÓA · USD · LOGARIT' : 'TỔNG QUOTE TRONG KỲ · USDT · LOGARIT') + '</text>';
    for (const point of [...g.points].reverse()) {
      const row = point.row, ticker = Array.from(row.base), label = ticker.slice(0, ticker.length > 7 ? 6 : 7).join('') + (ticker.length > 7 ? '…' : ''), font = ticker.length <= 3 ? 13 : ticker.length <= 5 ? 10 : 8;
      html += '<g class="so-point ' + (row.net > 0 ? 'so-up' : row.net < 0 ? 'so-down' : 'so-flat') + '" tabindex="0" role="button" data-so-key="' + esc(row.key) + '" aria-label="' + esc(rowTip(row)) + '"><title>' + esc(rowTip(row)) + '</title><circle class="so-halo" cx="' + point.x + '" cy="' + point.y + '" r="26"/><circle class="so-token" fill="hsl(' + hue(row.base) + ' 37% 19%)" cx="' + point.x + '" cy="' + point.y + '" r="22"/><g font-size="' + font + '"><text class="so-symbol" x="' + point.x + '" y="' + (point.y + 4) + '" text-anchor="middle">' + esc(label) + '</text></g>' + (row.imageUrl ? '<image class="so-logo" href="' + esc(row.imageUrl) + '" x="' + (point.x - 20) + '" y="' + (point.y - 20) + '" width="40" height="40" preserveAspectRatio="xMidYMid meet"/>' : '') + '</g>';
    }
    return html + '</svg>';
  }

  function renderTable(rows) {
    if (!rows.length) return '<p class="so-empty">Không có cặp trong bộ lọc.</p>';
    return '<div class="so-table-wrap"><table class="so-table"><thead><tr><th>Cặp Binance / USDT</th><th>Tỷ trọng mua</th><th>Vốn hóa · USD</th><th>Tổng quote · USDT</th><th>Taker mua · USDT</th><th>Taker bán · USDT</th><th>Net · USDT</th></tr></thead><tbody>' + rows.map(row => '<tr><th scope="row"><button type="button" data-so-key="' + esc(row.key) + '" title="' + esc(rowTip(row)) + '">' + esc(row.base) + ' ↗</button></th><td>' + pct(row.buyShare) + '</td><td>' + Flow.amount(row.marketCapUsd) + '</td><td>' + Flow.amount(row.quoteVolume) + '</td><td>' + Flow.amount(row.buy) + '</td><td>' + Flow.amount(row.sell) + '</td><td class="' + (row.net < 0 ? 'so-negative' : 'so-positive') + '">' + Flow.amount(row.net, {signed: true}) + '</td></tr>').join('') + '</tbody></table></div>';
  }

  function mount(host, {dataset = null, marketSnapshot = null, identitySnapshot = null, onOpen = () => ({ok: false, message: 'Chưa nạp biểu đồ token.'}), classify = globalThis.FlowInstrumentClasses?.classify, now = () => Date.now()} = {}) {
    if (!host) return null;
    let result = null, model = null, days = 1, view = 'share', bucket = 'all', axis = 'volume', axisChosen = false, query = '', limit = 150, zoomStart = 0, zoomEnd = 100, error = '', warning = '', observer = null;
    let identity = identitySnapshot, market = marketSnapshot;
    host.classList.add('strength-overview');
    host.innerHTML = '<header class="so-hero"><span class="so-eyebrow"><span aria-hidden="true">⌁</span> FLOW RESEARCH · EXCHANGE INTELLIGENCE</span><div class="so-title-row"><div><h2>Bản đồ lực mua</h2><p>Đặt tỷ trọng mua chủ động cạnh vốn hóa và quy mô giao dịch để tìm nơi lực mua nổi bật.</p></div><span class="so-date" data-so-date>Đang chờ dữ liệu</span></div><p class="so-method">Tỷ trọng taker mua = tổng taker mua ÷ tổng quote. Đây là số đo khớp lệnh Binance; chưa xác định ví mua hay token còn giữ.</p></header><section class="so-leaders"><h3>✧ TOP 10 NET TAKER DƯƠNG · USDT <span data-so-top-period>· 1D</span></h3><div class="so-ticker" data-so-leaders></div></section><div class="so-kpis" data-so-kpis></div><section class="so-panel"><div class="so-panel-heading"><div><h3>Tổng quan lực mua</h3><p data-so-average>Tỷ trọng mua và tổng quote trên cùng cửa sổ UTC.</p></div><div class="so-buttons" aria-label="Cửa sổ dữ liệu">' + PERIODS.map(n => '<button type="button" data-so-days="' + n + '" aria-pressed="' + (n === 1) + '">' + n + 'D</button>').join('') + '</div></div><div class="so-toolbar"><div class="so-buttons" aria-label="Chỉ số trục Y"><button type="button" data-so-view="share" aria-pressed="true">Tỷ trọng mua</button><button type="button" data-so-view="net" aria-pressed="false">Net flow</button></div><div class="so-buttons so-buckets" data-so-buckets aria-label="Nhóm trục X">' + Object.entries(BUCKETS).map(([key, label]) => '<button type="button" data-so-bucket="' + key + '" aria-pressed="' + (key === 'all') + '">' + label + '</button>').join('') + '</div></div><div class="so-filters"><label>Trục X<select data-so-axis><option value="volume">Tổng quote · USDT</option><option value="cap">Vốn hóa · USD</option></select></label><label>Tìm cặp<input type="search" data-so-search placeholder="BTC, ETH, W…" maxlength="80"></label><label>Điểm trên biểu đồ<select data-so-limit><option value="80">80 cặp trục X lớn nhất</option><option value="150" selected>150 cặp trục X lớn nhất</option><option value="all">Toàn bộ cặp khớp</option></select></label><span data-so-count></span></div><div class="so-plot" data-so-plot></div><div class="so-navigator"><label>Khoảng trục X <span data-so-range></span></label><div class="so-range-inputs"><label><span class="so-sr-only">Đầu khoảng trục X trên thang logarit</span><input data-so-from type="range" min="0" max="99" value="0" step="1"></label><label><span class="so-sr-only">Cuối khoảng trục X trên thang logarit</span><input data-so-to type="range" min="1" max="100" value="100" step="1"></label></div><button type="button" data-so-reset>Đặt lại khoảng</button></div><p class="so-inspect" data-so-inspect role="status">Trỏ hoặc Tab vào một cặp để xem số đo; bấm để mở biểu đồ.</p><p class="so-caption" data-so-axis-note></p></section><p class="so-status" data-so-status role="status"></p><details class="so-details"><summary>Bảng số liệu, phạm vi và cách tính</summary><div data-so-proof></div><div data-so-table></div></details>';
    const $ = s => host.querySelector(s);
    function paint() {
      for (const [attr, current] of [['days', days], ['view', view], ['bucket', bucket]]) for (const button of host.querySelectorAll('[data-so-' + attr + ']')) button.setAttribute('aria-pressed', String(String(button.dataset['so' + attr[0].toUpperCase() + attr.slice(1)]) === String(current)));
      $('[data-so-inspect]').textContent = 'Trỏ hoặc Tab vào một cặp để xem số đo; bấm để mở biểu đồ ' + days + 'D.';
      if (!model) {
        $('[data-so-status]').textContent = error ? 'Chưa đọc được dữ liệu: ' + error : 'Đang kiểm tra kho nến Binance đầy đủ; bản mở nhanh BTC không dùng để tính tổng.';
        $('[data-so-date]').textContent = 'Chờ kho nến đầy đủ';
        $('[data-so-plot]').innerHTML = '<div class="so-empty">' + (error ? 'Chưa có dữ liệu hợp lệ để vẽ.' : 'Đang kiểm tra nguồn, thời điểm và mã băm dữ liệu…') + '</div>';
        $('[data-so-kpis]').innerHTML = ''; $('[data-so-leaders]').innerHTML = ''; $('[data-so-table]').innerHTML = ''; $('[data-so-proof]').innerHTML = ''; $('[data-so-count]').textContent = ''; return;
      }
      $('[data-so-buckets]').innerHTML = Object.entries(axis === 'cap' ? CAP_BUCKETS : BUCKETS).map(([key, label]) => '<button type="button" data-so-bucket="' + key + '" aria-pressed="' + (key === bucket) + '">' + label + '</button>').join('');
      $('[data-so-axis]').value = axis;
      const selection = selectRows(model, {query, bucket, axis, limit, zoomStart, zoomEnd}), c = model.coverage;
      $('[data-so-date]').textContent = 'CHỐT DỮ LIỆU · ' + date(model.end) + ' UTC';
      $('[data-so-top-period]').textContent = '· ' + days + 'D';
      $('[data-so-leaders]').innerHTML = model.topPositive.length ? model.topPositive.map((row, i) => '<button class="so-leader" type="button" data-so-key="' + esc(row.key) + '" title="' + esc(rowTip(row)) + '"><span class="so-rank">#' + (i + 1) + '</span><span class="so-monogram" aria-hidden="true">' + (row.imageUrl ? '<img src="' + esc(row.imageUrl) + '" alt="" loading="lazy">' : esc(Array.from(row.base).slice(0, 3).join(''))) + '</span><span><strong>' + esc(row.base) + '</strong><small>Binance · ' + days + 'D</small></span><b>+' + amount(row.net) + '</b></button>').join('') : '<span class="so-empty-leaders">Không có cặp net dương trong kỳ.</span>';
      const card = (label, value, note, cls = '') => '<article><span>' + label + '</span><strong class="' + cls + '">' + value + '</strong><small>' + note + '</small></article>';
      $('[data-so-kpis]').innerHTML = card('CẶP ĐỦ DỮ LIỆU', String(c.eligible), c.scope + ' cặp sau lọc loại tài sản') + card('NET DƯƠNG · ' + days + 'D', String(c.positive), c.negative + ' âm · ' + c.flat + ' bằng 0') + card('TỔNG NET DƯƠNG', amount(model.totals.positiveNet), 'USDT · cộng phần net > 0', 'so-positive') + card('ĐỘ PHỦ CỬA SỔ', c.scope ? pct(c.eligible / c.scope) : '—', c.excluded + ' thiếu / không hợp lệ');
      $('[data-so-average]').textContent = 'Tỷ trọng mua toàn phạm vi: ' + pct(model.weightedBuyShare) + ' · có trọng số theo quote · ' + days + ' ngày đã đóng.';
      $('[data-so-count]').textContent = 'Hiện ' + selection.rows.length + '/' + selection.inZoom + ' cặp trong khoảng · ' + selection.matching + ' cặp khớp bộ lọc' + (selection.omitted ? ' · ' + selection.omitted + ' cặp ngoài giới hạn hiển thị' : '');
      $('[data-so-plot]').innerHTML = renderScatter(selection, {view, width: $('[data-so-plot]').clientWidth || 1200});
      $('[data-so-range]').textContent = amount(10 ** selection.domain[0]) + ' → ' + amount(10 ** selection.domain[1]) + (axis === 'cap' ? ' USD' : ' USDT');
      $('[data-so-from]').value = String(zoomStart); $('[data-so-to]').value = String(zoomEnd);
      $('[data-so-status]').textContent = (warning ? 'Lần đọc mới chưa dùng được: ' + warning + ' · giữ bản đã kiểm tra. ' : '') + 'BẢN NẾN ĐÃ LƯU · ' + date(model.start) + ' → ' + date(model.end) + ' UTC · ' + c.declared + ' cặp gốc, ẩn ' + c.classExcluded + ' bStocks/stablecoin/EUR đã xác minh. ' + (model.end !== Math.floor(now() / Flow.DAY) * Flow.DAY - 1 ? 'Chưa có ngày UTC vừa đóng. ' : '') + 'Các mã còn lại chưa được phân loại đầy đủ.';
      const ic = model.identityCoverage;
      $('[data-so-axis-note]').textContent = (axis === 'cap' ? 'Vốn hóa USD từ CoinGecko: ' + ic.cap + '/' + c.eligible + ' cặp có coin_id và vốn hóa hợp lệ; ' + (c.eligible - ic.cap) + ' thiếu bị loại khỏi trục vốn hóa. ' + (ic.times.length ? 'Thời điểm vốn hóa ' + new Date(ic.times[0]).toISOString() + ' → ' + new Date(ic.times.at(-1)).toISOString() + '; dòng khớp chốt ' + date(model.end) + ' UTC. Hai mốc khác nhau; không dùng ảnh chụp này làm backtest. ' : 'Chưa có dữ liệu vốn hóa gắn đúng định danh. ') : 'Trục X là tổng quote Binance trong kỳ, đơn vị USDT. ') + 'Vòng tròn cùng kích thước, giữ đúng tọa độ; logo chỉ hiện khi nguồn gắn đúng coin_id. Logo và vốn hóa: CoinGecko.';
      $('[data-so-proof]').innerHTML = '<p>Tỷ trọng mua từng cặp = Σ taker buy quote / Σ quote; chỉ tính khi Σ quote > 0. Net = Σ (2 × taker buy quote − quote), đơn vị USDT. Tỷ trọng toàn phạm vi = tổng mua của mọi cặp đủ dữ liệu / tổng quote của các cặp đó, không phải trung bình cộng tỷ trọng từng cặp.</p><p>KPI và Top 10 tính toàn phạm vi đủ dữ liệu; tìm kiếm, nhóm volume và zoom chỉ thay đổi biểu đồ và bảng bên dưới. Nhóm vốn hóa: Large ≥ $1B; Mid $100M–1B; Low $10–100M; Micro < $10M. Đây là ngưỡng của Flow Research. Khi chọn tổng quote, nhóm dùng 100 triệu / 10 triệu / 1 triệu USDT của kỳ ' + days + 'D. ' + selection.zeroVolume + ' cặp quote bằng 0 không có tỷ trọng và không vẽ trên trục logarit.</p><p>Bảng dưới giữ các cặp trong vùng zoom và cả các cặp ngoài giới hạn số điểm. Số liệu được làm tròn khi hiển thị; trỏ từng cặp để xem số lưu. Dữ liệu cùng cửa sổ UTC, thiếu nến/taker bị loại, không điền 0. Danh mục tại lần thu thập chưa bao phủ cặp đã hủy niêm yết.</p><p>SHA-256 kho nến: <code>' + esc(model.archiveSha256) + '</code></p><p><strong>Cặp thiếu / không hợp lệ (' + c.excluded + '):</strong> ' + (model.excluded.map(row => esc(row.instrument) + ' — ' + esc(row.reason)).join('; ') || 'Không có.') + '</p><p><strong>Ẩn theo loại đã xác minh (' + c.classExcluded + '):</strong> ' + model.classExcluded.map(row => esc(row.instrument) + ' · ' + esc(row.reason)).join('; ') + '</p><p><strong>Định danh/vốn hóa bị loại:</strong> ' + (ic.excluded.map(row => esc(row.key) + ' — ' + esc(row.reason)).join('; ') || 'Không có lỗi; các cặp chưa có liên kết hoặc vốn hóa vẫn được ghi là thiếu.') + '</p>';
      $('[data-so-table]').innerHTML = renderTable(selectRows(model, {query, bucket, axis, limit: 'all', zoomStart, zoomEnd}).rows);
    }
    function recalculate() { if (result) { try { model = joinIdentity(deriveModel(result, {days, classify, now: now()}), identity, market, {now: now()}); if (!axisChosen && model.identityCoverage.cap > 0) axis = 'cap'; error = ''; } catch (e) { model = null; error = e.message; } } paint(); }
    function open(key) {
      if (!model?.rows.some(row => row.key === key)) return;
      try { const opened = onOpen(key, {days}); if (opened === false || opened?.ok === false) $('[data-so-inspect]').textContent = opened?.message || 'Chưa mở được biểu đồ cặp này.'; }
      catch (e) { $('[data-so-inspect]').textContent = 'Chưa mở được biểu đồ: ' + e.message; }
    }
    host.addEventListener('click', event => {
      const asset = event.target.closest('[data-so-key]'); if (asset) { open(asset.dataset.soKey); return; }
      const period = event.target.closest('[data-so-days]'), mode = event.target.closest('[data-so-view]'), group = event.target.closest('[data-so-bucket]');
      if (period) { days = Number(period.dataset.soDays); zoomStart = 0; zoomEnd = 100; recalculate(); }
      else if (mode) { view = mode.dataset.soView; paint(); }
      else if (group) { bucket = group.dataset.soBucket; zoomStart = 0; zoomEnd = 100; paint(); }
      else if (event.target.closest('[data-so-reset]')) { zoomStart = 0; zoomEnd = 100; paint(); }
    });
    host.addEventListener('keydown', event => { const asset = event.target.closest('g[data-so-key]'); if (asset && ['Enter', ' '].includes(event.key)) { event.preventDefault(); open(asset.dataset.soKey); } });
    for (const type of ['pointerover', 'focusin']) host.addEventListener(type, event => { const asset = event.target.closest('[data-so-key]'), row = model?.rows.find(r => r.key === asset?.dataset.soKey); if (row) $('[data-so-inspect]').textContent = rowTip(row).replace(/\n/g, ' · '); });
    $('[data-so-search]').addEventListener('input', e => { query = e.target.value; zoomStart = 0; zoomEnd = 100; paint(); });
    $('[data-so-axis]').addEventListener('change', e => { axis = e.target.value; axisChosen = true; bucket = 'all'; zoomStart = 0; zoomEnd = 100; paint(); });
    $('[data-so-limit]').addEventListener('change', e => { limit = e.target.value === 'all' ? 'all' : Number(e.target.value); paint(); });
    $('[data-so-from]').addEventListener('input', e => { zoomStart = Math.min(Number(e.target.value), zoomEnd - 1); paint(); });
    $('[data-so-to]').addEventListener('input', e => { zoomEnd = Math.max(Number(e.target.value), zoomStart + 1); paint(); });
    if (typeof ResizeObserver === 'function') { let width = 0; observer = new ResizeObserver(entries => { const next = Math.round(entries[0]?.contentRect.width || 0); if (next > 0 && width !== next) { width = next; paint(); } }); observer.observe(host); }
    const controller = Object.freeze({setDataset(next) { if (next?.preview) return false; try { const nextModel = joinIdentity(deriveModel(next, {days, classify, now: now()}), identity, market, {now: now()}); result = next; model = nextModel; if (!axisChosen && model.identityCoverage.cap > 0) axis = 'cap'; warning = ''; error = ''; paint(); return true; } catch (e) { this.setError(e.message); return false; } }, setIdentity({bindings, identitySnapshot: nextIdentity, marketSnapshot: nextMarket} = {}) { const oldIdentity = identity, oldMarket = market; identity = nextIdentity || bindings || identity; market = nextMarket || market; try { if (result) { const next = joinIdentity(deriveModel(result, {days, classify, now: now()}), identity, market, {now: now()}); model = next; if (!axisChosen && model.identityCoverage.cap > 0) axis = 'cap'; } paint(); return true; } catch (e) { identity = oldIdentity; market = oldMarket; this.setError(e.message); return false; } }, setMarketSnapshot(next) { return this.setIdentity({marketSnapshot: next}); }, setError(message) { if (model) warning = String(message); else error = String(message); paint(); }, setLoading() { if (!model) { error = ''; paint(); } }, snapshot: () => ({model, days, view, bucket, axis, query, limit, zoomStart, zoomEnd, error, warning}), destroy() { observer?.disconnect(); }});
    paint(); if (dataset) controller.setDataset(dataset); return controller;
  }
  return Object.freeze({PERIODS, BUCKETS, CAP_BUCKETS, safeImage, joinIdentity, deriveModel, selectRows, geometry, renderScatter, renderTable, rowTip, mount});
});
