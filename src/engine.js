// Strategy engine shared by backtests and the hourly agent runner.
// Decisions use hourly closes. Paper cost 0.1% of position notional per trade (leverage included).

export const COST = 0.001;
export const START_CASH = 10_000;

export const STRATEGIES = {
  momentum: {
    label: 'Momentum',
    blurb: 'Long: buys a breakout above the recent high. Short: sells a breakdown below the recent low. Rides the move with a trailing stop.',
    params: { window: [24, 6, 168, 'Breakout window (hours)'], trail: [5, 1, 30, 'Trailing stop (%)'] },
  },
  meanrev: {
    label: 'Mean reversion',
    blurb: 'Long: buys when price is unusually far below its average and sells back at the average. Short does the opposite.',
    params: { avg: [48, 10, 200, 'Average window (hours)'], sigma: [2, 0.5, 4, 'Entry distance (σ)'], stopLoss: [8, 1, 50, 'Stop loss (%)'] },
  },
  rsi: {
    label: 'RSI reversal',
    blurb: 'Long: buys when the RSI is oversold and sells when it is overbought. Short does the opposite.',
    params: { period: [14, 5, 50, 'RSI period (hours)'], buyBelow: [30, 5, 45, 'Buy below'], sellAbove: [70, 55, 95, 'Sell above'] },
  },
  dip: {
    label: 'Buy the dip in an uptrend',
    blurb: 'Long: buys a short dip while price stays above its long trend average, exits on the bounce or the trailing stop.',
    params: { trend: [168, 48, 400, 'Trend average (hours)'], dipWin: [24, 10, 100, 'Dip window (hours)'], depth: [1.5, 0.5, 4, 'Dip depth (σ)'], trail: [6, 1, 30, 'Trailing stop (%)'] },
  },
  custom: {
    label: 'Custom (MA crossover)',
    blurb: 'Long: buys when the fast moving average crosses above the slow one and sells on the cross back. Short does the opposite.',
    params: { fast: [12, 2, 100, 'Fast average (hours)'], slow: [48, 5, 400, 'Slow average (hours)'] },
  },
};

const COMMON = { positionPct: [100, 10, 100], stopLoss: [0, 0, 90], takeProfit: [0, 0, 500], maxLoss24h: [0, 0, 90] };

export function sanitize(strategy, raw = {}, kind = 'crypto') {
  const def = STRATEGIES[strategy];
  if (!def) throw new Error('unknown strategy');
  const p = {};
  const clamp = (v, d, lo, hi) => { v = Number(v); if (!Number.isFinite(v)) v = d; return Math.min(hi, Math.max(lo, v)); };
  for (const [k, [d, lo, hi]] of Object.entries(def.params)) p[k] = clamp(raw[k], d, lo, hi);
  for (const [k, [d, lo, hi]] of Object.entries(COMMON)) if (!(k in p)) p[k] = clamp(raw[k], d, lo, hi);
  if (strategy === 'custom' && p.fast >= p.slow) p.slow = Math.min(400, p.fast + 5);
  for (const k of ['window', 'avg', 'period', 'trend', 'dipWin', 'fast', 'slow']) if (k in p) p[k] = Math.round(p[k]);
  p.side = kind === 'perp' && raw.side === 'short' ? 'short' : 'long';
  p.leverage = kind === 'perp' ? [1, 1.5, 2, 3].includes(Number(raw.leverage)) ? Number(raw.leverage) : 1 : 1;
  return p;
}

export const lookback = (s, p) => {
  switch (s) {
    case 'momentum': return p.window + 2;
    case 'meanrev': return p.avg + 2;
    case 'rsi': return p.period * 3 + 2;
    case 'dip': return Math.max(p.trend, p.dipWin) + 2;
    case 'custom': return p.slow + 2;
  }
  return 50;
};

// ----------------------------------------------------------------- indicators (on closes array, at index i)
const sma = (c, i, n) => { if (i + 1 < n) return null; let s = 0; for (let k = i - n + 1; k <= i; k++) s += c[k]; return s / n; };
const sd = (c, i, n, m) => { let s = 0; for (let k = i - n + 1; k <= i; k++) s += (c[k] - m) ** 2; return Math.sqrt(s / n); };
const hi = (c, i, n) => { let m = -Infinity; for (let k = i - n; k < i; k++) if (c[k] > m) m = c[k]; return m; };
const lo = (c, i, n) => { let m = Infinity; for (let k = i - n; k < i; k++) if (c[k] < m) m = c[k]; return m; };
function rsi(c, i, n) {
  if (i < n * 3) return null;
  let g = 0, l = 0;
  for (let k = i - n * 3 + 1; k <= i - n * 2; k++) { const d = c[k] - c[k - 1]; if (d > 0) g += d; else l -= d; }
  g /= n; l /= n;
  for (let k = i - n * 2 + 1; k <= i; k++) { const d = c[k] - c[k - 1]; g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n; }
  return l === 0 ? 100 : 100 - 100 / (1 + g / l);
}
const pct = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(2)}%`;

// ----------------------------------------------------------------- signal at bar i
// st: { pos: 0 | 1 (long) | -1 (short), entry, peak } — returns { action: 'open'|'close'|'hold', reason }
export function signal(strategy, p, c, i, st) {
  const px = c[i];
  const L = p.side !== 'short';
  const dir = L ? 1 : -1;
  if (st.pos) {
    const movePct = ((px / st.entry - 1) * 100) * dir * p.leverage;
    if (p.stopLoss > 0 && movePct <= -p.stopLoss) return { action: 'close', reason: `stop loss hit (${pct(movePct)})` };
    if (p.takeProfit > 0 && movePct >= p.takeProfit) return { action: 'close', reason: `take profit hit (${pct(movePct)})` };
  }
  switch (strategy) {
    case 'momentum': {
      if (i < p.window) return { action: 'hold', reason: 'warming up' };
      if (!st.pos) {
        if (L) { const h = hi(c, i, p.window); return px > h ? { action: 'open', reason: `breakout above ${p.window}h high` } : { action: 'hold', reason: `no breakout (${pct((px / h - 1) * 100)} vs ${p.window}h high)` }; }
        const l = lo(c, i, p.window); return px < l ? { action: 'open', reason: `breakdown below ${p.window}h low` } : { action: 'hold', reason: `no breakdown (${pct((px / l - 1) * 100)} vs ${p.window}h low)` };
      }
      const ext = L ? Math.max(st.peak, px) : Math.min(st.peak, px);
      const dd = L ? (1 - px / ext) * 100 : (px / ext - 1) * 100;
      if (dd >= p.trail) return { action: 'close', reason: `trailing stop (${p.trail}% from ${L ? 'peak' : 'low'})` };
      return { action: 'hold', reason: `riding the trend, ${pct((px / st.entry - 1) * 100 * dir)} since entry` };
    }
    case 'meanrev': {
      const m = sma(c, i, p.avg);
      if (m == null) return { action: 'hold', reason: 'warming up' };
      const s = sd(c, i, p.avg, m) || 1e-9;
      const z = (px - m) / s;
      if (!st.pos) {
        if (L ? z <= -p.sigma : z >= p.sigma) return { action: 'open', reason: `price ${z.toFixed(2)}σ from its ${p.avg}h average` };
        return { action: 'hold', reason: `price ${z.toFixed(2)}σ from average, waiting for ${L ? '-' : '+'}${p.sigma}σ` };
      }
      if (L ? px >= m : px <= m) return { action: 'close', reason: 'back at the average' };
      const mv = ((px / st.entry - 1) * 100) * dir * p.leverage;
      if (p.stopLoss > 0 && mv <= -p.stopLoss) return { action: 'close', reason: `stop loss hit (${pct(mv)})` };
      return { action: 'hold', reason: `waiting for the average (${z.toFixed(2)}σ)` };
    }
    case 'rsi': {
      const r = rsi(c, i, p.period);
      if (r == null) return { action: 'hold', reason: 'warming up' };
      if (!st.pos) {
        if (L ? r < p.buyBelow : r > p.sellAbove) return { action: 'open', reason: `RSI ${r.toFixed(0)} ${L ? 'below ' + p.buyBelow : 'above ' + p.sellAbove}` };
        return { action: 'hold', reason: `RSI ${r.toFixed(0)}, waiting for ${L ? p.buyBelow : p.sellAbove}` };
      }
      if (L ? r > p.sellAbove : r < p.buyBelow) return { action: 'close', reason: `RSI ${r.toFixed(0)} ${L ? 'above ' + p.sellAbove : 'below ' + p.buyBelow}` };
      return { action: 'hold', reason: `RSI ${r.toFixed(0)}, holding` };
    }
    case 'dip': {
      const t = sma(c, i, p.trend), m = sma(c, i, p.dipWin);
      if (t == null || m == null) return { action: 'hold', reason: 'warming up' };
      const s = sd(c, i, p.dipWin, m) || 1e-9;
      const z = (px - m) / s;
      if (!st.pos) {
        const trendOk = L ? px > t : px < t;
        if (!trendOk) return { action: 'hold', reason: `no ${L ? 'up' : 'down'}trend (price ${L ? 'below' : 'above'} ${p.trend}h average)` };
        if (L ? z <= -p.depth : z >= p.depth) return { action: 'open', reason: `${L ? 'dip' : 'rally'} of ${Math.abs(z).toFixed(2)}σ in a ${L ? 'up' : 'down'}trend` };
        return { action: 'hold', reason: `in ${L ? 'up' : 'down'}trend, waiting for a ${p.depth}σ ${L ? 'dip' : 'rally'} (${z.toFixed(2)}σ)` };
      }
      if (L ? px >= m : px <= m) return { action: 'close', reason: 'bounced back to the short average' };
      const ext = L ? Math.max(st.peak, px) : Math.min(st.peak, px);
      const dd = L ? (1 - px / ext) * 100 : (px / ext - 1) * 100;
      if (dd >= p.trail) return { action: 'close', reason: `trailing stop (${p.trail}%)` };
      return { action: 'hold', reason: `waiting for the bounce (${z.toFixed(2)}σ)` };
    }
    case 'custom': {
      const f = sma(c, i, p.fast), s = sma(c, i, p.slow), f0 = sma(c, i - 1, p.fast), s0 = sma(c, i - 1, p.slow);
      if (f == null || s == null || f0 == null || s0 == null) return { action: 'hold', reason: 'warming up' };
      const up = f > s, crossUp = f0 <= s0 && f > s, crossDn = f0 >= s0 && f < s;
      if (!st.pos) {
        if (L ? crossUp : crossDn) return { action: 'open', reason: `fast MA crossed ${L ? 'above' : 'below'} slow` };
        return { action: 'hold', reason: `fast MA ${up ? 'above' : 'below'} slow` };
      }
      if (L ? crossDn : crossUp) return { action: 'close', reason: `fast MA crossed ${L ? 'below' : 'above'} slow` };
      return { action: 'hold', reason: `fast MA ${up ? 'above' : 'below'} slow, holding` };
    }
  }
  return { action: 'hold', reason: '—' };
}

// ----------------------------------------------------------------- portfolio accounting (shared by sim + live paper)
export function newBook(cash = START_CASH) {
  return { cash, pos: 0, qty: 0, margin: 0, entry: 0, peak: 0, entryAt: 0, fees: 0, funding: 0, hwm: [], paused24Until: 0 };
}

export function equity(b, px) {
  if (!b.pos) return b.cash;
  const pnl = (px - b.entry) * b.qty * b.pos;
  return b.cash + b.margin + pnl;
}

export function open(b, p, px, t) {
  const margin = (equity(b, px) * p.positionPct) / 100;
  if (margin <= 1) return false;
  const notional = margin * p.leverage;
  const fee = notional * COST;
  b.cash -= margin + fee;
  b.fees += fee;
  b.margin = margin;
  b.qty = notional / px;
  b.pos = p.side === 'short' ? -1 : 1;
  b.entry = px;
  b.peak = px;
  b.entryAt = t;
  return true;
}

export function close(b, px) {
  const pnl = (px - b.entry) * b.qty * b.pos;
  const fee = b.qty * px * COST;
  const ret = (pnl / b.margin) * 100;
  b.cash += b.margin + pnl - fee;
  b.fees += fee;
  b.pos = 0; b.qty = 0; b.margin = 0; b.entry = 0; b.peak = 0;
  return ret;
}

// one hourly step: funding, liquidation, max-24h-loss guard, then the strategy signal
export function step(strategy, p, closes, i, t, b, fundingRate = 0) {
  const px = closes[i];
  const events = [];
  if (b.pos && fundingRate) {
    const pay = b.qty * px * fundingRate * b.pos; // longs pay positive funding
    b.cash -= pay; b.funding += pay;
  }
  if (b.pos) {
    b.peak = b.pos > 0 ? Math.max(b.peak, px) : Math.min(b.peak, px);
    const pnl = (px - b.entry) * b.qty * b.pos;
    if (p.leverage > 1 && pnl <= -0.9 * b.margin) {
      const r = close(b, px);
      events.push({ action: 'close', reason: `liquidated (${r.toFixed(1)}% of margin)`, price: px, ret: r });
    }
  }
  const eq = equity(b, px);
  b.hwm = (b.hwm || []).filter((x) => x[0] > t - 24 * 3600_000);
  b.hwm.push([t, eq]);
  if (p.maxLoss24h > 0) {
    const peak24 = Math.max(...b.hwm.map((x) => x[1]));
    if (eq <= peak24 * (1 - p.maxLoss24h / 100)) {
      if (b.pos) { const r = close(b, px); events.push({ action: 'close', reason: `max 24h loss reached (${p.maxLoss24h}%)`, price: px, ret: r }); }
      b.paused24Until = t + 24 * 3600_000;
      if (!events.length) events.push({ action: 'hold', reason: `paused: max 24h loss reached`, price: px });
      return events;
    }
    if (b.paused24Until && t < b.paused24Until && eq < peak24 * (1 - p.maxLoss24h / 100) * 1.0001) {
      events.push({ action: 'hold', reason: 'paused after max 24h loss', price: px });
      return events;
    }
  }
  if (events.length) return events;
  const s = signal(strategy, p, closes, i, b);
  if (s.action === 'open' && !b.pos) {
    if (open(b, p, px, t)) events.push({ action: p.side === 'short' ? 'short' : 'buy', reason: s.reason, price: px });
  } else if (s.action === 'close' && b.pos) {
    const side = b.pos > 0 ? 'sell' : 'cover';
    const r = close(b, px);
    events.push({ action: side, reason: `${s.reason} (${r >= 0 ? '+' : ''}${r.toFixed(2)}%)`, price: px, ret: r });
  } else {
    events.push({ action: 'hold', reason: s.reason, price: px });
  }
  return events;
}

// ----------------------------------------------------------------- backtest
// bars: [{t,c,f?}] — simulates the last `hours` bars, earlier bars only warm up indicators
export function backtest(strategy, p, bars, hours) {
  const closes = bars.map((b) => b.c);
  const startIdx = Math.max(1, bars.length - hours);
  const b = newBook();
  const curve = [], hold = [], marks = [], trades = [];
  let inMarket = 0;
  const holdQty = START_CASH / closes[startIdx];
  for (let i = startIdx; i < bars.length; i++) {
    const ev = step(strategy, p, closes, i, bars[i].t, b, bars[i].f || 0);
    for (const e of ev) {
      if (e.action !== 'hold') {
        marks.push({ t: bars[i].t, a: e.action, p: e.price, r: e.reason });
        if (e.ret != null) trades.push({ ret: e.ret, t: bars[i].t });
      }
      if (e.action === 'buy' || e.action === 'short') trades.openAt = bars[i].t;
      if ((e.action === 'sell' || e.action === 'cover' || e.action === 'close') && trades.openAt) { (trades.holds ||= []).push(bars[i].t - trades.openAt); trades.openAt = 0; }
    }
    if (b.pos) inMarket++;
    curve.push([bars[i].t, equity(b, closes[i])]);
    hold.push([bars[i].t, holdQty * closes[i]]);
  }
  if (!curve.length) return null;
  const end = curve[curve.length - 1][1];
  const ret = (end / START_CASH - 1) * 100;
  const holdRet = (hold[hold.length - 1][1] / START_CASH - 1) * 100;
  let peak = -Infinity, mdd = 0;
  for (const [, v] of curve) { peak = Math.max(peak, v); mdd = Math.min(mdd, (v / peak - 1) * 100); }
  const rets = curve.slice(1).map((x, i) => x[1] / curve[i][1] - 1);
  const mean = rets.reduce((a, c) => a + c, 0) / (rets.length || 1);
  const sdev = Math.sqrt(rets.reduce((a, c) => a + (c - mean) ** 2, 0) / (rets.length || 1));
  const sharpe = sdev > 0 ? (mean / sdev) * Math.sqrt(24 * 365) : 0;
  const wins = trades.filter((x) => x.ret > 0), losses = trades.filter((x) => x.ret <= 0);
  const gw = wins.reduce((a, x) => a + x.ret, 0), gl = -losses.reduce((a, x) => a + x.ret, 0);
  const holds = trades.holds || [];
  const every = Math.max(1, Math.ceil(curve.length / 240));
  const thin = (arr) => arr.filter((_, i) => i % every === 0 || i === arr.length - 1).map(([t, v]) => [t, +v.toFixed(2)]);
  return {
    returnPct: ret, holdPct: holdRet, vsHoldPct: ret - holdRet,
    maxDrawdownPct: mdd, winRatePct: trades.length ? (wins.length / trades.length) * 100 : 0,
    trades: trades.length, sharpe,
    avgHoldHours: holds.length ? holds.reduce((a, x) => a + x, 0) / holds.length / 3600_000 : 0,
    profitFactor: gl > 0 ? gw / gl : gw > 0 ? 99 : 0,
    bestTradePct: trades.length ? Math.max(...trades.map((x) => x.ret)) : 0,
    worstTradePct: trades.length ? Math.min(...trades.map((x) => x.ret)) : 0,
    timeInMarketPct: (inMarket / curve.length) * 100,
    fundingPaid: b.funding, feesPaid: b.fees,
    curve: thin(curve), hold: thin(hold), marks: marks.slice(-200),
  };
}

// ----------------------------------------------------------------- optimizer: fit on first 2/3, test on last 1/3
export function grid(strategy) {
  const G = {
    momentum: { window: [12, 24, 48, 72, 96, 168], trail: [3, 5, 8, 12] },
    meanrev: { avg: [24, 48, 96, 168], sigma: [1, 1.5, 2, 2.5, 3], stopLoss: [5, 10] },
    rsi: { period: [7, 14, 21], buyBelow: [20, 25, 30, 35], sellAbove: [60, 65, 70, 75] },
    dip: { trend: [96, 168, 336], dipWin: [12, 24, 48], depth: [1, 1.5, 2], trail: [4, 8] },
    custom: { fast: [6, 12, 24, 48], slow: [48, 96, 168, 240] },
  }[strategy];
  let combos = [{}];
  for (const [k, vals] of Object.entries(G)) combos = combos.flatMap((c) => vals.map((v) => ({ ...c, [k]: v })));
  return combos.filter((c) => !(c.fast && c.fast >= c.slow));
}
