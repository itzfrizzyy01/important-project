const mineflayer = require('mineflayer');
const discordLogger = require('./discordLogger');
const http = require('http');

// ---- Config (can be overridden with environment variables on Render) ----
const HOST = process.env.MC_HOST || 'noblesmp.mcsh.io';
const PORT = parseInt(process.env.MC_PORT || '25565', 10);
const USERNAME = process.env.MC_USERNAME || 'RomKillerV3';
const LOGIN_PASSWORD = process.env.MC_LOGIN_PASSWORD || 'chalol78';
// Auto-detect can fail if the server reports a custom/proxy version string
// mineflayer's bundled minecraft-data doesn't recognize. Pin explicitly to
// the real client protocol version (1.21.5, matching your screenshot).
const VERSION = process.env.MC_VERSION || '1.21.5';

// Reconnect settings — spaced out so the server/host doesn't flag rapid reconnects
const MIN_RECONNECT_DELAY_MS = parseInt(process.env.MIN_RECONNECT_DELAY_MS || '15000', 10); // 15s
const MAX_RECONNECT_DELAY_MS = parseInt(process.env.MAX_RECONNECT_DELAY_MS || '60000', 10); // 60s

// Wander settings
const WANDER_INTERVAL_MS = parseInt(process.env.WANDER_INTERVAL_MS || '8000', 10);
const WANDER_RADIUS = parseInt(process.env.WANDER_RADIUS || '5', 10);

// How long to wait for spawn after connecting before treating it as stuck
const SPAWN_TIMEOUT_MS = parseInt(process.env.SPAWN_TIMEOUT_MS || '60000', 10);

let reconnectAttempt = 0;
let wanderTimer = null;
let loggedIn = false;
let activeBot = null; // guards against overlapping bot instances on restart

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`;
  console.log(line);
  discordLogger.logToDiscord(line);
}

function randomDelay() {
  const base = Math.min(MAX_RECONNECT_DELAY_MS, MIN_RECONNECT_DELAY_MS * Math.pow(1.5, reconnectAttempt));
  const jitter = Math.random() * 2000;
  return Math.floor(base + jitter);
}

function scheduleReconnect() {
  reconnectAttempt++;
  const delay = randomDelay();
  log(`Reconnecting in ${Math.round(delay / 1000)}s (attempt ${reconnectAttempt})...`);
  setTimeout(() => {
    activeBot = null;
    createBot();
  }, delay);
}

function stopWandering(bot) {
  if (wanderTimer) {
    clearInterval(wanderTimer);
    wanderTimer = null;
  }
  if (bot && bot.clearControlStates) bot.clearControlStates();
}

function startWandering(bot) {
  stopWandering(bot);
  wanderTimer = setInterval(() => {
    if (!bot.entity) return;
    try {
      bot.clearControlStates();

      const yaw = Math.random() * Math.PI * 2;
      const pitch = 0;
      bot.look(yaw, pitch, true);

      const moves = ['forward', 'back', 'left', 'right'];
      const pick = moves[Math.floor(Math.random() * moves.length)];
      bot.setControlState(pick, true);

      if (Math.random() < 0.2) {
        bot.setControlState('jump', true);
        setTimeout(() => bot.setControlState('jump', false), 400);
      }

      const walkDuration = 1000 + Math.random() * 1500;
      setTimeout(() => {
        if (bot && bot.clearControlStates) bot.clearControlStates();
      }, walkDuration);
    } catch (err) {
      log('Wander tick error:', err.message);
    }
  }, WANDER_INTERVAL_MS);
}

function createBot() {
  if (activeBot) {
    log('createBot() called while a bot instance is already active — skipping.');
    return activeBot;
  }

  log(`Connecting to ${HOST}:${PORT} as ${USERNAME}...`);
  loggedIn = false;

  const botOptions = {
    host: HOST,
    port: PORT,
    username: USERNAME,
    auth: 'offline', // change to 'microsoft' if the server requires premium/online-mode accounts
  };
  if (VERSION) botOptions.version = VERSION;

  const bot = mineflayer.createBot(botOptions);
  activeBot = bot;

  // ---- Resource pack handling ----
  // For modern 1.21.x servers, Mineflayer's acceptResourcePack() sends
  // ACCEPTED (3) and SUCCESSFULLY_LOADED (0) back-to-back. Some Paper/proxy
  // setups can leave the connection waiting when those two responses arrive
  // in the same tick. Handle add_resource_pack directly and separate the two
  // responses, which is closer to what a real client does after pressing
  // Proceed and finishing the pack step.
  let resourcePackHandled = false;
  bot._client.on('add_resource_pack', (data) => {
    if (resourcePackHandled) return;
    resourcePackHandled = true;

    const uuid = data.uuid;
    log('Required resource pack offered — sending ACCEPTED (Proceed).');

    try {
      bot._client.write('resource_pack_receive', {
        uuid,
        result: 3
      });
      log('Resource pack status ACCEPTED sent.');

      // Do not send SUCCESSFULLY_LOADED in the same tick.
      setTimeout(() => {
        if (!bot._client || bot._client.ended) return;
        try {
          bot._client.write('resource_pack_receive', {
            uuid,
            result: 0
          });
          log('Resource pack status SUCCESSFULLY_LOADED sent.');
        } catch (err) {
          log('Resource pack loaded-status failed:', err.message);
        }
      }, 1500);
    } catch (err) {
      log('Resource pack acceptance failed:', err.message);
    }
  });

  // ---- Diagnostics: log every packet so we can see exactly where things
  // stall if spawn never fires. Comment this out once joining is reliable —
  // it's noisy in the logs.
  bot._client.on('packet', (data, meta) => {
    log(`[PACKET] ${meta.name}`);
  });

  // ---- Watchdog: if spawn hasn't happened within SPAWN_TIMEOUT_MS, force a
  // clean disconnect/reconnect instead of hanging silently forever.
  const spawnWatchdog = setTimeout(() => {
    if (!bot.entity) {
      log(`WARNING: no spawn after ${SPAWN_TIMEOUT_MS / 1000}s — forcing disconnect to retry.`);
      bot.end('spawn-timeout');
    }
  }, SPAWN_TIMEOUT_MS);

  bot.once('spawn', () => {
    clearTimeout(spawnWatchdog);
    reconnectAttempt = 0; // reset backoff on a successful connection
    log('Spawned into the world.');

    setTimeout(() => {
      log(`Sending login command: /login ${LOGIN_PASSWORD}`);
      bot.chat(`/login ${LOGIN_PASSWORD}`);
      loggedIn = true;

      setTimeout(() => startWandering(bot), 3000);
    }, 1500);
  });

  bot.on('kicked', (reason) => {
    log('Kicked from server:', reason);
  });

  bot.on('error', (err) => {
    log('Connection error:', err.message);
  });

  bot.on('end', (reason) => {
    log('Disconnected from server:', reason || '(no reason given)');
    clearTimeout(spawnWatchdog);
    stopWandering(bot);
    activeBot = null;
    scheduleReconnect();
  });

  bot.on('message', (jsonMsg) => {
    const text = jsonMsg.toString();
    if (text && text.trim().length) log('[CHAT]', text);
  });

  return bot;
}

// Render's "Web Service" type requires the app to bind to a port, or it
// keeps thinking the deploy failed and restarts the service (which caused
// duplicate-UUID kicks earlier). This server exists purely to satisfy that
// health check.
const PORT_FOR_RENDER = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('RomKillerV2 bot is running.\n');
}).listen(PORT_FOR_RENDER, () => {
  console.log(`HTTP keep-alive server listening on port ${PORT_FOR_RENDER}`);
});

log('Starting RomKillerV2 bot service...');
discordLogger.init().finally(() => {
  createBot();
});

process.on('unhandledRejection', (err) => {
  log('Unhandled rejection:', err);
});
process.on('uncaughtException', (err) => {
  log('Uncaught exception:', err);
});
