// Robinhood Chain access (viem): public reads, the bot wallet, and contract addresses.
import { createPublicClient, createWalletClient, http, defineChain, getAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import C from './gen/contracts.json';
import RH from './gen/robinhood.json';

export const ABI = Object.fromEntries(Object.entries(C).map(([k, v]) => [k, v.abi]));
export const BYTECODE = Object.fromEntries(Object.entries(C).filter(([, v]) => v.bytecode).map(([k, v]) => [k, v.bytecode]));
export const NET = RH;
export const TOKENS = RH.tokens;
export const USDG = RH.tokens.find((t) => t.symbol === 'USDG');
export const WETH = RH.tokens.find((t) => t.symbol === 'WETH');

export const UNI = {
  poolManager: '0x8366a39cc670b4001a1121b8f6a443a643e40951',
  v4Quoter: '0x8dc178efb8111bb0973dd9d722ebeff267c98f94',
  stateView: '0xf3334192d15450cdd385c8b70e03f9a6bd9e673b',
  v3Factory: '0x1f7d7550b1b028f7571e69a784071f0205fd2efa',
  v3Quoter: '0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7',
  swapRouter02: '0xcaf681a66d020601342297493863e78c959e5cb2',
  create2: '0x4e59b44847b379578588920ca78fbf26c0b4956c',
  multicall3: '0xcA11bde05977b3631167028862bE2a173976CA11',
  ponsFactory: '0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e',
};

// market id → on-chain token for live agents
export const LIVE_TOKEN = {
  'crypto:ETH': 'WETH', 'crypto:BTC': 'cbBTC',
  ...Object.fromEntries(['AAPL', 'NVDA', 'TSLA', 'MSFT', 'AMZN', 'GOOGL', 'META', 'SPY', 'QQQ', 'COIN'].map((s) => [`stock:${s}`, s])),
};

export function chainDef(env) {
  return defineChain({
    id: 4663,
    name: 'Robinhood Chain',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [env.RPC_URL || RH.publicRpc] } },
    blockExplorers: { default: { name: 'Blockscout', url: RH.explorer } },
    contracts: { multicall3: { address: UNI.multicall3 } },
  });
}

let _pub, _pubUrl;
export function pub(env) {
  const url = env.RPC_URL || RH.publicRpc;
  if (!_pub || _pubUrl !== url) {
    _pub = createPublicClient({ chain: chainDef(env), transport: http(url, { batch: false, retryCount: 1 }), batch: { multicall: { wait: 0 } } });
    _pubUrl = url;
  }
  return _pub;
}

export function botAccount(env) {
  if (!env.BOT_PRIVATE_KEY) return null;
  let k = env.BOT_PRIVATE_KEY.trim();
  if (!k.startsWith('0x')) k = '0x' + k;
  try { return privateKeyToAccount(k); } catch (_) { return null; }
}

export function bot(env) {
  const account = botAccount(env);
  if (!account) return null;
  return createWalletClient({ account, chain: chainDef(env), transport: http(env.RPC_URL || RH.publicRpc) });
}

// contract addresses saved by the setup console (D1 `config` table), cached per isolate for 60 s
let _cfg, _cfgAt = 0;
export async function config(env, fresh = false) {
  if (!fresh && _cfg && Date.now() - _cfgAt < 60_000) return _cfg;
  const rows = env.DB ? (await env.DB.prepare('SELECT k, v FROM config').all()).results : [];
  const c = {};
  for (const r of rows) { try { c[r.k] = JSON.parse(r.v); } catch (_) { c[r.k] = r.v; } }
  _cfg = c; _cfgAt = Date.now();
  return c;
}
export function resetConfigCache() { _cfg = null; }

export const addr = (a) => { try { return getAddress(a); } catch (_) { return null; } };

export function poolKeyFrom(cfg) {
  if (!cfg.hook) return null;
  return { currency0: WETH.address, currency1: USDG.address, fee: 0x800000, tickSpacing: 60, hooks: cfg.hook };
}
