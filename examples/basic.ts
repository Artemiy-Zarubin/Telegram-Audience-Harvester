import { harvestBotAudience } from '../src/index.js';

async function main() {
  const report = await harvestBotAudience({
    apiId: parseInt(process.env.TELEGRAM_API_ID || '0', 10),
    apiHash: process.env.TELEGRAM_API_HASH || '',
    botToken: process.env.BOT_TOKEN || '',
    saveCsvPath: './audience.csv',
    saveJsonPath: './audience.json',
    onProgress: (prog) => {
      console.log(`[${prog.percent}%] PTS: ${prog.currentPts}/${prog.serverPts} | Users: ${prog.uniqueUsers}`);
    },
  });

  console.log(`Successfully extracted ${report.totalUsers} users in ${report.durationSec}s!`);
}

main().catch(console.error);
