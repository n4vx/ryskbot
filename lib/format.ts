import { formatUnits } from "viem";
import type { RyskPosition } from "./rysk.js";
import { loadTokenMeta } from "./symbols.js";
import { getPriceUsd } from "./prices.js";

const ONE_DAY = 86_400;
const STRIKE_DECIMALS = 8;
const OTOKEN_DECIMALS = 8;

function formatExpiry(unix: number): string {
  return new Date(unix * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

function timeUntil(unix: number): string {
  const diff = unix - Math.floor(Date.now() / 1000);
  if (diff <= 0) return "expired";
  const days = Math.floor(diff / ONE_DAY);
  const hours = Math.floor((diff % ONE_DAY) / 3600);
  if (days > 0) return `${days}d ${hours}h`;
  const minutes = Math.floor((diff % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function formatUsd(n: number): string {
  const maxDp = n < 10 ? 4 : n < 1000 ? 2 : 0;
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: maxDp });
}

function formatAmount(n: number, maxDp = 6): string {
  if (n === 0) return "0";
  if (n >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return n.toLocaleString("en-US", { maximumFractionDigits: maxDp });
}

function labelFor(p: RyskPosition): string {
  return p.isPut ? "CASH-SECURED PUT" : "COVERED CALL";
}

function outcomeText(p: RyskPosition, symbol: string, sizeUnits: number, spot: number | null, strike: number): string {
  const cashNotional = sizeUnits * strike;
  if (!p.isPut) {
    if (spot === null) return `If ≤ ${formatUsd(strike)}: keep ${formatAmount(sizeUnits)} ${symbol} · If >: deliver for ${formatUsd(cashNotional)}`;
    return spot <= strike
      ? `Keep ${formatAmount(sizeUnits)} ${symbol} (OTM)`
      : `Deliver ${formatAmount(sizeUnits)} ${symbol} for ${formatUsd(cashNotional)} (ITM)`;
  }
  if (spot === null) return `If ≥ ${formatUsd(strike)}: keep ${formatUsd(cashNotional)} · If <: buy ${formatAmount(sizeUnits)} ${symbol}`;
  return spot >= strike
    ? `Keep ${formatUsd(cashNotional)} (OTM)`
    : `Buy ${formatAmount(sizeUnits)} ${symbol} at ${formatUsd(strike)} (ITM)`;
}

export async function formatPositions(positions: RyskPosition[]): Promise<string> {
  if (positions.length === 0) return "No active Rysk positions found for this address.";

  const underlyings = positions.map((p) => p.underlying);
  const meta = await loadTokenMeta(underlyings);

  const symbols = new Set<string>();
  for (const p of positions) symbols.add(meta.get(p.underlying)?.symbol ?? "?");
  const prices = new Map<string, number | null>();
  await Promise.all(
    Array.from(symbols).map(async (s) => {
      prices.set(s, s === "?" ? null : await getPriceUsd(s));
    }),
  );

  return positions
    .map((p) => {
      const m = meta.get(p.underlying) ?? { symbol: "?", decimals: 18 };
      const sizeUnits = Number(formatUnits(p.size, OTOKEN_DECIMALS));
      const strike = Number(formatUnits(p.strike, STRIKE_DECIMALS));
      const spot = prices.get(m.symbol) ?? null;
      return formatPositionBlock(p, m.symbol, sizeUnits, strike, spot);
    })
    .join("\n\n");
}

function formatPositionBlock(
  p: RyskPosition,
  symbol: string,
  sizeUnits: number,
  strike: number,
  spot: number | null,
): string {
  const now = Math.floor(Date.now() / 1000);
  const expired = p.expiry <= now;
  const timeLine = expired
    ? `Expired · ${formatExpiry(p.expiry)}`
    : `${timeUntil(p.expiry)} to expiry · ${formatExpiry(p.expiry)}`;
  const outcome = outcomeText(p, symbol, sizeUnits, spot, strike);
  const outcomeLine = spot !== null ? `Spot ${formatUsd(spot)} → ${outcome}` : outcome;
  return [
    `${labelFor(p)} · ${formatAmount(sizeUnits)} ${symbol} @ ${formatUsd(strike)}`,
    timeLine,
    outcomeLine,
  ].join("\n");
}

// file_unique_ids from the RyskItAll public sticker set (resolved at runtime)
const STICKER_OTM = "AgADIScAAmqSGFA";
const STICKER_ITM = "AgADwBoAAqHDOVA";

const STICKERS_TRACK = [
  "AgADBxgAAnJ5iVE", // 🐈 cat (meme)
  "AgADKxwAAoBCYFE", // 🤑 money face
  "AgADkBgAAsEXqVE", // 😎 sunglasses
];

const STICKERS_COVERED_CALL_STATUS = [
  "AgAD3hcAAnmGYVI", // RYSK HUH cat
];

function pick<T>(xs: readonly T[]): T {
  return xs[Math.floor(Math.random() * xs.length)]!;
}

export function pickTrackSticker(): string {
  return pick(STICKERS_TRACK);
}

export function pickCoveredCallStatusSticker(): string {
  return pick(STICKERS_COVERED_CALL_STATUS);
}

function isOtm(p: RyskPosition, spot: number, strike: number): boolean {
  return p.isPut ? spot >= strike : spot <= strike;
}

export async function formatExpiryAlert(
  p: RyskPosition,
): Promise<{ text: string; sticker?: string }> {
  const meta = await loadTokenMeta([p.underlying]);
  const m = meta.get(p.underlying) ?? { symbol: "?", decimals: 18 };
  const sizeUnits = Number(formatUnits(p.size, OTOKEN_DECIMALS));
  const strike = Number(formatUnits(p.strike, STRIKE_DECIMALS));
  const spot = m.symbol === "?" ? null : await getPriceUsd(m.symbol);

  const text = [
    `⏰ Position expired`,
    ``,
    formatPositionBlock(p, m.symbol, sizeUnits, strike, spot),
    ``,
    `Rysk settles automatically — app.rysk.finance`,
  ].join("\n");

  const sticker = spot === null ? undefined : isOtm(p, spot, strike) ? STICKER_OTM : STICKER_ITM;
  return { text, sticker };
}

export async function formatPreExpiryAlert(p: RyskPosition): Promise<string> {
  const meta = await loadTokenMeta([p.underlying]);
  const m = meta.get(p.underlying) ?? { symbol: "?", decimals: 18 };
  const sizeUnits = Number(formatUnits(p.size, OTOKEN_DECIMALS));
  const strike = Number(formatUnits(p.strike, STRIKE_DECIMALS));
  const spot = m.symbol === "?" ? null : await getPriceUsd(m.symbol);

  return [
    `⚠️ Expires in under 24h`,
    ``,
    formatPositionBlock(p, m.symbol, sizeUnits, strike, spot),
  ].join("\n");
}
