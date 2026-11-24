// Agents: create, run hourly, read, rank.
import { STRATEGIES, sanitize, lookback, backtest, step, newBook, equity, signal, START_CASH } from './engine.js';
import { candles, hlFunding, lastPrice } from './data.js';
import { parseMarket, marketLabel, LIVE_MARKETS } from './markets.js';
import { all, one, run } from './db.js';
import { pub, bot, config, ABI, TOKENS, USDG, LIVE_TOKEN } from './chain.js';
import { formatUnits } from 'viem';
import * as HLX from './hl.js';

const H = 3600_000;
export const MAX_AGENTS = 5, MAX_AGENTS_HOLDER = 10;
const nextHour = (t) => Math.floor(t / H) * H + H + 15 * 60_000; // run 15 min after each hour closes

export const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');

export function publicAgent(r) {
  const p = JSON.parse(r.params || '{}');
  const book = JSON.parse(r.book || '{}');
  return {
    id: r.id, name: r.name, owner: short(r.owner), ownerFull: r.owner, strategy: r.strategy,
    strategyLabel: STRATEGIES[r.strategy]?.label || r.strategy, market: r.market, marketLabel: marketLabel(r.market),
    mode: r.mode, hlNetwork: r.hl_network, vault: r.vault, status: r.status, params: p,
    equity: r.equity, startCash: r.start_cash, returnPct: r.return_pct || 0, holdPct: r.hold_pct || 0,
    inPosition: !!book.pos, side: p.side, leverage: p.leverage, entryPrice: book.entry || null, lastPrice: r.last_price,
    trades: r.trades || 0, feesPaid: book.fees || 0, fundingPaid: book.funding || 0,
    backtest: r.backtest ? JSON.parse(r.backtest) : null, createdAt: r.created_at, lastRunAt: r.last_run_at,
    ageHours: (Date.now() - r.created_at) / H, error: r.err || null, sourceId: r.source_id || null,
  };
}

export async function countOwned(env, owner) {
  return (await one(env, "SELECT COUNT(*) n FROM agents WHERE owner = ? AND status != 'deleted'", owner)).n;
}

export async function createAgent(env, owner, body, { holder }) {
  const name = String(body.name || '').trim();
  if (!/^[A-Za-z0-9 _-]{3,32}$/.test(name)) throw new Error('Name must be 3–32 letters or numbers.');
  const m = parseMarket(body.market);
  if (!m) throw new Error('Unknown market.');
  if (!STRATEGIES[body.strategy]) throw new Error('Unknown strategy.');
  const mode = ['paper', 'live', 'hl'].includes(body.mode) ? body.mode : 'paper';
  const hlNetwork = mode === 'hl' ? (body.hlNetwork === 'testnet' ? 'testnet' : 'mainnet') : null;
  const limit = holder ? MAX_AGENTS_HOLDER : MAX_AGENTS;
  if ((await countOwned(env, owner)) >= limit) throw new Error(`You can run up to ${limit} agents.`);
  const p = sanitize(body.strategy, body.params || {}, m.kind);

  let vault = null;
  if (mode === 'live') {
    if (!LIVE_MARKETS.includes(m.id)) throw new Error('Live agents trade ETH, BTC or one of the 10 stock tokens.');
    if (p.side !== 'long' || p.leverage !== 1) throw new Error('Live agents are long-only at 1x.');
    const cfg = await config(env);
    if (!cfg.agentVaultFactory) throw new Error('Live trading is not set up yet.');
    vault = await pub(env).readContract({ address: cfg.agentVaultFactory, abi: ABI.AgentVaultFactory, functionName: 'vaultOf', args: [owner] });
    if (!vault || /^0x0+$/.test(vault)) throw new Error('Create and fund your vault first.');
    const busy = await one(env, "SELECT id FROM agents WHERE vault = ? AND mode = 'live' AND status IN ('active','paused')", vault);
    if (busy) throw new Error('One live agent per vault. Delete the other live agent first.');
  }
  if (mode === 'hl') {
    if (m.kind !== 'perp') throw new Error('Hyperliquid agents trade perpetuals.');
    const k = await one(env, 'SELECT agent_address FROM hl_keys WHERE owner = ? AND network = ?', owner, hlNetwork);
    if (!k) throw new Error('Connect Hyperliquid first (approve an agent wallet).');
  }

  // backtest the last 30 days at launch
  const lb = lookback(body.strategy, p);
  const bars = await candles(m.id, 24 * 30 + lb);
  const bt = backtest(body.strategy, p, bars, 24 * 30);
  const btSummary = bt ? { returnPct: bt.returnPct, holdPct: bt.holdPct, trades: bt.trades, maxDrawdownPct: bt.maxDrawdownPct, winRatePct: bt.winRatePct, sharpe: bt.sharpe } : null;
  const price = bars.length ? bars[bars.length - 1].c : await lastPrice(m.id);

  const id = crypto.randomUUID();
  const now = Date.now();
  const book = newBook();
  await run(env, `INSERT INTO agents (id, owner, name, strategy, market, mode, hl_network, params, book, status, created_at, last_run_at, next_run_at, backtest, start_cash, equity, return_pct, hold_pct, hold_price, trades, last_price, vault, source_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, NULL, ?, ?, ?, ?, 0, 0, ?, 0, ?, ?, ?)`,
    id, owner, name, body.strategy, m.id, mode, hlNetwork, JSON.stringify(p), JSON.stringify(book), now, now, JSON.stringify(btSummary),
    START_CASH, START_CASH, price, price, vault, body.sourceId || null);
  await run(env, 'INSERT INTO decisions (agent_id, at, action, price, reason, equity) VALUES (?, ?, ?, ?, ?, ?)', id, now, 'launch',
    price, `launched in ${mode === 'paper' ? 'paper' : mode === 'live' ? 'live vault' : 'Hyperliquid ' + hlNetwork} mode`, START_CASH);
  if (mode === 'paper') await run(env, 'INSERT OR REPLACE INTO equity (agent_id, t, eq, hold) VALUES (?, ?, ?, ?)', id, now, START_CASH, START_CASH);
  // first decision right away
  const row = await one(env, 'SELECT * FROM agents WHERE id = ?', id);
  try { await runAgent(env, row); } catch (e) { await run(env, 'UPDATE agents SET err = ? WHERE id = ?', String(e.message || e).slice(0, 200), id); }
  return publicAgent(await one(env, 'SELECT * FROM agents WHERE id = ?', id));
}

// ---------------------------------------------------------------- hourly run
export async function runAgent(env, row) {
  const p = JSON.parse(row.params);
  const m = parseMarket(row.market);
  const lb = lookback(row.strategy, p);
  const bars = await candles(m.id, Math.max(lb + 6, 48));
  if (bars.length < 3) throw new Error('no price data');
  const closes = bars.map((b) => b.c);
  const i = closes.length - 1;
  const now = Date.now();
  let book = JSON.parse(row.book);
  let px = closes[i];
  let decisions = [], eq, tx = null;

  if (row.mode === 'paper') {
    const fr = m.kind === 'perp' ? await hlFunding(m.sym).catch(() => 0) : 0;
    decisions = step(row.strategy, p, closes, i, now, book, fr);
    eq = equity(book, px);
  } else if (row.mode === 'live') {
    ({ decisions, eq, book, tx, px } = await runLive(env, row, p, closes, i, book));
  } else {
    ({ decisions, eq, book, tx, px } = await HLX.runHL(env, row, p, closes, i, book));
  }

  const holdPrice = row.hold_price || closes[0];
  const startCash = row.mode === 'paper' ? (row.start_cash || START_CASH) : (book.liveStart || eq || 1);
  const holdEq = (startCash / holdPrice) * px;
  const trades = (row.trades || 0) + decisions.filter((d) => d.action !== 'hold').length;
  const stmts = [
    env.DB.prepare(`UPDATE agents SET book = ?, start_cash = ?, equity = ?, return_pct = ?, hold_pct = ?, trades = ?, last_price = ?, last_run_at = ?, next_run_at = ?, err = NULL WHERE id = ?`)
      .bind(JSON.stringify(book), startCash, eq, (eq / startCash - 1) * 100, (holdEq / startCash - 1) * 100, trades, px, now, nextHour(now), row.id),
    env.DB.prepare('INSERT OR REPLACE INTO equity (agent_id, t, eq, hold) VALUES (?, ?, ?, ?)').bind(row.id, Math.floor(now / H) * H, eq, holdEq),
  ];
  for (const d of decisions) stmts.push(env.DB.prepare('INSERT INTO decisions (agent_id, at, action, price, reason, equity, tx) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(row.id, now, d.action, d.price ?? px, d.reason, eq, d.tx || tx || null));
  await env.DB.batch(stmts);
  return decisions;
}

// live vault agent: long-only, USDG ↔ token through the vault's pinned Uniswap V3 pool
async function runLive(env, row, p, closes, i, book) {
  const client = pub(env);
  const tokSym = LIVE_TOKEN[row.market];
  const tok = TOKENS.find((t) => t.symbol === tokSym);
  const v = row.vault;
  const erc20 = [{ type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
    { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] }];
  const [uBal, tBal, tDec, pxTok, paused, op, remaining] = await client.multicall({
    allowFailure: false,
    contracts: [
      { address: USDG.address, abi: erc20, functionName: 'balanceOf', args: [v] },
      { address: tok.address, abi: erc20, functionName: 'balanceOf', args: [v] },
      { address: tok.address, abi: erc20, functionName: 'decimals' },
      { address: v, abi: ABI.AgentVault, functionName: 'priceUsd', args: [tok.address] },
      { address: v, abi: ABI.AgentVault, functionName: 'paused' },
      { address: v, abi: ABI.AgentVault, functionName: 'operator' },
      { address: v, abi: ABI.AgentVault, functionName: 'remainingDailyUsd' },
    ],
  });
  const usd = Number(formatUnits(uBal, 6));
  const price = Number(formatUnits(pxTok, 18)) || closes[i];
  const held = Number(formatUnits(tBal, tDec));
  const eq = usd + held * price;
  if (!book.liveStart) { book.liveStart = eq; }
  const holding = held * price >= 1;
  // keep strategy state in sync with what the vault actually holds
  if (holding && !book.pos) { book.pos = 1; book.entry = book.entry || price; book.peak = price; }
  if (!holding && book.pos) { book.pos = 0; }
  if (book.pos) book.peak = Math.max(book.peak || price, price);

  const w = bot(env);
  const out = [];
  if (paused) return { decisions: [{ action: 'hold', reason: 'vault is paused', price }], eq, book, px: price };
  if (!w || op.toLowerCase() !== w.account.address.toLowerCase()) return { decisions: [{ action: 'hold', reason: 'agent access was revoked', price }], eq, book, px: price };
  if (eq < 5) return { decisions: [{ action: 'hold', reason: `vault needs at least $5 (has $${eq.toFixed(2)})`, price }], eq, book, px: price };

  // max-24h-loss guard (same as paper)
  book.hwm = (book.hwm || []).filter((x) => x[0] > Date.now() - 24 * H);
  book.hwm.push([Date.now(), eq]);
  const sig = (() => {
    if (p.maxLoss24h > 0) {
      const peak = Math.max(...book.hwm.map((x) => x[1]));
      if (eq <= peak * (1 - p.maxLoss24h / 100)) return book.pos ? { action: 'close', reason: `max 24h loss reached (${p.maxLoss24h}%)` } : { action: 'hold', reason: 'paused after max 24h loss' };
    }
    const c = closes.slice(); c[i] = price;
    return signal(row.strategy, p, c, i, book);
  })();

  const cfg = await config(env);
  const rem = Number(formatUnits(remaining, 18));
  const send = async (tokenIn, tokenOut, amountIn) => {
    const hash = await w.writeContract({ address: v, abi: ABI.AgentVault, functionName: 'swap', args: [tokenIn, tokenOut, tok.feeTier, amountIn, 0n] });
    await client.waitForTransactionReceipt({ hash, timeout: 25_000 }).catch(() => null);
    return hash;
  };
  try {
    if (sig.action === 'open' && !book.pos) {
      let spend = usd * (p.positionPct / 100);
      if (spend > rem) spend = rem;
      if (spend < 1) return { decisions: [{ action: 'hold', reason: rem < 1 ? 'daily limit reached' : 'not enough USDG', price }], eq, book, px: price };
      const amt = BigInt(Math.floor(spend * 1e6));
      const hash = await send(USDG.address, tok.address, amt);
      book.pos = 1; book.entry = price; book.peak = price; book.entryAt = Date.now();
      out.push({ action: 'buy', reason: sig.reason + (spend < usd * (p.positionPct / 100) - 0.01 ? ' (partial: daily limit)' : ''), price, tx: hash });
    } else if (sig.action === 'close' && book.pos) {
      let amt = tBal;
      const valUsd = held * price;
      if (valUsd > rem) amt = (tBal * BigInt(Math.floor((rem / valUsd) * 1e6))) / 1_000_000n;
      if (amt === 0n) return { decisions: [{ action: 'hold', reason: 'daily limit reached', price }], eq, book, px: price };
      const hash = await send(tok.address, USDG.address, amt);
      const r = (price / (book.entry || price) - 1) * 100;
      if (amt === tBal) { book.pos = 0; book.entry = 0; book.peak = 0; }
      out.push({ action: 'sell', reason: `${sig.reason} (${r >= 0 ? '+' : ''}${r.toFixed(2)}%)${amt !== tBal ? ' (partial: daily limit)' : ''}`, price, tx: hash });
    } else {
      out.push({ action: 'hold', reason: sig.reason, price });
    }
  } catch (e) {
    const msg = String(e.shortMessage || e.message || e);
    const why = /Stale|paused/i.test(msg) ? 'oracle price is paused or stale' : /InsufficientOutput|Too little|slippage/i.test(msg) ? 'price moved too much (slippage guard)' : /DailyLimit/.test(msg) ? 'daily limit reached' : /insufficient funds/i.test(msg) ? 'bot has no ETH for gas' : 'trade failed: ' + msg.slice(0, 80);
    out.push({ action: 'hold', reason: why, price });
  }
  void cfg;
  return { decisions: out, eq, book, px: price };
}

// ---------------------------------------------------------------- reads
export async function agentDetail(env, id) {
  const r = await one(env, "SELECT * FROM agents WHERE id = ? AND status != 'deleted'", id);
  if (!r) return null;
  const a = publicAgent(r);
  a.decisions = await all(env, 'SELECT at, action, price, reason, equity, tx FROM decisions WHERE agent_id = ? ORDER BY at DESC LIMIT 400', id);
  a.curve = (await all(env, 'SELECT t, eq, hold FROM equity WHERE agent_id = ? ORDER BY t ASC', id)).map((x) => [x.t, x.eq, x.hold]);
  return a;
}

export async function leaderboard(env, q) {
  const where = ["status IN ('active','paused')"], args = [];
  if (q.market && q.market !== 'all') { where.push('market LIKE ?'); args.push(q.market + ':%'); }
  if (q.mode && q.mode !== 'all') { where.push(q.mode === 'live' ? "mode IN ('live','hl')" : 'mode = ?'); if (q.mode !== 'live') args.push(q.mode); }
  const minTrades = Number(q.minTrades ?? 2) || 0;
  if (minTrades) { where.push('trades >= ?'); args.push(minTrades); }
  const age = Number(q.age ?? 24) || 0;
  if (age) { where.push('created_at <= ?'); args.push(Date.now() - age * H); }
  const order = q.rank === 'vshold' ? '(return_pct - hold_pct) DESC' : 'return_pct DESC';
  let rows = (await all(env, `SELECT * FROM agents WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT 300`, ...args)).map(publicAgent);
  if (q.direction && q.direction !== 'all') rows = rows.filter((a) => a.side === q.direction);
  if (q.leverage === '1') rows = rows.filter((a) => a.leverage === 1);
  if (q.leverage === 'gt1') rows = rows.filter((a) => a.leverage > 1);
  return rows.slice(0, 100);
}

export async function stats(env) {
  const a = await one(env, "SELECT COUNT(*) n, SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) act FROM agents WHERE status != 'deleted'");
  const d = await one(env, 'SELECT COUNT(*) n, SUM(CASE WHEN action NOT IN (\'hold\',\'launch\') THEN 1 ELSE 0 END) t FROM decisions');
  return { agents: a.n || 0, active: a.act || 0, decisions: d.n || 0, trades: d.t || 0 };
}

export async function feed(env, limit = 8) {
  return all(env, `SELECT d.agent_id agentId, a.name agent, a.market, d.at, d.action, d.price, d.reason, d.equity
    FROM decisions d JOIN agents a ON a.id = d.agent_id WHERE a.status != 'deleted' AND d.action != 'launch' ORDER BY d.at DESC LIMIT ?`, Math.min(50, limit));
}

// top agent with its latest decisions (home page "Live right now")
export async function topAgent(env) {
  let r = await one(env, "SELECT * FROM agents WHERE status = 'active' AND trades >= 1 AND created_at <= ? ORDER BY return_pct DESC LIMIT 1", Date.now() - 12 * H);
  if (!r) r = await one(env, "SELECT * FROM agents WHERE status = 'active' ORDER BY return_pct DESC LIMIT 1");
  if (!r) return null;
  const a = publicAgent(r);
  a.decisions = await all(env, "SELECT at, action, price, reason FROM decisions WHERE agent_id = ? AND action != 'launch' ORDER BY at DESC LIMIT 5", r.id);
  return a;
}

// ---------------------------------------------------------------- owner actions
export async function updateAgent(env, owner, id, body) {
  const r = await one(env, "SELECT * FROM agents WHERE id = ? AND owner = ? AND status != 'deleted'", id, owner);
  if (!r) throw new Error('Agent not found.');
  const now = Date.now();
  const log = (reason) => run(env, 'INSERT INTO decisions (agent_id, at, action, price, reason, equity) VALUES (?, ?, ?, ?, ?, ?)', id, now, 'edit', r.last_price, reason, r.equity);
  if (body.action === 'pause') { await run(env, "UPDATE agents SET status = 'paused' WHERE id = ?", id); await log('paused by owner'); }
  else if (body.action === 'resume') { await run(env, "UPDATE agents SET status = 'active', next_run_at = ? WHERE id = ?", now, id); await log('resumed by owner'); }
  else if (body.action === 'delete') {
    await env.DB.batch([
      env.DB.prepare("UPDATE agents SET status = 'deleted' WHERE id = ?").bind(id),
      env.DB.prepare('DELETE FROM decisions WHERE agent_id = ?').bind(id),
      env.DB.prepare('DELETE FROM equity WHERE agent_id = ?').bind(id),
    ]);
  } else if (body.action === 'edit') {
    const m = parseMarket(r.market);
    const old = JSON.parse(r.params);
    const book = JSON.parse(r.book);
    const merged = { ...old, ...(body.params || {}) };
    if (book.pos && (merged.side !== old.side || Number(merged.leverage) !== old.leverage)) throw new Error('Direction and leverage can only change while the agent is in cash.');
    if (r.mode === 'live' && (merged.side === 'short' || Number(merged.leverage) > 1)) throw new Error('Live agents are long-only at 1x.');
    const p = sanitize(r.strategy, merged, m.kind);
    const changed = Object.keys(p).filter((k) => p[k] !== old[k]).map((k) => `${k} ${old[k]} → ${p[k]}`);
    await run(env, 'UPDATE agents SET params = ? WHERE id = ?', JSON.stringify(p), id);
    if (changed.length) await log('settings changed: ' + changed.join(', '));
  } else throw new Error('Unknown action.');
  return true;
}

export async function ownedAgents(env, owner) {
  return (await all(env, "SELECT * FROM agents WHERE owner = ? AND status != 'deleted' ORDER BY created_at DESC", owner)).map(publicAgent);
}

// ---------------------------------------------------------------- cron: run due agents within a subrequest budget
export async function runDue(env, budget = 30) {
  const due = await all(env, "SELECT * FROM agents WHERE status = 'active' AND (next_run_at IS NULL OR next_run_at <= ?) ORDER BY next_run_at ASC LIMIT 60", Date.now());
  const markets = new Set();
  let ran = 0;
  for (const r of due) {
    const cost = (markets.has(r.market) ? 0 : 3) + (r.mode === 'paper' ? 1 : 6);
    if (budget - cost < 0) break;
    budget -= cost;
    markets.add(r.market);
    try { await runAgent(env, r); ran++; }
    catch (e) {
      await run(env, 'UPDATE agents SET err = ?, next_run_at = ? WHERE id = ?', String(e.message || e).slice(0, 200), Date.now() + 10 * 60_000, r.id);
    }
  }
  return { due: due.length, ran };
}
