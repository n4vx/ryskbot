function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export const env = {
  telegramBotToken: () => required("TELEGRAM_BOT_TOKEN"),
  telegramWebhookSecret: () => required("TELEGRAM_WEBHOOK_SECRET"),
  upstashUrl: () => required("UPSTASH_REDIS_REST_URL"),
  upstashToken: () => required("UPSTASH_REDIS_REST_TOKEN"),
  rpcUrl: () => process.env.HYPEREVM_RPC_URL ?? "https://rpc.hyperliquid.xyz/evm",
  cronSecret: () => required("CRON_SECRET"),
};
