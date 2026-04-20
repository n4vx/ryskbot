# Ryskbot

Telegram bot that tracks [Rysk Finance](https://app.rysk.finance/) positions on HyperEVM and alerts you before and at expiry.

Built for Rysk's retail use case — covered calls and cash-secured puts. Long positions (market-maker side) are intentionally ignored.

## What it does

Send it your HyperEVM address and it will:

- `/status` — live on-chain read of your short option positions (label, size in underlying, strike, expiry, current spot, outcome)
- 24h pre-expiry ping
- Expiry ping at T=0 (fires even after Rysk auto-settles and removes the short from the vault)

Example `/status` output:

```
COVERED CALL · 0.05 UBTC @ $87,000
  Expires: 2026-05-01 08:00 UTC (in 13d 15h)
  Spot: $77,787.50
  Outcome: Keep 0.05 UBTC (OTM)
```

## Stack

- **Runtime**: Vercel Edge Functions (TypeScript)
- **Storage**: Upstash Redis (free tier, REST)
- **Chain**: HyperEVM (chain id 999) via `https://rpc.hyperliquid.xyz/evm`
- **Telegram**: [grammy](https://grammy.dev/) webhook
- **Prices**: Hyperliquid `/info` spot mids
- **Scheduler**: external (cron-job.org free tier) → Vercel hobby cron only runs daily

## How it reads positions

Rysk is an RFQ layer on top of Opyn Gamma. Each option series is an ERC-20 oToken; user shorts live inside Gamma vaults owned by the user.

For any address we call:

```
Controller.getAccountVaultCounter(owner)  -> uint256 n
Controller.getVault(owner, 1..n)          -> tuple(shortOtokens[], shortAmounts[], ...)
OToken.getOtokenDetails()                 -> (collateral, underlying, strike, strikePrice, expiry, isPut)
```

That's it. ~3–4 RPC calls per user, no global scanning.

Known HyperEVM addresses used (recovered from the `RyskHype` proxy storage — the AddressBook reverse registry isn't populated):

| Name | Address |
|---|---|
| Rysk tx processor | `0x8C8bcb6D2c0E31c5789253EcC8431cA6209B4E35` |
| MarginPool | `0x24a44f1dc25540c62c1196FfC297dFC951C91aB4` |
| MMarket | `0x691a5fc3a81a144e36c6C4fBCa1fC82843c80d0d` |
| Gamma Controller | `0x84d84E481B49b8BC5a55f17aaF8181c21A29B212` |
| OTokenFactory | `0xd8EB81d7d31B420B435Cb3c61a8b4e7805E12efF` |

## Setup

### 1. Prerequisites

- Telegram bot token from [@BotFather](https://t.me/BotFather)
- Upstash Redis database ([console.upstash.com](https://console.upstash.com)) — copy the **REST URL** and **REST token**
- Vercel account + CLI (`npm i -g vercel`)
- cron-job.org account (free)

### 2. Clone & install

```bash
git clone <this-repo>
cd ryskbot
yarn install
cp .env.example .env.local
```

Fill `.env.local`:

```
TELEGRAM_BOT_TOKEN=...           # from BotFather
TELEGRAM_WEBHOOK_SECRET=...      # any long random string
UPSTASH_REDIS_REST_URL=https://...
UPSTASH_REDIS_REST_TOKEN=...
HYPEREVM_RPC_URL=https://rpc.hyperliquid.xyz/evm
CRON_SECRET=...                  # any long random string
```

### 3. Deploy to Vercel

```bash
vercel link
# push each env var to Vercel production:
while IFS='=' read -r key value; do
  [ -z "$key" ] || [[ "$key" == \#* ]] && continue
  printf '%s' "$value" | vercel env add "$key" production --force
done < .env.local
vercel --prod
```

### 4. Register the Telegram webhook

```bash
WEBHOOK_URL=https://<your-app>.vercel.app/api/telegram yarn set-webhook
```

### 5. Schedule the cron (every 30 min)

On [cron-job.org](https://console.cron-job.org/jobs):

- **URL**: `https://<your-app>.vercel.app/api/cron`
- **Method**: `POST`
- **Header**: `Authorization: Bearer <CRON_SECRET>`
- **Schedule**: every 30 minutes

## Commands

- `/start` — intro
- `/track 0x...` — start tracking a wallet
- `/status` — live on-chain fetch of current positions
- `/stop` — stop tracking

Sending a bare `0x…` address also starts tracking.

## Layout

```
api/
  telegram.ts   webhook handler (grammy)
  cron.ts       expiry poller (cron-job.org hits this)
  ping.ts       health check
lib/
  bot.ts            grammy bot + commands
  rysk.ts           HyperEVM client + vault enumeration
  positionsState.ts last-seen snapshot (for expiry-after-settlement detection)
  redis.ts          Upstash wrapper + schema
  symbols.ts        ERC-20 symbol/decimals cache
  prices.ts         Hyperliquid mids fetcher
  format.ts         Telegram message formatting
  env.ts            env-var accessors
scripts/
  set-webhook.ts    register Telegram webhook
  smoke.ts          one-shot HyperEVM smoke test
  clean-redis.ts    delete obsolete keys (dev)
```

## License

MIT — see [LICENSE](LICENSE).
