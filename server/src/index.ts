import { createApp } from './app.ts';
import { loadConfig } from './config.ts';
import { connectDocker } from './docker.ts';
import { SessionManager } from './sessions.ts';

const config = loadConfig();
const manager = new SessionManager(connectDocker(), config);
await manager.start();
const server = createApp(config, manager);
server.listen(config.port, config.host, () => {
  console.log(`tide-server listening on http://${config.host}:${config.port} (image ${config.image})`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    server.close();
    await manager.stop();
    process.exit(0);
  });
}
