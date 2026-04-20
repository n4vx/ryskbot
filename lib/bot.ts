import { Bot, webhookCallback, type Context } from "grammy";
import type { Address } from "viem";
import { env } from "./env.js";
import {
  addUserAddress,
  clearAwaitingAddress,
  getUserAddresses,
  isAwaitingAddress,
  removeAllUserAddresses,
  removeUserAddress,
  setAwaitingAddress,
} from "./redis.js";
import { isLikelyAddress, listPositions } from "./rysk.js";
import { formatPositions, pickCoveredCallStatusSticker, pickTrackSticker } from "./format.js";
import { sendSticker } from "./stickers.js";

let singleton: Bot | null = null;

export function bot(): Bot {
  if (singleton) return singleton;
  const b = new Bot(env.telegramBotToken());

  b.command("start", async (ctx) => {
    await ctx.reply(
      [
        "Rysk position tracker",
        "",
        "I notify you when your Rysk covered-call / cash-secured-put positions expire.",
        "",
        "Commands:",
        "/track — start tracking a wallet",
        "/status — show your tracked wallets' positions",
        "/stop 0x… — untrack a wallet (or /stop all)",
      ].join("\n"),
    );
  });

  b.command("track", async (ctx) => {
    if (!ctx.chat) return;
    const arg = ctx.match?.toString().trim() ?? "";
    if (arg) return handleTrack(ctx, arg);
    await setAwaitingAddress(ctx.chat.id);
    await ctx.reply(
      "Paste the HyperEVM wallet address you want to track (0x...). You can track multiple — send one at a time.",
    );
  });

  b.command("stop", async (ctx) => {
    if (!ctx.chat) return;
    const arg = ctx.match?.toString().trim() ?? "";
    if (!arg || arg.toLowerCase() === "all") {
      const n = await removeAllUserAddresses(ctx.chat.id);
      await ctx.reply(n === 0 ? "Nothing was being tracked." : `Stopped tracking ${n} address${n === 1 ? "" : "es"}.`);
      return;
    }
    if (!isLikelyAddress(arg)) {
      await ctx.reply("Usage: /stop 0xAddress (or /stop all)");
      return;
    }
    const removed = await removeUserAddress(ctx.chat.id, arg);
    await ctx.reply(removed ? `Stopped tracking ${arg.toLowerCase()}.` : "That address wasn't in your list.");
  });

  b.command("status", async (ctx) => {
    if (!ctx.chat) return;
    const addrs = await getUserAddresses(ctx.chat.id);
    if (addrs.length === 0) {
      await ctx.reply("You're not tracking any address yet. Send /track.");
      return;
    }
    for (const addr of addrs) {
      await ctx.reply(`Tracking ${addr}\nFetching positions…`);
      await sendPositionsReport(ctx, addr);
    }
  });

  b.on("message:text", async (ctx) => {
    if (!ctx.chat) return;
    const text = ctx.message.text.trim();
    if (text.startsWith("/")) return;
    const awaiting = await isAwaitingAddress(ctx.chat.id);
    if (isLikelyAddress(text)) {
      if (awaiting) await clearAwaitingAddress(ctx.chat.id);
      await handleTrack(ctx, text);
      return;
    }
    if (awaiting) {
      await ctx.reply("That doesn't look like a valid 0x address. Try again, or /stop all to cancel.");
    }
  });

  singleton = b;
  return b;
}

async function handleTrack(ctx: Context, arg: string) {
  if (!ctx.chat) return;
  if (!isLikelyAddress(arg)) {
    await ctx.reply("That doesn't look like a valid 0x address.");
    return;
  }
  const addr = arg.toLowerCase();
  await addUserAddress(ctx.chat.id, addr);
  await ctx.reply(`Tracking ${addr}.\nI'll message you 24h before and at expiry.`);
  await sendSticker(ctx.chat.id, pickTrackSticker());
  await sendPositionsReport(ctx, addr);
}

async function sendPositionsReport(ctx: Context, address: string) {
  if (!ctx.chat) return;
  try {
    const positions = await listPositions(address as Address);
    const body = await formatPositions(positions);
    await ctx.reply(body);
    if (positions.some((p) => !p.isPut)) {
      await sendSticker(ctx.chat.id, pickCoveredCallStatusSticker());
    }
  } catch (err) {
    await ctx.reply(`Error fetching positions: ${(err as Error).message}`);
  }
}

export const handleUpdate = () =>
  webhookCallback(bot(), "std/http", {
    secretToken: env.telegramWebhookSecret(),
  });
