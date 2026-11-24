# ORLA

No-code trading agents, self-custody vaults, USDG payroll and hooked Uniswap v4 pools on Robinhood Chain.

This repository holds the web app: one Cloudflare Worker that serves the pages, the API, the hourly agent engine (Cron Trigger) and the setup console.

## What it does

- **Paper agents**: pick a strategy and a market, backtest it on real hourly prices, and let it trade $10,000 of virtual money every hour.
- **Live agents**: the same agent trades from an on-chain vault owned by the user's wallet. Only the owner can withdraw.
- **Payroll**: USDG payroll vaults that pay on a schedule.
- **Hooked pool**: a WETH / USDG Uniswap v4 pool with a dynamic fee, plus LP vaults whose range is moved by the agent.

## Build

```bash
npm install
npm run build        # writes dist/worker.js
npm test             # local end-to-end tests (Miniflare, mocked price APIs)
```

## Deploy (Cloudflare)

1. Create a D1 database and bind it to the Worker as `DB`.
2. Add a Cron Trigger: `*/5 * * * *`.
3. Add variables and secrets:

| Name | Type | Value |
| --- | --- | --- |
| `ADMIN_ADDRESS` | Text | Public address of the admin wallet (comma-separated for several) |
| `BOT_PRIVATE_KEY` | Secret | Private key of a **new** wallet used only by the bot (keep a little ETH for gas) |
| `HL_SECRET` | Secret | Random string, 32+ characters, used to encrypt Hyperliquid agent keys. Do not change it later |
| `RPC_URL` | Text (optional) | Custom Robinhood Chain RPC |
| `X_URL`, `GITHUB_URL` | Text (optional) | Footer links |

4. Deploy `dist/worker.js`, sign in at `/setup` with the admin wallet and deploy the contracts.

Never commit private keys or secrets. They live only in Cloudflare.

## Market data

Crypto prices: Binance, with OKX and Hyperliquid as fallbacks. Perpetuals and funding: Hyperliquid. Stocks: Yahoo Finance.

## Disclaimer

Software provided as is. Nothing here is financial advice. Trading crypto and tokenized stocks is risky.
