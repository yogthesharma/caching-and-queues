import { config } from './config.js';
import { buildApp } from './app.js';

const app = await buildApp(config);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    process.exit(0);
  });
}

await app.listen({ port: config.port });
