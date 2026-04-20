export const config = { runtime: "edge" };

export default async function handler(req: Request): Promise<Response> {
  return new Response(
    JSON.stringify({
      ok: true,
      hasTelegramToken: !!process.env.TELEGRAM_BOT_TOKEN,
      hasUpstashUrl: !!process.env.UPSTASH_REDIS_REST_URL,
      hasCronSecret: !!process.env.CRON_SECRET,
      ua: req.headers.get("user-agent"),
    }),
    { headers: { "content-type": "application/json" } },
  );
}
