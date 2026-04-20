import { redis } from "../lib/redis.js";

const r = redis();
const deleted = await r.del("otoken:list", "otoken:count");
console.log(`deleted ${deleted} keys`);
