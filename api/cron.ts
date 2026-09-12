import type { Address } from "viem";
import { bot } from "../lib/bot.js";
import { env } from "../lib/env.js";
import { allTrackedAddresses, chatsForAddress, markNotifiedOnce } from "../lib/redis.js";
import { listPositions } from "../lib/rysk.js";
import { loadState, saveState } from "../lib/positionsState.js";
import { formatExpiryAlert, formatPreExpiryAlert } from "../lib/format.js";
import { sendSticker } from "../lib/stickers.js";

export const config = { runtime: "edge" };

const EXPIRY_WINDOW = 60 * 60 * 24 * 2; // 48h
const PRE_EXPIRY_SECONDS = 60 * 60 * 24; // 24h
// Vercel Edge aborts the request if no response has started after 25s. Stop
// scanning before that so state for the wallets we did process still gets
// saved and the scheduler sees a 200 instead of a 504 (cron-job.org disables
// jobs that keep failing).
const TIME_BUDGET_MS = 20_000;

export default async function handler(req: Request): Promise<Response> {
  try {
    return await run(req);
  } catch (err) {
    const e = err as Error;
    console.error("cron error:", e.stack ?? e.message);
    return Response.json({ error: e.message }, { status: 500 });
  }
}

async function run(req: Request): Promise<Response> {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${env.cronSecret()}`) return new Response("unauthorized", { status: 401 });

  const startedAt = Date.now();
  const addresses = await allTrackedAddresses();
  const now = Math.floor(Date.now() / 1000);
  const results: Array<{ address: string; status: string; notified: number; ms?: number }> = [];
  let skipped = 0;

  for (const address of addresses) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      skipped++;
      continue;
    }
    const t0 = Date.now();
    try {
      const current = await listPositions(address as Address, EXPIRY_WINDOW);
      const lastSeen = await loadState(address);

      // Union of IDs we should consider: everything we've ever seen + everything present now.
      // Snapshot entries older than the window are dropped silently: if the cron was down
      // for days, a stale "expired" alert is noise, not information.
      const byId = new Map<string, (typeof current)[number]>();
      for (const p of lastSeen) if (p.expiry > now - EXPIRY_WINDOW) byId.set(p.optionId, p);
      for (const p of current) byId.set(p.optionId, p); // fresher data wins

      let notified = 0;
      const chatIds = await chatsForAddress(address);

      for (const p of byId.values()) {
        const delta = p.expiry - now;

        // Pre-expiry: entering the final 24h window.
        if (delta > 0 && delta <= PRE_EXPIRY_SECONDS) {
          for (const chatId of chatIds) {
            const first = await markNotifiedOnce(chatId, address, `${p.optionId}:pre24h`);
            if (!first) continue;
            await bot().api.sendMessage(chatId, await formatPreExpiryAlert(p));
            notified++;
          }
        }

        // Expired.
        if (delta <= 0) {
          const alert = await formatExpiryAlert(p);
          for (const chatId of chatIds) {
            const first = await markNotifiedOnce(chatId, address, p.optionId);
            if (!first) continue;
            await bot().api.sendMessage(chatId, alert.text);
            if (alert.sticker) await sendSticker(chatId, alert.sticker);
            notified++;
          }
        }
      }

      await saveState(address, current);
      results.push({ address, status: "ok", notified, ms: Date.now() - t0 });
    } catch (err) {
      results.push({ address, status: `error: ${(err as Error).message}`, notified: 0, ms: Date.now() - t0 });
    }
  }

  return Response.json({ scanned: addresses.length - skipped, skipped, ms: Date.now() - startedAt, results });
}
