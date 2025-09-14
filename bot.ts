import express from 'express';
import bodyParser from 'body-parser';
import { parseStringPromise } from 'xml2js';
import { Client, GatewayIntentBits, TextChannel } from 'discord.js';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const AUTO_RENEW_INTERVAL_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

type Subscription = {
  youtubeChannelId: string;
  discordChannelIds: string[];
};

const SUBS_FILE = 'subs.json';

function loadSubscriptions(): Subscription[] {
  if (fs.existsSync(SUBS_FILE)) {
    const data = fs.readFileSync(SUBS_FILE, 'utf-8');
    return JSON.parse(data);
  }
  return [];
}

function saveSubscriptions(subs: Subscription[]) {
  fs.writeFileSync(SUBS_FILE, JSON.stringify(subs, null, 2));
}

let subscriptions: Subscription[] = loadSubscriptions();

app.use(bodyParser.text({ type: 'application/atom+xml' }));

// --- Discord Bot Setup ---

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY!;
const permissions = 3072; // Send Messages + View Channels
const inviteUrl = `https://discord.com/oauth2/authorize?client_id=${process.env.DISCORD_APPLICATION_ID}&permissions=${permissions}&scope=bot`;

const liveVideos = new Set<string>();

// --- WebSub subscribe/unsubscribe ---

async function subscribeToWebSub(youtubeChannelId: string) {
  const topicUrl = `https://www.youtube.com/xml/feeds/videos.xml?channel_id=${youtubeChannelId}`;
  const callbackUrl = `${process.env.PUBLIC_BASE_URL}/youtube/websub`;

  const params = new URLSearchParams({
    'hub.mode': 'subscribe',
    'hub.topic': topicUrl,
    'hub.callback': callbackUrl,
    'hub.verify': 'async',
  });

  const res = await fetch('https://pubsubhubbub.appspot.com/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (res.ok) {
    console.log(`✅ Subscribed to ${youtubeChannelId}`);
  } else {
    console.error(`❌ Failed to subscribe to ${youtubeChannelId}: ${await res.text()}`);
  }
}

async function unsubscribeFromWebSub(youtubeChannelId: string) {
  const topicUrl = `https://www.youtube.com/xml/feeds/videos.xml?channel_id=${youtubeChannelId}`;
  const callbackUrl = `${process.env.PUBLIC_BASE_URL}/youtube/websub`;

  const params = new URLSearchParams({
    'hub.mode': 'unsubscribe',
    'hub.topic': topicUrl,
    'hub.callback': callbackUrl,
    'hub.verify': 'async',
  });

  const res = await fetch('https://pubsubhubbub.appspot.com/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (res.ok) {
    console.log(`✅ Unsubscribed from ${youtubeChannelId}`);
  } else {
    console.error(`❌ Failed to unsubscribe from ${youtubeChannelId}: ${await res.text()}`);
  }
}

// --- Subscription Management ---

async function subscribe(youtubeChannelId: string, discordChannelId: string) {
  let sub = subscriptions.find(s => s.youtubeChannelId === youtubeChannelId);

  if (!sub) {
    sub = { youtubeChannelId, discordChannelIds: [discordChannelId] };
    subscriptions.push(sub);
    await subscribeToWebSub(youtubeChannelId);
  } else if (!sub.discordChannelIds.includes(discordChannelId)) {
    sub.discordChannelIds.push(discordChannelId);
  }

  saveSubscriptions(subscriptions);
}

async function unsubscribe(youtubeChannelId: string, discordChannelId: string) {
  const sub = subscriptions.find(s => s.youtubeChannelId === youtubeChannelId);
  if (!sub) return;

  sub.discordChannelIds = sub.discordChannelIds.filter(id => id !== discordChannelId);

  if (sub.discordChannelIds.length === 0) {
    subscriptions = subscriptions.filter(s => s.youtubeChannelId !== youtubeChannelId);
    await unsubscribeFromWebSub(youtubeChannelId);
  }

  saveSubscriptions(subscriptions);
}

async function autoRenewSubscriptions() {
  console.log('🔁 Auto-renewing subscriptions...');
  const uniqueChannelIds = new Set(subscriptions.map(s => s.youtubeChannelId));
  for (const youtubeChannelId of uniqueChannelIds) {
    await subscribeToWebSub(youtubeChannelId);
  }
}

// --- Express Routes ---

app.get('/youtube/websub', (req, res) => {
  const challenge = req.query['hub.challenge'];
  if (challenge) {
    console.log('✅ WebSub verification challenge received');
    res.status(200).send(challenge as string);
  } else {
    res.status(400).send('Missing hub.challenge');
  }
});

app.post('/youtube/websub', async (req, res) => {
  try {
    const xml = req.body;
    const json = await parseStringPromise(xml);

    const entry = json.feed?.entry?.[0];
    if (!entry) return res.status(204).end();

    const videoId = entry['yt:videoId']?.[0];
    const channelId = entry['yt:channelId']?.[0];
    const channelTitle = entry.author?.[0]?.name?.[0] || 'Unknown Channel';
    const videoTitle = entry.title?.[0] || 'Untitled';

    if (!videoId || !channelId) return res.status(204).end();
    if (liveVideos.has(videoId)) return res.status(200).end();

    // Check if video is actually live
    const videoDetailsRes = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails,snippet&id=${videoId}&key=${YOUTUBE_API_KEY}`
    );
    const videoDetails = await videoDetailsRes.json();
    const item = videoDetails.items?.[0];
    if (!item) return res.status(204).end();

    const liveBroadcastContent = item.snippet?.liveBroadcastContent;
    if (liveBroadcastContent !== 'live' && liveBroadcastContent !== 'upcoming') {
      console.log(`Video ${videoId} is not live (status: ${liveBroadcastContent})`);
      return res.status(200).end();
    }

    liveVideos.add(videoId);
    const sub = subscriptions.find(s => s.youtubeChannelId === channelId);
    if (!sub) return res.status(200).end();

    for (const discordChannelId of sub.discordChannelIds) {
      const channel = await client.channels.fetch(discordChannelId);
      if (channel?.isTextBased()) {
        await channel.send(`🔴 **${channelTitle} is live!**\nhttps://www.youtube.com/watch?v=${videoId}`);
      }
    }

    console.log(`✅ Alerted for video ${videoId}`);
    res.status(200).end();
  } catch (err) {
    console.error('❌ Error in WebSub handler:', err);
    res.status(500).end();
  }
});

// --- Discord Commands ---

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const content = message.content.trim();
  if (!content.startsWith('!yt')) return;

  const args = content.split(/\s+/);
  const command = args[1]?.toLowerCase();

  if (command === 'subscribe' && args[2]) {
    const youtubeChannelId = args[2];
    await subscribe(youtubeChannelId, message.channel.id);
    message.reply(`✅ Subscribed to **${youtubeChannelId}** in this channel.`);
  } else if (command === 'unsubscribe' && args[2]) {
    const youtubeChannelId = args[2];
    await unsubscribe(youtubeChannelId, message.channel.id);
    message.reply(`❌ Unsubscribed **${youtubeChannelId}** from this channel.`);
  } else if (command === 'list') {
    if (subscriptions.length === 0) {
      message.reply('No subscriptions found.');
    } else {
      const lines = subscriptions.map(
        s => `- ${s.youtubeChannelId} → ${s.discordChannelIds.length} channel(s)`
      );
      message.reply('📺 **Subscribed YouTube Channels:**\n' + lines.join('\n'));
    }
  } else {
    message.reply(
      'Usage:\n' +
      '`!yt subscribe <channelId>` — subscribe this channel\n' +
      '`!yt unsubscribe <channelId>` — unsubscribe this channel\n' +
      '`!yt list` — list subscriptions'
    );
  }
});

// --- Startup ---
const server = app.listen(PORT, () => {
  console.log(`🚀 Express WebSub server running on port ${PORT}`);
});

let autoRenewTimer: NodeJS.Timeout;

client.once('ready', () => {
  console.log(`✅ Discord bot logged in as ${client.user?.tag}`);
  console.log(`🔗 Invite the bot to your server:\n${inviteUrl}`);

  autoRenewSubscriptions();
  autoRenewTimer = setInterval(autoRenewSubscriptions, AUTO_RENEW_INTERVAL_MS);
});

client.login(process.env.DISCORD_BOT_TOKEN);

// --- Shutdown ---
async function shutdown(signal: string) {
  console.log(`Caught ${signal}, shutting down...`);
  try {
    if (autoRenewTimer) clearInterval(autoRenewTimer);
    await client.destroy();
    server.close(() => {
      console.log('HTTP server closed.');
      process.exit(0);
    });
  } catch (err) {
    console.error('Error during shutdown:', err);
    process.exit(1);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));