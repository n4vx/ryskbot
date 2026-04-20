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
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n < 10 ? 4 : 2 });
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

      const lines = [
        `${labelFor(p)} · ${formatAmount(sizeUnits)} ${m.symbol} @ ${formatUsd(strike)}`,
        `  Expires: ${formatExpiry(p.expiry)} (in ${timeUntil(p.expiry)})`,
      ];
      if (spot !== null) lines.push(`  Spot: ${formatUsd(spot)}`);
      lines.push(`  Outcome: ${outcomeText(p, m.symbol, sizeUnits, spot, strike)}`);
      return lines.join("\n");
    })
    .join("\n\n");
}

export async function formatExpiryAlert(p: RyskPosition): Promise<string> {
  const meta = await loadTokenMeta([p.underlying]);
  const m = meta.get(p.underlying) ?? { symbol: "?", decimals: 18 };
  const sizeUnits = Number(formatUnits(p.size, OTOKEN_DECIMALS));
  const strike = Number(formatUnits(p.strike, STRIKE_DECIMALS));

  return [
    `${labelFor(p)} expired`,
    ``,
    `${formatAmount(sizeUnits)} ${m.symbol} @ ${formatUsd(strike)}`,
    `Expiry: ${formatExpiry(p.expiry)}`,
    ``,
    `Rysk settles automatically — check your collateral at https://app.rysk.finance/`,
  ].join("\n");
}

export async function formatPreExpiryAlert(p: RyskPosition): Promise<string> {
  const meta = await loadTokenMeta([p.underlying]);
  const m = meta.get(p.underlying) ?? { symbol: "?", decimals: 18 };
  const sizeUnits = Number(formatUnits(p.size, OTOKEN_DECIMALS));
  const strike = Number(formatUnits(p.strike, STRIKE_DECIMALS));

  return [
    `${labelFor(p)} expires in <24h`,
    ``,
    `${formatAmount(sizeUnits)} ${m.symbol} @ ${formatUsd(strike)}`,
    `Expiry: ${formatExpiry(p.expiry)} (in ${timeUntil(p.expiry)})`,
  ].join("\n");
}
