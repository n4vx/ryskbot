import { Redis } from "@upstash/redis";
import { env } from "./env.js";

let client: Redis | null = null;

export function redis(): Redis {
  if (!client) {
    client = new Redis({ url: env.upstashUrl(), token: env.upstashToken() });
  }
  return client;
}

// Schema
//   user:<chatId>:addresses  -> Set<addr>                              (per-chat tracked set)
//   user:<chatId>:awaiting   -> "1" with 5 min TTL                     (track-flow state)
//   address:<addr>           -> Set<chatId>                            (reverse lookup)
//   tracked:addresses        -> Set<addr>                              (global cron loop)
//   notified:<chatId>:<addr>:<optionId>  -> "1" with TTL               (dedupe alerts)
//
// Legacy (pre-multi-address) — auto-migrated on read:
//   user:<chatId>            -> HASH { address, addedAt }

const lc = (a: string) => a.toLowerCase();

async function migrateLegacyIfNeeded(chatId: number): Promise<void> {
  const r = redis();
  const legacy = await r.hget<string>(`user:${chatId}`, "address");
  if (!legacy) return;
  await r.sadd(`user:${chatId}:addresses`, lc(legacy));
  await r.del(`user:${chatId}`);
}

export async function addUserAddress(chatId: number, address: string): Promise<void> {
  const r = redis();
  await migrateLegacyIfNeeded(chatId);
  const addr = lc(address);
  await r.sadd(`user:${chatId}:addresses`, addr);
  await r.sadd(`address:${addr}`, chatId.toString());
  await r.sadd("tracked:addresses", addr);
}

export async function removeUserAddress(chatId: number, address: string): Promise<boolean> {
  const r = redis();
  await migrateLegacyIfNeeded(chatId);
  const addr = lc(address);
  const removed = await r.srem(`user:${chatId}:addresses`, addr);
  await r.srem(`address:${addr}`, chatId.toString());
  const remainingChats = await r.scard(`address:${addr}`);
  if (remainingChats === 0) await r.srem("tracked:addresses", addr);
  return removed > 0;
}

export async function removeAllUserAddresses(chatId: number): Promise<number> {
  const addrs = await getUserAddresses(chatId);
  for (const addr of addrs) await removeUserAddress(chatId, addr);
  return addrs.length;
}

export async function getUserAddresses(chatId: number): Promise<string[]> {
  const r = redis();
  await migrateLegacyIfNeeded(chatId);
  return (await r.smembers(`user:${chatId}:addresses`)) ?? [];
}

const AWAITING_TTL = 5 * 60;

export async function setAwaitingAddress(chatId: number): Promise<void> {
  await redis().set(`user:${chatId}:awaiting`, "1", { ex: AWAITING_TTL });
}

export async function isAwaitingAddress(chatId: number): Promise<boolean> {
  const v = await redis().get<string>(`user:${chatId}:awaiting`);
  return v === "1";
}

export async function clearAwaitingAddress(chatId: number): Promise<void> {
  await redis().del(`user:${chatId}:awaiting`);
}

export async function allTrackedAddresses(): Promise<string[]> {
  const r = redis();
  return (await r.smembers("tracked:addresses")) ?? [];
}

export async function chatsForAddress(address: string): Promise<number[]> {
  const ids = (await redis().smembers(`address:${lc(address)}`)) ?? [];
  return ids.map((s) => Number(s));
}

export async function markNotifiedOnce(
  chatId: number,
  address: string,
  optionId: string,
  ttlSeconds = 60 * 60 * 24 * 30,
): Promise<boolean> {
  const res = await redis().set(`notified:${chatId}:${lc(address)}:${optionId}`, "1", {
    nx: true,
    ex: ttlSeconds,
  });
  return res === "OK";
}
