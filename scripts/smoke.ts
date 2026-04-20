import { createPublicClient, http, parseAbiItem, getAddress } from "viem";

const RPC = process.env.HYPEREVM_RPC_URL ?? "https://rpc.hyperliquid.xyz/evm";
const FACTORY = getAddress("0xd8eb81d7d31b420b435cb3c61a8b4e7805e12eff");
const CONTROLLER = getAddress("0x84d84e481b49b8bc5a55f17aaf8181c21a29b212");

const client = createPublicClient({
  transport: http(RPC),
  chain: {
    id: 999,
    name: "HyperEVM",
    nativeCurrency: { decimals: 18, name: "HYPE", symbol: "HYPE" },
    rpcUrls: { default: { http: [RPC] } },
  } as const,
});

const chainId = await client.getChainId();
console.log("chainId:", chainId);

const block = await client.getBlockNumber();
console.log("latest block:", block);

const total = await client.readContract({
  address: FACTORY,
  abi: [parseAbiItem("function getOtokensLength() view returns (uint256)")],
  functionName: "getOtokensLength",
});
console.log("OTokens deployed:", total.toString());

const first = await client.readContract({
  address: FACTORY,
  abi: [parseAbiItem("function otokens(uint256) view returns (address)")],
  functionName: "otokens",
  args: [0n],
});
console.log("otokens[0]:", first);

const details = await client.readContract({
  address: first,
  abi: [
    parseAbiItem(
      "function getOtokenDetails() view returns (address collateral, address underlying, address strike, uint256 strikePrice, uint256 expiry, bool isPut)",
    ),
  ],
  functionName: "getOtokenDetails",
});
console.log("sample otoken details:", {
  collateral: details[0],
  underlying: details[1],
  strikeAsset: details[2],
  strikePrice: details[3].toString(),
  expiry: new Date(Number(details[4]) * 1000).toISOString(),
  isPut: details[5],
});

// Quick controller sanity check (should not revert on getAccountVaultCounter for any address)
const vaults = await client.readContract({
  address: CONTROLLER,
  abi: [parseAbiItem("function getAccountVaultCounter(address owner) view returns (uint256)")],
  functionName: "getAccountVaultCounter",
  args: ["0x0000000000000000000000000000000000000000"],
});
console.log("vaults for zero addr:", vaults.toString());
