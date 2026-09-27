import fp from 'fastify-plugin';
import { createRedisClient } from '../redis/clients.js';

// While disconnected, reject commands immediately instead of holding them until the next reconnect attempt
// (which backs off to seconds apart), so a request fails in milliseconds rather than hanging.
const API_OPTIONS = { enableOfflineQueue: false };

async function redisPlugin(app, { cacheUrl, queueUrl }) {
  const cache = createRedisClient(cacheUrl, 'm00-api:cache', app.log, API_OPTIONS);
  const queue = createRedisClient(queueUrl, 'm00-api:queue', app.log, API_OPTIONS);

  app.decorate('redis', { cache, queue });

  app.addHook('onClose', async () => {
    await Promise.all([cache, queue].map(async (client) => {
      try {
        await client.quit();
      } catch {
        // Without the offline queue, QUIT is rejected while disconnected; just drop the socket.
        client.disconnect();
      }
    }));
  });
}

// fp() makes `app.redis` visible to every route, not just inside this plugin.
export default fp(redisPlugin, { name: 'redis' });
