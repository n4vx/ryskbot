import { redis } from "../lib/redis.js";

const r = redis();
const setRes = await r.set("ryskbot:ping", "pong", { ex: 60 });
const getRes = await r.get<string>("ryskbot:ping");
console.log("set:", setRes, "| get:", getRes);
