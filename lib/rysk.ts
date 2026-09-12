import { createPublicClient, http, type Address, parseAbiItem, getAddress } from "viem";
import { env } from "./env.js";

const lc = (s: string) => s.toLowerCase() as Address;

export const CHAIN_ID = 999;

export const rpc = () =>
  createPublicClient({
    transport: http(env.rpcUrl(), { retryCount: 0 }),
    chain: {
      id: CHAIN_ID,
      name: "HyperEVM",
      nativeCurrency: { decimals: 18, name: "HYPE", symbol: "HYPE" },
      rpcUrls: { default: { http: [env.rpcUrl()] } },
    } as const,
  });

export const CONTRACTS = {
  rysk: getAddress("0x8c8bcb6d2c0e31c5789253ecc8431ca6209b4e35"),
  marginPool: getAddress("0x24a44f1dc25540c62c1196ffc297dfc951c91ab4"),
  mmarket: getAddress("0x691a5fc3a81a144e36c6c4fbca1fc82843c80d0d"),
  controller: getAddress("0x84d84e481b49b8bc5a55f17aaf8181c21a29b212"),
};

export type RyskPosition = {
  optionId: string;
  oToken: Address;
  side: "short";
  strike: bigint;
  expiry: number;
  isPut: boolean;
  size: bigint;
  underlying: Address;
  collateral: Address;
  vaultId: number;
};

export const otokenAbi = [
  parseAbiItem(
    "function getOtokenDetails() view returns (address collateral, address underlying, address strike, uint256 strikePrice, uint256 expiry, bool isPut)",
  ),
] as const;

export const controllerAbi = [
  parseAbiItem("function getAccountVaultCounter(address owner) view returns (uint256)"),
  {
    type: "function",
    stateMutability: "view",
    name: "getVault",
    inputs: [
      { name: "owner", type: "address" },
      { name: "vaultId", type: "uint256" },
    ],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "shortOtokens", type: "address[]" },
          { name: "longOtokens", type: "address[]" },
          { name: "collateralAssets", type: "address[]" },
          { name: "shortAmounts", type: "uint256[]" },
          { name: "longAmounts", type: "uint256[]" },
          { name: "collateralAmounts", type: "uint256[]" },
        ],
      },
    ],
  },
] as const;

export function isLikelyAddress(s: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(s.trim());
}

const MULTICALL3: Address = "0xca11bde05977b3631167028862be2a173976ca11";
const ZERO: Address = "0x0000000000000000000000000000000000000000";
const MULTICALL_CHUNK = 40;

async function multicallChunked<T>(
  client: ReturnType<typeof rpc>,
  contracts: readonly unknown[],
): Promise<Array<{ status: "success"; result: T } | { status: "failure"; error: Error }>> {
  const out: Array<{ status: "success"; result: T } | { status: "failure"; error: Error }> = [];
  for (let i = 0; i < contracts.length; i += MULTICALL_CHUNK) {
    const chunk = contracts.slice(i, i + MULTICALL_CHUNK);
    const res = await client.multicall({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      contracts: chunk as any,
      multicallAddress: MULTICALL3,
      allowFailure: true,
    });
    out.push(...(res as Array<{ status: "success"; result: T } | { status: "failure"; error: Error }>));
  }
  return out;
}

type Vault = {
  shortOtokens: readonly Address[];
  shortAmounts: readonly bigint[];
};

type OtokenDetails = readonly [Address, Address, Address, bigint, bigint, boolean];

/**
 * Lists a user's short option positions by enumerating their Gamma vaults.
 * Pure on-chain read, user-specific — no global scanning.
 *
 * Uses Multicall3 so a wallet with N vaults costs ~3 RPC round-trips instead
 * of N+M. The public HyperEVM RPC is slow (~250ms/call) and Vercel Edge kills
 * the cron at 25s, so serial per-vault reads don't scale past a few wallets.
 */
export async function listPositions(
  account: Address,
  activeWindowSeconds = 60 * 60 * 24 * 2,
): Promise<RyskPosition[]> {
  const client = rpc();
  const now = Math.floor(Date.now() / 1000);
  const positions: RyskPosition[] = [];

  const vaultCount = await client.readContract({
    address: CONTRACTS.controller,
    abi: controllerAbi,
    functionName: "getAccountVaultCounter",
    args: [account],
  });
  if (vaultCount === 0n) return positions;

  // 1) All vaults in a few batched calls.
  const vaultCalls = [];
  for (let i = 1n; i <= vaultCount; i++) {
    vaultCalls.push({
      address: CONTRACTS.controller,
      abi: controllerAbi,
      functionName: "getVault",
      args: [account, i],
    });
  }
  const vaults = await multicallChunked<Vault>(client, vaultCalls);

  // 2) Collect live shorts, then fetch each distinct oToken's details once.
  type Short = { vaultId: bigint; oToken: Address; amount: bigint };
  const shorts: Short[] = [];
  vaults.forEach((v, idx) => {
    if (v.status !== "success") return;
    const vaultId = BigInt(idx + 1);
    for (let j = 0; j < v.result.shortOtokens.length; j++) {
      const oToken = v.result.shortOtokens[j];
      const amount = v.result.shortAmounts[j];
      if (!oToken || oToken === ZERO || !amount || amount === 0n) continue;
      shorts.push({ vaultId, oToken: lc(oToken), amount });
    }
  });
  if (shorts.length === 0) return positions;

  const uniqueOtokens = Array.from(new Set(shorts.map((s) => s.oToken)));
  const detailResults = await multicallChunked<OtokenDetails>(
    client,
    uniqueOtokens.map((address) => ({ address, abi: otokenAbi, functionName: "getOtokenDetails" })),
  );
  const details = new Map<Address, OtokenDetails>();
  uniqueOtokens.forEach((addr, i) => {
    const r = detailResults[i];
    if (r && r.status === "success") details.set(addr, r.result);
  });

  for (const s of shorts) {
    const d = details.get(s.oToken);
    if (!d) continue;
    const expiry = Number(d[4]);
    if (expiry <= now - activeWindowSeconds) continue;

    positions.push({
      optionId: `${s.oToken}:short:${s.vaultId.toString()}`,
      oToken: s.oToken,
      side: "short",
      strike: d[3],
      expiry,
      isPut: d[5],
      size: s.amount,
      underlying: lc(d[1]),
      collateral: lc(d[0]),
      vaultId: Number(s.vaultId),
    });
  }

  return positions;
}
