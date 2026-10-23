import { config } from './config.js';
import { createApp } from './app.js';

const { app, repo, providers } = createApp(config);

function housekeeping() {
  try {
    const cache = repo.purgeExpiredCache();
    const scans = config.historyRetentionDays > 0 ? repo.purgeScansOlderThan(config.historyRetentionDays) : 0;
    if (cache || scans) console.log(`[housekeeping] removed ${scans} old scans, ${cache} expired cache rows`);
  } catch (err) {
    console.error('[housekeeping]', err);
  }
}
housekeeping();
const timer = setInterval(housekeeping, 6 * 3_600_000);
timer.unref();

const server = app.listen(config.port, config.host, () => {
  console.log(`Barcode scanner on http://localhost:${config.port}`);
  console.log(`DB: ${config.dbPath}`);
  console.log(`Lookup: local -> ${providers.map((p) => p.name).join(' -> ') || '(external disabled)'}`);
});

function shutdown() {
  server.close(() => {
    repo.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
