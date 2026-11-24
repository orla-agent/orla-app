// Server-rendered page shells. Dynamic parts are filled by /assets/site.js.
import { LOGO_SVG, LOGO_PATHS, LOGO_DOT, LOGO_VIEWBOX } from './brand.js';
import { DOCS } from './docs.js';

const esc = (s) => String(s ?? '').replace(/[<&>"']/g, (c) => ({ '<': '&lt;', '&': '&amp;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mark = (cls = '') => `<svg class="${cls}" viewBox="${LOGO_VIEWBOX}" aria-hidden="true"><path fill="currentColor" d="${LOGO_PATHS[0]}"/><path fill="currentColor" d="${LOGO_PATHS[1]}"/><path fill="#FFB020" d="${LOGO_DOT}"/></svg>`;

const NAV = [
  ['agents', 'Agents'], ['markets', 'Markets'], ['pools', 'Pools'], ['payroll', 'Payroll'], ['portfolio', 'Portfolio'], ['leaderboard', 'Leaderboard'], ['token', '$ORLA'], ['docs', 'Docs'],
];

function shell(key, { title, desc, body, env = {}, origin = '', meta, bare = false, cfg = {} }) {
  const x = cfg.x || env.X_URL || 'https://x.com/';
  const gh = cfg.github || env.GITHUB_URL || 'https://github.com/';
  const t = meta?.title ? `${meta.title} · ORLA` : title;
  const d = meta?.desc || desc;
  const img = meta?.image || `${origin}/assets/logo.svg`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(t)}</title><meta name="description" content="${esc(d)}"><meta name="theme-color" content="#0e0d0b">
<meta property="og:title" content="${esc(t)}"><meta property="og:description" content="${esc(d)}"><meta property="og:image" content="${esc(img)}"><meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/assets/site.css?v=3">
</head><body data-page="${key}">
${bare ? '' : `<header class="nav"><div class="wrap">
<a class="brand" href="/">${mark()}ORLA</a>
<ul id="navlinks">${NAV.map(([k, l]) => `<li><a href="/${k}/" class="${k === key || (key === 'agent' && k === 'leaderboard') ? 'on' : ''}">${l}</a></li>`).join('')}
<li><a href="${esc(gh)}" target="_blank" rel="noopener">GitHub<sup>↗</sup></a></li><li><a href="${esc(x)}" target="_blank" rel="noopener">X<sup>↗</sup></a></li></ul>
<div class="right"><button class="btn sm ghost" id="loginBtn">Log in</button><a class="btn sm light" href="/agents/">Open app</a><button class="burger" id="burger" aria-label="Menu">☰</button></div>
</div></header>
<div class="ticker" id="ticker"><div class="track" id="tickerTrack"><span class="skel">loading markets ……………………………………………</span></div></div>`}
<main>${body}</main>
${bare ? '' : footer(x, gh)}
<div class="toast card" id="toast"></div>
<script>window.ORLA=${JSON.stringify({ page: key, x, gh, token: cfg.token || null, tokenName: '$ORLA', pons: cfg.token ? `https://ponsfamily.com/token/${cfg.token}` : null })};</script>
<script type="module" src="/assets/site.js?v=5"></script>
${key === 'home' ? '<script type="module" src="/assets/logo3d.js?v=3"></script>' : ''}
</body></html>`;
}

const footer = (x, gh) => `<footer><div class="wrap">
<div class="foot">
<div><a class="brand" href="/">${mark()}ORLA</a><p>Trading agents, a self-custody vault and on-chain payroll, built on Robinhood Chain.</p><span class="badge"><i></i>Open source · MIT</span></div>
<div><h6>Product</h6><ul><li><a href="/agents/">Agent Studio</a></li><li><a href="/markets/">Markets</a></li><li><a href="/pools/">Pools</a></li><li><a href="/payroll/">Payroll</a></li><li><a href="/portfolio/">Portfolio</a></li><li><a href="/leaderboard/">Leaderboard</a></li><li><a href="/token/">$ORLA</a></li></ul></div>
<div><h6>Resources</h6><ul><li><a href="/docs/">Docs</a></li><li><a href="/api/health" target="_blank">Status</a></li><li><a href="/api/stats" target="_blank">Stats</a></li><li><a href="${esc(gh)}" target="_blank" rel="noopener">GitHub</a></li><li><a href="${esc(x)}" target="_blank" rel="noopener">X / Twitter</a></li></ul></div>
<div><h6>Legal</h6><ul><li><a href="/docs/#terms">Terms</a></li><li><a href="/docs/#privacy">Privacy</a></li><li><a href="/docs/#contracts">Contracts</a></li></ul></div>
</div>
<div class="copy"><span>© ${new Date().getFullYear()} ORLA</span><span>Robinhood Chain · 4663</span></div>
</div></footer>`;

const next = (href, t, p) => `<a class="card next reveal" href="${href}"><span class="kicker">Next</span><div class="t">${t} →</div><p>${p}</p></a>`;
const head = (crumb, h1, lead) => `<div class="head"><div><div class="crumb">${crumb}</div><h1 class="big">${h1}</h1></div><p class="lead">${lead}</p></div>`;

// ------------------------------------------------------------------ pages
const P = {};

P.home = () => ({
  title: 'ORLA · Trading agents, hooked pools & on-chain payroll',
  desc: 'No-code trading agents for crypto and tokenized stocks, a self-custody vault and USDG payroll on Robinhood Chain.',
  body: `
<section class="hero"><div class="dotgrid"></div><div class="wrap hero-grid">
<div class="reveal in">
  <div class="kicker">Live on Robinhood Chain</div>
  <h1 class="big" style="margin-top:18px">Let agents trade.<br>Keep the keys<span class="dot">.</span></h1>
  <p class="lead">ORLA puts no-code trading agents for crypto and tokenized stocks, a vault that only your wallet controls, and USDG payroll into one app on Robinhood Chain.</p>
  <div class="ctas"><a class="btn primary lg" href="/agents/">Build your first agent</a><a class="btn lg" href="/leaderboard/">See live agents</a></div>
  <div class="chain"><span><i class="live"></i>Live market data</span><span>Paper mode first</span><span>Self-custody</span></div>
</div>
<div class="stage" id="logoStage"><div class="ring"></div><div class="ring r2"></div><div class="glow"></div>
  ${mark('fallback')}<canvas id="logo3d"></canvas>
  <div class="orbit-tag" style="top:12%;left:2%"><i></i>agent <b>BUY</b> ETH</div>
  <div class="orbit-tag" style="bottom:16%;right:0;animation-delay:-3s">fee <b id="tagFee">0.05%</b> · hooked</div>
  <div class="orbit-tag" style="bottom:6%;left:10%;animation-delay:-5s">payroll <b>USDG</b></div>
</div>
</div></section>

<section class="sec" style="padding-top:40px"><div class="wrap">
<div class="head" style="padding-top:0"><h2 class="big reveal">One wallet.<br>Every tool.</h2><p class="lead reveal d1">Each piece works alone, and all of them share your wallet: agents trade from your vault, the pool earns fees, payroll pays your people in USDG.</p></div>
<div class="pillars">
${[
    ['01', '◆', 'Agent Studio', 'Choose a strategy, set the risk, and backtest it on real prices. Start on paper, then go live from your own vault.', '/agents/', 'Open the Studio'],
    ['02', '◐', 'Hooked pools', 'A WETH/USDG pool whose fee moves with volatility. Swap in it, or open an LP vault the agent keeps in range.', '/pools/', 'Swap & add liquidity'],
    ['03', '▤', 'Payroll', 'Send USDG salaries on a schedule from a vault nobody but you can manage.', '/payroll/', 'Set up payroll'],
    ['04', '◎', 'Markets', 'Live crypto, perpetual and US stock prices, updated every 20 seconds.', '/markets/', 'Browse markets'],
    ['05', '▲', 'Leaderboard', 'Each agent is scored against simply holding its market. Nothing is hand-picked.', '/leaderboard/', 'See the ranking'],
    ['06', '●', '$ORLA', 'The ORLA token on Robinhood Chain.', '/token/', 'Token page'],
  ].map(([n, ic, h, p, href, go], i) => `<a class="card pillar reveal d${i % 3}" href="${href}"><span class="n">${n}</span><span class="ic">${ic}</span><h3>${h}</h3><p>${p}</p><span class="go">${go} →</span></a>`).join('')}
</div></div></section>

<section class="sec band"><div class="wrap">
<div class="head" style="padding-top:0"><h2 class="big reveal">Running<br>right now.</h2><p class="lead reveal d1">The leading agent's most recent calls, straight from the engine. Each decision is stored with its reason.</p></div>
<div class="live-grid">
  <div class="card console reveal" id="liveConsole">
    <div class="console-top"><span id="liveName">Top agent</span><span><i class="live" style="display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--up);margin-right:6px;animation:pulse 1.6s infinite"></i>live</span></div>
    <div class="agent-head"><div><div class="lbl">Portfolio value</div><div class="pnl" id="livePnl">—</div></div><div class="mono" id="liveRet">—</div></div>
    <div class="log" id="liveLog"><div class="empty">No agents yet. Be the first to launch one.</div></div>
  </div>
  <div class="kpis reveal d1">
    <div class="card kpi"><div class="v" id="kAgents">—</div><div class="l">Agents created</div></div>
    <div class="card kpi"><div class="v" id="kDecisions">—</div><div class="l">Decisions logged</div></div>
    <div class="card kpi"><div class="v" id="kTrades">—</div><div class="l">Trades executed</div></div>
    <a class="card kpi link" href="/leaderboard/"><span class="arrow">→</span><span class="l">Full leaderboard</span></a>
  </div>
</div></div></section>

<section class="sec"><div class="wrap">
<div class="head" style="padding-top:0"><h2 class="big reveal">Roadmap.</h2><p class="lead reveal d1">Built in public. Every change ships with a note in the changelog.</p></div>
<div class="road">
${[['Live', 'Paper trading agents', 'Try strategies with virtual money on real prices.'], ['Live', 'Live trading', 'Agents trade ETH, BTC and 10 Robinhood stock tokens against USDG from your own vault.'], ['Live', 'Hooked pools', 'A dynamic-fee WETH/USDG pool with agent-managed liquidity.'], ['Planned', 'Agent tokens', 'Turn a winning agent into its own token.']]
    .map(([s, h, p], i) => `<div class="card item ${s === 'Live' ? 'live' : ''} reveal d${i % 3}"><span class="tag ${s === 'Live' ? 'accent' : ''}">${s}</span><h3 style="margin-top:12px">${h}</h3><p>${p}</p></div>`).join('')}
</div></div></section>

<section class="sec" style="padding-top:20px"><div class="wrap">
<h2 class="big reveal" style="text-align:center;margin-bottom:26px">Good to know.</h2>
<div class="faq reveal d1">
${[
    ['Do I need to write code?', 'No. You pick a strategy template, adjust a few numbers and launch. Backtests run in your browser before you commit to anything.'],
    ['Does ORLA ever hold my money?', 'No. Live funds sit in a vault contract owned by your wallet. The ORLA bot can only swap inside the limits you set, and only your wallet can withdraw.'],
    ['What is paper mode?', 'Every agent can start with $10,000 of virtual money traded on live prices. It shows how a strategy behaves without risking anything.'],
    ['What is a pool hook?', 'A small contract that Uniswap v4 calls on every swap. ORLA\'s hook raises the fee when the market is volatile, lowers it when it is calm, and allows one swap per block per wallet.'],
    ['How is payroll funded?', 'You deposit USDG into your payroll vault. You can top it up any time, including with agent profits. Salaries go out on the schedule you set.'],
    ['What does it cost?', 'ORLA charges no fee. You pay network gas for your own transactions and the Uniswap pool fee on live trades.'],
  ].map(([q, a]) => `<details><summary>${q}</summary><p>${a}</p></details>`).join('')}
</div></div></section>

<section class="band"><div class="wrap cta reveal">
${mark('mark')}
<h2 class="big">Start with a free agent.</h2>
<p>Connect your wallet, run it on paper with live prices, and move to your own vault when you are ready.</p>
<a class="btn light lg" href="/agents/">Get started</a>
<form class="notify" id="notify"><input type="email" required placeholder="you@email.com" name="email"><button class="btn primary">Notify me</button></form>
<div class="hint" id="notifyMsg"></div>
</div></section>`,
});

P.agents = () => ({
  title: 'Agent Studio · ORLA', desc: 'Build, backtest and launch a no-code trading agent.',
  body: `<div class="wrap">
${head('Home / Agents', 'Your agents<span class="dot">.</span>', 'Each new agent gets $10,000 of paper money, is backtested on real hourly prices, then decides every hour. When you want real money, switch it to Live and trade from your own vault.')}
<div id="vaultCard"></div>
<div id="myAgents"></div>
<div class="card intro reveal in"><div><span class="kicker">New here?</span><h3 style="margin-top:8px;font-size:20px">Your first agent in a minute.</h3>
<ol><li><b>Pick a strategy and a market.</b> The note under the market describes the last 7 days.</li><li><b>Read the backtest.</b> It replays the strategy on real hourly prices next to simply holding.</li><li><b>Launch in paper mode.</b> $10,000 of virtual money, nothing to deposit. It runs every hour and logs each decision.</li></ol></div>
<div><button class="btn primary lg block" id="exampleBtn">Try an example agent</button><p class="note">Fills in Momentum on BTC with a 50% position, an 8% stop loss and a 5% max 24h loss. Example values, not advice.</p></div></div>

<div class="card studio" id="studio">
<h3 style="font-size:19px">New agent</h3>
<div class="callout" style="margin-top:12px"><span>Hold 1,000,000 $ORLA for up to 10 agents and 90 and 180-day backtests.</span><a href="/token/">Get $ORLA →</a></div>
<label class="f">Name</label><input class="inp" id="fName" placeholder="e.g. Night Owl" maxlength="32">
<label class="f">Strategy</label><select class="inp" id="fStrategy"></select><p class="hint" id="fBlurb"></p>
<label class="f">Mode</label><select class="inp" id="fMode">
<option value="paper">Paper — $10,000 virtual money</option><option value="live">Live — trades the funds in your vault</option>
<option value="hl-mainnet">Live on Hyperliquid mainnet — real USDC, perps in your own account</option><option value="hl-testnet">Live on Hyperliquid testnet — test funds, perps in your own account</option></select>
<div id="hlBox"></div>
<label class="f">Market</label><select class="inp" id="fMarket"></select>
<div class="regime" id="regime"><span class="skel">Reading the last 7 days…</span></div>
<div id="perpBox" class="row2 hide"><div><label class="f">Direction</label><select class="inp" id="fSide"><option value="long">Long</option><option value="short">Short</option></select></div>
<div><label class="f">Leverage</label><select class="inp" id="fLev"><option>1</option><option>1.5</option><option>2</option><option>3</option></select></div></div>
<div id="fParams" class="row2"></div>
<fieldset><legend id="riskToggle">▾ Risk controls · 0 = off</legend><div id="riskBox"><div class="row2">
<div><label class="f">Stop loss (% of position)</label><input class="inp" type="number" id="pStopLoss" value="0" min="0" max="90"></div>
<div><label class="f">Take profit (% of position)</label><input class="inp" type="number" id="pTakeProfit" value="0" min="0" max="500"></div>
<div><label class="f">Max loss in 24h (% of equity)</label><input class="inp" type="number" id="pMaxLoss24h" value="0" min="0" max="90"></div>
<div><label class="f">Position size (% of equity)</label><input class="inp" type="number" id="pPositionPct" value="100" min="10" max="100"></div></div>
<p class="note">Stop loss and take profit measure the move on the position, leverage included. Max 24h loss closes the position and pauses new entries once the agent is that far below its 24-hour high.</p></div></fieldset>
<label class="f">Backtest window</label><select class="inp" id="fWindow"><option value="168">Last 7 days</option><option value="720" selected>Last 30 days</option><option value="2160">Last 90 days (holders)</option><option value="4320">Last 180 days (holders)</option></select>
<div class="row2" style="margin-top:12px"><button class="btn" id="optBtn">✦ Find best settings</button><button class="btn" id="cmpBtn">Compare strategies</button></div>
<div id="optOut"></div>
<div class="bt" id="bt"><div class="bt-top"><span class="kicker" id="btTitle">Backtest · last 30 days</span><span class="legend"><span><i></i>Agent</span><span><i class="h"></i>Hold</span></span></div>
<div class="chart" id="btChart"></div><div class="legend" style="margin-top:4px">▲ buy · ▼ short · ● close</div>
<div class="metrics" id="btMetrics"></div>
<p class="note">Paper simulation on hourly closes with 0.1% cost per trade. “Hold” means buying the market and doing nothing. Past results do not predict future returns.</p></div>
<button class="btn primary lg block" style="margin-top:16px" id="launchBtn">Connect wallet to launch</button>
<p class="note" id="launchNote" style="text-align:center">Paper mode · $10,000 virtual cash · connecting a wallet only signs a message</p>
<div class="err" id="launchErr"></div>
</div>

<section class="sec"><div class="head" style="padding-top:0"><h2 class="big reveal">A strategy for<br>every kind of market.</h2><p class="lead reveal d1">Start from a template and change whatever you like. No code anywhere.</p></div>
<div class="strats">
<div class="card strat reveal"><span class="kicker">Momentum</span><svg viewBox="0 0 200 70"><polyline fill="none" stroke="var(--accent)" stroke-width="2.5" points="0,58 25,52 45,54 70,42 95,38 120,30 150,22 175,14 200,6"><animate attributeName="stroke-dasharray" from="0,400" to="400,0" dur="2.4s" fill="freeze"/></polyline></svg><h3>Ride the trend</h3><ul><li>Enters on breakouts</li><li>Built-in trailing stop</li><li>Shines in rising markets</li></ul></div>
<div class="card strat reveal d1"><span class="kicker">Mean reversion</span><svg viewBox="0 0 200 70"><polyline fill="none" stroke="var(--ink)" stroke-width="2.5" points="0,35 20,12 45,55 70,14 95,56 120,12 145,55 170,14 200,40"><animate attributeName="stroke-dasharray" from="0,600" to="600,0" dur="2.4s" fill="freeze"/></polyline></svg><h3>Buy low, sell high</h3><ul><li>Enters when price stretches</li><li>Exits at the average</li><li>Shines in sideways markets</li></ul></div>
<div class="card strat reveal d2"><span class="kicker">Custom</span><svg viewBox="0 0 200 70"><g stroke="var(--line2)" stroke-width="1.5" fill="none"><path d="M40 35 L80 15 M40 35 L80 55 M120 15 L160 35 M120 55 L160 35"/></g><rect x="4" y="27" width="36" height="16" rx="5" fill="var(--ink)"/><rect x="80" y="7" width="40" height="16" rx="5" fill="var(--ink)"/><rect x="80" y="47" width="40" height="16" rx="5" fill="var(--ink)"/><rect x="160" y="27" width="36" height="16" rx="5" fill="var(--accent)"/></svg><h3>Build your own</h3><ul><li>Mix signals and filters</li><li>Set your position size</li><li>30-day backtest at launch</li></ul></div>
</div></section>
${next('/markets/', 'Markets', 'Live crypto, perpetual and US stock prices.')}
</div>`,
});

P.agent = () => ({
  title: 'Agent · ORLA', desc: 'An ORLA trading agent: equity vs holding, every decision and its settings.',
  body: `<div class="wrap" id="agentPage">
<div class="ah"><div><div class="crumb"><a href="/leaderboard/">Leaderboard</a> / Agent</div><h1 class="big" id="aName"><span class="skel">loading agent</span></h1><div class="meta" id="aMeta"></div></div>
<div class="acts" id="aActs"></div></div>
<div class="kgrid" id="aK"></div>
<div class="agrid">
  <div>
    <div class="card pad"><div style="display:flex;justify-content:space-between;align-items:center"><h3>Equity vs just holding</h3><div class="chips" id="aRange"><button class="chip" data-r="24">24h</button><button class="chip" data-r="168">7d</button><button class="chip on" data-r="0">All</button></div></div>
    <div class="legend" style="margin-top:6px"><span><i></i>Agent</span><span><i class="h"></i>Just holding</span></div>
    <div class="chart" id="aChart" style="height:240px"></div><div class="legend">▲ buy · ▼ short · ● close · hover a marker for its reason</div></div>
    <div class="card pad" style="margin-top:14px"><div style="display:flex;justify-content:space-between;align-items:center"><h3>Trades</h3><button class="btn sm" id="allDec">Show every hourly decision</button></div><div id="aTrades"></div></div>
  </div>
  <div>
    <div class="card pad" id="aOwner" style="margin-bottom:14px;display:none"></div>
    <div class="card pad"><h3>Settings</h3><div class="kv" id="aSettings" style="margin-top:8px"></div></div>
    <div class="card pad" style="margin-top:14px"><h3>Backtest at launch</h3><p class="hint" style="margin-top:2px">The 30 days before it started.</p><div class="kv" id="aBt" style="margin-top:8px"></div></div>
    <div class="card pad" style="margin-top:14px"><h3>Share card</h3><p class="hint" style="margin-top:2px">What people see when you post the link.</p><div class="share"><img id="aOg" alt=""></div><div class="chips"><button class="btn sm" data-share="x">Share on X</button><button class="btn sm" data-share="copy">Copy link</button></div></div>
  </div>
</div>
<p class="note" id="aFoot" style="margin-top:18px"></p>
${next('/leaderboard/', 'Leaderboard', 'Every agent measured against holding.')}
</div>`,
});

P.markets = () => ({
  title: 'Markets · ORLA', desc: 'Live crypto, perpetual and US stock prices.',
  body: `<div class="wrap">
${head('Home / Markets', 'Every major market,<br>day and night.', 'Prices from Binance, Hyperliquid and US stock markets, refreshed every 20 seconds. Perpetuals also show the current hourly funding rate.')}
<div class="tabs" id="mTabs"><button class="chip on" data-k="crypto">Crypto</button><button class="chip" data-k="perp">Perps</button><button class="chip" data-k="stock">Stocks</button></div>
<div class="mkts" id="mGrid">${'<div class="card mkt skel" style="height:86px"></div>'.repeat(15)}</div>
${next('/pools/', 'Pools', 'Swap and earn in the hooked WETH/USDG pool.')}
</div>`,
});

P.pools = () => ({
  title: 'Hooked pools · ORLA', desc: 'A dynamic-fee Uniswap v4 pool on Robinhood Chain with agent-managed liquidity.',
  body: `<section class="cream"><div class="wrap">
${head('Home / Pools · hooked pool · <span id="poolStatus">live</span>', 'Pools that follow<br>the market.', 'ORLA pools run a hook: rules that execute on every swap. The fee adapts to volatility, each wallet gets one swap per block, and agents keep liquidity in range.')}
<div class="pool-grid">
  <div class="card sim reveal in"><div style="display:flex;justify-content:space-between;align-items:center"><b>Fee simulator · ETH/USDG</b><span class="mono muted" style="font-size:11px">dynamic fee <b id="simFeeTop">—</b></span></div>
    <div class="box"><label><span>You pay</span><span>live price</span></label><div class="amt"><input id="simIn" value="1000" inputmode="decimal"><span class="unit">USDG</span></div></div>
    <div class="box"><label><span>You would receive</span><span>≈</span></label><div class="amt"><input id="simOut" readonly><span class="unit">ETH</span></div></div>
    <dl><dt>ETH price</dt><dd id="simPx">—</dd><dt>Hourly volatility (24h)</dt><dd id="simVol">—</dd><dt>Per-block limit</dt><dd>1 swap / address</dd></dl>
    <a class="btn primary block" href="#lp">Swap in the hooked pool →</a>
    <div class="bars" id="simBars"></div><p class="mono muted" style="font-size:10.5px;margin-top:6px">Real ETH hourly moves over the last 40 hours. The fee follows them.</p>
  </div>
  <div class="rules">
    ${[['beforeSwap', 'Dynamic fees', 'The fee climbs when volatility rises to protect LPs, and drops back when the market calms down.'], ['beforeSwap', 'One swap per block', 'Each address can swap once per block, which shuts out sandwich attacks and most MEV.'], ['afterSwap', 'Fees to a payroll vault', 'Part of the LP fee can be routed straight into a payroll vault.'], ['agent', 'Agent rebalancing', 'A pool agent moves the liquidity range to follow the price and logs every decision.']]
    .map(([t, h, p], i) => `<div class="card rule reveal d${i % 3}"><span class="tag">${t}</span><h3>${h}</h3><p>${p}</p></div>`).join('')}
  </div>
</div></div></section>

<section class="sec"><div class="wrap">
<div class="head" style="padding-top:0"><div><span class="kicker">On-chain · Robinhood Chain</span><h2 class="big reveal" style="margin-top:12px">Pool stats.</h2></div><p class="lead reveal d1">Every figure here is read from the chain: swaps through the hooked pool, the volume they moved, and the fees sent to payroll.</p></div>
<div class="pstats" id="pStats">${['Swaps', 'Volume', 'Sent to payroll', 'Fee right now'].map((l) => `<div class="card pstat"><div class="l">${l}</div><div class="v">—</div><small>&nbsp;</small></div>`).join('')}</div>
<div class="card swaps"><div class="top"><h3>Latest swaps · WETH / USDG</h3><a class="btn sm" id="hookLink" target="_blank">Hook on explorer ↗</a></div><div id="pSwaps"><div class="empty">No swaps yet.</div></div><p class="note" id="pBlock"></p></div>
</div></section>

<section class="sec" id="lp" style="padding-top:20px"><div class="wrap">
<div class="head" style="padding-top:0"><div><span class="kicker">Hooked pool · WETH / USDG</span><h2 class="big reveal" style="margin-top:12px">Add liquidity.<br>The agent keeps it in range.</h2></div><p class="lead reveal d1">Your LP vault holds a position in the ORLA hooked pool. The agent shifts the range as the price moves, only within your limits and only when the pool agrees with Chainlink. Only you can withdraw.</p></div>
<div class="lp-grid">
  <div class="card pad" id="lpVault"><h3>WETH / USDG LP vault</h3><p class="hint">Sign in with your wallet to create an LP vault for this pool.</p><button class="btn light" data-connect style="margin-top:14px">Connect wallet</button></div>
  <div>
    <div class="card pad swapbox" id="swapBox"></div>
    <div class="card pad" style="margin-top:14px"><div style="display:flex;justify-content:space-between;align-items:center"><h3>Agent decision log</h3><span class="mono muted" style="font-size:11px" id="lpFee"></span></div><div class="dlog" id="lpLog"><p class="hint">Decisions show up here once your vault exists. The agent checks it every hour.</p></div></div>
  </div>
</div></div></section>

<section class="sec" id="pons" style="padding-top:20px"><div class="wrap">
<div class="head" style="padding-top:0"><div><span class="kicker">Pons tokens</span><h2 class="big reveal" style="margin-top:12px">Trade any Pons token.<br>Curve or Uniswap.</h2></div><p class="lead reveal d1">Paste a token launched on Pons. While it is on its bonding curve the swap goes to the curve; after graduation it goes to its Uniswap v4 pool. Tokens land in your wallet and ORLA takes no fee.</p></div>
<div class="lp-grid">
  <div class="card pad" id="ponsBox"><h3>Swap · Pons tokens</h3><p class="hint">Paste the contract address of any token launched on Pons.</p><label class="f">Token contract address</label><input class="inp mono" id="ponsAddr" placeholder="0x… (a token launched on Pons)"><div id="ponsOut"></div></div>
  <div class="card pad"><h3>Before you swap</h3><ul class="warnlist" style="margin-top:12px">
  <li><b>New tokens are extremely risky.</b> Most launches lose most of their value. Only use money you can lose.</li>
  <li><b>Check the contract address</b> on the project's own channels. Anyone can launch a token with any name.</li>
  <li><b>Every swap has a 1% slippage limit</b> and a 10-minute deadline. If the price moves further, it reverts and nothing trades.</li>
  <li>Pons charges its own curve and pool fees. ORLA adds nothing.</li></ul></div>
</div>
${next('/payroll/', 'Payroll', 'Pay your team in USDG on a schedule.')}
</div></section>`,
});

P.payroll = () => ({
  title: 'Payroll · ORLA', desc: 'USDG payroll on Robinhood Chain from a vault only you control.',
  body: `<div class="wrap">
${head('Home / Payroll', 'Payroll on<br>autopilot<span class="dot">.</span>', 'Fill a payroll vault with USDG and top it up whenever you like, agent profits included. Salaries leave on schedule, all verifiable on-chain.')}
<div class="pay-grid">
<div class="steps reveal in">
${[['Create a vault', 'One click. Only your wallet can manage it or withdraw.'], ['Fund it', 'Deposit USDG on Robinhood Chain. Withdraw whenever you want.'], ['Add recipients', 'Address, amount and schedule: weekly, every two weeks or monthly.'], ['Runs by itself', 'The ORLA bot sends each salary when it is due. It can only pay the people and amounts you set.']]
    .map(([h, p], i) => `<div class="s"><em>0${i + 1}</em><h3>${h}</h3><p>${p}</p></div>`).join('')}
</div>
<div class="card pad reveal d1" id="payBox"><span class="tag green">Live</span><h3 style="margin:12px 0 6px;font-size:20px">Run payroll in USDG.</h3><p class="hint">Sign in with your wallet to create a payroll vault, add recipients and fund it.</p><button class="btn light" data-connect style="margin-top:16px">Connect wallet</button></div>
</div>
${next('/leaderboard/', 'Leaderboard', 'Every agent measured against holding.')}
</div>`,
});

P.portfolio = () => ({
  title: 'Portfolio · ORLA', desc: 'Your agents, vaults and payroll in one view.',
  body: `<div class="wrap">
${head('Home / Portfolio', 'Your<br>portfolio<span class="dot">.</span>', 'Everything you run on ORLA in one place: your agents, your live vault, your LP vault and your payroll, read live from the app and from Robinhood Chain.')}
<div id="pf"><div class="gate"><div class="ghost"><div></div><div></div><div></div><div></div></div>
<div class="over"><div class="card"><span class="tag accent">Private to your wallet</span><h3 style="margin:14px 0 8px;font-size:20px">Sign in to see your portfolio.</h3><p class="hint">Your agents, live vault, LP vault and payroll in one view. Signing in only signs a message: no transaction, no gas.</p><button class="btn light" data-connect style="margin-top:16px">Connect wallet</button></div></div></div></div>
${next('/agents/', 'Agent Studio', 'Build, backtest and run a trading agent.')}
</div>`,
});

P.leaderboard = () => ({
  title: 'Leaderboard · ORLA', desc: 'Every ORLA agent measured against simply holding its market.',
  body: `<div class="wrap">
${head('Home / Leaderboard', 'Agents against<br>holding.', 'Each agent is compared with simply holding the same market since the day it launched. Paper trading on live prices, with nothing hand-picked.')}
<div class="lb-grid">
  <div class="card pad"><div class="mono muted" style="font-size:12px" id="lbTopName">—</div><div class="legend" style="margin-top:6px"><span><i></i>Agent</span><span><i class="h"></i>Hold</span><span><i class="c"></i>Starting cash</span></div><div class="chart" id="lbChart" style="height:210px"></div></div>
  <div class="kpis"><div class="card kpi"><div class="v" id="kAgents">—</div><div class="l">Agents created</div></div><div class="card kpi"><div class="v" id="kDecisions">—</div><div class="l">Decisions logged</div></div><div class="card kpi"><div class="v" id="kTrades">—</div><div class="l">Trades executed</div></div><div class="card kpi"><div class="v">1 hour</div><div class="l">Decision interval, 30-day backtest at launch</div></div></div>
</div>
<div class="filters" id="lbFilters">
${[['market', 'Market', [['all', 'All'], ['crypto', 'Crypto'], ['perp', 'Perpetuals'], ['stock', 'Stocks & ETFs']]], ['direction', 'Direction', [['all', 'All'], ['long', 'Long'], ['short', 'Short']]], ['leverage', 'Leverage', [['all', 'All'], ['1', '1x only'], ['gt1', 'Above 1x']]], ['mode', 'Mode', [['all', 'All'], ['paper', 'Paper'], ['live', 'Live']]], ['minTrades', 'Min. trades', [['0', 'Any'], ['2', '2+'], ['5', '5+'], ['10', '10+']], '2'], ['age', 'Running for', [['0', 'Any time'], ['24', '24h+'], ['168', '7 days+'], ['720', '30 days+']], '24'], ['rank', 'Rank by', [['return', 'Return'], ['vshold', 'vs just holding']]]]
    .map(([k, l, opts, d]) => `<label>${l}<select class="inp" data-f="${k}">${opts.map(([v, t]) => `<option value="${v}" ${v === (d || opts[0][0]) ? 'selected' : ''}>${t}</option>`).join('')}</select></label>`).join('')}
</div>
<p class="hint">By default only agents with at least 2 trades that have run for 24 hours or more are ranked, so one lucky trade cannot take the top spot.</p>
<div class="card" style="margin-top:12px;overflow:auto"><table class="lb"><thead><tr><th>#</th><th>Agent</th><th class="hm">Strategy</th><th>Market</th><th class="hm">Trades</th><th class="hm">Age</th><th>Return</th><th>vs hold</th><th></th></tr></thead><tbody id="lbBody"><tr><td colspan="9" class="empty"><span class="spin"></span></td></tr></tbody></table></div>
${next('/token/', '$ORLA', 'The token and its contract.')}
</div>`,
});

P.token = ({ cfg }) => ({
  title: '$ORLA · ORLA', desc: 'The ORLA token on Robinhood Chain.',
  body: `<div class="wrap"><div class="tok">
<div class="mono muted" style="font-size:14px">Home / The token</div><h1>$ORLA</h1></div>
<div style="padding:26px 0 70px"><div class="muted" style="font-size:14px">Contract · Robinhood Chain</div>
<div class="ca"><span id="tokCa">${cfg.token ? esc(cfg.token) : 'Launching soon — the contract address appears here.'}</span>${cfg.token ? '<button id="tokCopy">Copy</button>' : ''}</div>
<div class="tok buy" style="padding:0;border:0">${cfg.token ? `<a class="btn light" href="https://ponsfamily.com/token/${esc(cfg.token)}" target="_blank" rel="noopener">Buy on Robinhood Chain <span>→</span></a><a class="u" href="https://robinhoodchain.blockscout.com/token/${esc(cfg.token)}" target="_blank" rel="noopener">Explorer</a>` : '<span class="btn light" style="opacity:.5">Buy on Robinhood Chain <span>→</span></span>'}</div>
<p class="hint" style="margin-top:22px;max-width:520px">Holding 1,000,000 $ORLA unlocks up to 10 agents and 90 and 180-day backtests in Agent Studio.</p></div>
${next('/agents/', 'Agent Studio', 'Build, backtest and run a trading agent.')}
</div>`,
});

P.docs = ({ cfg }) => ({
  title: 'ORLA Docs', desc: 'How to use ORLA: agents, vaults, payroll, hooked pools, contracts and security.',
  docs: true,
  body: DOCS(cfg),
});

P.setup = () => ({
  title: 'Setup · ORLA', desc: 'Admin setup console.',
  body: `<div class="wrap setup" style="max-width:760px;padding-bottom:80px">
${head('Admin / Setup', 'Setup<br>console<span class="dot">.</span>', 'Deploy the ORLA contracts from your own wallet and save their addresses. Only the wallet in ADMIN_ADDRESS can use this page.')}
<div id="setup"><div class="card pad"><p class="hint">Sign in with the admin wallet.</p><button class="btn light" data-connect style="margin-top:12px">Connect wallet</button></div></div>
</div>`,
});

P['404'] = () => ({ title: 'Not found · ORLA', desc: '', body: `<div class="wrap" style="padding:120px 0;text-align:center"><h1 class="big">Lost<span class="dot">.</span></h1><p class="muted" style="margin:16px 0 24px">That page does not exist.</p><a class="btn light" href="/">Back home</a></div>` });

export const PAGES = Object.fromEntries(Object.keys(P).filter((k) => k !== '404').map((k) => [k, true]));

export function page(key, ctx) {
  const cfg = ctx.cfg || {};
  const p = P[key]({ cfg, env: ctx.env });
  if (p.docs) return docsShell(p, ctx, cfg);
  return shell(key, { ...p, env: ctx.env, origin: ctx.origin, meta: ctx.meta, cfg });
}

function docsShell(p, ctx, cfg) {
  const x = cfg.x || ctx.env?.X_URL || 'https://x.com/';
  const gh = cfg.github || ctx.env?.GITHUB_URL || 'https://github.com/';
  const html = shell('docs', { ...p, bare: true, env: ctx.env, origin: ctx.origin, cfg });
  const top = `<header class="nav"><div class="wrap"><a class="brand" href="/">${mark()}ORLA<small>DOCS</small></a><ul></ul><div class="right"><a class="btn sm" href="${esc(x)}" target="_blank">X</a><a class="btn sm" href="${esc(gh)}" target="_blank">GitHub</a><a class="btn sm light" href="/agents/">Open app</a></div></div></header>`;
  return html.replace('<main>', top + '<main>');
}

export { mark };
void LOGO_SVG;
