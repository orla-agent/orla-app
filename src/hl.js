// Hyperliquid live agents: perps in the user's own Hyperliquid account through an approved
// "agent wallet" (API wallet). The agent key can place orders but can never withdraw.
import { keccak256, concat, toHex, numberToHex } from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { signal } from './engine.js';
import { hlCoin } from './markets.js';
import { one, run } from './db.js';

export const HL_URL = { mainnet: 'https://api.hyperliquid.xyz', testnet: 'https://api.hyperliquid-testnet.xyz' };

// ---------------------------------------------------------------- tiny msgpack encoder (key order preserved)
function mp(v, out) {
  if (v === null || v === undefined) out.push(0xc0);
  else if (v === true) out.push(0xc3);
  else if (v === false) out.push(0xc2);
  else if (typeof v === 'number') {
    if (!Number.isInteger(v)) throw new Error('msgpack: floats not used');
    if (v >= 0 && v < 128) out.push(v);
    else if (v >= 0 && v < 256) out.push(0xcc, v);
    else if (v >= 0 && v < 65536) out.push(0xcd, v >> 8, v & 255);
    else if (v >= 0 && v < 2 ** 32) out.push(0xce, (v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
    else if (v >= 0) { const b = BigInt(v); out.push(0xcf); for (let i = 7; i >= 0; i--) out.push(Number((b >> BigInt(i * 8)) & 255n)); }
    else if (v >= -32) out.push(v & 255);
    else { const b = BigInt.asUintN(64, BigInt(v)); out.push(0xd3); for (let i = 7; i >= 0; i--) out.push(Number((b >> BigInt(i * 8)) & 255n)); }
  } else if (typeof v === 'string') {
    const b = new TextEncoder().encode(v);
    if (b.length < 32) out.push(0xa0 | b.length);
    else if (b.length < 256) out.push(0xd9, b.length);
    else out.push(0xda, b.length >> 8, b.length & 255);
    out.push(...b);
  } else if (Array.isArray(v)) {
    if (v.length < 16) out.push(0x90 | v.length); else out.push(0xdc, v.length >> 8, v.length & 255);
    for (const x of v) mp(x, out);
  } else {
    const ks = Object.keys(v);
    if (ks.length < 16) out.push(0x80 | ks.length); else out.push(0xde, ks.length >> 8, ks.length & 255);
    for (const k of ks) { mp(k, out); mp(v[k], out); }
  }
  return out;
}

async function signL1(account, action, nonce, network) {
  const bytes = new Uint8Array(mp(action, []));
  const nb = new Uint8Array(8);
  new DataView(nb.buffer).setBigUint64(0, BigInt(nonce));
  const connectionId = keccak256(concat([toHex(bytes), toHex(nb), '0x00']));
  const sig = await account.signTypedData({
    domain: { name: 'Exchange', version: '1', chainId: 1337, verifyingContract: '0x0000000000000000000000000000000000000000' },
    types: { Agent: [{ name: 'source', type: 'string' }, { name: 'connectionId', type: 'bytes32' }] },
    primaryType: 'Agent',
    message: { source: network === 'mainnet' ? 'a' : 'b', connectionId },
  });
  return { r: '0x' + sig.slice(2, 66), s: '0x' + sig.slice(66, 130), v: parseInt(sig.slice(130, 132), 16) };
}

const post = async (network, path, body) => {
  const r = await fetch(HL_URL[network] + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error('Hyperliquid ' + r.status);
  return j;
};
export const info = (network, body) => post(network, '/info', body);

async function exchange(network, account, action) {
  const nonce = Date.now();
  const signature = await signL1(account, action, nonce, network);
  const res = await post(network, '/exchange', { action, nonce, signature, vaultAddress: null });
  if (!res || res.status !== 'ok') throw new Error('Hyperliquid: ' + JSON.stringify(res?.response || res).slice(0, 120));
  const st = res.response?.data?.statuses?.[0];
  if (st && st.error) throw new Error('Hyperliquid: ' + st.error);
  return res;
}

// ---------------------------------------------------------------- agent keys (encrypted at rest with HL_SECRET)
async function aesKey(env) {
  if (!env.HL_SECRET) throw new Error('Hyperliquid trading is not enabled on this server (HL_SECRET missing).');
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(env.HL_SECRET));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
const b64 = (u) => btoa(String.fromCharCode(...u));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function encrypt(env, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(env), new TextEncoder().encode(text)));
  return b64(iv) + '.' + b64(ct);
}
async function decrypt(env, s) {
  const [iv, ct] = s.split('.');
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await aesKey(env), unb64(ct)));
}

// step 1: create (or reuse) a pending agent wallet for this owner/network
export async function prepareAgent(env, owner, network) {
  const ex = await one(env, 'SELECT agent_address, enc, created FROM hl_keys WHERE owner = ? AND network = ?', owner, network);
  if (ex && ex.created > 0) return { status: 'connected', agentAddress: ex.agent_address };
  if (ex) return { status: 'pending', agentAddress: ex.agent_address };
  const pk = generatePrivateKey();
  const acct = privateKeyToAccount(pk);
  await run(env, 'INSERT INTO hl_keys (owner, network, agent_address, enc, created) VALUES (?, ?, ?, ?, 0)', owner, network, acct.address, await encrypt(env, pk));
  return { status: 'pending', agentAddress: acct.address };
}

// step 2: the user's wallet signed approveAgent in the browser; we relay it to Hyperliquid
export async function confirmAgent(env, owner, network, { action, nonce, signature }) {
  const ex = await one(env, 'SELECT agent_address FROM hl_keys WHERE owner = ? AND network = ?', owner, network);
  if (!ex) throw new Error('No pending agent wallet.');
  if (!action || action.type !== 'approveAgent' || action.agentAddress.toLowerCase() !== ex.agent_address.toLowerCase()) throw new Error('Bad approval.');
  const res = await post(network, '/exchange', { action, nonce, signature });
  if (!res || res.status !== 'ok') throw new Error('Hyperliquid rejected the approval: ' + JSON.stringify(res?.response || res).slice(0, 120));
  await run(env, 'UPDATE hl_keys SET created = ? WHERE owner = ? AND network = ?', Date.now(), owner, network);
  return { status: 'connected', agentAddress: ex.agent_address };
}

export async function forgetAgent(env, owner, network) {
  await run(env, 'DELETE FROM hl_keys WHERE owner = ? AND network = ?', owner, network);
  await run(env, "UPDATE agents SET status = 'paused', err = 'Hyperliquid disconnected' WHERE owner = ? AND mode = 'hl' AND hl_network = ?", owner, network);
}

export async function account(env, owner, network) {
  const st = await info(network, { type: 'clearinghouseState', user: owner });
  return { accountValue: +st.marginSummary.accountValue, withdrawable: +st.withdrawable, positions: st.assetPositions.map((x) => x.position) };
}

// ---------------------------------------------------------------- hourly run for an hl agent
const sig5 = (x) => Number(x.toPrecision(5));
function fmtPx(px, szDecimals) {
  const d = Math.max(0, 6 - szDecimals);
  return String(Number(sig5(px).toFixed(d)));
}
function fmtSz(sz, szDecimals) { return String(Number(sz.toFixed(szDecimals))); }

export async function runHL(env, row, p, closes, i, book) {
  const network = row.hl_network || 'mainnet';
  const k = await one(env, 'SELECT enc, created FROM hl_keys WHERE owner = ? AND network = ?', row.owner, network);
  const sym = row.market.split(':')[1];
  const coin = hlCoin(sym);
  const price = closes[i];
  if (!k || !k.created) return { decisions: [{ action: 'hold', reason: 'Hyperliquid not connected', price }], eq: row.equity, book, px: price };
  const agent = privateKeyToAccount(await decrypt(env, k.enc));
  const [meta, st] = await Promise.all([info(network, { type: 'meta' }), info(network, { type: 'clearinghouseState', user: row.owner })]);
  const asset = meta.universe.findIndex((u) => u.name === coin);
  if (asset < 0) return { decisions: [{ action: 'hold', reason: `${coin} not listed on Hyperliquid ${network}`, price }], eq: row.equity, book, px: price };
  const szDec = meta.universe[asset].szDecimals;
  const eq = +st.marginSummary.accountValue;
  if (!book.liveStart) book.liveStart = eq;
  const pos = st.assetPositions.map((x) => x.position).find((x) => x.coin === coin);
  const size = pos ? +pos.szi : 0;
  // sync strategy state with the real position
  if (size && !book.pos) { book.pos = size > 0 ? 1 : -1; book.entry = +pos.entryPx; book.peak = price; }
  if (!size && book.pos) book.pos = 0;
  const mult = coin.startsWith('k') ? 1000 : 1; // closes are per coin; kPEPE quotes are per 1000
  if (book.pos) book.peak = book.pos > 0 ? Math.max(book.peak || price, price) : Math.min(book.peak || price, price);

  const s = signal(row.strategy, p, closes, i, book);
  const out = [];
  try {
    if (s.action === 'open' && !book.pos) {
      if (eq < 10) return { decisions: [{ action: 'hold', reason: `account needs at least $10 (has $${eq.toFixed(2)})`, price }], eq, book, px: price };
      await exchange(network, agent, { type: 'updateLeverage', asset, isCross: true, leverage: Math.max(1, Math.round(p.leverage)) });
      const isBuy = p.side !== 'short';
      const notional = eq * (p.positionPct / 100) * p.leverage;
      const sz = notional / (price * mult);
      const limit = fmtPx(price * mult * (isBuy ? 1.01 : 0.99), szDec);
      await exchange(network, agent, { type: 'order', orders: [{ a: asset, b: isBuy, p: limit, s: fmtSz(sz, szDec), r: false, t: { limit: { tif: 'Ioc' } } }], grouping: 'na' });
      book.pos = isBuy ? 1 : -1; book.entry = price; book.peak = price; book.entryAt = Date.now();
      out.push({ action: isBuy ? 'buy' : 'short', reason: s.reason, price });
    } else if (s.action === 'close' && book.pos) {
      const isBuy = size < 0;
      const limit = fmtPx(price * mult * (isBuy ? 1.01 : 0.99), szDec);
      await exchange(network, agent, { type: 'order', orders: [{ a: asset, b: isBuy, p: limit, s: fmtSz(Math.abs(size), szDec), r: true, t: { limit: { tif: 'Ioc' } } }], grouping: 'na' });
      const r = ((price / book.entry - 1) * 100) * book.pos * p.leverage;
      book.pos = 0; book.entry = 0; book.peak = 0;
      out.push({ action: isBuy ? 'cover' : 'sell', reason: `${s.reason} (${r >= 0 ? '+' : ''}${r.toFixed(2)}%)`, price });
    } else out.push({ action: 'hold', reason: s.reason, price });
  } catch (e) {
    out.push({ action: 'hold', reason: String(e.message || e).slice(0, 120), price });
  }
  void numberToHex;
  return { decisions: out, eq, book, px: price };
}
