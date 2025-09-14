## How to run for development/testing

### 1. Setup: Required Files & Tools
📦 Dependencies

Ensure these are installed:
```
npm install express body-parser dotenv discord.js xml2js node-fetch
npm install --save-dev typescript ts-node @types/node @types/express
```

📄 Required Files
- bot.ts (or index.ts) — your main TypeScript file (from above)
- .env — for secrets and config
- subs.json — optional, starts as an empty array: []

### 2. Update .env for Local Testing

```
DISCORD_BOT_TOKEN=your_discord_bot_token
DISCORD_APPLICATION_ID=your_discord_app_id
YOUTUBE_API_KEY=your_youtube_api_key
PUBLIC_BASE_URL=https://your-tunnel.ngrok-free.app  # explained below
```

You must use a public URL for `PUBLIC_BASE_URL` (YouTube requires it to send WebSub POSTs).

### 3. Start a Local Webhook Tunnel (with ngrok)
Install ngrok (if not already installed)
```
npm install -g ngrok
```

Start tunnel (on port 3000)
```
ngrok http 3000
```

Copy the HTTPS URL it gives you, like:
(https://your-tunnel.ngrok-free.app)

Paste that into `.env` as `PUBLIC_BASE_URL`.

### 4. Compile & Run Locally with ts-node
If using bot.ts, run:
```
npx ts-node bot.ts
```

Or if using index.ts:
```
npx ts-node index.ts
```

You should see logs like:
```
🚀 Express WebSub server running on port 3000
✅ Discord bot logged in as DiveAlert#1234
🔗 Invite the bot to your server:
https://discord.com/oauth2/authorize?client_id=...&permissions=3072&scope=bot
```

### 5. Test it
Invite the bot to your test server using the printed invite link

In a Discord channel, run:
```
!yt subscribe UC1m5LdKP0m64n8nY3NhK6Zg
```

YouTube will send a WebSub verification request to your local server (via ngrok)
When that channel goes live, the bot will post the stream link to your Discord channel 🎉

🧪 Tip: Auto-Restart with ts-node-dev
For dev convenience:
```
npm install -D ts-node-dev
```

Add to package.json:
```
"scripts": {
  "dev": "ts-node-dev --respawn bot.ts"
}
```

Then run with:
```
npm run dev
```