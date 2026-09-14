#!/usr/bin/env node
import { BotAudienceHarvester } from './harvester.js';
import type { HarvestOptions } from './types.js';

function printHelp() {
  console.log(`
telegram-audience-harvester — Telegram Bot Audience Extractor via MTProto

USAGE:
  npx telegram-audience-harvester [options]
  tg-harvester [options]

REQUIRED:
  -t, --token <token>       Bot token from @BotFather (or BOT_TOKEN env)
  --api-id <id>             Telegram API ID from my.telegram.org (or TELEGRAM_API_ID env)
  --api-hash <hash>         Telegram API Hash from my.telegram.org (or TELEGRAM_API_HASH env)

OPTIONS:
  -p, --proxy <url>         Proxy URL (socks5://, socks4://, http://, https://, mtproxy)
  -d, --delay <ms>          Delay between getDifference RPC calls in ms (default: 35)
  --days <number>           Days threshold to consider offline users active (default: 7)
  --max-iter <number>       Maximum iterations limit (default: 5000)
  --max-flood <sec>         Maximum acceptable FloodWait seconds (default: 300)

EXPORTS:
  -c, --csv <path>          Save audience to RFC 4180 CSV file
  -j, --json <path>         Save report and audience to JSON file

INFO:
  -h, --help                Show help
  -v, --version             Show version

EXAMPLES:
  tg-harvester -t "123456:ABC-DEF..." --api-id 12345 --api-hash "abcdef" -c audience.csv
  tg-harvester -t "123456:ABC..." -p socks5://127.0.0.1:10808 -c out.csv -j out.json
`);
}

function parseArgs(): HarvestOptions & { showHelp?: boolean; showVersion?: boolean } {
  const args = process.argv.slice(2);
  let envApiId: number | undefined;
  if (process.env.TELEGRAM_API_ID) {
    const parsed = parseInt(process.env.TELEGRAM_API_ID, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      envApiId = parsed;
    }
  }

  const opts: any = {
    apiId: envApiId,
    apiHash: process.env.TELEGRAM_API_HASH || '',
    botToken: process.env.BOT_TOKEN || '',
    proxyUrl: process.env.PROXY_URL || process.env.ALL_PROXY || undefined,
    delayMsBetweenRequests: 35,
    activeDaysThreshold: 7,
    maxIterations: 5000,
    maxFloodWaitSec: 300,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    if (arg === '-h' || arg === '--help') {
      opts.showHelp = true;
      return opts;
    }
    if (arg === '-v' || arg === '--version') {
      opts.showVersion = true;
      return opts;
    }
    if ((arg === '-t' || arg === '--token') && next) {
      opts.botToken = next;
      i++;
    } else if (arg === '--api-id' && next) {
      const parsed = parseInt(next, 10);
      if (Number.isNaN(parsed) || parsed <= 0) {
        console.error(`[ERROR] Invalid --api-id value: ${next}`);
        process.exit(1);
      }
      opts.apiId = parsed;
      i++;
    } else if (arg === '--api-hash' && next) {
      opts.apiHash = next;
      i++;
    } else if ((arg === '-p' || arg === '--proxy') && next) {
      opts.proxyUrl = next;
      i++;
    } else if ((arg === '-d' || arg === '--delay') && next) {
      const parsed = parseInt(next, 10);
      if (Number.isNaN(parsed) || parsed < 0) {
        console.error(`[ERROR] Invalid --delay value: ${next}`);
        process.exit(1);
      }
      opts.delayMsBetweenRequests = parsed;
      i++;
    } else if (arg === '--days' && next) {
      const parsed = parseInt(next, 10);
      if (Number.isNaN(parsed) || parsed < 0) {
        console.error(`[ERROR] Invalid --days value: ${next}`);
        process.exit(1);
      }
      opts.activeDaysThreshold = parsed;
      i++;
    } else if (arg === '--max-iter' && next) {
      const parsed = parseInt(next, 10);
      if (Number.isNaN(parsed) || parsed <= 0) {
        console.error(`[ERROR] Invalid --max-iter value: ${next}`);
        process.exit(1);
      }
      opts.maxIterations = parsed;
      i++;
    } else if (arg === '--max-flood' && next) {
      const parsed = parseInt(next, 10);
      if (Number.isNaN(parsed) || parsed < 0) {
        console.error(`[ERROR] Invalid --max-flood value: ${next}`);
        process.exit(1);
      }
      opts.maxFloodWaitSec = parsed;
      i++;
    } else if ((arg === '-c' || arg === '--csv') && next) {
      opts.saveCsvPath = next;
      i++;
    } else if ((arg === '-j' || arg === '--json') && next) {
      opts.saveJsonPath = next;
      i++;
    }
  }

  return opts;
}

async function runCli() {
  const opts = parseArgs();

  if (opts.showHelp) {
    printHelp();
    process.exit(0);
  }

  if (opts.showVersion) {
    console.log('telegram-audience-harvester 1.0.0');
    process.exit(0);
  }

  if (!opts.botToken) {
    console.error('[ERROR] Bot token is required. Use --token <token> or BOT_TOKEN env variable.');
    console.error('Run with --help for documentation.');
    process.exit(1);
  }

  if (!opts.apiId || !opts.apiHash) {
    console.error('[ERROR] API ID and API Hash are required from https://my.telegram.org');
    console.error('Use --api-id and --api-hash flags or TELEGRAM_API_ID and TELEGRAM_API_HASH env variables.');
    process.exit(1);
  }

  const botPrefix = opts.botToken.split(':')[0] || 'bot';
  console.log(`[INFO] Initializing audience harvester for bot ID: ${botPrefix}`);
  if (opts.proxyUrl) {
    console.log(`[INFO] Proxy configured: ${opts.proxyUrl}`);
  }

  const abortController = new AbortController();
  const harvester = new BotAudienceHarvester({
    ...opts,
    signal: abortController.signal,
  });

  let isTerminating = false;
  const handleSignal = () => {
    if (isTerminating) {
      console.log('\n[INFO] Forcing immediate termination...');
      process.exit(130);
    }
    isTerminating = true;
    console.log('\n[INFO] Abort signal received. Terminating gracefully...');
    abortController.abort();
    harvester.abort();
  };

  process.on('SIGINT', handleSignal);
  process.on('SIGTERM', handleSignal);

  let lastReportedPercent = -1;

  harvester.on('progress', (prog) => {
    if (prog.iteration % 10 === 0 || prog.percent >= lastReportedPercent + 5 || prog.percent === 100) {
      lastReportedPercent = prog.percent;
      const barLength = 25;
      const filled = Math.round((prog.percent / 100) * barLength);
      const bar = '='.repeat(filled) + '-'.repeat(barLength - filled);
      process.stdout.write(
        `\r[${bar}] ${prog.percent.toString().padStart(3)}% | PTS: ${prog.currentPts}/${prog.serverPts} | Users: ${prog.uniqueUsers}`
      );
    }
  });

  harvester.on('rateLimit', (sec) => {
    console.log(`\n[WARN] Telegram rate limit: sleeping for ${sec}s...`);
  });

  try {
    const report = await harvester.start();
    console.log('\n\n--- HARVEST SUMMARY ---');
    console.log(`Bot:                  ${report.botName} (@${report.botUsername || 'no_username'})`);
    console.log(`Bot ID:               ${report.botId}`);
    console.log(`Server PTS:           ${report.serverPts}`);
    console.log(`Scanned PTS:          ${report.scannedPts}`);
    console.log(`Iterations:           ${report.iterations}`);
    console.log(`Duration:             ${report.durationSec}s`);
    console.log('-----------------------');
    console.log(`Total Users:          ${report.totalUsers}`);
    console.log(`Active Users:         ${report.activeUsers} (${report.activeRate}%)`);
    console.log(`Inactive Users:       ${report.inactiveUsers}`);
    console.log(`Deleted Accounts:     ${report.deletedUsers}`);
    console.log(`Premium Subscribers:  ${report.premiumUsers} (${report.premiumRate}%)`);
    console.log(`With Username:        ${report.usersWithUsername}`);
    console.log('-----------------------');

    if (opts.saveCsvPath) {
      console.log(`[INFO] CSV written to: ${opts.saveCsvPath}`);
    }
    if (opts.saveJsonPath) {
      console.log(`[INFO] JSON written to: ${opts.saveJsonPath}`);
    }

    if (report.users.length > 0) {
      console.log('\nSample profiles:');
      console.table(
        report.users.slice(0, 5).map((u) => ({
          ID: u.id,
          Name: `${u.firstName} ${u.lastName}`.trim(),
          Username: u.username || '-',
          Premium: u.isPremium ? 'YES' : 'NO',
          Active: u.isActive ? 'YES' : 'NO',
          Status: u.status,
          Lang: u.language || '-',
        }))
      );
    }
  } catch (err: any) {
    if (abortController.signal.aborted || isTerminating) {
      console.log('\n[INFO] Harvest aborted.');
      process.exit(130);
    }
    console.error('\n[ERROR] Harvest failed:', err?.message || err);
    process.exit(1);
  } finally {
    process.removeListener('SIGINT', handleSignal);
    process.removeListener('SIGTERM', handleSignal);
  }
}

runCli().catch((err) => {
  console.error('[FATAL] Unhandled error:', err);
  process.exit(1);
});
