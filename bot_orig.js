import { Client, GatewayIntentBits } from 'discord.js';
import dotenv from 'dotenv';
dotenv.config();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const CHECK_INTERVAL = 600 * 1000; // 10 minute
const lastNotifiedVideoIds = new Map(); // Maps channelId -> lastVideoId

const permissions = 3072; // Send Messages + View Channels
const inviteUrl = `https://discord.com/oauth2/authorize?client_id=${process.env.DISCORD_APPLICATION_ID}&permissions=${permissions}&scope=bot`;

// List of monitored YouTube channels and their target Discord channels
const monitoredChannels = [
  {
    symbol: '🐉',
    name: 'Schmidt Ocean',
    youtubeChannelId: 'UC1m5LdKP0m64n8nY3NhK6Zg',
    discordChannelIds: [
      '992551928389177464'
    ]
  // },
  // {
  //   symbol: '🧭',
  //   name: 'EVNautilus',
  //   youtubeChannelId: 'UC1KOOWHthbQVXH2kZue3_xA',
  //   discordChannelIds: [
  //     '992551928389177464'
  //   ]
  }
];

async function checkYouTubeLive(youtubeChannelId) {
  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${youtubeChannelId}&eventType=live&type=video&key=${process.env.YOUTUBE_API_KEY}`;

  try {
    console.log("fetch:", url);
    const res = await fetch(url);
    const data = await res.json();

    if (data.error) {
      if (data.error.errors?.[0]?.reason === 'quotaExceeded') {
        console.error(`[x] YouTube API quota exceeded.`);
      } else {
        console.error(`[x] YouTube API error: ${data.error.message}`);
      }
      return null;
    }

    if (data.items?.length > 0) {
      return data.items[0]; // Return the first live video
    }

    return null;
  } catch (err) {
    console.error('[x] Failed to fetch YouTube data:', err);
    return null;
  }
}

async function checkAllChannels() {
  for (const channel of monitoredChannels) {
    const liveVideo = await checkYouTubeLive(channel.youtubeChannelId);

    if (liveVideo) {
      const videoId = liveVideo.id.videoId;
      const lastNotified = lastNotifiedVideoIds.get(channel.youtubeChannelId);

      if (videoId !== lastNotified) {
        lastNotifiedVideoIds.set(channel.youtubeChannelId, videoId);

        const timestamp = Math.floor(new Date(liveVideo.snippet.publishedAt).getTime() / 1000);
        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
        const message = `${channel.symbol} **${channel.name} is now LIVE!**\n🕒 <t:${timestamp}:f>\n🔗 ${videoUrl}`;

        for (const discordChannelId of channel.discordChannelIds) {
          try {
            const discordChannel = await client.channels.fetch(discordChannelId);
            await discordChannel.send(message);
            console.log(`[✔] Announced to ${discordChannelId} - ${channel.name}: ${videoId}`);
          } catch (err) {
            console.error(`[x] Failed to send to Discord channel ${discordChannelId}:`, err.message);
          }
        }
      }
    } else {
      // No live stream found, clear notification state
      lastNotifiedVideoIds.delete(channel.youtubeChannelId);
    }
  }
}

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`🔗 Invite the bot to your server:\n${inviteUrl}`);

  checkAllChannels(); // Initial check on startup
  setInterval(checkAllChannels, CHECK_INTERVAL);
});

client.login(process.env.DISCORD_BOT_TOKEN);
