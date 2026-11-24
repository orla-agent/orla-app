// Market catalogue: what agents can trade and where prices come from.
const C = (s) => s.split(',').map((x) => { const [sym, name] = x.split(':'); return { sym, name: name || sym }; });

export const CRYPTO = C('BTC:Bitcoin,ETH:Ethereum,SOL:Solana,XRP,DOGE:Dogecoin,LINK:Chainlink,AVAX:Avalanche,NEAR,SUI:Sui,ZEC:Zcash,BNB,ADA:Cardano,TRX:TRON,LTC:Litecoin,BCH:Bitcoin Cash,UNI:Uniswap,AAVE:Aave,TAO:Bittensor,ENA:Ethena,WLD:Worldcoin,ICP:Internet Computer,INJ:Injective,ONDO:Ondo,HBAR:Hedera,XLM:Stellar,APT:Aptos,DOT:Polkadot,ARB:Arbitrum,FET:Artificial Superintelligence Alliance,FIL:Filecoin,PEPE:Pepe,SHIB:Shiba Inu,POL:Polygon,ATOM:Cosmos,ETC:Ethereum Classic,RENDER:Render,SEI:Sei,TIA:Celestia,OP:Optimism,JUP:Jupiter,PENDLE:Pendle,WIF:dogwifhat,BONK:Bonk,CRV:Curve,LDO:Lido DAO,STX:Stacks,IMX:Immutable,ALGO:Algorand,VET:VeChain,TRUMP:Official Trump,PENGU:Pudgy Penguins,VIRTUAL:Virtuals Protocol,S:Sonic,RAY:Raydium,GRT:The Graph,SAND:The Sandbox,FLOKI:Floki,JTO:Jito,PYTH:Pyth Network,KAIA:Kaia,EIGEN:EigenLayer,ETHFI:ether.fi,WLFI:World Liberty Financial,XPL:Plasma,PUMP:Pump.fun,CAKE:PancakeSwap,QNT:Quant,THETA:Theta Network,MANA:Decentraland');

export const PERPS = C('BTC:Bitcoin,ETH:Ethereum,SOL:Solana,HYPE:Hyperliquid,XRP,DOGE:Dogecoin,SUI:Sui,LINK:Chainlink,BNB,ADA:Cardano,AVAX:Avalanche,LTC:Litecoin,AAVE:Aave,ENA:Ethena,TAO:Bittensor,ONDO:Ondo,NEAR,WLD:Worldcoin,ARB:Arbitrum,APT:Aptos,TRX:TRON,BCH:Bitcoin Cash,ZEC:Zcash,UNI:Uniswap,DOT:Polkadot,FIL:Filecoin,INJ:Injective,STX:Stacks,ATOM:Cosmos,OP:Optimism,TIA:Celestia,SEI:Sei,JUP:Jupiter,WIF:dogwifhat,PENDLE:Pendle,CRV:Curve,LDO:Lido DAO,POL:Polygon,RENDER:Render,ETC:Ethereum Classic,FARTCOIN:Fartcoin,TRUMP:Official Trump,PENGU:Pudgy Penguins,VIRTUAL:Virtuals Protocol,KAITO:Kaito,BERA:Berachain,PUMP:Pump.fun,XPL:Plasma,JTO:Jito,EIGEN:EigenLayer,WLFI:World Liberty Financial,ASTER:Aster');

export const STOCKS = C("AAPL:Apple,NVDA:NVIDIA,TSLA:Tesla,MSFT:Microsoft,AMZN:Amazon,GOOGL:Alphabet,META:Meta,SPY:S&P 500 ETF,QQQ:Nasdaq 100 ETF,COIN:Coinbase,AMD,NFLX:Netflix,AVGO:Broadcom,PLTR:Palantir,HOOD:Robinhood,MSTR:Strategy,ORCL:Oracle,JPM:JPMorgan Chase,V:Visa,WMT:Walmart,DIS:Disney,UBER:Uber,INTC:Intel,IWM:Russell 2000 ETF,DIA:Dow Jones ETF,ADBE:Adobe,CRM:Salesforce,CSCO:Cisco,QCOM:Qualcomm,MU:Micron,ARM:Arm Holdings,SMCI:Super Micro Computer,TSM:TSMC,SHOP:Shopify,PYPL:PayPal,XYZ:Block,ABNB:Airbnb,SNOW:Snowflake,CRWD:CrowdStrike,PANW:Palo Alto Networks,NET:Cloudflare,APP:AppLovin,SPOT:Spotify,RBLX:Roblox,SOFI:SoFi,CRCL:Circle,MARA:MARA Holdings,RIOT:Riot Platforms,RIVN:Rivian,BABA:Alibaba,BA:Boeing,KO:Coca-Cola,PEP:PepsiCo,MCD:McDonald's,NKE:Nike,SBUX:Starbucks,COST:Costco,XOM:ExxonMobil,CVX:Chevron,JNJ:Johnson & Johnson,PFE:Pfizer,LLY:Eli Lilly,UNH:UnitedHealth,MA:Mastercard,BAC:Bank of America,GS:Goldman Sachs,GLD:Gold ETF,SLV:Silver ETF,TLT:20+ Year Treasury ETF,ARKK:ARK Innovation ETF,IBIT:Bitcoin ETF");

// Markets a LIVE vault agent can trade (on-chain tokens against USDG)
export const LIVE_MARKETS = ['crypto:ETH', 'crypto:BTC', 'stock:AAPL', 'stock:NVDA', 'stock:TSLA', 'stock:MSFT', 'stock:AMZN', 'stock:GOOGL', 'stock:META', 'stock:SPY', 'stock:QQQ', 'stock:COIN'];

export function parseMarket(m) {
  const [kind, sym] = String(m || '').split(':');
  const list = kind === 'crypto' ? CRYPTO : kind === 'perp' ? PERPS : kind === 'stock' ? STOCKS : null;
  if (!list) return null;
  const e = list.find((x) => x.sym === sym);
  return e ? { kind, sym, name: e.name, id: `${kind}:${sym}` } : null;
}

export function marketLabel(m) {
  const p = parseMarket(m);
  if (!p) return m;
  return p.kind === 'perp' ? `${p.sym}-PERP` : p.sym;
}

// Binance symbol for a spot crypto
export const binSym = (s) => ({ PEPE: '1000PEPEUSDT', SHIB: '1000SHIBUSDT', BONK: '1000BONKUSDT', FLOKI: '1000FLOKIUSDT' }[s] ? null : null) || `${s}USDT`;
// Hyperliquid coin names for perps (k-prefixed for tiny-priced coins)
export const hlCoin = (s) => ({ PEPE: 'kPEPE', SHIB: 'kSHIB', BONK: 'kBONK', FLOKI: 'kFLOKI' }[s] || s);
// Yahoo symbol for a stock
export const yahooSym = (s) => ({ 'BRK.B': 'BRK-B' }[s] || s);
