# RomKillerV2 — Noble SMP AFK/Wander Bot

A Node.js bot (using [mineflayer](https://github.com/PrismarineJS/mineflayer)) that:

1. Joins `noblesmp.mcsh.io` as **RomKillerV2**
2. Auto-accepts the server resource pack (required — server disconnects if declined)
3. Runs `/login chalol78` after spawning
4. Wanders around randomly (turns, walks short bursts, occasional jump)
5. If kicked/disconnected, waits a randomized delay (15–60s, backing off) and reconnects automatically — this avoids the server/host flagging rapid reconnect spam
6. Forwards all its logs (connect/disconnect, resource pack, login, kicks, in-game chat) to a Discord channel via a bot token

## Files
- `index.js` — the Minecraft bot
- `discordLogger.js` — batches log lines and posts them to your Discord channel
- `package.json` — dependencies + start script

## Run locally
```bash
npm install
npm start
```

## Deploy on Render

1. Push this folder to a GitHub repo (or a private repo Render can access).
2. On Render: **New → Background Worker** (not a Web Service — this bot doesn't listen on an HTTP port).
3. Connect the repo.
4. Build command: `npm install`
5. Start command: `npm start`
6. Set environment variables if you want to override defaults instead of editing code:

   | Variable | Default | Purpose |
   |---|---|---|
   | `MC_HOST` | `noblesmp.mcsh.io` | server address |
   | `MC_PORT` | `25565` | server port |
   | `MC_USERNAME` | `RomKillerV2` | bot's in-game name |
   | `MC_LOGIN_PASSWORD` | `chalol78` | password sent via `/login` |
   | `MC_VERSION` | `1.21.5` | pinned to Noble SMP's version — only change if the server updates |
   | `MIN_RECONNECT_DELAY_MS` | `15000` | shortest reconnect wait |
   | `MAX_RECONNECT_DELAY_MS` | `60000` | longest reconnect wait (backoff cap) |
   | `WANDER_INTERVAL_MS` | `8000` | how often it picks a new movement |
   | `WANDER_RADIUS` | `5` | currently unused directly (movement is burst-based, not radius-clamped — see note below) |
   | `DISCORD_BOT_TOKEN` | *(none)* | your Discord bot's token — set this to enable log forwarding |
   | `DISCORD_CHANNEL_ID` | *(none)* | the channel ID logs get posted to |
   | `DISCORD_LOG_FLUSH_MS` | `4000` | how often queued log lines are batched and sent (keeps it under Discord rate limits) |

   If `DISCORD_BOT_TOKEN` / `DISCORD_CHANNEL_ID` are left unset, the bot just skips Discord forwarding and logs to Render's console only — nothing else changes.

7. Deploy. Check the Render logs — you should see connect → resource pack accept → login → wander lines.

## Setting up the Discord side

1. Create an application + bot at the [Discord Developer Portal](https://discord.com/developers/applications) (or use one you already have) and copy its **bot token** → set as `DISCORD_BOT_TOKEN` on Render.
2. Invite the bot to your server with at least **View Channel** and **Send Messages** permissions in the channel you want logs posted to.
3. Right-click the target channel in Discord (with Developer Mode enabled under User Settings → Advanced) → **Copy Channel ID** → set as `DISCORD_CHANNEL_ID` on Render.
4. Logs are batched every 4 seconds (configurable) and sent as code-block messages, so you won't get flooded with one message per line.

## Notes / things you may need to tweak

- **Auth mode**: the bot connects with `auth: 'offline'` (cracked/non-premium). If Noble SMP requires a Microsoft/premium account for `RomKillerV2`, change `auth: 'offline'` to `auth: 'microsoft'` in `index.js` — that will prompt a device-code login on first run (check the Render logs for the code/link), and mineflayer will cache the token afterward.
- **Resource pack handling**: the bot listens for Mineflayer's `resourcePack` event and calls `bot.acceptResourcePack()`. Mineflayer performs the correct protocol response for the active Minecraft version, which is the bot equivalent of pressing **Proceed**. The bot does not need to download/render the pack just to complete the server-side acceptance handshake.
- **Wandering stays near spawn only in the loose sense** that each move is a short random burst (1–2.5s) rather than a long walk — it won't path itself home, so over a long session it can drift. If you want it to stay within a hard radius of its spawn point (using real pathfinding), I can wire in `mineflayer-pathfinder` for that — just say so.
- **Reconnect delay** is randomized and grows slightly with repeated failures (up to the max), specifically to avoid looking like reconnect spam to an anti-bot system.
