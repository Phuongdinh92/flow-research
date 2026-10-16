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
  function bubble(points, { width, sizeBy = 'equal', windowLabel = '24H' } = {}) {
    if (!['equal', 'turnover'].includes(sizeBy)) return empty('Cách chọn kích thước bong bóng không được hỗ trợ.');
    if (!Array.isArray(points) || !points.length) return empty('Chưa có ticker hợp lệ để vẽ bong bóng.');
    if (points.some(p => !identity(p) || !finite(p.x) || !finite(p.y) || p.y <= 0)) return empty('Dữ liệu bong bóng không hợp lệ.');
    const selected = [...points].sort((a, b) => a.y === b.y ? a.key.localeCompare(b.key) : a.y > b.y ? -1 : 1).slice(0, 80);
    const quotes = [...new Set(selected.map(p => p.quote || 'USDT'))], quoteLabel = quotes.length === 1 ? quotes[0] : 'đơn vị của từng nguồn';
    const w = widthOf(width), h = w < 600 ? Math.max(340, Math.min(520, w * 1.05)) : Math.max(440, Math.min(600, w * 0.48));
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
    let svg = begin(w, h, 'Bong bóng biến động giá ' + windowLabel + ' theo tài sản và nguồn', 'Tối đa 80 tài sản/nguồn có giá trị giao dịch 24H cao nhất. ' + (sizeBy === 'equal' ? 'Các vòng tròn có kích thước bằng nhau để dễ đọc tên; diện tích không biểu thị khối lượng hay vốn hóa. ' : 'Diện tích hình tròn tỷ lệ giá trị giao dịch 24H bằng ' + quoteLabel + ', giữ nguyên cả khi một tài sản lớn vượt trội. ') + 'Màu phản ánh biến động giá ' + windowLabel + '. Chỉ hiện nhãn khi vòng tròn đủ chỗ; mọi tài sản vẫn có chú giải chính xác khi trỏ hoặc lấy nét. Các vòng tròn không chồng lên nhau.');
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
  function daily(input, { mode = 'price', width, interval = '1d' } = {}) {
    const series = Array.isArray(input) ? input : input && input.series;
    if (!['price', 'delta', 'cvd'].includes(mode)) return empty('Loại biểu đồ lịch sử không được hỗ trợ.');
    if (!Object.prototype.hasOwnProperty.call(INTERVALS, interval)) return empty('Khung nến không được hỗ trợ.');
    if (!Array.isArray(series) || !series.length) return empty('Chưa có nến ngày UTC đã đóng để vẽ.');
    if (series.some(b => !b || !['time', 'end', 'open', 'high', 'low', 'close', 'quote'].every(k => finite(b[k])) || b.time < 946684800000 || b.end >= 4102444800000 || b.end < b.time || Math.min(b.open, b.high, b.low, b.close) <= 0 || b.quote < 0 || b.high < Math.max(b.open, b.close, b.low) || b.low > Math.min(b.open, b.close, b.high))) return empty('Nến lịch sử không hợp lệ; chưa vẽ biểu đồ.');
    if (mode !== 'price' && series.some(b => !['buy', 'sell', 'delta', 'cvd'].every(k => finite(b[k])))) return empty('Nguồn hoặc cửa sổ này chưa có đầy đủ dữ liệu taker mua/bán. Chưa thể tính ' + (mode === 'delta' ? 'delta' : 'CVD') + '; không thay dữ liệu thiếu bằng 0.');
    const bars = [...series].sort((a, b) => a.time - b.time);
    const w = widthOf(width), h = mode === 'price' ? 430 : 360, left = w < 420 ? 61 : 77, right = w - (mode === 'delta' ? (w < 420 ? 59 : 78) : 23), top = 40, bottom = mode === 'price' ? 270 : h - 60;
    const start = bars[0].time, finish = bars.at(-1).end + 1, span = Math.max(DAY, finish - start), plotWidth = right - left;
    const at = time => left + (time - start) / span * plotWidth, center = b => at((b.time + b.end + 1) / 2), barWidthFor = b => Math.max(0.7, Math.min(28, (b.end + 1 - b.time) / span * plotWidth * 0.65));
    const title = mode === 'price' ? 'Nến OHLC và giá trị giao dịch ' + INTERVALS[interval].name + ' UTC' : mode === 'delta' ? 'Taker delta ' + INTERVALS[interval].name + ' UTC và giá đóng cửa' : 'CVD taker theo cửa sổ ' + INTERVALS[interval].name + ' UTC';
    let svg = begin(w, h, title, mode === 'cvd' ? 'CVD bằng tổng tích lũy taker mua trừ taker bán, đặt lại 0 ở đầu cửa sổ hiển thị. Đơn vị USDT; không phải dòng tiền mới hoặc số dư ví.' : mode === 'delta' ? 'Cột là taker mua trừ taker bán bằng USDT; đường giá đóng cửa dùng trục giá độc lập bên phải. Không xác định ai mua.' : 'Mỗi nến giữ nguyên Open, High, Low, Close. Cột ở ô riêng bên dưới là giá trị giao dịch quote bằng USDT.');
    const indicators = [ { field: 'sma20', css: 'chart-sma20', label: 'SMA20 ngày' }, { field: 'ema50', css: 'chart-ema50', label: 'EMA50 ngày' } ].filter(indicator => mode === 'price' && bars.some(b => finite(b[indicator.field]) && b[indicator.field] > 0));
    const indicatorValues = indicators.flatMap(indicator => bars.map(b => b[indicator.field]).filter(value => finite(value) && value > 0));
    const y = scale(mode === 'price' ? bars.flatMap(b => [b.low, b.high]).concat(indicatorValues) : bars.map(b => mode === 'delta' ? b.delta : b.cvd), bottom, top, { includeZero: mode !== 'price', nonnegative: mode === 'price' });
    for (const t of y.ticks) svg += line(left, t.coordinate, right, t.coordinate) + text(left - 8, t.coordinate + 4, human(t.value), 'chart-tick', 'end');
    svg += text(left, 19, mode === 'price' ? 'GIÁ · USDT' : mode === 'delta' ? 'TAKER DELTA · USDT' : 'CVD · USDT · RESET ĐẦU CỬA SỔ', 'chart-axis-label', 'start');
    if (mode !== 'price') svg += line(left, y.map(0), right, y.map(0), 'chart-zero');
    if (mode === 'price') {
      const vTop = 310, vBottom = 376, volumes = scale(bars.map(b => b.quote), vBottom, vTop, { includeZero: true, nonnegative: true, padding: 0 });
      svg += text(left, 299, INTERVALS[interval].volume, 'chart-axis-label', 'start');
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
        const legendX = left + index * Math.max(90, Math.min(130, plotWidth / 2));
        svg += line(legendX, 285, legendX + 12, 285, indicator.css) + text(legendX + 17, 289, indicator.label, 'chart-indicator-label ' + indicator.css + '-label', 'start');
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
    const dateY = mode === 'price' ? 400 : h - 35;
    svg += text(left, dateY, date(start), 'chart-tick', 'start') + text(right, dateY, date(bars.at(-1).end), 'chart-tick', 'end') + text((left + right) / 2, h - 11, INTERVALS[interval].axis, 'chart-axis-label');
    return svg + '</svg>';
  }
  return Object.freeze({ scatter, bubble, daily });
});
