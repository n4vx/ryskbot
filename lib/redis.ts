import { Redis } from "@upstash/redis";
import { env } from "./env.js";

let client: Redis | null = null;

export function redis(): Redis {
  if (!client) {
    client = new Redis({ url: env.upstashUrl(), token: env.upstashToken() });
  }
  return client;
}

// Schema:
//   user:<chatId>        -> { address, addedAt }                     (HASH)
//   address:<addr>       -> Set<chatId>                              (SET)  // reverse lookup
//   tracked:addresses    -> Set<addr>                                (SET)  // all addresses to scan
//   notified:<chatId>:<addr>:<optionId> -> "1" with TTL after expiry (STRING) // dedupe alerts

export type TrackedUser = { address: string; addedAt: number };

export async function setUserAddress(chatId: number, address: string): Promise<void> {
  const r = redis();
  const existing = await r.hget<string>(`user:${chatId}`, "address");
  if (existing && existing.toLowerCase() !== address.toLowerCase()) {
    await r.srem(`address:${existing.toLowerCase()}`, chatId.toString());
  }
  await r.hset(`user:${chatId}`, { address: address.toLowerCase(), addedAt: Date.now() });
  await r.sadd(`address:${address.toLowerCase()}`, chatId.toString());
  await r.sadd("tracked:addresses", address.toLowerCase());
}

export async function getUser(chatId: number): Promise<TrackedUser | null> {
  const r = redis();
  const data = await r.hgetall<Record<string, string>>(`user:${chatId}`);
  if (!data || !data.address) return null;
  return { address: data.address, addedAt: Number(data.addedAt ?? 0) };
}

export async function removeUser(chatId: number): Promise<void> {
  const r = redis();
  const addr = await r.hget<string>(`user:${chatId}`, "address");
  await r.del(`user:${chatId}`);
  if (addr) {
    await r.srem(`address:${addr.toLowerCase()}`, chatId.toString());
    const remaining = await r.scard(`address:${addr.toLowerCase()}`);
    if (remaining === 0) await r.srem("tracked:addresses", addr.toLowerCase());
  }
}

export async function allTrackedAddresses(): Promise<string[]> {
  const r = redis();
  return (await r.smembers("tracked:addresses")) ?? [];
}

export async function chatsForAddress(address: string): Promise<number[]> {
  const r = redis();
  const ids = (await r.smembers(`address:${address.toLowerCase()}`)) ?? [];
  return ids.map((s) => Number(s));
}

// Returns true if this is the first time we're marking it (i.e., should notify).
export async function markNotifiedOnce(
  chatId: number,
  address: string,
  optionId: string,
  ttlSeconds = 60 * 60 * 24 * 30,
): Promise<boolean> {
  const r = redis();
  const key = `notified:${chatId}:${address.toLowerCase()}:${optionId}`;
  const res = await r.set(key, "1", { nx: true, ex: ttlSeconds });
  return res === "OK";
}
