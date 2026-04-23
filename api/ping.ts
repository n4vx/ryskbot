export const config = { runtime: "edge" };

export default async function handler(_req: Request): Promise<Response> {
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "content-type": "application/json" },
  });
}
