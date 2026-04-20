import { bot } from "./bot.js";

const SET_NAME = "RyskItAll";
let cache: Map<string, string> | null = null;

async function resolve(): Promise<Map<string, string>> {
  if (cache) return cache;
  const set = await bot().api.getStickerSet(SET_NAME);
  cache = new Map(set.stickers.map((s) => [s.file_unique_id, s.file_id]));
  return cache;
}

/** Sends a sticker by its stable file_unique_id, resolving the bot-scoped file_id at runtime. */
export async function sendSticker(chatId: number, fileUniqueId: string): Promise<void> {
  try {
    const map = await resolve();
    const fid = map.get(fileUniqueId);
    if (!fid) {
      console.warn(`sticker not found in set: ${fileUniqueId}`);
      return;
    }
    await bot().api.sendSticker(chatId, fid);
  } catch (err) {
    console.warn("sticker send failed:", (err as Error).message);
  }
}
