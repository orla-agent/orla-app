// Documentation page content.
import { CRYPTO, PERPS, STOCKS } from '../markets.js';
import RH from '../gen/robinhood.json';

const ex = (a) => (a ? `<a href="https://robinhoodchain.blockscout.com/address/${a}" target="_blank" rel="noopener"><code>${a}</code></a>` : '<span class="muted">not deployed yet</span>');
const list = (arr) => arr.map((x) => x.sym).join(', ');

export const DOCS = (cfg = {}) => {
  const S = [
    ['overview', 'Overview'], ['start', 'Getting started'], ['strategies', 'Strategies'], ['live', 'Live trading & vault'], ['stocks', 'Stock tokens'],
    ['hyperliquid', 'Hyperliquid perps'], ['payroll', 'Payroll'], ['pools', 'Hooked pools'], ['pons', 'Pons tokens'], ['roles', 'Who can do what'], ['fees', 'Fees & limits'],
    ['contracts', 'Contracts'], ['security', 'Security'], ['trouble', 'Troubleshooting'], ['terms', 'Terms'], ['privacy', 'Privacy'],
  ];
  return `<div class="wrap docs"><nav id="docnav">${S.map(([id, t], i) => `<a href="#${id}" class="${i ? '' : 'on'}">${t}</a>`).join('')}</nav>
<article>
<span class="kicker">Documentation</span>
<h1>Using ORLA</h1>
<p class="lede">Build trading agents without code, run them on paper or with real money from a vault only you control, and pay your team in USDG, all on Robinhood Chain.</p>

<h2 id="overview">Overview</h2>
<div class="cards3"><div class="card"><b>Paper agents</b><p>Choose a strategy and a market, backtest it on real prices and let it trade $10,000 of virtual money every hour.</p></div>
<div class="card"><b>Live agents</b><p>The same agent trading your own on-chain vault: ETH, BTC and 10 Robinhood stock tokens against USDG.</p></div>
<div class="card"><b>Payroll</b><p>A USDG vault that pays salaries by itself, weekly, every two weeks or monthly.</p></div></div>
<p>Everything runs from one wallet. ORLA never takes custody: live funds sit in smart contracts owned by your wallet, and only your wallet can withdraw them.</p>

<h2 id="start">Getting started</h2>
<h3>1. Connect your wallet</h3>
<p>Click <b>Connect wallet</b> and pick your wallet (MetaMask, Rabby, OKX Wallet, Coinbase Wallet or any browser wallet). You sign a short message to prove the address is yours. It is not a transaction, costs nothing and moves no funds. You stay signed in for 7 days on that browser.</p>
<div class="warn">ORLA will never ask for your seed phrase or private key. Anyone who does is not ORLA.</div>
<h3>2. Build a paper agent</h3>
<ol><li>Open <a href="/agents/">Agent Studio</a>. Backtests work before you connect anything. <b>Try an example agent</b> fills in a simple setup (example values, not advice).</li>
<li>Name it (3–32 letters or numbers) and choose a strategy.</li>
<li>Mode: <b>Paper</b>. Market: crypto (${CRYPTO.length}: ${list(CRYPTO)}), perpetuals (${PERPS.length}: ${list(PERPS)}) or stocks and ETFs (${STOCKS.length}: ${list(STOCKS)}).</li>
<li>The note under the market says whether the last 7 days went up, down or sideways and which strategies tend to suit that. It describes the past; it is not a forecast.</li>
<li>On a perpetual, choose a direction (long or short) and leverage (1x, 1.5x, 2x or 3x). Optionally set a stop loss, take profit and max loss in 24 hours.</li>
<li>Read the backtest over the last 7 or 30 days (90 and 180 days for $ORLA holders): return against holding, max drawdown, win rate, trades, Sharpe ratio, average hold, profit factor, best and worst trade, time in the market and, on perps, funding. Every entry and exit is marked on the chart. <b>Find best settings</b> tunes on the first two-thirds of the window and shows how those settings did on the final third, which they never saw. <b>Compare strategies</b> ranks every strategy on your market.</li>
<li>Click <b>Backtest &amp; launch</b>.</li></ol>
<p>ORLA backtests on hourly candles (stocks only have candles during US market hours) and compares the result with holding. Each agent keeps its 30-day launch backtest. After that it decides once an hour (buy, sell or hold) and writes the reason to its decision log. Every agent is on the public leaderboard. You can run up to 5 agents (10 for holders).</p>
<h3>3. Follow, edit and share</h3>
<p>Each agent has its own page with equity against holding, every trade on the chart with its reason, its settings and its launch backtest. <b>Pause</b>, <b>Resume</b> and <b>Edit settings</b> live there. Strategy and market stay fixed so the comparison with holding stays fair; direction and leverage can only change while the agent is in cash. Every change is logged.</p>
<p><b>Share on X</b> and <b>Copy link</b> share a link with a preview card. <b>Copy this setup</b> opens the Studio with that agent's strategy, market and settings filled in.</p>
<p><b>Go live:</b> after 3 days on paper, a long 1x agent on a market live agents can trade (ETH, BTC or a stock token) can start a live twin with the same settings. The paper agent keeps running.</p>

<h2 id="strategies">Strategies</h2>
<p>On crypto and stocks agents are long-only: they hold either the asset or cash (USDG when live). On perpetuals an agent can also go short and use up to 3x leverage; a short agent mirrors each rule below. Position size is the share of equity used as margin per trade (10–100%).</p>
<table><tr><th>Strategy</th><th>Enters (long) when</th><th>Exits when</th><th>Settings</th></tr>
<tr><td>Momentum</td><td>Price breaks above its recent high</td><td>Price falls a set % from its peak since entry (trailing stop)</td><td>Breakout window 6–168 h · trailing stop 1–30%</td></tr>
<tr><td>Mean reversion</td><td>Price is unusually far below its average</td><td>Price is back at the average, or the stop loss hits</td><td>Average 10–200 h · entry 0.5–4 σ · stop 1–50%</td></tr>
<tr><td>Custom (MA crossover)</td><td>The fast average crosses above the slow one</td><td>Fast crosses back below slow, stop loss or take profit</td><td>Fast 2–100 h · slow 5–400 h</td></tr>
<tr><td>RSI reversal</td><td>RSI drops below your buy level</td><td>RSI rises above your sell level, or the stop loss hits</td><td>Period 5–50 h · buy 5–45 · sell 55–95</td></tr>
<tr><td>Buy the dip in an uptrend</td><td>Price is above its long average and dips below its short average</td><td>It returns to the short average, or the trailing stop hits</td><td>Trend 48–400 h · dip window 10–100 h · depth 0.5–4 σ · trail 1–30%</td></tr></table>
<h3>Perpetuals: shorts, leverage and funding</h3>
<ul><li>Leverage multiplies gains and losses on the margin. A position that loses 90% of its margin is liquidated at that hour's price.</li>
<li>Funding is applied every hour using Hyperliquid's rate: when it is positive longs pay shorts, and the other way round. Backtests use the real funding history.</li>
<li>Paper trades cost 0.1% of position size (leverage included) for fees and slippage. Decisions use hourly closes.</li></ul>
<h3>Risk controls</h3>
<ul><li>Stop loss and take profit close the position when it is down or up by that % on the margin, leverage included. 0 turns them off.</li>
<li>Max loss in 24h closes the position and blocks new entries once equity is that far below its highest point of the last 24 hours. Trading resumes when the loss is back inside the limit or 24 hours pass.</li></ul>

<h2 id="live">Live trading &amp; your vault</h2>
<h3>What you need</h3>
<ul><li>A little ETH on Robinhood Chain for gas (0.0005 ETH is plenty). ETH on other chains does not count, so bridge some first.</li><li>USDG on Robinhood Chain, the dollar agents trade with. $10–$50 is a fine start.</li></ul>
<table><tr><th>Setting</th><th>Value</th></tr><tr><td>Network name</td><td>Robinhood Chain</td></tr><tr><td>RPC URL</td><td><code>${RH.publicRpc}</code></td></tr><tr><td>Chain ID</td><td>4663</td></tr><tr><td>Currency</td><td>ETH</td></tr><tr><td>Explorer</td><td><code>${RH.explorer}</code></td></tr></table>
<p>The app adds and switches the network in your wallet the first time you sign a vault transaction.</p>
<h3>Create and fund the vault</h3>
<ol><li>In Agent Studio the <b>Live trading vault</b> card sits at the top. Set a daily trading limit (the most the agent may swap in 24 hours) and a max slippage (the worst price accepted against the Chainlink oracle, 0.1–5%; 1% is a sensible default, 2% for stocks in 0.3% pools).</li>
<li>Click <b>Create vault</b> and confirm in your wallet.</li><li>Deposit USDG. It is a plain token transfer to your vault.</li></ol>
<h3>Run a live agent</h3>
<p>In <b>New agent</b> set Mode to Live, pick ETH / USDG, BTC / USDG or a stock / USDG market and launch. On a buy the agent swaps part of your USDG into the asset through Uniswap; on a sell it swaps back. Each trade in the log links to its transaction. One live agent per vault; the vault needs at least $5 and agent access switched on. If a trade is bigger than what is left of the daily limit, the agent trades the part that fits and carries on next hour.</p>
<h3>Withdraw, pause or stop</h3>
<table><tr><th>Button</th><th>Effect</th></tr><tr><td>Withdraw</td><td>Sends a token from the vault to your wallet. Works even while paused.</td></tr><tr><td>Pause / Resume vault</td><td>No swaps can happen while paused.</td></tr><tr><td>Revoke / Give agent access</td><td>Removes or restores the bot's permission to swap.</td></tr><tr><td>Agent pause / delete</td><td>Stops that agent. Deleting removes its history from ORLA; your vault and funds are untouched.</td></tr></table>
<p>Even with the ORLA website offline you can withdraw by calling <code>withdraw(token, amount, yourAddress)</code> on your vault from the explorer (Write contract).</p>

<h2 id="stocks">Stock tokens</h2>
<p>Live agents can trade 10 Robinhood Stock Tokens on Robinhood Chain: AAPL, NVDA, TSLA, MSFT, AMZN, GOOGL, META, SPY, QQQ and COIN, each against USDG through a Uniswap V3 pool.</p>
<ul><li>Prices come from Chainlink feeds that track US equities 24/5 and already include splits and dividends.</li><li>Stocks trade Monday to Friday. The feeds pause at the weekend, so the vault refuses stock swaps until they update; your agent simply holds.</li><li>Stock tokens are issued by Robinhood and may not be available everywhere. Check that you may hold them where you live.</li></ul>

<h2 id="hyperliquid">Hyperliquid perps</h2>
<p>Perpetual agents can also trade live in your own Hyperliquid account. In the Studio choose <b>Live on Hyperliquid</b> and approve an <b>agent wallet</b> with your wallet. That key can place and close orders but can never withdraw or transfer. ORLA stores it encrypted. Disconnect any time from the Studio or revoke it on Hyperliquid.</p>

<h2 id="payroll">Payroll</h2>
<ol><li>In <a href="/payroll/">Payroll</a>, click <b>Create payroll vault</b> (one per wallet).</li><li>Deposit USDG.</li><li>Add a recipient: wallet address, amount, schedule (weekly, every 2 weeks, or monthly = every 30 days) and the first payment date (empty = now).</li></ol>
<p>The ORLA bot checks every hour and pays each salary when it is due. The card shows the balance, monthly cost and runway. If the balance is short the payment waits and goes out as soon as you top up. <b>Pay due now</b> sends it immediately.</p>
<p>Only you can add or remove recipients and withdraw. The bot, or anyone else, can only trigger a payment that is due, to the address and amount you set, once per period.</p>

<h2 id="pools">Hooked pools</h2>
<p>ORLA runs a Uniswap v4 pool for WETH / USDG on Robinhood Chain with the ORLA hook:</p>
<ul><li><b>Dynamic fee</b> between 0.05% and 1%: on the first swap of each block the hook measures how far the price moved and keeps a running average. Calm market, low fee; busy market, higher fee. Nobody sets it by hand.</li>
<li><b>One swap per block per wallet</b>, to limit sandwich attacks and MEV.</li>
<li><b>Payroll share:</b> the pool owner can route part of the swap fee (up to half) to a payroll address. The LP fee drops by the same share, so swappers pay the same total.</li></ul>
<h3>LP vault with agent rebalancing</h3>
<ol><li>Create an LP vault and set its limits: narrowest and widest range, minimum hours between moves, and the oracle band (how close the pool price must be to Chainlink).</li><li>Deposit WETH and USDG. Within the hour the agent opens a range around the price.</li><li>When the price leaves the range or nears its edge, the agent moves it, only inside your limits and only when the pool agrees with Chainlink. Every decision is logged.</li></ol>
<p>The agent can only move the range; it never withdraws. You can exit (pull liquidity back into the vault) and withdraw any time, even while paused, and revoke the agent. Fees earned stay in your vault.</p>

<h2 id="pons">Pons tokens</h2>
<p>The Pools page can swap any token launched on Pons. While the token is on its bonding curve the swap goes to the curve contract; after it graduates, ERC-20-paired pools are swapped through its Uniswap v4 pool. Swaps carry a 1% slippage limit. ORLA adds no fee.</p>

<h2 id="roles">Who can do what</h2>
<p>These rules are enforced by the contracts. Nobody, including the ORLA team, can override them.</p>
<table><tr><th>Action</th><th>You (owner)</th><th>ORLA bot</th><th>Anyone else</th></tr>
<tr><td>Deposit</td><td>Yes</td><td>—</td><td>Yes (a transfer)</td></tr><tr><td>Withdraw</td><td>Yes, any time</td><td>Never</td><td>No</td></tr>
<tr><td>Swap inside the vault</td><td>—</td><td>Within your limits</td><td>No</td></tr><tr><td>Change limits, pause, revoke the bot</td><td>Yes</td><td>No</td><td>No</td></tr>
<tr><td>Payroll: add / remove recipients</td><td>Yes</td><td>No</td><td>No</td></tr><tr><td>Payroll: trigger a due payment</td><td>Yes</td><td>Yes</td><td>Only to the people and amounts you set</td></tr></table>
<p>Every swap is checked on-chain: the minimum output comes from Chainlink (not from the bot), stale or invalid prices are rejected, the pool is pinned per token, swap value is capped per 24 hours, and the vault checks its own balance before and after.</p>

<h2 id="fees">Fees &amp; limits</h2>
<ul><li>ORLA fees: none. You pay gas for your own transactions. The bot pays gas for agent trades and payroll runs.</li>
<li>Uniswap pool fee on each live trade: 0.01% (ETH), 0.05% (BTC, AAPL, NVDA, GOOGL, SPY, QQQ, COIN) or 0.3% (TSLA, MSFT, AMZN, META), plus price impact.</li>
<li>Pools on Robinhood Chain are still small, so keep trades modest. Max slippage protects you: a trade worse than that against the oracle is refused.</li>
<li>Paper agents simulate 0.1% cost per trade. Up to 5 agents per wallet, one live agent per vault, up to 100 payroll recipients.</li></ul>

<h2 id="contracts">Contracts</h2>
<p>Robinhood Chain, chain ID 4663. The contracts are open source (MIT).</p>
<table><tr><th>Contract</th><th>Address</th></tr>
<tr><td>AgentVaultFactory</td><td>${ex(cfg.agentVaultFactory)}</td></tr><tr><td>PayrollFactory</td><td>${ex(cfg.payrollFactory)}</td></tr>
<tr><td>OrlaHook (hooked pools)</td><td>${ex(cfg.hook)}</td></tr><tr><td>OrlaLPVaultFactory</td><td>${ex(cfg.lpFactory)}</td></tr><tr><td>OrlaSwapRouter</td><td>${ex(cfg.swapRouter)}</td></tr>
<tr><td>Uniswap V3 SwapRouter02</td><td>${ex(RH.router)}</td></tr><tr><td>Uniswap v4 PoolManager</td><td>${ex('0x8366a39cc670b4001a1121b8f6a443a643e40951')}</td></tr>
<tr><td>USDG</td><td>${ex(RH.tokens[0].address)}</td></tr></table>
<p>Your own vault and payroll addresses are shown in the app and returned by <code>vaultOf(wallet)</code> / <code>payrollOf(wallet)</code> on the factories.</p>

<h2 id="security">Security</h2>
<ul><li>The bot key is treated as untrusted. If it leaked, it could only swap a vault's tokens against USDG through the pinned pools, within your slippage and daily limit, until you pause or revoke it. It can never withdraw.</li>
<li>For payroll the bot can only trigger payments you scheduled; it cannot redirect, increase or bring them forward.</li>
<li>The contracts are open source (MIT) and covered by 76 unit and fuzz tests, plus fork tests against a local copy of Robinhood Chain.</li></ul>

<h2 id="trouble">Troubleshooting</h2>
<table><tr><th>Message</th><th>What it means</th></tr>
<tr><td>Wallet account changed, sign in again</td><td>You switched accounts in your wallet. Connect again.</td></tr><tr><td>Wallet does not switch network</td><td>Add Robinhood Chain manually with the settings above.</td></tr>
<tr><td>insufficient funds for gas</td><td>No ETH on Robinhood Chain in your wallet.</td></tr><tr><td>daily limit reached</td><td>The vault's 24-hour limit is used up; the agent continues after it resets.</td></tr>
<tr><td>price moved too much (slippage guard)</td><td>The pool price was worse than your max slippage against the oracle. Nothing traded.</td></tr><tr><td>oracle price is paused or stale</td><td>Usually a stock at the weekend. The agent retries every hour.</td></tr>
<tr><td>agent access was revoked / vault is paused</td><td>Use Give agent access / Resume vault.</td></tr><tr><td>Some agent runs are delayed</td><td>The engine or a price source is slow. ORLA checks itself every 5 minutes (<a href="/api/health">/api/health</a>) and agents catch up.</td></tr></table>

<h2 id="terms">Terms</h2>
<p>ORLA is software that helps you run automated strategies and payments with smart contracts you own. By using it you agree that:</p>
<ul><li>Nothing on ORLA is financial, investment, legal or tax advice. Backtests and past results do not predict future returns.</li>
<li>Trading crypto and tokenized stocks is risky and you can lose money. Live agents trade real funds in your vault according to the strategy you choose.</li>
<li>Smart contracts, oracles, bridges, wallets, pools and blockchains can fail. You use ORLA at your own risk, and the software is provided "as is", without warranties.</li>
<li>You are responsible for your wallet, your keys, your limits and for following the laws that apply to you.</li>
<li>We may change or discontinue the website and bot at any time. Your vault and payroll contracts stay under your control, and you can always withdraw on-chain.</li></ul>

<h2 id="privacy">Privacy</h2>
<ul><li><b>What we store:</b> your wallet address (as your account), the agents you create with their settings, decisions and results, and your email only if you join the waitlist.</li>
<li><b>What we don't collect:</b> names, private keys or seed phrases. No tracking or advertising cookies: one secure session cookie keeps you signed in.</li>
<li><b>Public by nature:</b> agent names, strategies and results are on the public leaderboard with a shortened wallet address. Everything on-chain is public on Robinhood Chain.</li>
<li><b>Third parties:</b> market data from Binance, Hyperliquid and Yahoo Finance; chain reads through an RPC provider.</li>
<li><b>Deleting data:</b> delete an agent in the Studio to remove it and its history.</li></ul>
</article></div>`;
};
