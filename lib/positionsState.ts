import { redis } from "./redis.js";
import type { RyskPosition } from "./rysk.js";

// Snapshot of last-seen positions per address. Cron diffs current chain state
// against this to detect expiries — even after Rysk settles and removes the
// short from the vault.

type StoredPosition = {
  optionId: string;
  oToken: string;
  strike: string;
  expiry: number;
  isPut: boolean;
  size: string;
  underlying: string;
  collateral: string;
  vaultId: number;
};

function key(addr: string): string {
  return `state:${addr.toLowerCase()}`;
}

function serialize(p: RyskPosition): StoredPosition {
  return {
    optionId: p.optionId,
    oToken: p.oToken,
    strike: p.strike.toString(),
    expiry: p.expiry,
    isPut: p.isPut,
    size: p.size.toString(),
    underlying: p.underlying,
    collateral: p.collateral,
    vaultId: p.vaultId,
  };
}

function deserialize(s: StoredPosition): RyskPosition {
  return {
    optionId: s.optionId,
    oToken: s.oToken as RyskPosition["oToken"],
    side: "short",
    strike: BigInt(s.strike),
    expiry: s.expiry,
    isPut: s.isPut,
    size: BigInt(s.size),
    underlying: s.underlying as RyskPosition["underlying"],
    collateral: s.collateral as RyskPosition["collateral"],
    vaultId: s.vaultId,
  };
}

export async function loadState(address: string): Promise<RyskPosition[]> {
  const r = redis();
  const raw = await r.get<StoredPosition[]>(key(address));
  return (raw ?? []).map(deserialize);
}

export async function saveState(address: string, positions: RyskPosition[]): Promise<void> {
  const r = redis();
  await r.set(key(address), positions.map(serialize));
}
