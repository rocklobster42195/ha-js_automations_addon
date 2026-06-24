/**
 * ha.history computed helpers — "History Repeating" release
 * Pure JS computation on top of ha.history.get(). No HA entities created.
 *
 * All six public functions accept either a string (entity ID, fetches from HA)
 * or an array of { state, last_changed } objects (Option A — external data).
 */

const UNIT_MS = { second: 1000, minute: 60000, hour: 3600000 };

function parsePeriod(value) {
    if (typeof value === 'number') return value;
    const m = String(value).match(/^(\d+(?:\.\d+)?)(s|m|h|d)$/i);
    if (!m) throw new Error(`Invalid period: '${value}'. Use e.g. '30m', '2h', '7d'.`);
    return parseFloat(m[1]) * { s: 1000, m: 60000, h: 3600000, d: 86400000 }[m[2].toLowerCase()];
}

function toNumeric(entries) {
    return entries
        .map(e => ({ t: new Date(e.last_changed).getTime(), v: parseFloat(e.state) }))
        .filter(e => isFinite(e.v));
}

function olsSlope(pts) {
    const n = pts.length;
    if (n < 2) return 0;
    const x0 = pts[0].t;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (const { t, v } of pts) {
        const x = t - x0;
        sumX += x; sumY += v; sumXY += x * v; sumX2 += x * x;
    }
    const denom = n * sumX2 - sumX * sumX;
    return denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
}

function polyFit(xs, ys, d) {
    const deg = d + 1;
    const n = xs.length;
    const VtV = Array.from({ length: deg }, () => new Array(deg).fill(0));
    const Vty = new Array(deg).fill(0);
    for (let i = 0; i < n; i++) {
        const row = Array.from({ length: deg }, (_, j) => Math.pow(xs[i], j));
        for (let j = 0; j < deg; j++) {
            Vty[j] += row[j] * ys[i];
            for (let k = 0; k < deg; k++) VtV[j][k] += row[j] * row[k];
        }
    }
    const M = VtV.map((row, i) => [...row, Vty[i]]);
    for (let col = 0; col < deg; col++) {
        let maxRow = col;
        for (let r = col + 1; r < deg; r++) {
            if (Math.abs(M[r][col]) > Math.abs(M[maxRow][col])) maxRow = r;
        }
        [M[col], M[maxRow]] = [M[maxRow], M[col]];
        if (Math.abs(M[col][col]) < 1e-12) continue;
        for (let r = 0; r < deg; r++) {
            if (r === col) continue;
            const f = M[r][col] / M[col][col];
            for (let k = col; k <= deg; k++) M[r][k] -= f * M[col][k];
        }
    }
    return M.map((row, i) => (Math.abs(row[i]) < 1e-12 ? 0 : row[deg] / row[i]));
}

// Resolves the first argument: array → use as-is, string → fetch from HA.
async function fetchOrUse(ha, source, periodMs) {
    if (Array.isArray(source)) return source;
    return ha.history.get(source, { start: new Date(Date.now() - periodMs), minimalResponse: true });
}

// --- Public API ---

async function trend(ha, source, options = {}) {
    const period      = parsePeriod(options.period ?? '1h');
    const sensitivity = options.sensitivity ?? 0.1;
    const raw = await fetchOrUse(ha, source, period);
    const pts = toNumeric(raw);
    if (pts.length < 2) return 'stable';
    const slopePerHour = olsSlope(pts) * 3600000;
    if (slopePerHour >  sensitivity) return 'rising';
    if (slopePerHour < -sensitivity) return 'falling';
    return 'stable';
}

async function derivative(ha, source, options = {}) {
    const period = parsePeriod(options.period ?? '1h');
    const method = options.method ?? 'linear';
    const scale  = UNIT_MS[options.unit ?? 'minute'];
    const raw = await fetchOrUse(ha, source, period);
    const pts = toNumeric(raw);
    if (pts.length < 2) return 0;

    if (method === 'linear') {
        return olsSlope(pts) * scale;
    }

    const t0 = pts[0].t;
    const tRange = Math.max(pts[pts.length - 1].t - t0, 1);
    const xs = pts.map(p => (p.t - t0) / tRange);
    const ys = pts.map(p => p.v);
    const d = Math.min(options.degree ?? 2, pts.length - 1);
    const coeffs = polyFit(xs, ys, d);
    let dAt1 = 0;
    for (let j = 1; j <= d; j++) dAt1 += j * (coeffs[j] ?? 0);
    return (dAt1 / tRange) * scale;
}

async function integral(ha, source, options = {}) {
    const period = parsePeriod(options.period ?? '1h');
    const method = options.method ?? 'trapezoidal';
    const scale  = UNIT_MS[options.unit ?? 'hour'];
    const raw = await fetchOrUse(ha, source, period);
    const pts = toNumeric(raw);
    if (pts.length < 2) return 0;
    let sum = 0;
    for (let i = 1; i < pts.length; i++) {
        const dt = pts[i].t - pts[i - 1].t;
        if      (method === 'left')  sum += pts[i - 1].v * dt;
        else if (method === 'right') sum += pts[i].v * dt;
        else                         sum += (pts[i - 1].v + pts[i].v) / 2 * dt;
    }
    return sum / scale;
}

async function stats(ha, source, options = {}) {
    const period = parsePeriod(options.period ?? '24h');
    const raw = await fetchOrUse(ha, source, period);
    const values = toNumeric(raw).map(p => p.v);
    const n = values.length;
    if (n === 0) return { mean: NaN, min: NaN, max: NaN, median: NaN, stddev: NaN, count: 0 };
    const mean   = values.reduce((a, b) => a + b, 0) / n;
    const sorted = [...values].sort((a, b) => a - b);
    const median = n % 2 === 0
        ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
        : sorted[Math.floor(n / 2)];
    const stddev = Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / n);
    return { mean, min: sorted[0], max: sorted[n - 1], median, stddev, count: n };
}

async function timeSince(ha, source, state) {
    if (Array.isArray(source)) {
        const raw = source;
        if (raw.length === 0) return NaN;
        if (state === undefined) {
            return Date.now() - new Date(raw[raw.length - 1].last_changed).getTime();
        }
        for (let i = raw.length - 1; i >= 1; i--) {
            if (raw[i].state === state && raw[i - 1].state !== state) {
                return Date.now() - new Date(raw[i].last_changed).getTime();
            }
        }
        return NaN;
    }

    // String entity ID
    if (state === undefined) {
        const s = ha.getState(source);
        return s ? Date.now() - new Date(s.last_changed).getTime() : NaN;
    }
    for (const windowMs of [24 * 3600000, 7 * 86400000]) {
        const raw = await ha.history.get(source, { start: new Date(Date.now() - windowMs), minimalResponse: true });
        for (let i = raw.length - 1; i >= 1; i--) {
            if (raw[i].state === state && raw[i - 1].state !== state) {
                return Date.now() - new Date(raw[i].last_changed).getTime();
            }
        }
        if (raw.length > 0 && raw[0].state !== state) break;
    }
    return NaN;
}

async function timeInState(ha, source, state, options = {}) {
    const endTime   = options.end   ?? new Date();
    const startTime = options.start ?? new Date(endTime.getTime() - parsePeriod(options.period ?? '24h'));
    const raw = Array.isArray(source)
        ? source
        : await ha.history.get(source, { start: startTime, end: endTime, minimalResponse: true });
    if (raw.length === 0) return 0;
    let total = 0;
    for (let i = 0; i < raw.length; i++) {
        if (raw[i].state !== state) continue;
        const from = Math.max(new Date(raw[i].last_changed).getTime(), startTime.getTime());
        const to   = i + 1 < raw.length
            ? Math.min(new Date(raw[i + 1].last_changed).getTime(), endTime.getTime())
            : endTime.getTime();
        if (to > from) total += to - from;
    }
    return total;
}

module.exports = { trend, derivative, integral, stats, timeSince, timeInState };
