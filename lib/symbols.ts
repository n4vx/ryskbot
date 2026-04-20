import { parseAbiItem, type Address } from "viem";
import { redis } from "./redis.js";
import { rpc } from "./rysk.js";

const erc20Abi = [
  parseAbiItem("function symbol() view returns (string)"),
  parseAbiItem("function decimals() view returns (uint8)"),
] as const;

// Returns a lowercased-addr -> { symbol, decimals } map. Cached in Redis forever
// (metadata doesn't change on ERC-20 contracts we care about).
export async function loadTokenMeta(addresses: Address[]): Promise<Map<Address, { symbol: string; decimals: number }>> {
  const r = redis();
  const out = new Map<Address, { symbol: string; decimals: number }>();
  const unique = Array.from(new Set(addresses.map((a) => a.toLowerCase() as Address)));
  if (unique.length === 0) return out;

  const cached = await r.mget<(string | null)[]>(...unique.map((a) => `token:meta:${a}`));
  const toFetch: Address[] = [];
  unique.forEach((addr, i) => {
    const raw = cached[i];
    if (raw) {
      try {
        const parsed = typeof raw === "string" ? JSON.parse(raw) : (raw as { symbol: string; decimals: number });
        out.set(addr, parsed);
        return;
      } catch {
        /* fall through */
      }
    }
    toFetch.push(addr);
  });

  const client = rpc();
  for (const addr of toFetch) {
    try {
      const [symbol, decimals] = await Promise.all([
        client.readContract({ address: addr, abi: erc20Abi, functionName: "symbol" }),
        client.readContract({ address: addr, abi: erc20Abi, functionName: "decimals" }),
      ]);
      const meta = { symbol, decimals: Number(decimals) };
      out.set(addr, meta);
      await r.set(`token:meta:${addr}`, JSON.stringify(meta));
    } catch {
      const fallback = { symbol: addr.slice(0, 6), decimals: 18 };
      out.set(addr, fallback);
    }
  }

  return out;
}
