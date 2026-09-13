import { BotAudienceHarvester } from '../src/index.js';

async function main() {
  const harvester = new BotAudienceHarvester({
    apiId: parseInt(process.env.TELEGRAM_API_ID || '0', 10),
    apiHash: process.env.TELEGRAM_API_HASH || '',
    botToken: process.env.BOT_TOKEN || '',
    delayMsBetweenRequests: 35,
    activeDaysThreshold: 7,
  });

  // Stream each user profile in real-time as it arrives from Telegram
  harvester.on('user', (user) => {
    console.log(`[User Stream] ID: ${user.id} | @${user.username || 'none'} | Active: ${user.isActive}`);
  });

  harvester.on('progress', (prog) => {
    console.log(`[Progress] PTS: ${prog.currentPts}/${prog.serverPts} (${prog.percent}%) | Users: ${prog.uniqueUsers}`);
  });

  harvester.on('rateLimit', (seconds) => {
    console.warn(`[RateLimit] Waiting ${seconds}s before retrying...`);
  });

  const report = await harvester.start();
  console.log(`Harvest complete: ${report.totalUsers} users collected (${report.activeUsers} active).`);
}

main().catch(console.error);
