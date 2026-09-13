import { harvestBotAudience } from '../src/index.js';

async function main() {
  const report = await harvestBotAudience({
    apiId: parseInt(process.env.TELEGRAM_API_ID || '0', 10),
    apiHash: process.env.TELEGRAM_API_HASH || '',
    botToken: process.env.BOT_TOKEN || '',
    proxyUrl: 'socks5://127.0.0.1:10808', // SOCKS5, HTTP, HTTPS or MTProxy
    delayMsBetweenRequests: 40,
    saveCsvPath: './audience_proxy.csv',
    onProgress: (p) => {
      console.log(`[Progress ${p.percent}%] Discovered: ${p.uniqueUsers} users`);
    },
  });

  console.log(`Extracted: ${report.totalUsers} users via proxy.`);
}

main().catch(console.error);
