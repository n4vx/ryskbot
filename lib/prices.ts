type Mids = Record<string, string>;

// Map ERC-20 symbol on HyperEVM -> Hyperliquid spot market symbol.
// Rule of thumb: Rysk uses "U<asset>" (e.g. UBTC, UETH, USOL) for bridged assets,
// and WHYPE for wrapped native HYPE.
function hyperliquidSymbol(erc20Symbol: string): string {
  const s = erc20Symbol.toUpperCase();
  if (s === "WHYPE") return "HYPE";
  if (s.startsWith("U") && s.length <= 5) return s.slice(1); // UBTC -> BTC
  return s;
}

let midsCache: { at: number; data: Mids } | null = null;

async function loadMids(): Promise<Mids> {
  if (midsCache && Date.now() - midsCache.at < 30_000) return midsCache.data;
  const res = await fetch("https://api.hyperliquid.xyz/info", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "allMids" }),
  });
  if (!res.ok) throw new Error(`hyperliquid allMids ${res.status}`);
  const data = (await res.json()) as Mids;
  midsCache = { at: Date.now(), data };
  return data;
}

export async function getPriceUsd(erc20Symbol: string): Promise<number | null> {
  try {
    const mids = await loadMids();
    const hlSymbol = hyperliquidSymbol(erc20Symbol);
    const raw = mids[hlSymbol];
    return raw ? Number(raw) : null;
  } catch {
    return null;
  }
}
