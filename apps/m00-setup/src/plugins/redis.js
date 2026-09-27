import fp from 'fastify-plugin';
import { createRedisClient } from '../redis/clients.js';

async function redisPlugin(app, { cacheUrl, queueUrl }) {
  const cache = createRedisClient(cacheUrl, 'm00-api:cache', app.log);
  const queue = createRedisClient(queueUrl, 'm00-api:queue', app.log);

  app.decorate('redis', { cache, queue });

  app.addHook('onClose', async () => {
    await Promise.all([cache.quit(), queue.quit()]);
  });
}

// fp() makes `app.redis` visible to every route, not just inside this plugin.
export default fp(redisPlugin, { name: 'redis' });
