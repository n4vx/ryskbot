# Ryskbot — Claude Project Context

Telegram bot that alerts Rysk Finance users 24h before and at expiry on their
covered-call / cash-secured-put positions on HyperEVM.

Production: https://ryskbot.vercel.app  ·  Bot handle: `@rysktrackerbot`
Public repo: https://github.com/n4vx/ryskbot

## Stack

- **Runtime**: Vercel **Edge Functions** (not Node). `req`/`Response` are Fetch API — don't use `VercelRequest` or `res.status()` style.
- **Language**: TypeScript (Yarn Berry, ESM, `"type": "module"`). Use `.js` extensions in imports.
- **Telegram**: grammy, webhook-based (`/api/telegram`), not long-polling.
- **Storage**: Upstash Redis (REST, not TCP — Edge can't hold connections). `@upstash/redis`.
- **Chain**: HyperEVM (chain id 999), public RPC `https://rpc.hyperliquid.xyz/evm`. Rate-limited; keep serial.
- **Prices**: Hyperliquid `POST https://api.hyperliquid.xyz/info {type:"allMids"}`. Symbol map: `WHYPE→HYPE`, `U<X>→<X>` (UBTC→BTC), else passthrough.
- **Scheduler**: external (cron-job.org hits `/api/cron` every 30 min with `Authorization: Bearer $CRON_SECRET`). Vercel Hobby cron only runs daily — don't rely on it.

## Position data path

Rysk V12 is an RFQ layer on top of Opyn Gamma. Shorts (our target audience)
live in Gamma vaults owned by the user. We do not scan oTokens globally.

Per user:
```
Controller.getAccountVaultCounter(owner) -> uint256
Controller.getVault(owner, i)            -> (shortOtokens[], shortAmounts[], ...)
OToken.getOtokenDetails()                -> (collateral, underlying, strikeAsset, strikePrice, expiry, isPut)
```

**We only track shorts.** Longs are market-maker-side — not this bot's problem.

### Contracts (HyperEVM, chain 999)

| Name | Address |
|---|---|
| Rysk tx processor | `0x8C8bcb6D2c0E31c5789253EcC8431cA6209B4E35` |
| MarginPool | `0x24a44f1dc25540c62c1196FfC297dFC951C91aB4` |
| MMarket | `0x691a5fc3a81a144e36c6C4fBCa1fC82843c80d0d` |
| Gamma Controller | `0x84d84E481B49b8BC5a55f17aaF8181c21A29B212` |
| OTokenFactory | `0xd8EB81d7d31B420B435Cb3c61a8b4e7805E12efF` |

These are not in Rysk's AddressBook (the reverse registry is unpopulated) —
we recovered them from the `RyskHype` proxy's storage slots. Don't trust
`AddressBook.getController()` etc. — they return `0x0`.

## Gotchas

- **Addresses**: viem applies EIP-1191 chain-specific checksum on chain 999 returns; plain EIP-55 `getAddress()` then rejects. Always store addresses **lowercased** (`x.toLowerCase() as Address`) — viem accepts lowercase at call sites.
- **Telegram sticker file_id is bot-scoped.** A file_id obtained via `@ShowJSONBot` won't work from our bot. We resolve at runtime via `bot.api.getStickerSet("RyskItAll")` and look up by `file_unique_id` (globally stable). See `lib/stickers.ts`.
- **Opyn decimals**: oToken `balanceOf` and `shortAmounts` use **8 decimals** regardless of the underlying. Strike prices also use **8 decimals**.
- **HyperEVM RPC** caps `eth_getLogs` at 1000 blocks per call. We don't use logs; kept here so nobody tries.
- **Post-expiry settlement**: Rysk's keeper may remove the short from the vault shortly after expiry. Cron snapshots last-seen state in `state:<addr>` so alerts still fire even after settlement removes the position. See `lib/positionsState.ts`.

## Layout

```
api/
  telegram.ts   grammy webhook (Edge)
  cron.ts      expiry poller, hit by cron-job.org (Edge)
  ping.ts      health check
lib/
  bot.ts            grammy commands: /start /track /status /stop, bare-addr handling
  rysk.ts           HyperEVM client + vault enumeration + listPositions()
  positionsState.ts last-seen snapshot for expiry-after-settlement
  redis.ts          Upstash wrapper + schema
  symbols.ts        ERC-20 symbol+decimals cache
  prices.ts         Hyperliquid mids fetcher + symbol mapping
  format.ts         message formatting + sticker picker
  stickers.ts       resolves file_unique_id → file_id via getStickerSet
  env.ts            env-var accessors
scripts/
  set-webhook.ts    registers Telegram webhook
  set-commands.ts   registers the bot's command menu
  smoke.ts          one-shot HyperEVM sanity check
  clean-redis.ts    ad-hoc key cleanup (dev)
  check-redis.ts    health check
```

## Redis schema

```
user:<chatId>:addresses          SET<addr>              per-chat tracked wallets
user:<chatId>:awaiting           STRING "1" TTL 5 min   /track-no-arg flow
address:<addr>                   SET<chatId>            reverse lookup
tracked:addresses                SET<addr>              global cron loop
notified:<chatId>:<addr>:<optId> STRING TTL 30d         alert dedupe
state:<addr>                     JSON[]                 last-seen positions snapshot
```

Legacy `user:<chatId>` hash (pre-multi-address) auto-migrates on first read.

## Commands on Telegram

- `/start` — intro
- `/track` — prompts for an address (next msg captured); or `/track 0x…` to add directly
- `/status` — iterates all tracked wallets, shows live positions
- `/stop 0x…` — untrack one; `/stop all` — clear all

Bare `0x…` message also triggers /track.

## Deploy flow

```
# first time only
vercel link

# push env vars from .env.local
while IFS='=' read -r k v; do
  [ -z "$k" ] || [[ "$k" == \#* ]] && continue
  printf '%s' "$v" | vercel env add "$k" production --force
done < .env.local

vercel --prod --yes
WEBHOOK_URL=https://ryskbot.vercel.app/api/telegram yarn set-webhook
yarn set-commands
```

External cron (cron-job.org): POST `https://ryskbot.vercel.app/api/cron`
with header `Authorization: Bearer $CRON_SECRET`, every 30 minutes.

## Local scripts

- `yarn typecheck` — tsc --noEmit
- `yarn smoke` — hits HyperEVM, prints chain id + factory length + sample oToken details
- `yarn check-redis` — ping/pong against Upstash
- `yarn set-webhook` — needs `WEBHOOK_URL` env var
- `yarn set-commands` — refreshes the bot's menu

## Editing conventions

- Run `yarn typecheck` before every deploy.
- After changing env vars, re-run `vercel env add` and `vercel --prod` — Edge Functions read env only at cold start.
- After rotating `TELEGRAM_BOT_TOKEN` or `TELEGRAM_WEBHOOK_SECRET`, re-run `yarn set-webhook`.
- Sticker `file_unique_id`s are constants in `lib/format.ts`. Pack name is in `lib/stickers.ts` (`RyskItAll`). Add a new sticker: send it to `@ShowJSONBot`, copy `file_unique_id`, add to the appropriate constant array.
