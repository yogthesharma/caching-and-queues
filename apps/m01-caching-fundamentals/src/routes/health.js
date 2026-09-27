import { ping } from '../redis/health.js';

export default async function healthRoutes(app) {
  app.get('/health', {
    schema: {
      summary: 'Report redis-cache status',
      description: 'Always 200 while the process runs: product reads fall back to the database when Redis is down, '
        + 'so the instance can still serve traffic. `status: degraded` means slower, not broken.',
      tags: ['health'],
      response: {
        200: {
          description: 'Instance can serve traffic',
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['ok', 'degraded'] },
            redisCache: { type: 'string', enum: ['up', 'down'] },
          },
        },
      },
    },
  }, async () => {
    // Unlike m00, a 503 here would make a load balancer drop every instance at once when the shared cache dies.
    const redisCache = await ping(app.redis.cache);
    return { status: redisCache === 'up' ? 'ok' : 'degraded', redisCache };
  });
}
