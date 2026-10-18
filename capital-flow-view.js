/* Reproducible price/flow charts. Exchange USDT and network USD are separate views. */
(function (root, factory) {
  'use strict';
  const node = typeof module === 'object' && module.exports;
  const api = factory(node ? require('./intelligence-core.js') : root.FlowIntelligence,
    node ? require('./cost-reference-view.js') : root.FlowCostReferenceView);
  if (node) module.exports = api;
  root.FlowCapitalFlowView = api;
})(typeof globalThis === 'object' ? globalThis : this, function (Intelligence, CostView) {
  'use strict';
  const DAY = 86400000;
  const COLORS = Object.freeze({ price: '#a995ff', up: '#21d4c6', down: '#f05a89', ema50: '#b4de4b', ema200: '#e583bc', volumeAnomaly: '#a373fb', momentumExpansion: '#25d1ad', pressureSetup: '#f39340', sidewaysBuyPressure: '#eed15c', possibleSellAbsorption: '#58cce0', overheated: '#ed7b9c' });
  const EVENT_LABELS = Object.freeze({ volumeAnomaly: 'Volume đột biến', momentumExpansion: 'Động lượng mở rộng', pressureSetup: 'Áp lực mua', sidewaysBuyPressure: 'Mua trong biên hẹp', possibleSellAbsorption: 'Bán nhiều · giá giữ', overheated: 'RSI & đà tăng cao' });
  const EVENT_ORDER = Object.freeze(['volumeAnomaly', 'momentumExpansion', 'pressureSetup', 'sidewaysBuyPressure', 'possibleSellAbsorption', 'overheated']);
  const UNKNOWN_BANDS = Object.freeze(['Balance', 'Delta', 'Undervalue', 'Diamond']);
  const finite = v => typeof v === 'number' && Number.isFinite(v);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const date = t => new Date(t).toISOString().slice(0, 10);
  const coord = n => Number(n.toFixed(3));
  function human(n) {
    if (!finite(n)) return '—';
    const a = Math.abs(n);
    if (a >= 1e15 || a && a < .00001) return n.toExponential(3);
    for (const [size, suffix] of [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']]) if (a >= size) return Number((n / size).toPrecision(4)) + suffix;
    return n.toLocaleString('en-US', { maximumFractionDigits: a >= 1 ? 3 : 8 });
  }
  function price(n) {
    if (!finite(n)) return '—';
    if (n && (Math.abs(n) < .00001 || Math.abs(n) >= 1e12)) return n.toExponential(5);
    return n.toLocaleString('en-US', { maximumFractionDigits: Math.abs(n) >= 1 ? 2 : 8, minimumFractionDigits: Math.abs(n) >= 1 ? 2 : 0 });
  }
  const exact = n => finite(n) ? String(n) : 'thiếu';
  function sum(rows, key) {
    if (rows.some(r => !finite(r[key]))) return null;
    const total = rows.reduce((s, r) => s + r[key], 0);
    return finite(total) ? total : null;
  }

  /** Fixed, nonoverlapping observation buckets. An incomplete period is unknown,
   * not a zero/partial total. The 30-day baseline ends before its bucket starts. */
  function aggregate(rows, days = 1, cutoff = rows.at(-1)?.end) {
    if (![1, 7, 30].includes(days) || !Array.isArray(rows) || !rows.length || !Number.isSafeInteger(cutoff) || (cutoff + 1) % DAY) throw Error('Invalid capital-flow aggregation');
    let prev = null;
    const byDay = new Map();
    for (const r of rows) {
      if (!r || !Number.isSafeInteger(r.time) || r.time % DAY || r.end !== r.time + DAY - 1 || prev !== null && r.time <= prev || r.end > cutoff || !finite(r.close) || r.close <= 0 || ['quote', 'buy', 'sell', 'delta'].some(k => r[k] !== null && !finite(r[k])) || finite(r.quote) && r.quote < 0) throw Error('Invalid daily flow observation');
      prev = r.time; byDay.set(r.time, r);
    }
    const first = rows[0].time, size = days * DAY;
    const firstEnd = cutoff - Math.floor((cutoff - (first + DAY - 1)) / size) * size;
    const result = [];
    for (let end = firstEnd; end <= cutoff; end += size) {
      const from = end + 1 - size, members = [], baseline = [];
      for (let t = from; t <= end; t += DAY) if (byDay.has(t)) members.push(byDay.get(t));
      for (let t = from - 30 * DAY; t < from; t += DAY) if (byDay.has(t)) baseline.push(byDay.get(t));
      const complete = members.length === days;
      const quote = complete ? sum(members, 'quote') : null;
      const buy = complete ? sum(members, 'buy') : null;
      const sell = complete ? sum(members, 'sell') : null;
      const delta = complete ? sum(members, 'delta') : null;
      const priorQuote = baseline.length === 30 ? sum(baseline, 'quote') : null;
      const intensity = quote !== null && priorQuote > 0 ? (quote / days) / (priorQuote / 30) : null;
      result.push({ time: from, end, days, observedDays: members.length, missingDays: days - members.length, complete, quote, buy, sell, delta,
        intensity: finite(intensity) ? intensity : null, priorQuote, priorFrom: from - 30 * DAY, priorTo: from - 1,
        close: members.at(-1)?.close ?? null, closeTime: members.at(-1)?.time ?? null });
    }
    return result;
  }

  function prepare(history, options = {}) {
    if (!Intelligence) throw Error('FlowIntelligence must load before FlowCapitalFlowView');
    const now = options.now === undefined ? Date.now() : options.now;
    const intel = Intelligence.analyze(history, { now });
    const rows = intel.series.map(p => ({ ...p.metrics }));
    const cutoff = rows.at(-1).end;
    const windowDays = options.windowDays ?? 180;
    if (!Number.isInteger(windowDays) || windowDays < 1 || windowDays > 10000) throw Error('Invalid capital-flow window');
    const start = options.from ?? Math.max(rows[0].time, cutoff + 1 - windowDays * DAY);
    const end = options.to ?? cutoff;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start < rows[0].time || end > cutoff) throw Error('Invalid capital-flow viewport');
    const visible = rows.filter(r => r.time >= start && r.end <= end);
    if (!visible.length) throw Error('No completed observations in viewport');
    const aggregationDays = options.aggregationDays ?? 1;
    const buckets = aggregate(rows, aggregationDays, cutoff);
    const visibleBuckets = buckets.filter(b => b.end >= visible[0].time && b.time <= visible.at(-1).end);
    // Do not paint whole-period totals into a clipped range: the navigator may
    // select an interior date, but aggregation boundaries remain explicit.
    const fullVisibleBuckets = visibleBuckets.filter(b => b.time >= visible[0].time && b.end <= visible.at(-1).end);
    const events = intel.events.filter(e => e.signalTime >= visible[0].time && e.signalTime <= visible.at(-1).end);
    return { history, intel, rows, visible, buckets, visibleBuckets, fullVisibleBuckets, events, cutoff, aggregationDays,
      from: visible[0].time, to: visible.at(-1).end,
      gaps: Math.round((visible.at(-1).end + 1 - visible[0].time) / DAY) - visible.length,
      clippedBuckets: visibleBuckets.length - fullVisibleBuckets.length,
      current: intel.coverage.current, now };
  }

  function scale(values, bottom, top, { zero = false, nonnegative = false } = {}) {
    const input = values.filter(finite).concat(zero ? [0] : []);
    if (!input.length) input.push(0, 1);
    const magnitude = Math.max(...input.map(Math.abs)) || 1;
    let lo = Math.min(...input.map(v => v / magnitude)), hi = Math.max(...input.map(v => v / magnitude));
    const pad = Math.max(hi - lo, Math.abs(hi) * .1, .01) * .08;
    lo -= pad; hi += pad;
    if (nonnegative) lo = Math.max(0, lo);
    const limit = Number.MAX_VALUE / magnitude;
    lo = Math.max(-limit, lo); hi = Math.min(limit, hi);
    if (lo === hi) hi += .01;
    const map = v => bottom - (v / magnitude - lo) / (hi - lo) * (bottom - top);
    return { map, ticks: Array.from({ length: 5 }, (_, i) => ({ y: bottom - i / 4 * (bottom - top), value: (lo + (hi - lo) * i / 4) * magnitude })) };
  }
  function labels(items, top, bottom, gap = 34) {
    const result = items.map(x => ({ ...x })).sort((a, b) => a.y - b.y);
    for (let i = 0; i < result.length; i++) result[i].labelY = Math.max(top + 17, Math.min(bottom - 17, result[i].y), i ? result[i - 1].labelY + gap : top + 17);
    if (result.length && result.at(-1).labelY > bottom - 17) {
      result.at(-1).labelY = bottom - 17;
      for (let i = result.length - 2; i >= 0; i--) result[i].labelY = Math.min(result[i].labelY, result[i + 1].labelY - gap);
    }
    return result;
  }
  function dimensions(width, type) {
    const w = finite(width) ? Math.max(700, Math.min(1800, width)) : 1100;
    return { w, h: type === 'price' ? 500 : 425, left: 66, right: w - 143, top: 26, bottom: type === 'price' ? 342 : 355 };
  }
  function path(rows, field, x, y) {
    let d = '', previous = null;
    for (const r of rows) {
      if (!finite(r[field])) { previous = null; continue; }
      d += (previous !== null && r.time === previous + DAY ? 'L' : 'M') + coord(x(r.time)) + ',' + coord(y(r[field])) + ' ';
      previous = r.time;
    }
    return d.trim();
  }
  function text(x, y, content, cls = 'cf-axis', anchor = 'start') {
    return '<text class="' + cls + '" x="' + coord(x) + '" y="' + coord(y) + '" text-anchor="' + anchor + '">' + esc(content) + '</text>';
  }
  function grid(d, y, mode, priceAxis = true) {
    let svg = '';
    for (const t of y.ticks) svg += '<line class="cf-grid" x1="' + d.left + '" x2="' + d.right + '" y1="' + coord(t.y) + '" y2="' + coord(t.y) + '"/>' + text(priceAxis ? d.right + 9 : d.left - 9, t.y + 4, mode === 'price' ? price(t.value) : human(t.value) + (mode === 'intensity' ? '×' : ''), 'cf-axis', priceAxis ? 'start' : 'end');
    return svg;
  }
  function timeAxis(model, d, x, bottom) {
    const { visible } = model;
    return [...new Set(Array.from({ length: 7 }, (_, i) => Math.round((visible.length - 1) * i / 6)))].map(i => text(x(visible[i].time), bottom + 25, date(visible[i].time).slice(5), 'cf-axis', 'middle')).join('');
  }
  function pointTip(row, model, bucket) {
    const e = model.events.filter(event => event.signalTime === row.end);
    return date(row.time) + ' UTC · ' + model.history.instrument + ' · ' + model.history.sourceId + '\n' +
      'O ' + exact(row.open) + ' · H ' + exact(row.high) + ' · L ' + exact(row.low) + ' · C ' + exact(row.close) + ' USDT\n' +
      'Volume ' + exact(row.quote) + ' · Mua ' + exact(row.buy) + ' · Bán ' + exact(row.sell) + ' · Δ ' + exact(row.delta) + ' USDT\n' +
      'EMA50 ' + exact(row.ema50) + ' · EMA200 ' + exact(row.ema200) + ' USDT\n' +
      (bucket ? 'Kỳ ' + model.aggregationDays + 'D: ' + date(bucket.time) + ' → ' + date(bucket.end) + ' · ' + bucket.observedDays + '/' + bucket.days + ' ngày\nΔ kỳ ' + exact(bucket.delta) + ' USDT · Volume/nền30D ' + exact(bucket.intensity) + '×\n' : '') +
      e.map(event => EVENT_LABELS[event.signal] + (event.firstObservable ? ' (lần đầu đủ đầu vào)' : '')).join(' · ');
  }
  function hitAreas(model, d, x, y, type) {
    const step = (d.right - d.left) / Math.max(1, (model.to + 1 - model.from) / DAY);
    return model.visible.map((r, index) => {
      const tip = pointTip(r, model, model.buckets.find(b => r.time >= b.time && r.end <= b.end));
      return '<g class="cf-sample" data-cf-sample="' + index + '" data-cf-time="' + r.time + '" data-cf-tip="' + esc(tip) + '" tabindex="' + (index === 0 ? '0' : '-1') + '" role="img" aria-label="' + esc(tip) + '"><title>' + esc(tip) + '</title><rect class="cf-hit" x="' + coord(x(r.time) - step / 2) + '" y="' + d.top + '" width="' + coord(Math.max(.5, step)) + '" height="' + (type === 'price' ? 448 - d.top : d.bottom - d.top) + '"/><line class="cf-crosshair" x1="' + coord(x(r.time)) + '" x2="' + coord(x(r.time)) + '" y1="' + d.top + '" y2="' + (type === 'price' ? 448 : d.bottom) + '"/><circle class="cf-crosshair-dot" cx="' + coord(x(r.time)) + '" cy="' + coord(y(r.close)) + '" r="4"/></g>';
    }).join('');
  }

  function priceChart(model, options = {}) {
    const d = dimensions(options.width, 'price'), rows = model.visible;
    const enabled = ['ema50', 'ema200'].filter(k => options[k] !== false);
    const y = scale(rows.flatMap(r => [r.low, r.high, ...enabled.map(k => r[k])]), d.bottom, d.top, { nonnegative: true });
    const x = t => d.left + ((t - model.from + DAY / 2) / (model.to + 1 - model.from)) * (d.right - d.left);
    const barWidth = Math.max(.7, (d.right - d.left) / ((model.to + 1 - model.from) / DAY) * .65);
    const maxVolume = Math.max(...rows.map(r => finite(r.quote) ? r.quote : 0)) || 1;
    let svg = '<svg class="cf-svg cf-price-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + d.w + ' ' + d.h + '" role="group" aria-label="' + esc(model.history.instrument) + ' nến, volume, EMA50 và EMA200 · USDT"><title>Nến ngày đã đóng và trung bình giá · ' + esc(model.history.instrument) + '</title>';
    svg += grid(d, y, 'price') + text(d.right + 9, 13, 'USDT', 'cf-unit') + text(d.left, 371, 'VOLUME · USDT', 'cf-unit');
    for (const r of rows) {
      const px = x(r.time), color = r.close >= r.open ? COLORS.up : COLORS.down;
      svg += '<g class="cf-candle" data-cf-candle="' + r.time + '"><line x1="' + coord(px) + '" x2="' + coord(px) + '" y1="' + coord(y.map(r.high)) + '" y2="' + coord(y.map(r.low)) + '" stroke="' + color + '"/><rect x="' + coord(px - barWidth / 2) + '" y="' + coord(Math.min(y.map(r.open), y.map(r.close))) + '" width="' + coord(barWidth) + '" height="' + coord(Math.max(.6, Math.abs(y.map(r.open) - y.map(r.close)))) + '" fill="' + color + '"/></g>';
      if (finite(r.quote)) {
        const v = r.quote / maxVolume * 67;
        const event = model.events.find(e => e.signalTime === r.end && e.signal === 'volumeAnomaly');
        svg += '<rect class="cf-volume" data-cf-volume="' + r.time + '" x="' + coord(px - barWidth / 2) + '" y="' + coord(448 - v) + '" width="' + coord(barWidth) + '" height="' + coord(v) + '" fill="' + (event ? COLORS.volumeAnomaly : color) + '"/>';
      }
    }
    const latest = rows.at(-1), lastLabels = [{ key: 'close', label: 'Close', value: latest.close, time: latest.time, color: latest.close >= latest.open ? COLORS.up : COLORS.down }];
    for (const key of enabled) {
      const p = path(rows, key, x, y.map);
      if (p) svg += '<path class="cf-price-line ' + key + '" data-cf-series="' + key + '" d="' + p + '" stroke="' + COLORS[key] + '"/>';
      // Only a value on the final visible day can be labeled as its current EMA.
      if (finite(latest[key])) lastLabels.push({ key, label: key.toUpperCase(), value: latest[key], time: latest.time, color: COLORS[key] });
    }
    for (const l of labels(lastLabels.map(l => ({ ...l, y: y.map(l.value) })), d.top, d.bottom)) {
      svg += '<g class="cf-last-label" data-cf-label="' + l.key + '" data-cf-label-y="' + coord(l.labelY) + '"><title>' + esc(l.label + ' · ' + date(l.time) + ' · ' + exact(l.value) + ' USDT') + '</title><polyline fill="none" stroke="' + l.color + '" points="' + coord(x(latest.time)) + ',' + coord(l.y) + ' ' + d.right + ',' + coord(l.y) + ' ' + (d.right + 53) + ',' + coord(l.labelY) + '"/><rect x="' + (d.right + 53) + '" y="' + coord(l.labelY - 15) + '" width="87" height="30" rx="3" fill="#101a29" stroke="' + l.color + '"/>' + text(d.right + 58, l.labelY - 3, l.label, 'cf-last-name') + text(d.right + 58, l.labelY + 10, price(l.value), 'cf-last-value') + '</g>';
    }
    svg += '<line class="cf-grid" x1="' + d.left + '" x2="' + d.right + '" y1="448" y2="448"/>' + text(d.right + 8, 445, human(maxVolume), 'cf-axis');
    svg += timeAxis(model, d, x, 448) + hitAreas(model, d, x, y.map, 'price');
    return svg + '</svg>';
  }

  function flowChart(model, options = {}) {
    const mode = options.flowMode ?? 'intensity';
    if (!['intensity', 'delta'].includes(mode)) throw Error('Invalid flow display measure');
    const d = dimensions(options.width, 'flow'), rows = model.visible, hidden = new Set(options.hiddenEvents || []);
    const buckets = model.fullVisibleBuckets;
    const field = mode === 'intensity' ? 'intensity' : 'delta';
    const yFlow = scale(buckets.map(b => b[field]).concat(mode === 'intensity' ? [1] : []), d.bottom, d.top + 8, { zero: true, nonnegative: mode === 'intensity' });
    const yPrice = scale(rows.map(r => r.close), d.bottom, d.top + 8, { nonnegative: true });
    const x = t => d.left + ((t - model.from + DAY / 2) / (model.to + 1 - model.from)) * (d.right - d.left);
    const duration = model.to + 1 - model.from;
    const barWidth = (d.right - d.left) / duration * model.aggregationDays * DAY * .65;
    let svg = '<svg class="cf-svg cf-flow-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + d.w + ' ' + d.h + '" role="group" aria-label="' + esc(model.history.instrument) + ' giá và ' + (mode === 'intensity' ? 'volume so với nền trước 30 ngày' : 'mua trừ bán chủ động bằng USDT') + '"><title>Giá và lực khớp lệnh · ' + esc(model.history.instrument) + '</title>';
    svg += grid(d, yFlow, mode, false) + text(d.left, 13, mode === 'intensity' ? 'VOLUME / NỀN · ×' : 'MUA − BÁN · USDT', 'cf-unit') + text(d.right + 9, 13, 'GIÁ · USDT', 'cf-unit');
    for (const tick of yPrice.ticks) svg += text(d.right + 9, tick.y + 4, price(tick.value), 'cf-axis');
    for (const b of buckets) {
      if (!finite(b[field])) continue;
      const bx = x(b.time + (b.days - 1) * DAY / 2), py = yFlow.map(b[field]), zero = yFlow.map(0);
      const selectedEvents = model.events.filter(e => e.signalTime >= b.time && e.signalTime <= b.end && !hidden.has(e.signal));
      const primary = EVENT_ORDER.find(name => selectedEvents.some(e => e.signal === name));
      const fill = primary ? COLORS[primary] : mode === 'delta' ? b.delta >= 0 ? COLORS.up : COLORS.down : '#264756';
      const tip = date(b.time) + ' → ' + date(b.end) + ' · ' + b.days + 'D\nΔ ' + exact(b.delta) + ' USDT\nVolume ' + exact(b.quote) + ' USDT\nNền: ' + date(b.priorFrom) + ' → ' + date(b.priorTo) + '\nVolume/nền30D ' + exact(b.intensity) + '×';
      svg += '<rect class="cf-flow-column" data-cf-bucket="' + b.time + '" data-cf-measure="' + field + '" data-cf-value="' + b[field] + '" x="' + coord(bx - barWidth / 2) + '" y="' + coord(Math.min(zero, py)) + '" width="' + coord(Math.max(.7, barWidth)) + '" height="' + coord(Math.abs(zero - py)) + '" fill="' + fill + '"><title>' + esc(tip) + '</title></rect>';
    }
    svg += '<line class="cf-zero" x1="' + d.left + '" x2="' + d.right + '" y1="' + coord(yFlow.map(0)) + '" y2="' + coord(yFlow.map(0)) + '"/>';
    if (mode === 'intensity') svg += '<line class="cf-baseline" x1="' + d.left + '" x2="' + d.right + '" y1="' + coord(yFlow.map(1)) + '" y2="' + coord(yFlow.map(1)) + '"/>';
    svg += '<path class="cf-flow-price" data-cf-series="flow-price" d="' + path(rows, 'close', x, yPrice.map) + '" stroke="' + COLORS.price + '"/>';
    const grouped = new Map();
    for (const e of model.events.filter(e => !hidden.has(e.signal))) {
      if (!grouped.has(e.signalTime)) grouped.set(e.signalTime, []);
      grouped.get(e.signalTime).push(e);
    }
    for (const [time, events] of grouped) {
      const px = x(time + 1 - DAY), py = yPrice.map(events[0].referenceClose);
      const primary = EVENT_ORDER.find(name => events.some(e => e.signal === name));
      svg += '<g class="cf-event" data-cf-event-time="' + time + '"><title>' + esc(date(time) + '\n' + events.map(e => EVENT_LABELS[e.signal] + ' · ' + Intelligence.DEFINITIONS[e.signal].formula).join('\n')) + '</title><circle cx="' + coord(px) + '" cy="' + coord(py) + '" r="6" fill="' + COLORS[primary] + '" fill-opacity=".16"/><circle cx="' + coord(px) + '" cy="' + coord(py) + '" r="3" stroke="' + COLORS[primary] + '" fill="#09131d"/></g>';
    }
    const last = rows.at(-1), py = yPrice.map(last.close);
    svg += '<line class="cf-latest-price" x1="' + d.left + '" x2="' + d.right + '" y1="' + coord(py) + '" y2="' + coord(py) + '"/>';
    svg += text(d.right + 9, Math.max(29, py - 8), price(last.close), 'cf-price-value');
    svg += timeAxis(model, d, x, d.bottom) + hitAreas(model, d, x, yPrice.map, 'flow');
    if (!buckets.some(b => finite(b[field]))) svg += text((d.left + d.right) / 2, 196, mode === 'intensity' ? 'Chưa đủ 30 ngày nền và kỳ volume đầy đủ' : 'Chưa có kỳ taker đầy đủ', 'cf-empty-text', 'middle');
    return svg + '</svg>';
  }

  function navigator(model) {
    const rows = model.rows, w = 1000, h = 44, x = t => (t - rows[0].time + DAY / 2) / (model.cutoff + 1 - rows[0].time) * w;
    const y = scale(rows.map(r => r.close), 38, 6, { nonnegative: true });
    const start = (model.from - rows[0].time) / (model.cutoff + 1 - rows[0].time) * w;
    const width = (model.to + 1 - model.from) / (model.cutoff + 1 - rows[0].time) * w;
    const fromIndex = rows.findIndex(r => r.time === model.from), toIndex = rows.findIndex(r => r.end === model.to);
    return '<div class="cf-navigator"><svg viewBox="0 0 1000 44" preserveAspectRatio="none" aria-hidden="true"><path class="cf-navigator-price" d="' + path(rows, 'close', x, y.map) + '"/><rect class="cf-navigator-selection" x="' + coord(start) + '" y="1" width="' + coord(width) + '" height="42" rx="2"/></svg><div class="cf-range-inputs"><label>Từ <span>' + date(model.from) + '</span><input aria-label="Ngày đầu cửa sổ biểu đồ" data-cf-from type="range" min="0" max="' + (rows.length - 1) + '" value="' + fromIndex + '"></label><label>Đến <span>' + date(model.to) + '</span><input aria-label="Ngày cuối cửa sổ biểu đồ" data-cf-to type="range" min="0" max="' + (rows.length - 1) + '" value="' + toIndex + '"></label></div></div>';
  }
  function toggle(key, label, active, className = '') {
    return '<button type="button" class="cf-chip ' + className + (active ? ' is-on' : '') + '" data-cf-toggle="' + key + '" aria-pressed="' + !!active + '"><i></i>' + esc(label) + '</button>';
  }
  function html(model, options = {}) {
    const mode = options.sourceMode === 'network' && options.costAsset && CostView ? 'network' : 'exchange';
    const hidden = new Set(options.hiddenEvents || []), history = model.history;
    const title = mode === 'network' ? options.costAsset.symbol : history.base;
    const source = mode === 'network' ? 'Coin Metrics · ' + options.costAsset.symbol + ' native network · USD' : history.sourceId + ' spot · ' + history.instrument + ' · USDT';
    let priceBody;
    if (mode === 'network') {
      // A Coin Metrics reference is its own explicitly identified dataset. No
      // symbol matching is performed here and it never shares the USDT axes.
      const rows = options.costAsset.rows.filter(r => r.time >= model.from && r.time <= model.to);
      priceBody = CostView.render({ ...options.costAsset, rows }, { width: options.width, windowDays: 10000, showEma50: options.ema50 !== false, showEma200: options.ema200 !== false, showRealized: options.realized !== false });
      let focusIndex = 0;
      priceBody = priceBody.replace(/tabindex="0"/g, () => 'tabindex="' + (focusIndex++ === 0 ? '0' : '-1') + '"');
    } else priceBody = priceChart(model, options);
    const bucketCount = model.fullVisibleBuckets.filter(b => b.complete).length;
    const missing = model.fullVisibleBuckets.filter(b => !b.complete || !finite(b[options.flowMode === 'delta' ? 'delta' : 'intensity'])).length;
    const endTime = mode === 'network' ? options.costAsset.rows.filter(r => r.time >= model.from && r.time <= model.to).at(-1)?.time : model.to;
    const svgIcon = '<span class="cf-icon" aria-hidden="true">◈</span>';
    return '<div class="capital-flow-view"><div class="cf-section-title"><div><span>CAPITAL FLOW & PRICE STRUCTURE</span><h2>Giá và dòng khớp lệnh</h2></div><div class="cf-window-tabs" role="group" aria-label="Khoảng lịch sử">' + [30, 90, 180, 365, 'all'].map(n => '<button type="button" data-cf-window="' + n + '" aria-pressed="' + (options.activeWindow === n) + '">' + (n === 'all' ? 'Tất cả' : n + 'D') + '</button>').join('') + '</div></div>' +
      '<section class="cf-card cf-structure"><header class="cf-card-head">' + svgIcon + '<div><h3>Price Structure · ' + esc(title) + '</h3><p>' + (mode === 'network' ? 'Giá ngày và Realized mạng lưới, cùng nguồn và đơn vị USD.' : 'Nến, khối lượng và cấu trúc giá trên cùng trục thời gian.') + '</p></div><span class="cf-source-badge">' + esc(source) + '</span></header><div class="cf-toolbar"><div class="cf-band-legend">' +
      (options.costAsset && CostView ? '<button type="button" class="cf-chip cf-realized ' + (mode === 'network' && options.realized !== false ? 'is-on' : '') + '" data-cf-realized aria-pressed="' + (mode === 'network' && options.realized !== false) + '" title="Realized mạng lưới được xem riêng bằng USD, cùng nguồn Coin Metrics"><i></i>Realized · USD ↗</button>' : '<span class="cf-unavailable" title="Chưa có tham chiếu Coin Metrics cho tài sản được chọn">Realized · thiếu nguồn</span>') +
      UNKNOWN_BANDS.map(name => '<span class="cf-unavailable" title="Chưa có công thức và dữ liệu nguồn đủ để tái tạo dải ' + name + '">' + name + ' ⓘ</span>').join('') + toggle('ema50', 'EMA50', options.ema50 !== false, 'cf-ema50') + toggle('ema200', 'EMA200', options.ema200 !== false, 'cf-ema200') + '</div>' +
      (options.costAsset && CostView ? '<div class="cf-source-switch" role="group" aria-label="Nguồn và đơn vị biểu đồ"><button type="button" data-cf-source="exchange" aria-pressed="' + (mode === 'exchange') + '">Giá sàn · USDT</button><button type="button" data-cf-source="network" aria-pressed="' + (mode === 'network') + '">Mạng lưới · USD</button></div>' : '') + '</div><div class="cf-chart-scroll">' + priceBody + '</div>' +
      '<div class="cf-readout" data-cf-readout="price" role="status">Rê chuột hoặc dùng ← → trên biểu đồ để đọc đúng từng ngày UTC.</div><footer class="cf-footer"><span><i></i>Quan sát cuối: <strong>' + (endTime === undefined ? 'chưa có trong cửa sổ' : date(endTime) + ' UTC') + '</strong></span><span>' + (mode === 'network' ? 'Realized = PriceUSD / CapMVRVCur · dữ liệu mạng riêng' : model.visible.length + ' nến đã đóng · ' + model.gaps + ' ngày thiếu') + '</span></footer></section>' +
      '<section class="cf-card cf-flow"><header class="cf-card-head">' + svgIcon + '<div><h3>Flow & Price · ' + esc(history.base) + '</h3><p>Cường độ khớp lệnh, sự kiện công khai và phản ứng giá.</p></div><span class="cf-source-badge">' + esc(history.sourceId + ' · USDT · mô hình độc lập') + '</span></header>' +
      '<div class="cf-toolbar"><div class="cf-event-legend" aria-label="Bật tắt sự kiện">' + EVENT_ORDER.map(id => toggle('event:' + id, EVENT_LABELS[id], !hidden.has(id), 'cf-event-' + id)).join('') + '</div><div class="cf-period-tabs" role="group" aria-label="Gộp các ngày đã đóng">' + [1, 7, 30].map(n => '<button type="button" data-cf-period="' + n + '" aria-pressed="' + (model.aggregationDays === n) + '">' + n + 'D</button>').join('') + '</div></div>' +
      '<div class="cf-measure-tabs" role="group" aria-label="Đơn vị dòng khớp lệnh"><button type="button" data-cf-measure="intensity" aria-pressed="' + (options.flowMode !== 'delta') + '">Volume / nền 30D</button><button type="button" data-cf-measure="delta" aria-pressed="' + (options.flowMode === 'delta') + '">Mua − bán · USDT</button></div><div class="cf-chart-scroll">' + flowChart(model, options) + '</div><div class="cf-readout" data-cf-readout="flow" role="status">Cột: kỳ ' + model.aggregationDays + ' ngày không chồng lấn. Đường tím: giá đóng cửa từng ngày, trục phải.</div>' + navigator(model) +
      '<footer class="cf-footer"><span><i></i>Chốt nguồn: <strong>' + date(model.cutoff) + ' UTC</strong></span><span>' + bucketCount + ' kỳ đủ ngày · ' + missing + ' kỳ thiếu đầu vào · ' + model.clippedBuckets + ' kỳ bị cắt ở biên chưa vẽ</span></footer></section>' +
      '<details class="cf-method"><summary>Công thức, đơn vị và bằng chứng của các dấu sự kiện</summary><p>Dữ liệu ' + esc(history.sourceId + ':' + history.instrument) + ' đã đóng đến ' + date(model.cutoff) + ' UTC. Nhận nguồn: ' + esc(new Date(history.fetchedAt).toISOString()) + '. ' + (model.current ? 'Có ngày UTC vừa đóng.' : 'Bản lịch sử chưa có ngày UTC vừa đóng; không xem đây là tín hiệu trực tiếp.') + '</p><p>1D/7D/30D là kỳ không chồng lấn, đếm ngược từ ngày chốt của bản lưu; 30D không phải tháng lịch. Volume/nền = volume bình quân mỗi ngày trong kỳ ÷ volume bình quân 30 ngày liền trước kỳ. Nền không chứa ngày trong kỳ. Mua − bán = 2 × taker-buy quote − total quote, đơn vị USDT. Kỳ thiếu ngày hoặc taker không được điền 0. Đổi ngày chốt có thể đổi ranh giới kỳ.</p><p>Chấm đánh dấu ngày một điều kiện độc lập chuyển sang đúng; chúng dùng nến đã đóng và lịch sử trước ngày đó. Màu cột ưu tiên theo thứ tự chú giải khi nhiều điều kiện cùng xảy ra. Dữ liệu này chưa cho biết danh tính hay tồn kho người mua; các quy tắc không phải công thức MFI/Smart Bands độc quyền của A1.</p><dl>' + EVENT_ORDER.map(id => '<dt>' + EVENT_LABELS[id] + '</dt><dd>' + esc(Intelligence.DEFINITIONS[id].formula) + '</dd>').join('') + '</dl><p>EMA50/200 được khởi tạo bằng trung bình 50/200 giá đóng cửa liên tục; α = 2/(n+1). Tính trên toàn lịch sử trước khi phóng to. Khoảng thiếu ngày ngắt đường và khởi tạo lại EMA. Balance, Delta, Undervalue và Diamond chưa được vẽ vì thiếu đặc tả và dữ liệu nguồn; Realized mạng lưới được hiển thị riêng bằng USD.</p></details></div>';
  }

  function mount(host, input = {}) {
    if (!host || typeof host.querySelector !== 'function') throw Error('Capital flow requires a DOM host');
    let props = { ...input }, model, destroyed = false;
    const state = { windowDays: 180, activeWindow: 180, aggregationDays: 1, flowMode: 'intensity', sourceMode: 'exchange', ema50: true, ema200: true, realized: true, hiddenEvents: [], from: undefined, to: undefined };
    function paint() {
      if (destroyed) return;
      try {
        model = prepare(props.history, { ...state, now: props.now });
        host.innerHTML = html(model, { ...state, costAsset: props.costAsset, width: host.clientWidth || 1100 });
      } catch (error) {
        model = null;
        host.innerHTML = '<section class="capital-flow-view"><p class="cf-empty" role="status">Chưa thể vẽ dữ liệu đã kiểm chứng: ' + esc(error.message) + '</p></section>';
      }
    }
    function focusControl(selector) { host.querySelector(selector)?.focus({ preventScroll: true }); }
    function clicked(event) {
      const button = event.target.closest?.('button');
      if (!button || !host.contains(button) || !model) return;
      let selector = null;
      if (button.hasAttribute('data-cf-window')) {
        const raw = button.dataset.cfWindow;
        state.activeWindow = raw === 'all' ? 'all' : Number(raw);
        state.windowDays = raw === 'all' ? 10000 : Number(raw);
        state.from = undefined; state.to = undefined;
        selector = '[data-cf-window="' + raw + '"]';
      } else if (button.hasAttribute('data-cf-period')) {
        state.aggregationDays = Number(button.dataset.cfPeriod); selector = '[data-cf-period="' + state.aggregationDays + '"]';
      } else if (button.hasAttribute('data-cf-measure')) {
        state.flowMode = button.dataset.cfMeasure; selector = '[data-cf-measure="' + state.flowMode + '"]';
      } else if (button.hasAttribute('data-cf-source')) {
        state.sourceMode = button.dataset.cfSource; selector = '[data-cf-source="' + state.sourceMode + '"]';
      } else if (button.hasAttribute('data-cf-realized')) {
        if (state.sourceMode !== 'network') { state.sourceMode = 'network'; state.realized = true; }
        else state.realized = !state.realized;
        selector = '[data-cf-realized]';
      } else if (button.hasAttribute('data-cf-toggle')) {
        const key = button.dataset.cfToggle;
        if (key.startsWith('event:')) {
          const id = key.slice(6);
          state.hiddenEvents = state.hiddenEvents.includes(id) ? state.hiddenEvents.filter(s => s !== id) : state.hiddenEvents.concat(id);
        } else if (['ema50', 'ema200'].includes(key)) state[key] = !state[key];
        selector = '[data-cf-toggle="' + key + '"]';
      }
      if (selector) { paint(); focusControl(selector); }
    }
    function changed(event) {
      if (!model || !event.target.matches?.('[data-cf-from],[data-cf-to]')) return;
      const isFrom = event.target.hasAttribute('data-cf-from');
      let from = Number(host.querySelector('[data-cf-from]').value), to = Number(host.querySelector('[data-cf-to]').value);
      if (from > to) { if (isFrom) to = from; else from = to; }
      state.from = model.rows[from].time; state.to = model.rows[to].end;
      state.activeWindow = null;
      paint(); focusControl(isFrom ? '[data-cf-from]' : '[data-cf-to]');
    }
    function showSample(sample) {
      if (!sample) return;
      const time = sample.getAttribute('data-cf-time');
      host.querySelectorAll('.cf-sample.is-active').forEach(s => s.classList.remove('is-active'));
      host.querySelectorAll('.cf-sample[data-cf-time="' + time + '"]').forEach(s => s.classList.add('is-active'));
      host.querySelectorAll(state.sourceMode === 'network' ? '[data-cf-readout="flow"]' : '[data-cf-readout]').forEach(r => { r.textContent = sample.getAttribute('data-cf-tip'); });
    }
    function showTarget(event) {
      showSample(event.target.closest?.('.cf-sample'));
      const reference = event.target.closest?.('.cost-reference-sample');
      if (reference) {
        const readout = host.querySelector('[data-cf-readout="price"]');
        if (readout) readout.textContent = reference.getAttribute('data-terminal-tip');
      }
    }
    function pointed(event) { showTarget(event); }
    function focused(event) { showTarget(event); }
    function keyed(event) {
      const sample = event.target.closest?.('.cf-sample,.cost-reference-sample');
      if (!sample || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const samples = [...sample.closest('svg').querySelectorAll(sample.classList.contains('cf-sample') ? '.cf-sample' : '.cost-reference-sample')];
      const current = samples.indexOf(sample);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? samples.length - 1 : Math.max(0, Math.min(samples.length - 1, current + (event.key === 'ArrowLeft' ? -1 : 1)));
      event.preventDefault(); sample.setAttribute('tabindex', '-1'); samples[next].setAttribute('tabindex', '0'); samples[next].focus();
    }
    host.addEventListener('click', clicked);
    host.addEventListener('change', changed);
    host.addEventListener('pointerover', pointed);
    host.addEventListener('focusin', focused);
    host.addEventListener('keydown', keyed);
    paint();
    let lastWidth = host.clientWidth;
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
      const width = host.clientWidth;
      if (width > 0 && Math.abs(width - lastWidth) > 20) { lastWidth = width; paint(); }
    }) : null;
    observer?.observe(host);
    return {
      update(next) {
        const changedAsset = next.history && next.history.key !== props.history?.key;
        props = { ...props, ...next };
        if (changedAsset) { state.from = undefined; state.to = undefined; state.activeWindow = 180; state.windowDays = 180; state.sourceMode = 'exchange'; }
        paint();
      },
      getModel() { return model; },
      destroy() {
        destroyed = true; observer?.disconnect();
        host.removeEventListener('click', clicked); host.removeEventListener('change', changed); host.removeEventListener('pointerover', pointed); host.removeEventListener('focusin', focused); host.removeEventListener('keydown', keyed);
      }
    };
  }
  return Object.freeze({ DAY, COLORS, EVENT_LABELS, EVENT_ORDER, UNKNOWN_BANDS, aggregate, prepare, labels, human, price, priceChart, flowChart, navigator, html, mount });
});
