// ORLA — Cloudflare Worker: pages, API, hourly agent engine and on-chain bot.
import { verifyMessage, getAddress, encodeAbiParameters, concat, keccak256, encodeDeployData, encodeFunctionData } from 'viem';
import { ensureSchema, all, one, run, kvGet, kvSet } from './db.js';
import { tickers, candles, regime } from './data.js';
import { STRATEGIES } from './engine.js';
import { CRYPTO, PERPS, STOCKS, LIVE_MARKETS } from './markets.js';
import * as A from './agents.js';
import * as O from './onchain.js';
import * as HLX from './hl.js';
import { config, resetConfigCache, botAccount, bot, ABI, BYTECODE, TOKENS, UNI, NET, USDG, WETH, pub } from './chain.js';
import { page, PAGES } from './ui/pages.js';
import CSS from './ui/site.css';
import CLIENT from './ui/client.js.txt';
import LOGO3D from './ui/logo3d.js.txt';
import ENGINE_SRC from './engine.js?raw';
import { LOGO_SVG, FAVICON } from './ui/brand.js';

const json = (d, s = 200, h = {}) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...h } });
const err = (m, s = 400) => json({ error: m }, s);
const SESSION_DAYS = 7;

function cookie(req, name) {
  const c = req.headers.get('cookie') || '';
  const m = c.match(new RegExp('(?:^|; )' + name + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]) : null;
}

async function session(env, req) {
  const id = cookie(req, 'orla_s');
  if (!id) return null;
  const s = await one(env, 'SELECT address, expires FROM sessions WHERE id = ?', id);
  if (!s || s.expires < Date.now()) return null;
  return s.address;
}

const isAdmin = (env, a) => !!a && (env.ADMIN_ADDRESS || '').split(',').map((x) => x.trim().toLowerCase()).includes(a.toLowerCase());

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const path = url.pathname;
    try {
      if (path.startsWith('/assets/')) return asset(path, env);
      if (path === '/favicon.svg' || path === '/favicon.ico') return new Response(FAVICON, { headers: { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=86400' } });
      if (path === '/robots.txt') return new Response('User-agent: *\nAllow: /\n', { headers: { 'content-type': 'text/plain' } });
      if (!env.DB && path.startsWith('/api/')) return err('Database not connected: add a D1 binding named DB.', 500);
      await ensureSchema(env);
      if (path.startsWith('/api/')) return await api(req, env, ctx, url);
      if (path.startsWith('/og/agent/')) return await ogCard(env, path.split('/')[3]);
      const key = path.replace(/^\/+|\/+$/g, '') || 'home';
      if (PAGES[key]) {
        const cfg = env.DB ? await config(env).catch(() => ({})) : {};
        let meta = null;
        if (key === 'agent' && url.searchParams.get('id') && env.DB) {
          const a = await one(env, "SELECT name, market, return_pct FROM agents WHERE id = ? AND status != 'deleted'", url.searchParams.get('id')).catch(() => null);
          if (a) meta = { title: `${a.name} · ${a.market.split(':')[1]}`, desc: `${a.name} is ${(a.return_pct || 0) >= 0 ? 'up' : 'down'} ${Math.abs(a.return_pct || 0).toFixed(2)}% — an ORLA trading agent.`, image: `${url.origin}/og/agent/${url.searchParams.get('id')}` };
        }
        return new Response(page(key, { cfg, env, origin: url.origin, meta }), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
      }
      return new Response(page('404', { env, origin: url.origin }), { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } });
    } catch (e) {
      console.error(e);
      if (path.startsWith('/api/')) return err(String(e.message || e).slice(0, 300), 500);
      return new Response('Something went wrong: ' + String(e.message || e), { status: 500 });
    }
  },

  async scheduled(event, env, ctx) {
    if (!env.DB) return;
    await ensureSchema(env);
    const out = {};
    const t = new Date(event.scheduledTime || Date.now());
    try { out.agents = await A.runDue(env, 28); } catch (e) { out.agents = String(e.message); }
    // on-chain jobs share the rest of the subrequest budget; rotate them across the 5-minute ticks
    const slot = Math.floor(t.getUTCMinutes() / 5) % 3;
    try {
      if (slot === 0) out.payroll = await O.payrollJob(env, 12);
      if (slot === 1) out.lp = await O.lpJob(env, 12);
      if (slot === 2) out.swaps = await O.indexSwaps(env, 3);
    } catch (e) { out.job = String(e.message); }
    await kvSet(env, 'health', { at: Date.now(), ...out });
  },
};

// ---------------------------------------------------------------- static assets
const ASSETS = {
  '/assets/site.css': [CSS, 'text/css'],
  '/assets/site.js': [CLIENT, 'text/javascript'],
  '/assets/logo3d.js': [LOGO3D, 'text/javascript'],
  '/assets/engine.js': [ENGINE_SRC, 'text/javascript'],
  '/assets/logo.svg': [LOGO_SVG, 'image/svg+xml'],
};
function asset(path, env) {
  if (path === '/assets/abi.json') {
    return new Response(JSON.stringify({ abi: ABI, tokens: TOKENS, uni: UNI, net: { chainId: NET.chainId, rpc: NET.publicRpc, explorer: NET.explorer }, liveMarkets: LIVE_MARKETS }), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=300' } });
  }
  if (path === '/assets/bytecode.json') return new Response(JSON.stringify(BYTECODE), { headers: { 'content-type': 'application/json' } });
  const a = ASSETS[path];
  if (!a) return new Response('not found', { status: 404 });
  return new Response(a[0], { headers: { 'content-type': a[1] + '; charset=utf-8', 'cache-control': 'public, max-age=300' } });
}

// ---------------------------------------------------------------- API
async function api(req, env, ctx, url) {
  const p = url.pathname.replace(/\/+$/, '');
  const q = Object.fromEntries(url.searchParams);
  const method = req.method;
  const body = method === 'POST' || method === 'PATCH' || method === 'DELETE' ? await req.json().catch(() => ({})) : {};

  // ---- public
  if (p === '/api/health') {
    const h = await kvGet(env, 'health');
    const ok = h && Date.now() - h.at < 15 * 60_000;
    return json({ ok: !!ok, lastCron: h?.at || null, details: h || null, bot: botAccount(env)?.address || null }, ok ? 200 : 503);
  }
  if (p === '/api/config') {
    const cfg = await config(env);
    return json({ ...cfg, bot: botAccount(env)?.address || null, x: env.X_URL || null, github: env.GITHUB_URL || null, chainId: NET.chainId, pool: await O.hookedPool(env) });
  }
  if (p === '/api/stats') return json(await A.stats(env));
  if (p === '/api/strategies') return json({ strategies: STRATEGIES });
  if (p === '/api/markets') {
    const kind = q.kind || 'crypto';
    try { return json({ kind, available: true, rows: await tickers(kind) }); }
    catch (e) { return json({ kind, available: false, rows: [], error: String(e.message) }); }
  }
  if (p === '/api/catalog') return json({ crypto: CRYPTO, perp: PERPS, stock: STOCKS, live: LIVE_MARKETS });
  if (p === '/api/candles') {
    const hours = Math.min(Number(q.hours) || 24 * 30, 24 * 200);
    let bars;
    try { bars = await candles(q.market, hours); } catch (e) { return err('Price history is unavailable for this market right now (' + e.message + ').', 502); }
    return json({ market: q.market, bars }, 200, { 'cache-control': 'public, max-age=120' });
  }
  if (p === '/api/regime') { try { return json(await regime(q.market)); } catch (_) { return json(null); } }
  if (p === '/api/agents/feed') return json({ decisions: await A.feed(env, Number(q.limit) || 8) });
  if (p === '/api/agents/top') return json({ agent: await A.topAgent(env), stats: await A.stats(env) });
  if (p === '/api/agents/leaderboard') return json({ agents: await A.leaderboard(env, q) });
  if (p.startsWith('/api/agents/')) {
    const a = await A.agentDetail(env, p.split('/')[3]);
    return a ? json({ agent: a }) : err('Agent not found.', 404);
  }
  if (p === '/api/pools/stats') return json(await O.poolStats(env));
  if (p === '/api/lp/pools') return json({ pools: [await O.hookedPool(env)].filter(Boolean) });
  if (p.startsWith('/api/lp/vaults/')) {
    const v = p.split('/')[4];
    return json({ log: await all(env, 'SELECT at, action, reason, tx FROM lp_log WHERE vault = ? ORDER BY at DESC LIMIT 50', v.toLowerCase()) });
  }
  if (p === '/api/pons/token') { try { return json(await O.ponsToken(env, q.address)); } catch (e) { return err(e.message); } }
  if (p === '/api/pons/quote') { try { return json(await O.ponsQuote(env, q.token, q.side === 'sell' ? 'sell' : 'buy', q.amount, q.user)); } catch (e) { return err(e.message); } }
  if (p === '/api/newsletter' && method === 'POST') {
    const email = String(body.email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return err('Enter a valid email.');
    await run(env, 'INSERT OR IGNORE INTO newsletter (email, at) VALUES (?, ?)', email, Date.now());
    return json({ ok: true });
  }

  // ---- auth
  if (p === '/api/auth/nonce' && method === 'POST') {
    const address = (() => { try { return getAddress(body.address); } catch (_) { return null; } })();
    if (!address) return err('Bad address.');
    const nonce = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    await run(env, 'DELETE FROM nonces WHERE created < ?', Date.now() - 15 * 60_000);
    await run(env, 'INSERT INTO nonces (nonce, created) VALUES (?, ?)', nonce, Date.now());
    const message = `Sign in to ORLA\n\nThis only proves you own this wallet. It is not a transaction and costs nothing.\n\nWallet: ${address}\nNonce: ${nonce}\nIssued: ${new Date().toISOString()}\nSite: ${url.host}`;
    return json({ message, nonce });
  }
  if (p === '/api/auth/verify' && method === 'POST') {
    const address = getAddress(body.address);
    const m = String(body.message || '').match(/Nonce: ([a-f0-9]{16})/);
    if (!m || !String(body.message).includes(`Wallet: ${address}`) || !String(body.message).includes(`Site: ${url.host}`)) return err('Bad sign-in message.');
    const n = await one(env, 'SELECT created FROM nonces WHERE nonce = ?', m[1]);
    if (!n || Date.now() - n.created > 15 * 60_000) return err('Sign-in expired, try again.');
    let ok = false;
    try { ok = await verifyMessage({ address, message: body.message, signature: body.signature }); } catch (_) {}
    if (!ok) { try { ok = await pub(env).verifyMessage({ address, message: body.message, signature: body.signature }); } catch (_) {} }
    if (!ok) return err('Signature does not match this wallet.', 401);
    await run(env, 'DELETE FROM nonces WHERE nonce = ?', m[1]);
    const id = crypto.randomUUID() + crypto.randomUUID();
    const exp = Date.now() + SESSION_DAYS * 86400_000;
    await run(env, 'INSERT INTO sessions (id, address, expires) VALUES (?, ?, ?)', id, address, exp);
    return json({ address, admin: isAdmin(env, address) }, 200, { 'set-cookie': `orla_s=${id}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}` });
  }
  if (p === '/api/auth/logout' && method === 'POST') {
    const id = cookie(req, 'orla_s');
    if (id) await run(env, 'DELETE FROM sessions WHERE id = ?', id);
    return json({ ok: true }, 200, { 'set-cookie': 'orla_s=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0' });
  }

  const me = await session(env, req);
  if (p === '/api/auth/me') return json({ address: me, admin: isAdmin(env, me) });
  if (!p.startsWith('/api/me') && !p.startsWith('/api/setup')) return err('Not found.', 404);
  if (!me) return err('Sign in with your wallet first.', 401);

  // ---- signed in
  if (p === '/api/me/agents' && method === 'GET') return json({ agents: await A.ownedAgents(env, me), max: (await holderSafe(env, me)).holder ? A.MAX_AGENTS_HOLDER : A.MAX_AGENTS });
  if (p === '/api/me/agents' && method === 'POST') {
    try {
      const h = await holderSafe(env, me);
      return json({ agent: await A.createAgent(env, me, body, { holder: h.holder }) });
    } catch (e) { return err(e.message); }
  }
  if (p.startsWith('/api/me/agents/') && (method === 'PATCH' || method === 'POST')) {
    try { await A.updateAgent(env, me, p.split('/')[4], body); return json({ ok: true }); } catch (e) { return err(e.message); }
  }
  if (p.startsWith('/api/me/agents/') && method === 'DELETE') {
    try { await A.updateAgent(env, me, p.split('/')[4], { action: 'delete' }); return json({ ok: true }); } catch (e) { return err(e.message); }
  }
  if (p === '/api/me/holder') return json(await holderSafe(env, me));
  if (p === '/api/me/vault') { try { return json(await O.vaultInfo(env, me)); } catch (e) { return err(e.shortMessage || e.message, 502); } }
  if (p === '/api/me/payroll') { try { return json(await O.payrollInfo(env, me)); } catch (e) { return err(e.shortMessage || e.message, 502); } }
  if (p === '/api/me/lp') { try { return json(await O.lpInfo(env, me)); } catch (e) { return err(e.shortMessage || e.message, 502); } }
  if (p === '/api/me/alerts') return json({ alerts: await all(env, `SELECT d.at, d.action, d.reason, d.price, a.name, a.id FROM decisions d JOIN agents a ON a.id = d.agent_id WHERE a.owner = ? AND d.action NOT IN ('hold','launch','edit') ORDER BY d.at DESC LIMIT 20`, me) });
  if (p === '/api/me/hl') {
    const network = q.network === 'testnet' || body.network === 'testnet' ? 'testnet' : 'mainnet';
    try {
      if (method === 'GET') {
        const st = await HLX.prepareAgent(env, me, network);
        let acct = null;
        try { acct = await HLX.account(env, me, network); } catch (_) {}
        return json({ network, ...st, account: acct });
      }
      return json(await HLX.confirmAgent(env, me, network, body));
    } catch (e) { return err(e.message); }
  }
  if (p === '/api/me/hl/forget' && method === 'POST') { await HLX.forgetAgent(env, me, body.network === 'testnet' ? 'testnet' : 'mainnet'); return json({ ok: true }); }

  // ---- setup console (admin only)
  if (p.startsWith('/api/setup')) {
    if (!isAdmin(env, me)) return err('Only the admin wallet (ADMIN_ADDRESS) can use setup.', 403);
    if (p === '/api/setup/info') {
      const b = botAccount(env);
      let botEth = null;
      if (b) { try { botEth = Number(await pub(env).getBalance({ address: b.address })) / 1e18; } catch (_) {} }
      return json({ config: await config(env, true), bot: b?.address || null, botEth, admin: me, hlSecret: !!env.HL_SECRET, rpc: env.RPC_URL || NET.publicRpc, uni: UNI, tokens: TOKENS });
    }
    if (p === '/api/setup/save' && method === 'POST') {
      const allowed = ['agentVaultFactory', 'payrollFactory', 'hook', 'hookSalt', 'lpFactory', 'swapRouter', 'poolBlock', 'poolSince', 'poolInitialized', 'token', 'tokenName', 'x', 'github'];
      const stmts = [];
      for (const [k, v] of Object.entries(body)) if (allowed.includes(k)) stmts.push(env.DB.prepare('INSERT INTO config (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').bind(k, JSON.stringify(v)));
      if (stmts.length) await env.DB.batch(stmts);
      resetConfigCache();
      return json({ ok: true, config: await config(env, true) });
    }
    if (p === '/api/setup/bot' && method === 'POST') {
      try { return json(await botDeploy(env, me, body)); } catch (e) { return err(String(e.shortMessage || e.message || e).slice(0, 300)); }
    }
    if (p === '/api/setup/run' && method === 'POST') {
      // run the cron jobs now (for testing)
      await this_scheduled(env);
      return json({ ok: true, health: await kvGet(env, 'health') });
    }
  }
  return err('Not found.', 404);
}

async function this_scheduled(env) {
  const out = {};
  try { out.agents = await A.runDue(env, 28); } catch (e) { out.agents = String(e.message); }
  try { out.payroll = await O.payrollJob(env, 8); } catch (e) { out.payroll = String(e.message); }
  try { out.lp = await O.lpJob(env, 8); } catch (e) { out.lp = String(e.message); }
  try { out.swaps = await O.indexSwaps(env, 2); } catch (e) { out.swaps = String(e.message); }
  await kvSet(env, 'health', { at: Date.now(), ...out });
}

async function holderSafe(env, me) {
  try { return await O.holderBalance(env, me); } catch (_) { return { holder: false, balance: 0, token: null, threshold: 1_000_000 }; }
}

// ---------------------------------------------------------------- share card (SVG)
async function ogCard(env, id) {
  const a = await A.agentDetail(env, id);
  if (!a) return new Response('not found', { status: 404 });
  const pts = a.curve.slice(-120);
  const W = 1200, Hh = 630;
  let path = '', hpath = '';
  if (pts.length > 1) {
    const vals = pts.flatMap((x) => [x[1], x[2]]);
    const mn = Math.min(...vals), mx = Math.max(...vals) || 1;
    const X = (i) => 640 + (i / (pts.length - 1)) * 500, Y = (v) => 470 - ((v - mn) / (mx - mn || 1)) * 280;
    path = pts.map((x, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(x[1]).toFixed(1)}`).join('');
    hpath = pts.map((x, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(x[2]).toFixed(1)}`).join('');
  }
  const r = a.returnPct, vs = a.returnPct - a.holdPct;
  const col = (x) => (x >= 0 ? '#3ccf86' : '#ff6b5a');
  const esc = (s) => String(s).replace(/[<&>"]/g, (c) => ({ '<': '&lt;', '&': '&amp;', '>': '&gt;', '"': '&quot;' }[c]));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${Hh}" viewBox="0 0 ${W} ${Hh}">
<rect width="100%" height="100%" fill="#0e0d0b"/><rect x="40" y="40" width="1120" height="550" rx="28" fill="#171512" stroke="#2b2822"/>
<g transform="translate(84 92) scale(.09)">${LOGO_SVG.replace(/<\/?svg[^>]*>/g, '')}</g>
<text x="140" y="118" font-family="Space Grotesk, Arial" font-size="30" font-weight="700" fill="#f3efe6">ORLA</text>
<text x="1116" y="118" text-anchor="end" font-family="JetBrains Mono, monospace" font-size="20" fill="#8c867a">${a.mode === 'paper' ? 'PAPER AGENT' : 'LIVE AGENT'}</text>
<text x="84" y="230" font-family="Space Grotesk, Arial" font-size="72" font-weight="700" fill="#f3efe6">${esc(a.name)}</text>
<text x="84" y="274" font-family="JetBrains Mono, monospace" font-size="22" fill="#8c867a">${esc(a.strategyLabel)} · ${esc(a.marketLabel)}</text>
<text x="84" y="400" font-family="Space Grotesk, Arial" font-size="110" font-weight="700" fill="${col(r)}">${r >= 0 ? '+' : ''}${r.toFixed(2)}%</text>
<text x="84" y="470" font-family="JetBrains Mono, monospace" font-size="24" fill="#8c867a">vs holding <tspan fill="${col(vs)}">${vs >= 0 ? '+' : ''}${vs.toFixed(2)}%</tspan>  ·  trades ${a.trades}</text>
<path d="${hpath}" fill="none" stroke="#6d675c" stroke-width="3"/><path d="${path}" fill="none" stroke="#ffb020" stroke-width="5"/>
<text x="84" y="550" font-family="JetBrains Mono, monospace" font-size="18" fill="#6d675c">${a.mode === 'paper' ? 'Paper trading: virtual money on live prices.' : 'Live agent.'} Past results do not predict future returns.</text></svg>`;
  return new Response(svg, { headers: { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=600' } });
}


// ---------------------------------------------------------------- setup: deploy with the bot wallet
// For wallets that cap contract-creation gas (e.g. 1.2M). The bot pays gas, then hands admin rights
// to ADMIN (two-step: the admin accepts from their own wallet) and pool ownership to ADMIN.
const HOOK_FLAGS = 0x20c4, HOOK_MASK = 0x3fff;
const POOL_ABI = [{ type: 'function', name: 'initialize', stateMutability: 'nonpayable', inputs: [{ name: 'key', type: 'tuple', components: [{ name: 'currency0', type: 'address' }, { name: 'currency1', type: 'address' }, { name: 'fee', type: 'uint24' }, { name: 'tickSpacing', type: 'int24' }, { name: 'hooks', type: 'address' }] }, { name: 'sqrtPriceX96', type: 'uint160' }], outputs: [{ type: 'int24' }] }];

export function hookInit() {
  return concat([BYTECODE.OrlaHook, encodeAbiParameters([{ type: 'address' }, { type: 'uint24' }, { type: 'uint24' }, { type: 'uint24' }], [UNI.poolManager, 500, 10000, 50])]);
}
export function hookAddress(salt) {
  const h = keccak256(concat(['0xff', UNI.create2, salt, keccak256(hookInit())]));
  return getAddress('0x' + h.slice(-40));
}

async function botDeploy(env, me, { step, salt }) {
  const w = bot(env), pc = pub(env);
  if (!w) throw new Error('BOT_PRIVATE_KEY is not set.');
  const B = w.account.address;
  const admin = getAddress(me);
  const cfg = await config(env, true);
  const gasFor = async (req) => {
    const est = await pc.estimateGas({ account: B, ...req });
    return (est * 13n) / 10n;
  };
  const send = async (req) => {
    const hash = await w.sendTransaction({ ...req, gas: await gasFor(req) });
    const rc = await pc.waitForTransactionReceipt({ hash, timeout: 120_000 });
    if (rc.status !== 'success') throw new Error('Transaction reverted: ' + hash);
    return rc;
  };
  const deploy = async (name, args) => {
    const rc = await send({ data: encodeDeployData({ abi: ABI[name], bytecode: BYTECODE[name], args }) });
    if (!rc.contractAddress) throw new Error(name + ' was not created');
    return rc.contractAddress;
  };
  const write = (address, abi, functionName, args) => send({ to: address, data: encodeFunctionData({ abi, functionName, args }) });
  const save = async (o) => {
    const stmts = Object.entries(o).map(([k, v]) => env.DB.prepare('INSERT INTO config (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').bind(k, JSON.stringify(v)));
    await env.DB.batch(stmts); resetConfigCache();
  };

  if (step === 'avf') {
    if (cfg.agentVaultFactory) throw new Error('Already deployed.');
    const a = await deploy('AgentVaultFactory', [UNI.swapRouter02, B, TOKENS.map((t) => t.address), TOKENS.map((t) => t.feed), TOKENS.map((t) => t.maxStaleness), TOKENS.map((t) => t.feeTier || 0)]);
    await save({ agentVaultFactory: a });
    await write(a, ABI.AgentVaultFactory, 'transferAdmin', [admin]);
    return { ok: true, address: a, pendingAdmin: admin };
  }
  if (step === 'pf') {
    if (cfg.payrollFactory) throw new Error('Already deployed.');
    const a = await deploy('PayrollFactory', [USDG.address]);
    await save({ payrollFactory: a });
    return { ok: true, address: a };
  }
  if (step === 'lpf') {
    if (cfg.lpFactory) throw new Error('Already deployed.');
    const a = await deploy('OrlaLPVaultFactory', [UNI.poolManager, B]);
    await save({ lpFactory: a });
    await write(a, ABI.OrlaLPVaultFactory, 'transferAdmin', [admin]);
    return { ok: true, address: a, pendingAdmin: admin };
  }
  if (step === 'router') {
    if (cfg.swapRouter) throw new Error('Already deployed.');
    const a = await deploy('OrlaSwapRouter', [UNI.poolManager]);
    await save({ swapRouter: a });
    return { ok: true, address: a };
  }
  if (step === 'hook') {
    if (cfg.hook) throw new Error('Already deployed.');
    if (!/^0x[0-9a-fA-F]{64}$/.test(salt || '')) throw new Error('Mine a salt first.');
    const addr = hookAddress(salt);
    if ((parseInt(addr.slice(-4), 16) & HOOK_MASK) !== HOOK_FLAGS) throw new Error('This salt does not give a valid hook address.');
    await send({ to: UNI.create2, data: concat([salt, hookInit()]) });
    const code = await pc.getCode({ address: addr });
    if (!code || code === '0x') throw new Error('Hook not found at ' + addr);
    await save({ hook: addr, hookSalt: salt });
    return { ok: true, address: addr };
  }
  if (step === 'pool') {
    if (!cfg.hook) throw new Error('Deploy the hook first.');
    if (cfg.poolInitialized) throw new Error('Already initialized.');
    const key = { currency0: WETH.address, currency1: USDG.address, fee: 0x800000, tickSpacing: 60, hooks: cfg.hook };
    const id = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'address' }, { type: 'uint24' }, { type: 'int24' }, { type: 'address' }], [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks]));
    const pcfg = await pc.readContract({ address: cfg.hook, abi: ABI.OrlaHook, functionName: 'pools', args: [id] });
    if (/^0x0+$/.test(pcfg[0])) await write(cfg.hook, ABI.OrlaHook, 'registerPool', [key, '0x0000000000000000000000000000000000000000', 0]);
    const bars = await candles('crypto:ETH', 24);
    const eth = bars[bars.length - 1].c;
    const sqrt = BigInt(Math.floor(Math.sqrt(eth * 1e-12) * 2 ** 48)) * 2n ** 48n;
    const rc = await write(UNI.poolManager, POOL_ABI, 'initialize', [key, sqrt]);
    const owner = (await pc.readContract({ address: cfg.hook, abi: ABI.OrlaHook, functionName: 'pools', args: [id] }))[0];
    if (getAddress(owner) === getAddress(B)) await write(cfg.hook, ABI.OrlaHook, 'setOwner', [key, admin]);
    await save({ poolInitialized: true, poolBlock: Number(rc.blockNumber), poolSince: Date.now() });
    return { ok: true, owner: admin };
  }
  throw new Error('Unknown step.');
}
