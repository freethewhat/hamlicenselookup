import { createApp } from './app.js';

const app = createApp({ dataDir: process.env.DATA_DIR ?? './data' });
const server = app.listen(Number(process.env.PORT ?? 3100), process.env.HOST ?? '127.0.0.1');

process.on('SIGTERM', () => {
  server.close(() => {
    app.locals.handle.close();
    process.exit(0);
  });
  server.closeAllConnections();
});
