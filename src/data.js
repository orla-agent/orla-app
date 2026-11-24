// Market data: Binance (spot crypto), Hyperliquid (perps + funding), Yahoo Finance (stocks).
// Everything is cached with the Workers Cache API so repeated calls cost no subrequests.
import { CRYPTO, PERPS, STOCKS, parseMarket, binSym, hlCoin, yahooSym } from './markets.js';

const BIN = 'https://data-api.binance.vision/api/v3';
const HL = 'https://api.hyperliquid.xyz/info';
const YH = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];
const UA = { 'user-agent': 'Mozilla/5.0 (compatible; OrlaBot/1.0)', accept: 'application/json' };
const H = 3600_000;

async function cached(key, ttlSec, fn) {
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const req = new Request('https://cache.orla/' + encodeURIComponent(key));
  if (cache) {
    const hit = await cache.match(req);
    if (hit) return hit.json();
  }
  const val = await fn();
  if (cache && val != null) {
    await cache.put(req, new Response(JSON.stringify(val), { headers: { 'cache-control': `public, max-age=${ttlSec}` } }));
  }
  return val;
}

const j = async (url, init) => {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`${new URL(url).host} ${r.status}`);
  return r.json();
};
const hl = (body) => j(HL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

async function yahoo(path) {
  let err;
  for (const base of YH) {
    try { return await j(base + path, { headers: UA }); } catch (e) { err = e; }
  }
  throw err;
}

// ---------------------------------------------------------------- live prices (tickers)

export async function cryptoTickers() {
  return cached('tick:crypto', 20, async () => {
    const errs = [];
    for (const src of [binanceTickers, okxTickers, hlSpotTickers]) {
      try {
        const rows = await src();
        if (rows.length >= 5) return rows;
        errs.push(src.name + ' empty');
      } catch (e) { errs.push(String(e.message || e)); }
    }
    throw new Error('all crypto price sources failed: ' + errs.join('; '));
  });
}

async function binanceTickers() {
  const syms = CRYPTO.map((c) => binSym(c.sym));
  const rows = await j(`${BIN}/ticker/24hr?type=MINI&symbols=${encodeURIComponent(JSON.stringify(syms))}`).catch(async () => {
    // one bad symbol fails the batch: fall back to the full list and filter
    const all = await j(`${BIN}/ticker/24hr?type=MINI`);
    return all.filter((r) => syms.includes(r.symbol));
  });
  const by = Object.fromEntries(rows.map((r) => [r.symbol, r]));
  return CRYPTO.map((c) => {
    const r = by[binSym(c.sym)];
    if (!r) return null;
    const last = +r.lastPrice, open = +r.openPrice;
    return { symbol: c.sym, name: c.name, price: last, change24h: open ? ((last - open) / open) * 100 : 0, volume24h: +r.quoteVolume };
  }).filter(Boolean);
}

// fallback 1: OKX spot tickers (no key, global)
async function okxTickers() {
  const d = await j('https://www.okx.com/api/v5/market/tickers?instType=SPOT', { headers: UA });
  const by = Object.fromEntries((d.data || []).map((r) => [r.instId, r]));
  return CRYPTO.map((c) => {
    const r = by[`${c.sym}-USDT`];
    if (!r) return null;
    const last = +r.last, open = +r.open24h;
    return { symbol: c.sym, name: c.name, price: last, change24h: open ? ((last - open) / open) * 100 : 0, volume24h: +r.volCcy24h };
  }).filter(Boolean);
}

// fallback 2: Hyperliquid perp marks as a spot proxy
async function hlSpotTickers() {
  const [meta, ctxs] = await hl({ type: 'metaAndAssetCtxs' });
  const idx = Object.fromEntries(meta.universe.map((u, i) => [u.name, i]));
  return CRYPTO.map((c) => {
    const coin = hlCoin(c.sym), i = idx[coin];
    if (i == null) return null;
    const mult = coin.startsWith('k') ? 1 / 1000 : 1;
    const x = ctxs[i], px = +x.markPx * mult, prev = +x.prevDayPx * mult;
    return { symbol: c.sym, name: c.name, price: px, change24h: prev ? ((px - prev) / prev) * 100 : 0, volume24h: +x.dayNtlVlm };
  }).filter(Boolean);
}

export async function perpTickers() {
  return cached('tick:perp', 20, async () => {
    const [meta, ctxs] = await hl({ type: 'metaAndAssetCtxs' });
    const idx = Object.fromEntries(meta.universe.map((u, i) => [u.name, i]));
    return PERPS.map((p) => {
      const i = idx[hlCoin(p.sym)];
      if (i == null) return null;
      const c = ctxs[i];
      const mult = hlCoin(p.sym).startsWith('k') ? 1 / 1000 : 1;
      const px = +c.markPx * mult, prev = +c.prevDayPx * mult;
      return { symbol: p.sym, name: p.name, price: px, change24h: prev ? ((px - prev) / prev) * 100 : 0, volume24h: +c.dayNtlVlm, funding: +c.funding * 100, openInterest: +c.openInterest * px };
    }).filter(Boolean);
  });
}

export async function stockTickers() {
  return cached('tick:stock', 60, async () => {
    const out = [];
    const groups = [];
    for (let i = 0; i < STOCKS.length; i += 20) groups.push(STOCKS.slice(i, i + 20));
    await Promise.all(groups.map(async (g) => {
      const syms = g.map((s) => yahooSym(s.sym)).join(',');
      const d = await yahoo(`/v8/finance/spark?symbols=${syms}&range=5d&interval=1d`).catch(() => null);
      if (!d) return;
      for (const s of g) {
        const r = d[yahooSym(s.sym)];
        if (!r || !r.close || !r.close.length) continue;
        const closes = r.close.filter((x) => x != null);
        const price = closes[closes.length - 1];
        const prev = r.chartPreviousClose && closes.length < 2 ? r.chartPreviousClose : closes[closes.length - 2];
        out.push({ symbol: s.sym, name: s.name, price, change24h: prev ? ((price - prev) / prev) * 100 : 0, volume24h: 0 });
      }
    }));
    const order = Object.fromEntries(STOCKS.map((s, i) => [s.sym, i]));
    return out.sort((a, b) => order[a.symbol] - order[b.symbol]);
  });
}

export async function tickers(kind) {
  if (kind === 'perp' || kind === 'perps') return perpTickers();
  if (kind === 'stock' || kind === 'stocks') return stockTickers();
  return cryptoTickers();
}

// ---------------------------------------------------------------- hourly candles
// returns [{t, c}] oldest → newest, hourly closes; perps also get funding (hourly rate, fraction)

export async function candles(marketId, hours) {
  const m = parseMarket(marketId);
  if (!m) throw new Error('unknown market');
  hours = Math.min(Math.max(hours | 0, 24), 24 * 200);
  const now = Date.now();
  const end = Math.floor(now / H) * H; // last fully-closed hour boundary
  const key = `c:${m.id}:${hours}:${end}`;
  return cached(key, 300, async () => {
    if (m.kind === 'crypto') {
      try {
        const b = await binanceCandles(binSym(m.sym), end - hours * H, end);
        if (b.length) return b;
      } catch (_) { /* fall through */ }
      try {
        const h = await hlCandles(hlCoin(m.sym), end - hours * H, end, false);
        if (h.length) return h.map(({ t, c }) => ({ t, c }));
      } catch (_) { /* fall through */ }
      return okxCandles(m.sym, end - hours * H, end);
    }
    if (m.kind === 'perp') return hlCandles(hlCoin(m.sym), end - hours * H, end, true);
    return yahooCandles(yahooSym(m.sym), hours);
  });
}

async function binanceCandles(sym, start, end) {
  const out = [];
  let from = start;
  while (from < end) {
    const rows = await j(`${BIN}/klines?symbol=${sym}&interval=1h&startTime=${from}&endTime=${end - 1}&limit=1000`);
    if (!rows.length) break;
    for (const r of rows) if (r[6] < Date.now()) out.push({ t: r[0], c: +r[4] });
    from = rows[rows.length - 1][0] + H;
    if (rows.length < 1000) break;
  }
  return out;
}

// OKX hourly closes, paged backwards 100 at a time
async function okxCandles(sym, start, end) {
  const out = [];
  let after = end;
  for (let k = 0; k < 50 && after > start; k++) {
    const d = await j(`https://www.okx.com/api/v5/market/history-candles?instId=${sym}-USDT&bar=1H&after=${after}&limit=100`, { headers: UA });
    const rows = d.data || [];
    if (!rows.length) break;
    for (const r of rows) { const t = +r[0]; if (t >= start && r[8] === '1') out.push({ t, c: +r[4] }); }
    after = +rows[rows.length - 1][0];
  }
  if (!out.length) throw new Error('no price history for ' + sym);
  return out.sort((a, b) => a.t - b.t);
}

async function hlCandles(coin, start, end, withFunding) {
  const mult = coin.startsWith('k') ? 1 / 1000 : 1;
  const rows = await hl({ type: 'candleSnapshot', req: { coin, interval: '1h', startTime: start, endTime: end } });
  const out = rows.filter((r) => r.T < Date.now()).map((r) => ({ t: r.t, c: +r.c * mult, f: 0 }));
  if (withFunding && out.length) {
    try {
      let from = start;
      const fund = {};
      for (let k = 0; k < 10 && from < end; k++) {
        const f = await hl({ type: 'fundingHistory', coin, startTime: from, endTime: end });
        if (!f.length) break;
        for (const x of f) fund[Math.floor(x.time / H) * H] = +x.fundingRate;
        from = f[f.length - 1].time + 1;
        if (f.length < 500) break;
      }
      for (const b of out) b.f = fund[b.t] || 0;
    } catch (_) { /* funding is best-effort */ }
  }
  return out;
}

async function yahooCandles(sym, hours) {
  const range = hours <= 24 * 7 ? '1mo' : hours <= 24 * 30 ? '3mo' : hours <= 24 * 90 ? '6mo' : '1y';
  const d = await yahoo(`/v8/finance/chart/${sym}?interval=1h&range=${range}`);
  const r = d.chart?.result?.[0];
  if (!r) throw new Error('no stock data');
  const ts = r.timestamp || [], cl = r.indicators.quote[0].close || [];
  const out = [];
  for (let i = 0; i < ts.length; i++) if (cl[i] != null) out.push({ t: ts[i] * 1000, c: cl[i] });
  // stocks only trade in market hours: keep the last N calendar hours worth of bars
  const cutoff = Date.now() - hours * H;
  return out.filter((b) => b.t >= cutoff);
}

// latest price for one market (cheap: uses ticker caches)
export async function lastPrice(marketId) {
  const m = parseMarket(marketId);
  const list = await tickers(m.kind);
  const r = list.find((x) => x.symbol === m.sym);
  return r ? r.price : null;
}

export async function hlFunding(sym) {
  const list = await perpTickers();
  const r = list.find((x) => x.symbol === sym);
  return r ? r.funding / 100 : 0;
}

// 7-day description of the market ("regime") — not a forecast
export async function regime(marketId) {
  const bars = await candles(marketId, 24 * 7);
  if (bars.length < 10) return null;
  const c = bars.map((b) => b.c);
  const chg = (c[c.length - 1] / c[0] - 1) * 100;
  const rets = c.slice(1).map((x, i) => Math.log(x / c[i]));
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length) * 100;
  const vol = sd > 1.0 ? 'high' : sd > 0.45 ? 'normal' : 'low';
  const trend = chg > 4 ? 'up' : chg < -4 ? 'down' : 'sideways';
  return { trend, changePct: chg, hourlyVolPct: sd, vol };
}
