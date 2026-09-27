import fp from 'fastify-plugin';
import { createRedisClient } from '../redis/clients.js';

async function redisPlugin(app, { cacheUrl }) {
  // While disconnected, reject commands immediately instead of holding them until the next reconnect attempt
  // (which backs off to seconds). The product service treats the error as a miss and reads the database.
  const cache = createRedisClient(cacheUrl, 'm01-api:cache', app.log, { enableOfflineQueue: false });

  app.decorate('redis', { cache });

  app.addHook('onClose', async () => {
    try {
      await cache.quit();
    } catch {
      // Without the offline queue, QUIT is rejected while disconnected; just drop the socket.
      cache.disconnect();
    }
  });
}

export default fp(redisPlugin, { name: 'redis' });
