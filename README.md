# tg-bot-audience-harvester

Export audience and subscribers from your Telegram bot via MTProto update history (`updates.getDifference`).

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5+-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-green.svg)](https://nodejs.org/)

[English](README.md) | [Русский](README_RU.md)

---

Telegram's standard Bot API doesn't provide a way to get a list of your bot's users or subscribers. 

This tool logs in to MTProto using your bot token, walks through its PTS update history, and extracts every user who ever sent a message or interacted with the bot.

## Quick Start (CLI)

Run it directly with `npx`:

```bash
export TELEGRAM_API_ID="123456"
export TELEGRAM_API_HASH="0123456789abcdef0123456789abcdef"

npx tg-bot-audience-harvester --token "1234567890:ABCdefGhIJKlmNoPQRsTUVwxyZ" --csv audience.csv
```

Or pass everything via CLI flags:

```bash
npx tg-bot-audience-harvester \
  --token "1234567890:ABCdefGhIJKlmNoPQRsTUVwxyZ" \
  --api-id 123456 \
  --api-hash "0123456789abcdef0123456789abcdef" \
  --csv ./audience.csv \
  --json ./report.json
```

### CLI Flags

| Flag | Env | Default | Description |
|---|---|---|---|
| `-t, --token <token>` | `BOT_TOKEN` | required | Bot token from @BotFather |
| `--api-id <id>` | `TELEGRAM_API_ID` | required | Telegram API ID from my.telegram.org |
| `--api-hash <hash>` | `TELEGRAM_API_HASH` | required | Telegram API Hash from my.telegram.org |
| `-p, --proxy <url>` | `PROXY_URL` | - | Proxy URL (`socks5://`, `http://`, `mtproxy`) |
| `-c, --csv <path>` | - | - | Path to save CSV file |
| `-j, --json <path>` | - | - | Path to save JSON report |
| `-d, --delay <ms>` | - | `35` | Delay in ms between requests (protects from rate limits) |
| `--days <num>` | - | `7` | Days offline threshold to consider a user active |
| `--max-iter <num>` | - | `5000` | Safety limit on total iterations |
| `--max-flood <sec>`| - | `300` | Max flood wait seconds before giving up |

---

## Library Usage

```bash
npm install tg-bot-audience-harvester
```

### Simple call

```typescript
import { harvestBotAudience } from 'tg-bot-audience-harvester';

const report = await harvestBotAudience({
  apiId: 123456,
  apiHash: '0123456789abcdef0123456789abcdef',
  botToken: '1234567890:ABCdefGhIJKlmNoPQRsTUVwxyZ',
  saveCsvPath: './audience.csv',
  onProgress: (p) => {
    console.log(`${p.percent}% done (${p.uniqueUsers} users found)`);
  },
});

console.log(`Found ${report.totalUsers} users (${report.activeUsers} active)`);
```

### Event streaming (for large bots)

If your bot has a massive audience and you want to stream users as they arrive instead of buffering everything in memory:

```typescript
import { BotAudienceHarvester } from 'tg-bot-audience-harvester';

const harvester = new BotAudienceHarvester({
  apiId: 123456,
  apiHash: '0123456789abcdef0123456789abcdef',
  botToken: '1234567890:ABCdefGhIJKlmNoPQRsTUVwxyZ',
});

harvester.on('user', (user) => {
  console.log(`User: ${user.id} (@${user.username || 'none'})`);
});

harvester.on('progress', (p) => {
  console.log(`${p.percent}% (PTS: ${p.currentPts}/${p.serverPts})`);
});

const report = await harvester.start();
```

---

## Output Data

Each extracted user profile contains:
- `id`: 64-bit Telegram user ID
- `firstName`, `lastName`: User's display name
- `username`: Primary username (without `@`)
- `usernames`: All handles, including Fragment collectible/NFT usernames
- `isPremium`: Whether the user has Telegram Premium
- `isDeleted`: True if the account was deleted
- `status`: Raw MTProto status string (`userStatusRecently`, `userStatusOnline`, etc.)
- `lastSeen`: Unix timestamp of last seen online (if available)
- `isActive`: Calculated based on your `activeDaysThreshold` (default: 7 days)
- `language`: Client language code (`ru`, `en`, etc.)
- `photoDcId`: Datacenter ID of profile picture

---

## License

MIT © [Artemiy Zarubin](https://github.com/Artemiy-Zarubin)
