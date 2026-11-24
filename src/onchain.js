// On-chain reads and bot jobs: vaults, payroll, hooked pool stats, LP agent, Pons tokens, holder check.
import { formatUnits, parseAbi, parseAbiItem, keccak256, encodeAbiParameters } from 'viem';
import { pub, bot, config, ABI, TOKENS, USDG, WETH, UNI, poolKeyFrom, addr } from './chain.js';
import { all, one, run, kvGet, kvSet } from './db.js';

const ZERO = '0x0000000000000000000000000000000000000000';
const isZero = (a) => !a || /^0x0{40}$/i.test(a);
const ERC20 = parseAbi(['function balanceOf(address) view returns (uint256)', 'function decimals() view returns (uint8)', 'function symbol() view returns (string)', 'function name() view returns (string)', 'function allowance(address,address) view returns (uint256)']);

export function poolId(key) {
  return keccak256(encodeAbiParameters(
    [{ type: 'address' }, { type: 'address' }, { type: 'uint24' }, { type: 'int24' }, { type: 'address' }],
    [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks]));
}

// ---------------------------------------------------------------- holder check
export async function holderBalance(env, owner) {
  const cfg = await config(env);
  const token = cfg.token || env.TOKEN_ADDRESS;
  if (!token) return { token: null, balance: 0, holder: false, threshold: 1_000_000 };
  const c = pub(env);
  const [bal, dec] = await c.multicall({ allowFailure: false, contracts: [
    { address: token, abi: ERC20, functionName: 'balanceOf', args: [owner] }, { address: token, abi: ERC20, functionName: 'decimals' }] });
  const b = Number(formatUnits(bal, dec));
  return { token, balance: b, holder: b >= 1_000_000, threshold: 1_000_000 };
}

// ---------------------------------------------------------------- agent vault
export async function vaultInfo(env, owner) {
  const cfg = await config(env);
  if (!cfg.agentVaultFactory) return { enabled: false };
  const c = pub(env);
  const v = await c.readContract({ address: cfg.agentVaultFactory, abi: ABI.AgentVaultFactory, functionName: 'vaultOf', args: [owner] });
  if (isZero(v)) return { enabled: true, factory: cfg.agentVaultFactory, vault: null };
  const calls = [
    { address: v, abi: ABI.AgentVault, functionName: 'paused' },
    { address: v, abi: ABI.AgentVault, functionName: 'operator' },
    { address: v, abi: ABI.AgentVault, functionName: 'maxSlippageBps' },
    { address: v, abi: ABI.AgentVault, functionName: 'dailyLimitUsd' },
    { address: v, abi: ABI.AgentVault, functionName: 'remainingDailyUsd' },
    ...TOKENS.map((t) => ({ address: t.address, abi: ERC20, functionName: 'balanceOf', args: [v] })),
    ...TOKENS.map((t) => ({ address: v, abi: ABI.AgentVault, functionName: 'priceUsd', args: [t.address] })),
  ];
  const r = await c.multicall({ allowFailure: true, contracts: calls });
  const val = (i) => (r[i].status === 'success' ? r[i].result : null);
  const n = TOKENS.length;
  const decs = { USDG: 6, WETH: 18, cbBTC: 8 };
  const balances = TOKENS.map((t, i) => {
    const raw = val(5 + i) ?? 0n;
    const d = decs[t.symbol] ?? 18;
    const amount = Number(formatUnits(raw, d));
    const px = val(5 + n + i);
    const price = px != null ? Number(formatUnits(px, 18)) : null;
    return { symbol: t.symbol, address: t.address, decimals: d, raw: raw.toString(), amount, price, usd: price != null ? amount * price : null };
  });
  const b = bot(env);
  return {
    enabled: true, factory: cfg.agentVaultFactory, vault: v, paused: val(0), operator: val(1),
    botAddress: b ? b.account.address : null, agentAccess: !!(b && val(1) && val(1).toLowerCase() === b.account.address.toLowerCase()),
    maxSlippageBps: Number(val(2) ?? 0), dailyLimitUsd: val(3) != null ? Number(formatUnits(val(3), 18)) : null,
    remainingDailyUsd: val(4) != null ? Number(formatUnits(val(4), 18)) : null,
    balances, totalUsd: balances.reduce((a, x) => a + (x.usd || 0), 0),
  };
}

// ---------------------------------------------------------------- payroll
export async function payrollInfo(env, owner) {
  const cfg = await config(env);
  if (!cfg.payrollFactory) return { enabled: false };
  const c = pub(env);
  const p = await c.readContract({ address: cfg.payrollFactory, abi: ABI.PayrollFactory, functionName: 'payrollOf', args: [owner] });
  if (isZero(p)) return { enabled: true, factory: cfg.payrollFactory, payroll: null };
  const [bal, recips, paused, due] = await c.multicall({ allowFailure: false, contracts: [
    { address: USDG.address, abi: ERC20, functionName: 'balanceOf', args: [p] },
    { address: p, abi: ABI.PayrollVault, functionName: 'getRecipients' },
    { address: p, abi: ABI.PayrollVault, functionName: 'paused' },
    { address: p, abi: ABI.PayrollVault, functionName: 'dueNow' },
  ] });
  const recipients = recips.map((r, id) => ({ id, to: r.to, amount: Number(formatUnits(r.amount, 6)), intervalDays: r.interval / 86400, nextPayAt: Number(r.nextPayAt) * 1000, active: r.active })).filter((r) => r.active);
  const monthly = recipients.reduce((a, r) => a + (r.amount * 30) / r.intervalDays, 0);
  const balance = Number(formatUnits(bal, 6));
  const log = await all(env, 'SELECT at, tx, note FROM payroll_log WHERE payroll = ? ORDER BY at DESC LIMIT 20', p.toLowerCase());
  return { enabled: true, factory: cfg.payrollFactory, payroll: p, balance, paused, recipients, monthlyCost: monthly,
    runwayDays: monthly > 0 ? (balance / monthly) * 30 : null, dueCount: Number(due[0]), dueAmount: Number(formatUnits(due[1], 6)), log };
}

// cron: pay due salaries for every payroll vault (rotating slice)
export async function payrollJob(env, budget = 12) {
  const cfg = await config(env);
  const w = bot(env);
  if (!cfg.payrollFactory || !w) return { skipped: true };
  const c = pub(env);
  const count = Number(await c.readContract({ address: cfg.payrollFactory, abi: ABI.PayrollFactory, functionName: 'payrollCount' }));
  if (!count) return { count };
  let start = (await kvGet(env, 'payroll:cursor')) || 0;
  if (start >= count) start = 0;
  const n = Math.min(40, count - start);
  const list = await c.readContract({ address: cfg.payrollFactory, abi: ABI.PayrollFactory, functionName: 'payrolls', args: [BigInt(start), BigInt(n)] });
  const dues = await c.multicall({ allowFailure: true, contracts: list.map((p) => ({ address: p, abi: ABI.PayrollVault, functionName: 'dueNow' })) });
  let paid = 0;
  for (let i = 0; i < list.length && budget > 1; i++) {
    const d = dues[i];
    if (d.status !== 'success' || d.result[0] === 0n) continue;
    const bal = await c.readContract({ address: USDG.address, abi: ERC20, functionName: 'balanceOf', args: [list[i]] });
    budget--;
    if (bal === 0n) continue;
    try {
      const hash = await w.writeContract({ address: list[i], abi: ABI.PayrollVault, functionName: 'payAllDue' });
      budget--;
      await run(env, 'INSERT INTO payroll_log (payroll, at, tx, note) VALUES (?, ?, ?, ?)', list[i].toLowerCase(), Date.now(), hash, `paid ${d.result[0]} due salaries`);
      paid++;
    } catch (e) {
      await run(env, 'INSERT INTO payroll_log (payroll, at, tx, note) VALUES (?, ?, NULL, ?)', list[i].toLowerCase(), Date.now(), 'payment failed: ' + String(e.shortMessage || e.message).slice(0, 80));
    }
  }
  await kvSet(env, 'payroll:cursor', start + n >= count ? 0 : start + n);
  return { count, checked: list.length, paid };
}

// ---------------------------------------------------------------- hooked pool
export async function hookedPool(env) {
  const cfg = await config(env);
  const key = poolKeyFrom(cfg);
  if (!key) return null;
  return { key, id: poolId(key), label: 'WETH / USDG', symbol0: 'WETH', symbol1: 'USDG', decimals0: 18, decimals1: 6, hook: cfg.hook, router: cfg.swapRouter, lpFactory: cfg.lpFactory, feed0: WETH.feed, feed1: USDG.feed, since: cfg.poolSince || null };
}

const SWAP_EV = parseAbiItem('event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)');

// cron: index swaps of the hooked pool (PoolManager Swap events), 9k blocks per call
export async function indexSwaps(env, calls = 3) {
  const pool = await hookedPool(env);
  if (!pool) return { skipped: true };
  const c = pub(env);
  const head = await c.getBlockNumber();
  let from = BigInt((await kvGet(env, 'swaps:cursor')) || (await config(env)).poolBlock || Number(head) - 9000);
  let added = 0;
  for (let k = 0; k < calls && from <= head; k++) {
    const to = from + 9000n > head ? head : from + 9000n;
    const logs = await c.getLogs({ address: UNI.poolManager, event: SWAP_EV, args: { id: pool.id }, fromBlock: from, toBlock: to });
    if (logs.length) {
      const stmts = [];
      const blocks = {};
      for (const l of logs.slice(0, 50)) {
        if (!blocks[l.blockNumber]) blocks[l.blockNumber] = await c.getBlock({ blockNumber: l.blockNumber }).then((b) => Number(b.timestamp) * 1000).catch(() => Date.now());
        const a0 = Number(formatUnits(l.args.amount0, 18)), a1 = Number(formatUnits(l.args.amount1, 6));
        // amounts are from the pool's view of the swapper: negative = paid by the swapper
        const buy = a1 < 0; // swapper paid USDG → bought WETH
        stmts.push(env.DB.prepare('INSERT OR IGNORE INTO swaps (tx, idx, block, at, buy, usd, fee) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(l.transactionHash, l.logIndex, Number(l.blockNumber), blocks[l.blockNumber], buy ? 1 : 0, Math.abs(a1), l.args.fee));
        void a0;
      }
      await env.DB.batch(stmts);
      added += stmts.length;
    }
    from = to + 1n;
  }
  await kvSet(env, 'swaps:cursor', Number(from));
  return { added, head: Number(head) };
}

export async function poolStats(env) {
  const pool = await hookedPool(env);
  if (!pool) return { enabled: false };
  const c = pub(env);
  const day = Date.now() - 86400_000;
  const [tot, d24, latest] = await Promise.all([
    one(env, 'SELECT COUNT(*) n, COALESCE(SUM(usd),0) v FROM swaps'),
    one(env, 'SELECT COUNT(*) n, COALESCE(SUM(usd),0) v FROM swaps WHERE at >= ?', day),
    all(env, 'SELECT tx, at, buy, usd, fee FROM swaps ORDER BY at DESC, idx DESC LIMIT 8'),
  ]);
  let fee = null;
  try {
    const q = await c.readContract({ address: pool.hook, abi: ABI.OrlaHook, functionName: 'quoteFee', args: [pool.key] });
    fee = { total: q[0] / 1e4, lp: q[1] / 1e4, payroll: q[2] / 1e4, volatility: q[3] / 1e4 };
  } catch (_) { /* pool not initialized yet */ }
  let cfgPool = null;
  try { const pc = await c.readContract({ address: pool.hook, abi: ABI.OrlaHook, functionName: 'pools', args: [pool.id] }); cfgPool = { owner: pc[0], payroll: pc[1], shareBps: Number(pc[2]) }; } catch (_) {}
  const cursor = await kvGet(env, 'swaps:cursor');
  return { enabled: true, pool: { ...pool, key: undefined }, swaps: tot.n, volume: tot.v, swaps24h: d24.n, volume24h: d24.v, fee, payroll: cfgPool && !isZero(cfgPool.payroll) ? cfgPool : null, latest, block: cursor };
}

// ---------------------------------------------------------------- LP vaults
export async function lpInfo(env, owner) {
  const pool = await hookedPool(env);
  if (!pool || !pool.lpFactory) return { enabled: false };
  const c = pub(env);
  const v = await c.readContract({ address: pool.lpFactory, abi: ABI.OrlaLPVaultFactory, functionName: 'vaultOf', args: [owner, pool.id] });
  if (isZero(v)) return { enabled: true, pool: { ...pool, key: pool.key }, vault: null };
  const r = await c.multicall({ allowFailure: true, contracts: [
    { address: v, abi: ABI.OrlaLPVault, functionName: 'positionAmounts' },
    { address: v, abi: ABI.OrlaLPVault, functionName: 'prices' },
    { address: v, abi: ABI.OrlaLPVault, functionName: 'tickLower' },
    { address: v, abi: ABI.OrlaLPVault, functionName: 'tickUpper' },
    { address: v, abi: ABI.OrlaLPVault, functionName: 'paused' },
    { address: v, abi: ABI.OrlaLPVault, functionName: 'operator' },
    { address: WETH.address, abi: ERC20, functionName: 'balanceOf', args: [v] },
    { address: USDG.address, abi: ERC20, functionName: 'balanceOf', args: [v] },
    { address: v, abi: ABI.OrlaLPVault, functionName: 'minWidth' },
    { address: v, abi: ABI.OrlaLPVault, functionName: 'maxWidth' },
    { address: v, abi: ABI.OrlaLPVault, functionName: 'minInterval' },
    { address: v, abi: ABI.OrlaLPVault, functionName: 'maxDeviationBps' },
  ] });
  const g = (i) => (r[i].status === 'success' ? r[i].result : null);
  const pa = g(0), pr = g(1);
  const b = bot(env);
  const log = await all(env, 'SELECT at, action, reason, tx FROM lp_log WHERE vault = ? ORDER BY at DESC LIMIT 30', v.toLowerCase());
  return {
    enabled: true, pool: { ...pool }, vault: v,
    position: pa ? { weth: Number(formatUnits(pa[0], 18)), usdg: Number(formatUnits(pa[1], 6)) } : null,
    idle: { weth: Number(formatUnits(g(6) ?? 0n, 18)), usdg: Number(formatUnits(g(7) ?? 0n, 6)) },
    tick: pr ? pr[0] : null, tickLower: g(2), tickUpper: g(3), paused: g(4), operator: g(5),
    agentAccess: !!(b && g(5) && g(5).toLowerCase() === b.account.address.toLowerCase()),
    params: { minWidth: g(8), maxWidth: g(9), minInterval: g(10) != null ? Number(g(10)) : null, maxDeviationBps: g(11) },
    log,
  };
}

// cron: LP agent — move the range when price leaves it or nears an edge
export async function lpJob(env, budget = 12) {
  const pool = await hookedPool(env);
  const w = bot(env);
  if (!pool || !pool.lpFactory || !w) return { skipped: true };
  const c = pub(env);
  const count = Number(await c.readContract({ address: pool.lpFactory, abi: ABI.OrlaLPVaultFactory, functionName: 'vaultCount' }));
  if (!count) return { count };
  const list = await c.readContract({ address: pool.lpFactory, abi: ABI.OrlaLPVaultFactory, functionName: 'vaults', args: [0n, BigInt(Math.min(count, 60))] });
  const reads = await c.multicall({ allowFailure: true, contracts: list.flatMap((v) => [
    { address: v, abi: ABI.OrlaLPVault, functionName: 'prices' },
    { address: v, abi: ABI.OrlaLPVault, functionName: 'tickLower' },
    { address: v, abi: ABI.OrlaLPVault, functionName: 'tickUpper' },
    { address: v, abi: ABI.OrlaLPVault, functionName: 'liquidity' },
    { address: v, abi: ABI.OrlaLPVault, functionName: 'paused' },
    { address: v, abi: ABI.OrlaLPVault, functionName: 'operator' },
    { address: v, abi: ABI.OrlaLPVault, functionName: 'minWidth' },
    { address: v, abi: ABI.OrlaLPVault, functionName: 'maxWidth' },
    { address: v, abi: ABI.OrlaLPVault, functionName: 'lastRebalance' },
    { address: v, abi: ABI.OrlaLPVault, functionName: 'minInterval' },
    { address: WETH.address, abi: ERC20, functionName: 'balanceOf', args: [v] },
    { address: USDG.address, abi: ERC20, functionName: 'balanceOf', args: [v] },
  ]) });
  const K = 12;
  const lastRun = (await kvGet(env, 'lp:lastrun')) || {};
  let acted = 0;
  for (let i = 0; i < list.length && budget > 1; i++) {
    const v = list[i];
    const g = (j) => (reads[i * K + j].status === 'success' ? reads[i * K + j].result : null);
    const pr = g(0);
    if (!pr) continue;
    const tick = Number(pr[0]), lo = Number(g(1) ?? 0), hi = Number(g(2) ?? 0), liq = g(3) ?? 0n;
    if (g(4) || !g(5) || g(5).toLowerCase() !== w.account.address.toLowerCase()) continue;
    if (Date.now() - (lastRun[v] || 0) < 55 * 60_000) continue; // hourly per vault
    lastRun[v] = Date.now();
    const minW = Number(g(6)), maxW = Number(g(7));
    const since = Date.now() / 1000 - Number(g(8) ?? 0n), minInt = Number(g(9) ?? 0n);
    const idle = (g(10) ?? 0n) > 0n || (g(11) ?? 0n) > 0n;
    const width = hi - lo;
    const edge = width > 0 ? Math.min(tick - lo, hi - tick) / width : -1;
    let reason = null;
    if (liq === 0n && idle) reason = 'opening a range around the price';
    else if (liq > 0n && (tick < lo || tick >= hi)) reason = 'price left the range';
    else if (liq > 0n && edge >= 0 && edge < 0.1) reason = 'price near the edge of the range';
    if (!reason) { await run(env, 'INSERT INTO lp_log (vault, at, action, reason) VALUES (?, ?, ?, ?)', v.toLowerCase(), Date.now(), 'hold', `in range (tick ${tick}, ${lo}…${hi})`); continue; }
    if (liq > 0n && since < minInt) { await run(env, 'INSERT INTO lp_log (vault, at, action, reason) VALUES (?, ?, ?, ?)', v.toLowerCase(), Date.now(), 'hold', `${reason}, waiting for the minimum interval`); continue; }
    // target width: halfway between the owner's bounds, aligned to tick spacing 60
    const sp = 60;
    let wdt = Math.max(minW, Math.min(maxW, Math.round((minW + maxW) / 2 / sp) * sp));
    if (wdt < sp * 2) wdt = sp * 2;
    const center = Math.floor(tick / sp) * sp;
    let nlo = center - Math.floor(wdt / 2 / sp) * sp, nhi = nlo + Math.ceil(wdt / sp) * sp;
    if (!(tick >= nlo && tick < nhi)) { nlo = center; nhi = center + Math.ceil(wdt / sp) * sp; }
    try {
      const hash = await w.writeContract({ address: v, abi: ABI.OrlaLPVault, functionName: 'rebalance', args: [nlo, nhi] });
      budget -= 2;
      await run(env, 'INSERT INTO lp_log (vault, at, action, reason, tx) VALUES (?, ?, ?, ?, ?)', v.toLowerCase(), Date.now(), 'rebalance', `${reason}: new range ${nlo}…${nhi}`, hash);
      acted++;
    } catch (e) {
      const m = String(e.shortMessage || e.message);
      await run(env, 'INSERT INTO lp_log (vault, at, action, reason) VALUES (?, ?, ?, ?)', v.toLowerCase(), Date.now(), 'hold', `${reason}, but ${/Oracle|Deviation/i.test(m) ? 'pool price is too far from Chainlink' : 'rebalance failed: ' + m.slice(0, 60)}`);
    }
  }
  await kvSet(env, 'lp:lastrun', lastRun);
  return { count, acted };
}

// ---------------------------------------------------------------- Pons tokens
const PONS_FACTORY = parseAbi([
  'function getLaunchedToken(address) view returns ((address token, address curve, address deployer, address creatorFeeRecipient, address pairToken, uint256 graduationThreshold, uint24 poolFee, int24 tickSpacing, uint16 creatorTaxBps, bool buybackEnabled, uint8 phase, uint256 sweptQuote, uint256 sweptTokens, uint256 sweptAt, bool exists))',
  'function memeHook() view returns (address)',
]);
export const PONS_CURVE = parseAbi([
  'function buy(uint256 quoteIn, uint256 minTokensOut, address recipient) payable returns (uint256)',
  'function sell(uint256 tokensIn, uint256 minQuoteOut, address recipient) returns (uint256)',
  'function getReserves() view returns (uint256, uint256)',
  'function feeBps() view returns (uint256)',
  'function creatorTaxBps() view returns (uint256)',
  'function currentSnipeTaxBps(address) view returns (uint256)',
  'function graduated() view returns (bool)',
  'function readyToGraduate() view returns (bool)',
  'function graduationThreshold() view returns (uint256)',
  'function realQuoteReserve() view returns (uint256)',
  'function isNativeQuote() view returns (bool)',
  'function sellableTokens() view returns (uint256)',
]);

export async function ponsToken(env, address) {
  const a = addr(address);
  if (!a) throw new Error('That is not a valid contract address.');
  const c = pub(env);
  const t = await c.readContract({ address: UNI.ponsFactory, abi: PONS_FACTORY, functionName: 'getLaunchedToken', args: [a] }).catch(() => null);
  if (!t || !t.exists) throw new Error('This token was not launched on Pons.');
  const [name, symbol, dec, grad, ready, real, native, fee, tax] = await c.multicall({ allowFailure: true, contracts: [
    { address: a, abi: ERC20, functionName: 'name' }, { address: a, abi: ERC20, functionName: 'symbol' }, { address: a, abi: ERC20, functionName: 'decimals' },
    { address: t.curve, abi: PONS_CURVE, functionName: 'graduated' }, { address: t.curve, abi: PONS_CURVE, functionName: 'readyToGraduate' },
    { address: t.curve, abi: PONS_CURVE, functionName: 'realQuoteReserve' }, { address: t.curve, abi: PONS_CURVE, functionName: 'isNativeQuote' },
    { address: t.curve, abi: PONS_CURVE, functionName: 'feeBps' }, { address: t.curve, abi: PONS_CURVE, functionName: 'creatorTaxBps' },
  ] }).then((r) => r.map((x) => (x.status === 'success' ? x.result : null)));
  const graduated = !!grad || !!ready;
  const isNative = !!native || isZero(t.pairToken);
  const pairSym = isNative ? 'ETH' : (TOKENS.find((x) => x.address.toLowerCase() === t.pairToken.toLowerCase())?.symbol || 'TOKEN');
  const pairDec = isNative ? 18 : pairSym === 'USDG' ? 6 : 18;
  const progress = t.graduationThreshold > 0n && real != null ? Math.min(100, Number((real * 10000n) / t.graduationThreshold) / 100) : 0;
  let poolKey = null;
  if (graduated) {
    const hook = await c.readContract({ address: UNI.ponsFactory, abi: PONS_FACTORY, functionName: 'memeHook' }).catch(() => ZERO);
    const pair = isNative ? ZERO : t.pairToken;
    const [c0, c1] = a.toLowerCase() < pair.toLowerCase() ? [a, pair] : [pair, a];
    poolKey = { currency0: c0, currency1: c1, fee: t.poolFee, tickSpacing: t.tickSpacing, hooks: hook };
  }
  return {
    token: a, curve: t.curve, name, symbol, decimals: dec ?? 18, status: graduated ? 'graduated' : 'curve', venue: graduated ? 'uniswap' : 'curve',
    pairToken: isNative ? null : t.pairToken, pairSymbol: pairSym, pairDecimals: pairDec, isNative,
    progressPct: progress, curveFeePct: fee != null ? Number(fee) / 100 : null, creatorTaxPct: tax != null ? Number(tax) / 100 : null,
    poolKey, swappable: !graduated || (graduated && !isNative),
    note: graduated && isNative ? 'This token graduated to a native-ETH Uniswap v4 pool. Swap it on Pons or Uniswap.' : null,
  };
}

const getOut = (inp, rIn, rOut) => (inp * rOut) / (rIn + inp);

export async function ponsQuote(env, address, side, amount, user) {
  const t = await ponsToken(env, address);
  if (t.status !== 'curve') throw new Error(t.note || 'Graduated: quote on Uniswap.');
  const c = pub(env);
  const [[qr, tr], fee, tax, snipe] = await c.multicall({ allowFailure: false, contracts: [
    { address: t.curve, abi: PONS_CURVE, functionName: 'getReserves' }, { address: t.curve, abi: PONS_CURVE, functionName: 'feeBps' },
    { address: t.curve, abi: PONS_CURVE, functionName: 'creatorTaxBps' }, { address: t.curve, abi: PONS_CURVE, functionName: 'currentSnipeTaxBps', args: [user || ZERO] }] });
  const amt = Number(amount);
  if (!(amt > 0)) throw new Error('Enter an amount.');
  let out, inRaw;
  if (side === 'buy') {
    inRaw = BigInt(Math.floor(amt * 10 ** t.pairDecimals));
    const net = inRaw - (inRaw * (fee + tax + snipe)) / 10000n;
    out = getOut(net, qr, tr);
    return { side, venue: 'curve', amountIn: amt, amountInRaw: inRaw.toString(), amountOut: Number(formatUnits(out, t.decimals)), amountOutRaw: out.toString(), minOutRaw: ((out * 99n) / 100n).toString(), feePct: Number(fee + tax + snipe) / 100, token: t };
  }
  inRaw = BigInt(Math.floor(amt * 1e6)) * 10n ** BigInt(t.decimals - 6);
  const gross = getOut(inRaw, tr, qr);
  out = gross - (gross * (fee + tax)) / 10000n;
  return { side, venue: 'curve', amountIn: amt, amountInRaw: inRaw.toString(), amountOut: Number(formatUnits(out, t.pairDecimals)), amountOutRaw: out.toString(), minOutRaw: ((out * 99n) / 100n).toString(), feePct: Number(fee + tax) / 100, token: t };
}
