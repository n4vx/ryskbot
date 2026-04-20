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

/**
 * Lists a user's short option positions by enumerating their Gamma vaults.
 * Pure on-chain read, user-specific — no global scanning.
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

  for (let i = 1n; i <= vaultCount; i++) {
    const vault = await client.readContract({
      address: CONTRACTS.controller,
      abi: controllerAbi,
      functionName: "getVault",
      args: [account, i],
    });

    for (let j = 0; j < vault.shortOtokens.length; j++) {
      const oToken = vault.shortOtokens[j];
      const amount = vault.shortAmounts[j];
      if (!oToken || oToken === "0x0000000000000000000000000000000000000000" || !amount || amount === 0n) continue;

      const d = await client.readContract({
        address: lc(oToken),
        abi: otokenAbi,
        functionName: "getOtokenDetails",
      });
      const expiry = Number(d[4]);
      if (expiry <= now - activeWindowSeconds) continue;

      positions.push({
        optionId: `${oToken.toLowerCase()}:short:${i.toString()}`,
        oToken: lc(oToken),
        side: "short",
        strike: d[3],
        expiry,
        isPut: d[5],
        size: amount,
        underlying: lc(d[1]),
        collateral: lc(d[0]),
        vaultId: Number(i),
      });
    }
  }

  return positions;
}
