import Fastify from 'fastify';
import swaggerPlugin from './plugins/swagger.js';
import redisPlugin from './plugins/redis.js';
import healthRoutes from './routes/health.js';
import kvRoutes from './routes/kv.js';

export async function buildApp(config) {
  const app = Fastify({ logger: true });

  await app.register(swaggerPlugin, { port: config.port });
  await app.register(redisPlugin, { cacheUrl: config.redisCacheUrl, queueUrl: config.redisQueueUrl });

  await app.register(healthRoutes);
  await app.register(kvRoutes);

  return app;
}
