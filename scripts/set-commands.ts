const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("Set TELEGRAM_BOT_TOKEN in your environment.");
  process.exit(1);
}

const commands = [
  { command: "start", description: "Intro and how to use" },
  { command: "track", description: "Track a wallet address" },
  { command: "status", description: "Show current Rysk positions" },
  { command: "stop", description: "Stop tracking" },
];

const res = await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ commands }),
});
console.log(res.status, await res.text());
