const { Client, GatewayIntentBits } = require('discord.js');

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || null;
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID || null;
const FLUSH_INTERVAL_MS = parseInt(process.env.DISCORD_LOG_FLUSH_MS || '4000', 10);
const MAX_MESSAGE_LEN = 1900; // stay under Discord's 2000 char limit with margin

let client = null;
let channel = null;
let ready = false;
let queue = [];
let flushTimer = null;

function enabled() {
  return Boolean(DISCORD_BOT_TOKEN && DISCORD_CHANNEL_ID);
}

async function init() {
  if (!enabled()) {
    console.log('[discord-log] DISCORD_BOT_TOKEN / DISCORD_CHANNEL_ID not set — skipping Discord log forwarding.');
    return;
  }

  client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.once('ready', async () => {
    try {
      channel = await client.channels.fetch(DISCORD_CHANNEL_ID);
      ready = true;
      console.log(`[discord-log] Connected as ${client.user.tag}, forwarding logs to channel ${DISCORD_CHANNEL_ID}.`);
      startFlushLoop();
    } catch (err) {
      console.log('[discord-log] Failed to fetch channel:', err.message);
    }
  });

  client.on('error', (err) => {
    console.log('[discord-log] Discord client error:', err.message);
  });

  try {
    await client.login(DISCORD_BOT_TOKEN);
  } catch (err) {
    console.log('[discord-log] Failed to log in to Discord:', err.message);
  }
}

function startFlushLoop() {
  if (flushTimer) return;
  flushTimer = setInterval(flush, FLUSH_INTERVAL_MS);
}

async function flush() {
  if (!ready || !channel || queue.length === 0) return;

  // Group queued lines into <=2000 char chunks wrapped in a code block
  const lines = queue.splice(0, queue.length);
  let chunk = '';
  const chunks = [];

  for (const line of lines) {
    if ((chunk + line + '\n').length > MAX_MESSAGE_LEN) {
      chunks.push(chunk);
      chunk = '';
    }
    chunk += line + '\n';
  }
  if (chunk) chunks.push(chunk);

  for (const c of chunks) {
    try {
      await channel.send('```\n' + c + '```');
    } catch (err) {
      console.log('[discord-log] Failed to send log message:', err.message);
    }
  }
}

// Queue a line to be sent to Discord on the next flush. Safe to call before
// the client is ready — lines just queue up and get sent once connected.
function logToDiscord(line) {
  if (!enabled()) return;
  queue.push(line);
  // Prevent unbounded growth if Discord is down for a long time
  if (queue.length > 200) queue.shift();
}

module.exports = { init, logToDiscord, enabled };
