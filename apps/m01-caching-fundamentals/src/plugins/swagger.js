import fp from 'fastify-plugin';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

async function swaggerPlugin(app, { port }) {
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'm01-caching-fundamentals',
        description: 'Module 1 — two-layer cache-aside (lru-cache + Redis) with HTTP caching headers',
        version: '1.0.0',
      },
      servers: [{ url: `http://localhost:${port}` }],
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });
}

// Must be registered before the routes so it can collect their schemas.
export default fp(swaggerPlugin, { name: 'swagger' });
