import Fastify from 'fastify';
import swaggerPlugin from './plugins/swagger.js';
import redisPlugin from './plugins/redis.js';
import productsPlugin from './plugins/products.js';
import healthRoutes from './routes/health.js';
import productRoutes from './routes/products.js';
import statsRoutes from './routes/stats.js';

export async function buildApp(config) {
  const app = Fastify({ logger: true });

  await app.register(swaggerPlugin, { port: config.port });
  await app.register(redisPlugin, { cacheUrl: config.redisCacheUrl });
  await app.register(productsPlugin);

  await app.register(healthRoutes);
  await app.register(productRoutes);
  await app.register(statsRoutes);

  return app;
}
