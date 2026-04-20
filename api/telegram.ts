import { handleUpdate } from "../lib/bot.js";

export const config = { runtime: "edge" };

export default async function handler(req: Request): Promise<Response> {
  try {
    return await handleUpdate()(req);
  } catch (err) {
    console.error("telegram webhook error", err);
    return new Response("ok", { status: 200 });
  }
}
