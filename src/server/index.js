import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

const app = createApp({ dataDir: process.env.DATA_DIR ?? './data' });
const server = app.listen(Number(process.env.PORT ?? 3100), process.env.HOST ?? '127.0.0.1');

// Start-up update in its own process, so the site keeps answering while it runs. The heap flag
// matches `npm run setup`. No automatic re-spawn: the timers or the next start retry a failure.
let updater = null;
if (process.env.AUTO_UPDATE !== '0') {
  const script = fileURLToPath(new URL('../../scripts/update.js', import.meta.url));
  updater = spawn(process.execPath, ['--max-old-space-size=1024', script, 'auto'], { stdio: 'inherit', env: process.env });
  updater.on('error', (err) => console.error(`Could not start the data update: ${err.message}`));
  updater.on('exit', (code, signal) => {
    console.log(`Data update process exited (${signal ?? `code ${code}`})`);
    updater = null;
  });
}

// Stops the updater (if running), waiting up to 5 s for it to exit, then closes the server.
async function shutdown() {
  if (updater) {
    const child = updater;
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill('SIGTERM');
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))]);
  }
  server.close(() => {
    app.locals.handle.close();
    process.exit(0);
  });
  server.closeAllConnections();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
