/* Deterministic SVG views of public descriptive data. No model scores or wallet attribution. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.FlowChartsView = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const VENUES = { binance: 'Binance', bitget: 'Bitget', bybit: 'Bybit', okx: 'OKX', kucoin: 'KuCoin', kraken: 'Kraken', coinbase: 'Coinbase' };
  const INTERVALS = { '1d': { name: 'ngày', axis: 'NGÀY UTC', volume: 'GD NGÀY · USDT' }, '1w': { name: 'tuần', axis: 'TUẦN UTC', volume: 'GD TUẦN · USDT' }, '1M': { name: 'tháng', axis: 'THÁNG UTC', volume: 'GD THÁNG · USDT' } };
  const DAY = 86400000;
  const esc = value => String(value === undefined || value === null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const coord = value => Number(value.toFixed(4));
  const exact = value => String(value);
  function widthOf(value) { return finite(value) ? Math.max(240, Math.min(1800, value)) : 960; }
  function short(value, count = 10) { const chars = Array.from(String(value)); return chars.length > count ? chars.slice(0, count - 1).join('') + '…' : chars.join(''); }
  function human(value) {
    if (!finite(value)) return '—';
    const a = Math.abs(value);
    if (a >= 1e15) return value.toExponential(2);
    if (a >= 1e12) return (value / 1e12).toPrecision(3) + 'T';
    if (a >= 1e9) return (value / 1e9).toPrecision(3) + 'B';
    if (a >= 1e6) return (value / 1e6).toPrecision(3) + 'M';
    if (a >= 1e3) return (value / 1e3).toPrecision(3) + 'K';
    if (a && a < 0.0001) return value.toExponential(2);
    return Number(value.toPrecision(5)).toLocaleString('vi-VN', { maximumFractionDigits: 8 });
  }
  function percent(value) {
    if (!finite(value)) return '—';
    const scaled = value * 100;
    if (finite(scaled)) return (value > 0 ? '+' : '') + human(scaled) + '%';
    const parts = value.toExponential(3).split('e');
    return (value > 0 ? '+' : '') + parts[0] + 'e' + (Number(parts[1]) + 2) + '%';
  }
  function share(value) { return human(value * 100) + '%'; }
  function powerTen(exponent) {
    if (exponent >= -300 && exponent <= 308) return human(Math.pow(10, exponent));
    const whole = Math.floor(exponent), mantissa = Math.pow(10, exponent - whole);
    return mantissa.toPrecision(3) + 'e' + whole;
  }
  function date(value) { return new Date(value).toISOString().slice(0, 10); }
  function direction(value) { return value > 0 ? 'chart-up' : value < 0 ? 'chart-down' : 'chart-flat'; }
  function empty(message) { return '<p class="chart-empty" role="status">' + esc(message) + '</p>'; }
  function begin(w, h, title, desc) { return '<svg class="chart-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + ' ' + h + '" width="100%" role="img" aria-label="' + esc(title) + '"><title>' + esc(title) + '</title><desc>' + esc(desc) + '</desc>'; }
  function text(x, y, value, className = 'chart-tick', anchor = 'middle') { return '<text class="' + className + '" x="' + coord(x) + '" y="' + coord(y) + '" text-anchor="' + anchor + '">' + esc(value) + '</text>'; }
  function line(x1, y1, x2, y2, className = 'chart-grid') { return '<line class="' + className + '" x1="' + coord(x1) + '" y1="' + coord(y1) + '" x2="' + coord(x2) + '" y2="' + coord(y2) + '"/>'; }
  /* Normalize before subtracting: a single enormous outlier cannot overflow coordinates. */
  function scale(values, from, to, { includeZero = false, nonnegative = false, padding = 0.08 } = {}) {
    const items = includeZero ? values.concat(0) : values;
    const magnitude = Math.max(...items.map(v => Math.abs(v))) || 1;
    let low = Math.min(...items.map(v => v / magnitude)), high = Math.max(...items.map(v => v / magnitude));
    const pad = (high - low || Math.max(Math.abs(high), 1)) * padding;
    low -= pad; high += pad;
    if (nonnegative) low = Math.max(0, low);
    const finiteLimit = Number.MAX_VALUE / magnitude;
    low = Math.max(-finiteLimit, low); high = Math.min(finiteLimit, high);
    if (low === high) high = low + 1;
    const map = value => from + ((value / magnitude - low) / (high - low)) * (to - from);
    const ticks = Array.from({ length: 5 }, (_, i) => {
      const normalized = low + (high - low) * i / 4, raw = normalized * magnitude;
      return { coordinate: from + i / 4 * (to - from), value: finite(raw) ? raw : Math.sign(raw) * Number.MAX_VALUE };
    });
    return { map, ticks, low: low * magnitude, high: high * magnitude };
  }
  function identity(point) {
    return point && typeof point.key === 'string' && typeof point.base === 'string' && typeof point.sourceId === 'string' && /^[a-z0-9_-]{1,40}$/.test(point.sourceId);
  }
  function sourceName(point) { return typeof point.sourceName === 'string' && point.sourceName ? point.sourceName : VENUES[point.sourceId] || point.sourceId; }
  function clickable(point, title, content, extraClass = '') {
    return '<g class="chart-point venue-' + point.sourceId + (extraClass ? ' ' + extraClass : '') + '" tabindex="0" role="button" data-key="' + esc(point.key) + '" aria-label="' + esc(title) + '"><title>' + esc(title) + '</title>' + content + '</g>';
  }
  function pointTitle(point, kind, windowLabel = '24H') {
    const label = kind === '7d' ? '7 ngày' : point.windowLabel || windowLabel, historical = kind === '7d' || point.reference === 'closed_daily';
    const quote = point.quote || 'USDT';
    return point.base + ' · ' + sourceName(point) + ' · ' + (point.instrument || '') + '\n' +
      'Giá ' + label + ': ' + percent(point.x) + ' (tỷ lệ gốc ' + exact(point.x) + ')\n' +
      (kind === '7d' ? 'Taker mua 7D: ' + share(point.y) + ' (tỷ lệ gốc ' + exact(point.y) + ')' : 'GD 24H: ' + exact(point.y) + ' ' + quote) +
      (historical ?
        (finite(point.close) ? '\nGiá đóng cửa: ' + exact(point.close) + ' ' + quote : '') +
        (finite(point.end) ? '\nNến ngày UTC mới nhất kết thúc: ' + new Date(point.end).toISOString() : '') +
        (finite(point.asOf) ? '\nThời điểm nguồn lịch sử: ' + new Date(point.asOf).toISOString() : '') +
        (finite(point.fetchedAt) ? '\nLấy lịch sử lúc: ' + new Date(point.fetchedAt).toISOString() : '') :
        (finite(point.last) ? '\n'+(point.sourceId==='coingecko'?'Giá tổng hợp: ':'Giá ticker: ')+exact(point.last) + ' ' + quote : '') +
        (finite(point.asOf) ? '\n'+(point.sourceId==='coingecko'?'Thời điểm nguồn cập nhật: ':'Thời điểm ticker: ')+new Date(point.asOf).toISOString() : ''));
  }
  function scatter(points, { kind = '24h', width, maxLabels = 18, windowLabel = '24H' } = {}) {
    if (!['24h', '7d'].includes(kind)) return empty('Loại biểu đồ phân tán không được hỗ trợ.');
    if (!Array.isArray(points) || !points.length) return empty(kind === '7d' ? 'Chưa có cặp đủ lịch sử và taker mua 7 ngày.' : 'Chưa có ticker hợp lệ để vẽ biểu đồ.');
    if (points.some(p => !identity(p) || !finite(p.x) || !finite(p.y) || (kind === '24h' ? p.y <= 0 : p.y < 0 || p.y > 1))) return empty('Dữ liệu biểu đồ không hợp lệ; chưa vẽ các điểm.');
    const w = widthOf(width), h = 390, left = w < 420 ? 63 : 76, right = w - 25, top = 37, bottom = h - 63;
    const x = scale(points.map(p => p.x), left, right, { includeZero: true });
    const yValues = points.map(p => kind === '24h' ? Math.log10(p.y) : p.y);
    const y = scale(kind === '7d' ? yValues.concat(0.5) : yValues, bottom, top);
    const title = kind === '7d' ? 'Biến động giá 7 ngày và tỷ trọng taker mua 7 ngày' : 'Biến động giá ' + windowLabel + ' và giá trị giao dịch 24H';
    let svg = begin(w, h, title, 'Mỗi điểm là một cặp trên một sàn, không gộp cùng ticker. ' + (kind === '24h' ? 'Trục dọc logarithm cơ số 10 của USDT; chỉ nhận giá trị dương.' : 'Taker mua không xác định danh tính người mua. Đường ngang tham chiếu 50%.'));
    for (const t of x.ticks) svg += line(t.coordinate, top, t.coordinate, bottom) + text(t.coordinate, bottom + 22, percent(t.value));
    for (const t of y.ticks) svg += line(left, t.coordinate, right, t.coordinate) + text(left - 9, t.coordinate + 4, kind === '24h' ? powerTen(t.value) : share(t.value), 'chart-tick', 'end');
    svg += line(x.map(0), top, x.map(0), bottom, 'chart-zero');
    if (kind === '7d') svg += line(left, y.map(0.5), right, y.map(0.5), 'chart-zero') + text(right, y.map(0.5) - 8, '50%', 'chart-tick', 'end');
    svg += text(left, 19, kind === '24h' ? 'GD 24H · USDT · log₁₀' : 'TAKER MUA 7D · %', 'chart-axis-label', 'start') + text((left + right) / 2, h - 13, kind === '24h' ? 'BIẾN ĐỘNG GIÁ ' + String(windowLabel).toUpperCase() + ' · %' : 'BIẾN ĐỘNG GIÁ 7 NGÀY · %', 'chart-axis-label');
    const sorted = [...points].sort((a, b) => {
      const av = finite(a.turnover24) ? a.turnover24 : 0, bv = finite(b.turnover24) ? b.turnover24 : 0;
      return av === bv ? a.key.localeCompare(b.key) : av > bv ? -1 : 1;
    });
    const labelled = new Set(sorted.slice(0, Math.max(0, Math.min(points.length, Math.floor(maxLabels)))).map(p => p.key));
    for (const p of points) {
      const px = x.map(p.x), py = y.map(kind === '24h' ? Math.log10(p.y) : p.y);
      const label = labelled.has(p.key) ? text(px, Math.max(top + 11, py - 9), short(p.base, 9), 'chart-point-label') : '';
      svg += clickable(p, pointTitle(p, kind, windowLabel), '<circle class="chart-dot" cx="' + coord(px) + '" cy="' + coord(py) + '" r="4.5"/>' + label);
    }
    return svg + '</svg>';
  }
  function bubble(points, { width, sizeBy = 'equal', windowLabel = '24H', maxItems = 80 } = {}) {
    if (!['equal', 'turnover'].includes(sizeBy)) return empty('Cách chọn kích thước bong bóng không được hỗ trợ.');
    if (!Array.isArray(points) || !points.length) return empty('Chưa có ticker hợp lệ để vẽ bong bóng.');
    if (points.some(p => !identity(p) || !finite(p.x) || !finite(p.y) || p.y <= 0)) return empty('Dữ liệu bong bóng không hợp lệ.');
    const limit = finite(maxItems) ? Math.max(1, Math.min(200, Math.floor(maxItems))) : 80;
    const selected = [...points].sort((a, b) => a.y === b.y ? a.key.localeCompare(b.key) : a.y > b.y ? -1 : 1).slice(0, limit);
    const quotes = [...new Set(selected.map(p => p.quote || 'USDT'))], quoteLabel = quotes.length === 1 ? quotes[0] : 'đơn vị của từng nguồn';
    const w = widthOf(width), baseHeight = w < 600 ? Math.max(340, Math.min(520, w * 1.05)) : Math.max(440, Math.min(600, w * 0.48));
    const h = baseHeight * Math.sqrt(Math.max(1, selected.length / 80));
    const margin = 13, aspect = (w - 2 * margin) / (h - 2 * margin), maxVolume = selected[0].y, gap = 0.012;
    const packed = [], bounds = { left: -1, right: 1, top: -1, bottom: 1 };
    function canPlace(x, y, r) {
      for (const c of packed) {
        const dx = x - c.x, dy = y - c.y, minimum = r + c.r + gap;
        if (dx * dx + dy * dy < minimum * minimum - 1e-10) return false;
      }
      return true;
    }
    /* Equal circles encode returns by color only. Turnover mode shares exactly
       one volume-to-area scale; packing never enlarges tiny-volume coins. */
    for (const p of selected) {
      const r = sizeBy === 'equal' ? 1 : Math.exp((Math.log(p.y) - Math.log(maxVolume)) / 2);
      if (!packed.length) { packed.push({ p, x: 0, y: 0, r }); continue; }
      let best = null;
      function consider(x, y) {
        if (!finite(x) || !finite(y) || !canPlace(x, y, r)) return;
        const left = Math.min(bounds.left, x - r), right = Math.max(bounds.right, x + r), top = Math.min(bounds.top, y - r), bottom = Math.max(bounds.bottom, y + r);
        const extent = Math.max((right - left) / aspect, bottom - top), distance = (x / aspect) ** 2 + y * y;
        if (!best || extent < best.extent - 1e-9 || (Math.abs(extent - best.extent) <= 1e-9 && distance < best.distance - 1e-9)) best = { x, y, r, p, left, right, top, bottom, extent, distance };
      }
      for (const c of packed) {
        const distance = c.r + r + gap;
        for (let a = 0; a < 32; a++) { const angle = a * Math.PI / 16; consider(c.x + Math.cos(angle) * distance, c.y + Math.sin(angle) * distance); }
      }
      for (let i = 0; i < packed.length; i++) for (let j = i + 1; j < packed.length; j++) {
        const a = packed[i], b = packed[j], dx = b.x - a.x, dy = b.y - a.y, distance = Math.hypot(dx, dy), ra = a.r + r + gap, rb = b.r + r + gap;
        if (!distance || distance > ra + rb || distance < Math.abs(ra - rb)) continue;
        const along = (ra * ra - rb * rb + distance * distance) / (2 * distance), perpendicular = Math.sqrt(Math.max(0, ra * ra - along * along));
        const x = a.x + along * dx / distance, y = a.y + along * dy / distance;
        consider(x - perpendicular * dy / distance, y + perpendicular * dx / distance);
        consider(x + perpendicular * dy / distance, y - perpendicular * dx / distance);
      }
      if (!best) consider(bounds.right + r + gap, 0);
      packed.push(best); bounds.left = best.left; bounds.right = best.right; bounds.top = best.top; bounds.bottom = best.bottom;
    }
    const factor = Math.min((w - 2 * margin) / (bounds.right - bounds.left), (h - 2 * margin) / (bounds.bottom - bounds.top));
    const offsetX = (w - (bounds.right - bounds.left) * factor) / 2 - bounds.left * factor, offsetY = (h - (bounds.bottom - bounds.top) * factor) / 2 - bounds.top * factor;
    let svg = begin(w, h, 'Bong bóng biến động giá ' + windowLabel + ' theo tài sản và nguồn', 'Hiển thị ' + selected.length + '/' + points.length + ' tài sản/nguồn hợp lệ có giá trị giao dịch 24H cao nhất; giới hạn được chọn ' + limit + ', tối đa 200. ' + (sizeBy === 'equal' ? 'Các vòng tròn có kích thước bằng nhau để dễ đọc tên; diện tích không biểu thị khối lượng hay vốn hóa. ' : 'Diện tích hình tròn tỷ lệ giá trị giao dịch 24H bằng ' + quoteLabel + ', giữ nguyên cả khi một tài sản lớn vượt trội. ') + 'Màu phản ánh biến động giá ' + windowLabel + '. Chỉ hiện nhãn khi vòng tròn đủ chỗ; mọi tài sản vẫn có chú giải chính xác khi trỏ hoặc lấy nét. Các vòng tròn không chồng lên nhau.');
    for (const c of packed) {
      const p = c.p, cx = offsetX + c.x * factor, cy = offsetY + c.y * factor, radius = c.r * factor;
      let content = '<circle class="chart-bubble" cx="' + coord(cx) + '" cy="' + coord(cy) + '" r="' + radius + '"/>';
      if (radius >= (sizeBy === 'equal' ? 23 : 33)) content += text(cx, cy - 11, short(p.base, Math.min(14, Math.floor(radius / 3.4))), 'chart-bubble-label') + text(cx, cy + 4, short(sourceName(p), Math.max(6, Math.floor(radius / 2.2))), 'chart-bubble-source') + text(cx, cy + 20, percent(p.x), 'chart-bubble-change');
      else if (radius >= 22) content += text(cx, cy - 3, short(p.base, Math.max(3, Math.floor(radius / 3))), 'chart-bubble-label') + text(cx, cy + 13, short(percent(p.x), Math.max(5, Math.floor(radius / 2.5))), 'chart-bubble-change');
      else if (radius >= 13) content += text(cx, cy + 3, short(p.base, Math.max(2, Math.floor(radius / 3))), 'chart-bubble-source');
      svg += clickable(p, pointTitle(p, '24h', windowLabel), content, direction(p.x));
    }
    return svg + '</svg>';
  }
  function barTitle(b, mode, interval = '1d') {
    const dayText = interval === '1d' ? date(b.time) + ' UTC' : INTERVALS[interval].name.toUpperCase() + ' ' + date(b.time) + ' đến ' + date(b.end) + ' UTC';
    if (mode === 'price') return dayText + '\nOpen: ' + exact(b.open) + ' USDT\nHigh: ' + exact(b.high) + ' USDT\nLow: ' + exact(b.low) + ' USDT\nClose: ' + exact(b.close) + ' USDT\nQuote volume (' + INTERVALS[interval].name + '): ' + exact(b.quote) + ' USDT';
    return dayText + '\n' + (mode === 'cvd' ? 'CVD từ đầu cửa sổ: ' + exact(b.cvd) : 'Taker delta (' + INTERVALS[interval].name + '): ' + exact(b.delta)) + ' USDT\nTaker mua: ' + exact(b.buy) + ' USDT\nTaker bán: ' + exact(b.sell) + ' USDT\nClose: ' + exact(b.close) + ' USDT';
  }
  const priceRegistry = new Map(), priceControllers = new WeakMap(); let priceSequence = 0;
  function priceValue(value) { if (Math.abs(value) < .0001) return value.toExponential(5); const decimals = Math.abs(value) >= 1 ? 2 : Math.min(12, Math.max(2, 7 - Math.floor(Math.log10(Math.abs(value))))); return value.toLocaleString('en-US', { minimumFractionDigits: Math.min(2, decimals), maximumFractionDigits: decimals }); }
  function updatedViewport(previous, next, lo, hi) {
    if (!next.length) return { lo: 0, hi: 0 };
    const count = Math.max(1, hi - lo);
    if (lo === 0 && hi === previous.length) return { lo: 0, hi: next.length };
    if (hi === previous.length) return { lo: Math.max(0, next.length - count), hi: next.length };
    const from = previous[lo]?.time, to = previous[hi - 1]?.time;
    let first = next.findIndex(b => b.time >= from); if (first < 0) first = Math.max(0, next.length - count);
    let last = next.findIndex(b => b.time > to); if (last < 0) last = next.length;
    return { lo: first, hi: Math.max(first + 1, last) };
  }
  function priceDaily(bars, options) {
    const { width, interval, height = 620, showSma20 = true, showEma50 = true, showEma200 = true, showLatestLabels = true, priceTracks = [] } = options;
    const w = widthOf(width), h = finite(height) ? Math.max(420, Math.min(1000, height)) : 620;
    const left = w < 420 ? 13 : 25, right = w - (w < 420 ? 68 : 92), plotWidth = right - left;
    const legendColumns = Math.max(1, Math.floor(plotWidth / 122));
    const definitions = [
      { field: 'sma20', css: 'chart-sma20', label: 'SMA20 ngày', shortLabel: 'SMA20', color: '#65aaf3', enabled: showSma20 },
      { field: 'ema50', css: 'chart-ema50', label: 'EMA50 ngày', shortLabel: 'EMA50', color: '#b8e44f', enabled: showEma50 },
      { field: 'ema200', css: 'chart-ema200', label: 'EMA200 ngày', shortLabel: 'EMA200', color: '#df79b6', enabled: showEma200 }
    ];
    const tracks = [], trackIds = new Set();
    // The caller supplies independently verified, same-quote price levels.
    // Missing/unverified levels never receive a proxy or invented curve.
    for (const candidate of Array.isArray(priceTracks) ? priceTracks.slice(0, 12) : []) {
      if (candidate?.verified !== true || !/^[a-z][a-z0-9-]{0,30}$/.test(candidate.id || '') || trackIds.has(candidate.id) || !/^#[0-9a-f]{6}$/i.test(candidate.color || '') || typeof candidate.label !== 'string' || !Array.isArray(candidate.points)) continue;
      const points = new Map(); let valid = true;
      for (const point of candidate.points) {
        if (!point || !finite(point.time) || points.has(point.time) || (point.value !== null && (!finite(point.value) || point.value <= 0))) { valid = false; break; }
        points.set(point.time, point.value);
      }
      if (!valid) continue;
      const values = bars.map(b => points.has(b.end) ? points.get(b.end) : points.has(b.end + 1) ? points.get(b.end + 1) : points.get(b.time));
      if (values.some(v => finite(v) && v > 0)) { tracks.push({ id: candidate.id, css: 'chart-level-' + candidate.id, label: candidate.label, shortLabel: candidate.label, color: candidate.color, values }); trackIds.add(candidate.id); }
    }
    for (const indicator of definitions) if (indicator.enabled && bars.some(b => finite(b[indicator.field]) && b[indicator.field] > 0)) tracks.push({ ...indicator, id: indicator.field, values: bars.map(b => b[indicator.field]) });
    const legendRows = Math.max(1, Math.ceil(tracks.length / legendColumns));
    const top = 32 + legendRows * 22, bottom = Math.max(top + 135, h - 155), vTop = bottom + 28, vBottom = h - 43;
    const firstTime = bars[0].time, endTime = bars.at(-1).end + 1, dataSpan = Math.max(DAY, endTime - firstTime), span = dataSpan * 1.045;
    const at = time => left + (time - firstTime) / span * plotWidth, center = b => at((b.time + b.end + 1) / 2);
    const candleWidth = b => Math.max(0.65, Math.min(22, (b.end + 1 - b.time) / span * plotWidth * 0.7));
    const y = scale(bars.flatMap(b => [b.low, b.high]).concat(tracks.flatMap(t => t.values.filter(v => finite(v) && v > 0))), bottom, top, { nonnegative: true, padding: 0.055 });
    const volumes = scale(bars.map(b => b.quote), vBottom, vTop, { includeZero: true, nonnegative: true, padding: 0 });
    const token = 'price-' + (++priceSequence), title = 'Nến OHLC và giá trị giao dịch ' + INTERVALS[interval].name + ' UTC';
    let svg = begin(w, h, title, 'Giá và các đường giá được cung cấp dùng cùng trục bên phải. Chỉ vẽ giá trị đã có dữ liệu; không nối qua kỳ bị thiếu. Khối lượng quote nằm trong ô riêng. Chọn biểu đồ để dùng phím mũi tên hoặc phóng to.').replace('class="chart-svg"', 'class="chart-svg chart-price-pro" data-price-chart="' + token + '" data-plot-left="' + left + '" data-plot-right="' + right + '" data-plot-top="' + top + '" data-plot-bottom="' + vBottom + '"');
    svg += '<rect class="chart-plot-background" x="' + left + '" y="' + top + '" width="' + plotWidth + '" height="' + (vBottom - top) + '"/>';
    const gridTicks = Math.max(2, Math.min(7, Math.floor(plotWidth / 125)));
    for (let i = 0; i <= gridTicks; i++) {
      const x = left + i / gridTicks * (at(endTime) - left), stamp = firstTime + i / gridTicks * (endTime - firstTime);
      svg += line(x, top, x, vBottom, 'chart-grid chart-grid-vertical') + text(x, h - 22, new Date(stamp).toISOString().slice(5, 10), 'chart-tick');
    }
    for (const tick of y.ticks) svg += line(left, tick.coordinate, right, tick.coordinate) + text(right + 9, tick.coordinate + 4, human(tick.value), 'chart-tick chart-right-axis', 'start');
    svg += line(right, top, right, vBottom, 'chart-axis-border') + line(left, vTop - 12, right, vTop - 12, 'chart-axis-border');
    svg += text(right + 9, top - 12, 'USDT', 'chart-axis-label', 'start') + text(left, vTop - 16, INTERVALS[interval].volume, 'chart-axis-label', 'start');
    svg += text(right + 9, vTop + 5, human(volumes.ticks.at(-1).value), 'chart-tick', 'start') + text(right + 9, vBottom + 4, '0', 'chart-tick', 'start');
    bars.forEach((b, index) => {
      const cx = center(b), open = y.map(b.open), close = y.map(b.close), barWidth = candleWidth(b);
      const readout = barTitle(b, 'price', interval) + (b.sourceSessionClosed ? '\nNến đã đóng nhận trong phiên trực tiếp · chưa ghi vào nghiên cứu' : '') + (b.provisional ? '\nNến đang hình thành · chưa dùng nghiên cứu\nSự kiện kline: ' + new Date(b.eventTime).toISOString() : '') + tracks.filter(t => finite(t.values[index])).map(t => '\n' + t.label + ': ' + exact(t.values[index]) + ' USDT').join('');
      svg += '<g class="chart-candle ' + direction(b.close - b.open) + (b.provisional ? ' chart-candle-provisional' : '') + '" data-provisional="' + !!b.provisional + '" data-price-sample="' + index + '" data-chart-x="' + coord(cx) + '" data-chart-y="' + coord(close) + '" data-chart-date="' + esc(date(b.end)) + '"><title>' + esc(readout) + '</title>' + line(cx, y.map(b.high), cx, y.map(b.low), 'chart-wick') + '<rect class="chart-candle-body" x="' + coord(cx - barWidth / 2) + '" y="' + coord(Math.min(open, close)) + '" width="' + coord(barWidth) + '" height="' + coord(Math.max(0.8, Math.abs(close - open))) + '"/><rect class="chart-volume" x="' + coord(cx - barWidth / 2) + '" y="' + coord(volumes.map(b.quote)) + '" width="' + coord(barWidth) + '" height="' + coord(vBottom - volumes.map(b.quote)) + '"/></g>';
    });
    const latestLabels = [];
    tracks.forEach((track, index) => {
      let path = '', continuing = false, previousEnd = null;
      bars.forEach((b, i) => {
        const value = track.values[i];
        if (previousEnd !== null && b.time !== previousEnd + 1) continuing = false; previousEnd = b.end;
        if (!finite(value) || value <= 0) { continuing = false; return; }
        path += (continuing ? 'L' : 'M') + coord(center(b)) + ',' + coord(y.map(value)) + ' '; continuing = true;
      });
      svg += '<path class="' + track.css + '" d="' + path.trim() + '" stroke="' + track.color + '"/>';
      bars.forEach((b, i) => { if (finite(track.values[i]) && track.values[i] > 0) svg += '<circle class="' + track.css + ' chart-indicator-sample" cx="' + coord(center(b)) + '" cy="' + coord(y.map(track.values[i])) + '" r="1.8"><title>' + esc(date(b.end) + ' UTC · ' + track.label + ': ' + exact(track.values[i]) + ' USDT') + '</title></circle>'; });
      const legendX = left + index % legendColumns * Math.min(148, plotWidth / legendColumns), legendY = 18 + Math.floor(index / legendColumns) * 22;
      svg += '<rect class="chart-legend-chip" x="' + coord(legendX - 6) + '" y="' + coord(legendY - 12) + '" width="' + Math.min(140, plotWidth / legendColumns - 5) + '" height="20" rx="10" stroke="' + track.color + '" fill="' + track.color + '12"/>';
      svg += '<circle cx="' + coord(legendX + 4) + '" cy="' + coord(legendY - 2) + '" r="2.4" fill="' + track.color + '"/>' + text(legendX + 12, legendY + 1, track.label, 'chart-indicator-label ' + track.css + '-label', 'start');
      if (finite(track.values.at(-1)) && track.values.at(-1) > 0) latestLabels.push({ label: track.shortLabel, color: track.color, value: track.values.at(-1), actualY: y.map(track.values.at(-1)) });
    });
    // Labels retain their true value while leaders separate crowded levels.
    if (showLatestLabels) {
      const last = bars.at(-1), priceY = y.map(last.close);
      svg += line(left, priceY, right, priceY, 'chart-latest-price-line') + '<rect class="chart-current-price-box" x="' + (right + 1) + '" y="' + coord(priceY - 9) + '" width="' + (w - right - 5) + '" height="18" rx="2"/>' + text(right + 7, priceY + 4, priceValue(last.close), 'chart-current-price-value', 'start');
      latestLabels.sort((a, b) => a.actualY - b.actualY);
      let previous = top - 19;
      for (const label of latestLabels) { label.labelY = Math.max(label.actualY, previous + 19); previous = label.labelY; }
      const overflow = latestLabels.length ? Math.max(0, latestLabels.at(-1).labelY - bottom) : 0;
      for (const label of latestLabels) {
        const labelY = label.labelY - overflow, labelText = label.label + ' ' + human(label.value), boxWidth = Math.min(plotWidth * .76, Math.max(72, labelText.length * 5.6 + 12));
        svg += '<g class="chart-end-label"><title>' + esc(label.label + ': ' + exact(label.value) + ' USDT') + '</title><path class="chart-label-leader" d="M' + coord(center(last)) + ',' + coord(label.actualY) + ' L' + coord(right - boxWidth - 8) + ',' + coord(labelY) + '" stroke="' + label.color + '"/><rect x="' + coord(right - boxWidth - 2) + '" y="' + coord(labelY - 9) + '" width="' + coord(boxWidth) + '" height="18" rx="2" fill="' + label.color + '"/>' + text(right - 8, labelY + 4, labelText, 'chart-end-label-text', 'end') + '</g>';
      }
    }
    svg += text(left, h - 5, date(firstTime), 'chart-period-label', 'start') + text(right, h - 5, date(bars.at(-1).end) + ' · ' + INTERVALS[interval].axis, 'chart-period-label', 'end');
    svg += '<g class="chart-crosshair" hidden aria-hidden="true"><line class="chart-crosshair-v"/><line class="chart-crosshair-h"/><circle r="3"/></g>';
    priceRegistry.set(token, { bars, options }); if (priceRegistry.size > 64) priceRegistry.delete(priceRegistry.keys().next().value);
    return svg + '</svg>';
  }
  function daily(input, { mode = 'price', width, interval = '1d', height, showSma20 = true, showEma50 = true, showEma200 = true, priceTracks = [], showLatestLabels = true } = {}) {
    const series = Array.isArray(input) ? input : input && input.series;
    if (!['price', 'delta', 'cvd'].includes(mode)) return empty('Loại biểu đồ lịch sử không được hỗ trợ.');
    if (!Object.prototype.hasOwnProperty.call(INTERVALS, interval)) return empty('Khung nến không được hỗ trợ.');
    if (!Array.isArray(series) || !series.length) return empty('Chưa có nến ngày UTC đã đóng để vẽ.');
    if (series.some(b => !b || !['time', 'end', 'open', 'high', 'low', 'close', 'quote'].every(k => finite(b[k])) || b.time < 946684800000 || b.end >= 4102444800000 || b.end < b.time || Math.min(b.open, b.high, b.low, b.close) <= 0 || b.quote < 0 || b.high < Math.max(b.open, b.close, b.low) || b.low > Math.min(b.open, b.close, b.high))) return empty('Nến lịch sử không hợp lệ; chưa vẽ biểu đồ.');
    if (mode !== 'price' && series.some(b => !['buy', 'sell', 'delta', 'cvd'].every(k => finite(b[k])))) return empty('Nguồn hoặc cửa sổ này chưa có đầy đủ dữ liệu taker mua/bán. Chưa thể tính ' + (mode === 'delta' ? 'delta' : 'CVD') + '; không thay dữ liệu thiếu bằng 0.');
    const bars = [...series].sort((a, b) => a.time - b.time);
    if (mode === 'price') return priceDaily(bars, { width, interval, height, showSma20, showEma50, showEma200, priceTracks, showLatestLabels });
    const indicators = [ { field: 'sma20', css: 'chart-sma20', label: 'SMA20 ngày' }, { field: 'ema50', css: 'chart-ema50', label: 'EMA50 ngày' }, { field: 'ema200', css: 'chart-ema200', label: 'EMA200 ngày' } ].filter(indicator => mode === 'price' && bars.some(b => finite(b[indicator.field]) && b[indicator.field] > 0));
    const w = widthOf(width), left = w < 420 ? 61 : 77, right = w - (mode === 'delta' ? (w < 420 ? 59 : 78) : 23), top = 40;
    const plotWidth = right - left, legendColumns = Math.max(1, Math.min(indicators.length, Math.floor(plotWidth / 95))), legendExtra = mode === 'price' ? Math.max(0, Math.ceil(indicators.length / legendColumns) - 1) * 14 : 0;
    const h = mode === 'price' ? 430 + legendExtra : 360, bottom = mode === 'price' ? 270 : h - 60;
    const start = bars[0].time, finish = bars.at(-1).end + 1, span = Math.max(DAY, finish - start);
    const at = time => left + (time - start) / span * plotWidth, center = b => at((b.time + b.end + 1) / 2), barWidthFor = b => Math.max(0.7, Math.min(28, (b.end + 1 - b.time) / span * plotWidth * 0.65));
    const title = mode === 'price' ? 'Nến OHLC và giá trị giao dịch ' + INTERVALS[interval].name + ' UTC' : mode === 'delta' ? 'Taker delta ' + INTERVALS[interval].name + ' UTC và giá đóng cửa' : 'CVD taker theo cửa sổ ' + INTERVALS[interval].name + ' UTC';
    let svg = begin(w, h, title, mode === 'cvd' ? 'CVD bằng tổng tích lũy taker mua trừ taker bán, đặt lại 0 ở đầu cửa sổ hiển thị. Đơn vị USDT; không phải dòng tiền mới hoặc số dư ví.' : mode === 'delta' ? 'Cột là taker mua trừ taker bán bằng USDT; đường giá đóng cửa dùng trục giá độc lập bên phải. Không xác định ai mua.' : 'Mỗi nến giữ nguyên Open, High, Low, Close. Cột ở ô riêng bên dưới là giá trị giao dịch quote bằng USDT.');
    const indicatorValues = indicators.flatMap(indicator => bars.map(b => b[indicator.field]).filter(value => finite(value) && value > 0));
    const y = scale(mode === 'price' ? bars.flatMap(b => [b.low, b.high]).concat(indicatorValues) : bars.map(b => mode === 'delta' ? b.delta : b.cvd), bottom, top, { includeZero: mode !== 'price', nonnegative: mode === 'price' });
    for (const t of y.ticks) svg += line(left, t.coordinate, right, t.coordinate) + text(left - 8, t.coordinate + 4, human(t.value), 'chart-tick', 'end');
    svg += text(left, 19, mode === 'price' ? 'GIÁ · USDT' : mode === 'delta' ? 'TAKER DELTA · USDT' : 'CVD · USDT · RESET ĐẦU CỬA SỔ', 'chart-axis-label', 'start');
    if (mode !== 'price') svg += line(left, y.map(0), right, y.map(0), 'chart-zero');
    if (mode === 'price') {
      const vTop = 310 + legendExtra, vBottom = 376 + legendExtra, volumes = scale(bars.map(b => b.quote), vBottom, vTop, { includeZero: true, nonnegative: true, padding: 0 });
      svg += text(left, 299 + legendExtra, INTERVALS[interval].volume, 'chart-axis-label', 'start');
      for (const t of [volumes.ticks[0], volumes.ticks[4]]) svg += line(left, t.coordinate, right, t.coordinate) + text(left - 8, t.coordinate + 4, human(t.value), 'chart-tick', 'end');
      for (const b of bars) {
        const cx = center(b), open = y.map(b.open), close = y.map(b.close), bodyTop = Math.min(open, close), bodyHeight = Math.max(0.8, Math.abs(close - open)), barWidth = barWidthFor(b);
        svg += '<g class="chart-candle ' + direction(b.close - b.open) + '"><title>' + esc(barTitle(b, 'price', interval)) + '</title>' + line(cx, y.map(b.high), cx, y.map(b.low), 'chart-wick') + '<rect class="chart-candle-body" x="' + coord(cx - barWidth / 2) + '" y="' + coord(bodyTop) + '" width="' + coord(barWidth) + '" height="' + coord(bodyHeight) + '"/><rect class="chart-volume" x="' + coord(cx - barWidth / 2) + '" y="' + coord(volumes.map(b.quote)) + '" width="' + coord(barWidth) + '" height="' + coord(vBottom - volumes.map(b.quote)) + '"/></g>';
      }
      indicators.forEach((indicator, index) => {
        let path = '', continuing = false, previousEnd = null;
        for (const b of bars) {
          const value = b[indicator.field];
          if (previousEnd !== null && b.time !== previousEnd + 1) continuing = false;
          previousEnd = b.end;
          if (!finite(value) || value <= 0) { continuing = false; continue; }
          path += (continuing ? 'L' : 'M') + coord(center(b)) + ',' + coord(y.map(value)) + ' '; continuing = true;
        }
        svg += '<path class="' + indicator.css + '" d="' + path.trim() + '"/>';
        for (const b of bars) if (finite(b[indicator.field]) && b[indicator.field] > 0) svg += '<circle class="' + indicator.css + ' chart-indicator-sample" cx="' + coord(center(b)) + '" cy="' + coord(y.map(b[indicator.field])) + '" r="1.8"><title>' + esc(date(b.end) + ' UTC · ' + indicator.label + ': ' + exact(b[indicator.field]) + ' USDT') + '</title></circle>';
        const legendX = left + (index % legendColumns) * Math.min(130, plotWidth / legendColumns), legendY = 285 + Math.floor(index / legendColumns) * 14;
        svg += line(legendX, legendY, legendX + 12, legendY, indicator.css) + text(legendX + 17, legendY + 4, indicator.label, 'chart-indicator-label ' + indicator.css + '-label', 'start');
      });
    } else if (mode === 'delta') {
      const price = scale(bars.map(b => b.close), bottom, top, { nonnegative: true });
      svg += text(right, 19, 'GIÁ · USDT', 'chart-axis-label chart-price-label', 'end');
      for (const t of price.ticks) svg += text(right + 8, t.coordinate + 4, human(t.value), 'chart-tick chart-price-label', 'start');
      for (const b of bars) {
        const zero = y.map(0), value = y.map(b.delta), height = Math.abs(value - zero), barWidth = barWidthFor(b);
        svg += '<g class="chart-delta ' + direction(b.delta) + '"><title>' + esc(barTitle(b, 'delta', interval)) + '</title><rect x="' + coord(center(b) - barWidth / 2) + '" y="' + coord(Math.min(zero, value)) + '" width="' + coord(barWidth) + '" height="' + coord(height) + '"/></g>';
      }
      svg += '<path class="chart-price-overlay" d="' + bars.map((b, i) => (i ? 'L' : 'M') + coord(center(b)) + ',' + coord(price.map(b.close))).join(' ') + '"/>';
      for (const b of bars) svg += '<circle class="chart-price-sample" cx="' + coord(center(b)) + '" cy="' + coord(price.map(b.close)) + '" r="2"><title>' + esc(barTitle(b, 'price', interval)) + '</title></circle>';
    } else {
      svg += '<path class="chart-cvd-line" d="M' + coord(left) + ',' + coord(y.map(0)) + ' ' + bars.map(b => 'L' + coord(at(b.end + 1)) + ',' + coord(y.map(b.cvd))).join(' ') + '"/>';
      for (const b of bars) svg += '<circle class="chart-cvd-sample" cx="' + coord(at(b.end + 1)) + '" cy="' + coord(y.map(b.cvd)) + '" r="2.5"><title>' + esc(barTitle(b, 'cvd', interval)) + '</title></circle>';
    }
    const dateY = mode === 'price' ? 400 + legendExtra : h - 35;
    svg += text(left, dateY, date(start), 'chart-tick', 'start') + text(right, dateY, date(bars.at(-1).end), 'chart-tick', 'end') + text((left + right) / 2, h - 11, INTERVALS[interval].axis, 'chart-axis-label');
    return svg + '</svg>';
  }
  function bindInteraction(container) {
    if (!container || typeof document === 'undefined') return;
    const charts = container.matches?.('svg[data-price-chart]') ? [container] : Array.from(container.querySelectorAll?.('svg[data-price-chart]') || []);
    for (const initial of charts) {
      if (initial.dataset.priceBound) continue;
      const registered = priceRegistry.get(initial.dataset.priceChart); if (!registered) continue;
      let base = registered.bars; const options = registered.options;
      const shell = document.createElement('div'); shell.className = 'price-chart-shell'; initial.parentNode.insertBefore(shell, initial); shell.appendChild(initial);
      const controls = document.createElement('div'); controls.className = 'price-chart-navigation';
      controls.innerHTML = '<span>Rê chuột để đọc · kéo để dịch</span><button type="button" data-price-zoom="out" aria-label="Thu nhỏ biểu đồ">−</button><button type="button" data-price-zoom="in" aria-label="Phóng to biểu đồ">+</button><button type="button" data-price-zoom="reset">Đặt lại</button>';
      shell.appendChild(controls);
      const tooltip = document.createElement('div'); tooltip.className = 'price-chart-tooltip'; tooltip.hidden = true; shell.appendChild(tooltip);
      let svg = initial, lo = 0, hi = base.length, selected = Math.max(0, base.length - 1), drag = null, pendingUpdate = null, lastClientX;
      function updateControls() { controls.querySelector('[data-price-zoom="in"]').disabled = hi - lo <= Math.min(8, base.length); controls.querySelector('[data-price-zoom="out"]').disabled = hi - lo >= base.length; }
      function show(index, clientX) {
        if (clientX !== undefined) lastClientX = clientX;
        const samples = svg.querySelectorAll('[data-price-sample]'); if (!samples.length) return;
        selected = Math.max(0, Math.min(samples.length - 1, index));
        const node = samples[selected], x = Number(node.dataset.chartX), y = Number(node.dataset.chartY), cross = svg.querySelector('.chart-crosshair');
        cross.hidden = false; cross.removeAttribute('hidden');
        const vertical = cross.querySelector('.chart-crosshair-v'), horizontal = cross.querySelector('.chart-crosshair-h');
        for (const [attribute, value] of Object.entries({ x1: x, x2: x, y1: svg.dataset.plotTop, y2: svg.dataset.plotBottom })) vertical.setAttribute(attribute, value);
        for (const [attribute, value] of Object.entries({ x1: svg.dataset.plotLeft, x2: svg.dataset.plotRight, y1: y, y2: y })) horizontal.setAttribute(attribute, value);
        cross.querySelector('circle').setAttribute('cx', x); cross.querySelector('circle').setAttribute('cy', y);
        tooltip.textContent = node.querySelector('title').textContent; tooltip.hidden = false;
        const shellBox = shell.getBoundingClientRect();
        tooltip.style.left = clientX && clientX - shellBox.left < shellBox.width * .52 ? 'auto' : '12px'; tooltip.style.right = clientX && clientX - shellBox.left < shellBox.width * .52 ? '12px' : 'auto';
      }
      function redraw(preserveReadout = false) {
        const hadFocus = document.activeElement === svg, hadTip = preserveReadout && !tooltip.hidden;
        const holder = document.createElement('div'); holder.innerHTML = daily(base.slice(lo, hi), { ...options, mode: 'price' });
        const next = holder.firstElementChild; svg.replaceWith(next); svg = next; tooltip.hidden = true; attach(); updateControls();
        if (hadTip) show(selected, lastClientX); if (hadFocus) svg.focus({ preventScroll: true });
      }
      function update(next) {
        if (!Array.isArray(next) || !next.length) return false;
        if (drag) { pendingUpdate = next; return true; }
        const selectedTime = base[lo + selected]?.time, view = updatedViewport(base, next, lo, hi);
        base = next.slice(); lo = view.lo; hi = view.hi;
        const index = base.findIndex(b => b.time === selectedTime); selected = Math.max(0, Math.min(hi - lo - 1, index < 0 ? hi - lo - 1 : index - lo));
        redraw(true); return true;
      }
      function zoom(factor) {
        const count = hi - lo, wanted = Math.min(base.length, Math.max(Math.min(8, base.length), Math.round(count * factor)));
        const anchor = lo + Math.min(count - 1, Math.max(0, selected)), ratio = count <= 1 ? 1 : selected / (count - 1);
        lo = Math.max(0, Math.min(base.length - wanted, Math.round(anchor - wanted * ratio))); hi = lo + wanted; selected = Math.min(wanted - 1, Math.round(wanted * ratio)); redraw();
      }
      function attach() {
        svg.dataset.priceBound = 'true'; svg.setAttribute('tabindex', '0');
        svg.setAttribute('aria-label', 'Biểu đồ giá tương tác. Mũi tên đọc nến; cộng trừ để zoom; Home đặt lại.');
        svg.addEventListener('pointermove', event => {
          const box = svg.getBoundingClientRect(), view = svg.viewBox.baseVal, x = (event.clientX - box.left) / box.width * view.width;
          const samples = Array.from(svg.querySelectorAll('[data-price-sample]'));
          if (x < Number(svg.dataset.plotLeft) || x > Number(svg.dataset.plotRight)) return;
          let nearest = 0; for (let i = 1; i < samples.length; i++) if (Math.abs(Number(samples[i].dataset.chartX) - x) < Math.abs(Number(samples[nearest].dataset.chartX) - x)) nearest = i;
          show(nearest, event.clientX);
        });
        svg.addEventListener('pointerleave', () => { tooltip.hidden = true; svg.querySelector('.chart-crosshair').setAttribute('hidden', ''); });
        svg.addEventListener('pointerdown', event => { if (event.button === 0 && hi - lo < base.length) drag = { x: event.clientX, lo, hi }; });
        svg.addEventListener('pointerup', event => {
          if (!drag) return;
          const shift = Math.round((drag.x - event.clientX) / svg.getBoundingClientRect().width * (hi - lo)), count = drag.hi - drag.lo;
          if (Math.abs(event.clientX - drag.x) > 8) { lo = Math.max(0, Math.min(base.length - count, drag.lo + shift)); hi = lo + count; redraw(); } drag = null;
          if (pendingUpdate) { const next = pendingUpdate; pendingUpdate = null; update(next); }
        });
        svg.addEventListener('keydown', event => {
          // Existing callers may also expose focusable candle samples with
          // their own keyboard navigation; do not process those twice.
          if (event.target !== svg) return;
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); show(selected + (event.key === 'ArrowLeft' ? -1 : 1)); }
          else if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(.65); svg.focus(); }
          else if (event.key === '-') { event.preventDefault(); zoom(1.6); svg.focus(); }
          else if (event.key === 'Home') { event.preventDefault(); lo = 0; hi = base.length; redraw(); svg.focus(); }
        });
        svg.addEventListener('wheel', event => { if (document.activeElement !== svg) return; event.preventDefault(); zoom(event.deltaY < 0 ? .8 : 1.25); svg.focus(); }, { passive: false });
      }
      controls.addEventListener('click', event => { const action = event.target.closest('[data-price-zoom]')?.dataset.priceZoom; if (action === 'in') zoom(.65); else if (action === 'out') zoom(1.6); else if (action === 'reset') { lo = 0; hi = base.length; redraw(); } });
      priceControllers.set(shell, { update });
      attach(); updateControls();
    }
  }
  function updateDaily(container, series) {
    if (!container || !Array.isArray(series) || !series.length) return false;
    const shells = container.matches?.('.price-chart-shell') ? [container] : Array.from(container.querySelectorAll?.('.price-chart-shell') || []);
    let updated = false; for (const shell of shells) if (priceControllers.get(shell)?.update(series)) updated = true; return updated;
  }
  return Object.freeze({ scatter, bubble, daily, bindInteraction, updateDaily, updatedViewport });
});
