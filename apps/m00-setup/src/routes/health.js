import { ping } from '../redis/health.js';

const healthBody = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['ok', 'degraded'] },
    redisCache: { type: 'string', enum: ['up', 'down'] },
    redisQueue: { type: 'string', enum: ['up', 'down'] },
  },
};

export default async function healthRoutes(app) {
  app.get('/health', {
    schema: {
      summary: 'Ping both Redis instances',
      tags: ['health'],
      response: {
        200: { description: 'Both instances are up', ...healthBody },
        503: { description: 'At least one instance is down', ...healthBody },
      },
    },
  }, async (request, reply) => {
    const [redisCache, redisQueue] = await Promise.all([ping(app.redis.cache), ping(app.redis.queue)]);
    const ok = redisCache === 'up' && redisQueue === 'up';
    reply.code(ok ? 200 : 503);
    return { status: ok ? 'ok' : 'degraded', redisCache, redisQueue };
  });
}
