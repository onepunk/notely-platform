import { createServer } from 'http';
import { createApp } from './app';
import { config } from './config/env';

async function start() {
  const app = createApp();
  const server = createServer(app);

  server.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(`Summaries service listening on port ${config.port}`);
  });
}

void start();
