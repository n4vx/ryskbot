import { Bot, webhookCallback, type Context } from "grammy";
import type { Address } from "viem";
import { env } from "./env.js";
import { getUser, removeUser, setUserAddress } from "./redis.js";
import { isLikelyAddress, listPositions } from "./rysk.js";
import { formatPositions } from "./format.js";

let singleton: Bot | null = null;

export function bot(): Bot {
  if (singleton) return singleton;
  const b = new Bot(env.telegramBotToken());

  b.command("start", async (ctx) => {
    await ctx.reply(
      [
        "Rysk position tracker",
        "",
        "Send me your HyperEVM wallet address (0x...) and I'll notify you when your Rysk positions expire.",
        "",
        "Commands:",
        "/track 0x... — start tracking an address",
        "/status — show current positions (live from chain)",
        "/stop — stop tracking",
      ].join("\n"),
    );
  });

  b.command("track", async (ctx) => handleTrack(ctx, ctx.match?.toString().trim() ?? ""));

  b.command("stop", async (ctx) => {
    if (!ctx.chat) return;
    await removeUser(ctx.chat.id);
    await ctx.reply("Stopped tracking. Send /track 0x... to resume.");
  });

  b.command("status", async (ctx) => {
    if (!ctx.chat) return;
    const user = await getUser(ctx.chat.id);
    if (!user) {
      await ctx.reply("You're not tracking any address yet. Send /track 0x...");
      return;
    }
    await ctx.reply(`Tracking ${user.address}\nFetching positions…`);
    try {
      const positions = await listPositions(user.address as Address);
      const body = await formatPositions(positions);
      await ctx.reply(body);
    } catch (err) {
      await ctx.reply(`Error fetching positions: ${(err as Error).message}`);
    }
  });

  // Bare 0x... messages act as /track
  b.on("message:text", async (ctx) => {
    const text = ctx.message.text.trim();
    if (text.startsWith("/")) return;
    if (isLikelyAddress(text)) await handleTrack(ctx, text);
  });

  singleton = b;
  return b;
}

async function handleTrack(ctx: Context, arg: string) {
  if (!ctx.chat) return;
  if (!arg) {
    await ctx.reply("Usage: /track 0xYourAddress");
    return;
  }
  if (!isLikelyAddress(arg)) {
    await ctx.reply("That doesn't look like a valid 0x address.");
    return;
  }
  await setUserAddress(ctx.chat.id, arg);
  await ctx.reply(
    `Tracking ${arg.toLowerCase()}.\nI'll message you when a position expires. Send /status to see current positions.`,
  );
}

export const handleUpdate = () =>
  webhookCallback(bot(), "std/http", {
    secretToken: env.telegramWebhookSecret(),
  });
