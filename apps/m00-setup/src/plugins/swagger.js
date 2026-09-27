import fp from 'fastify-plugin';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

async function swaggerPlugin(app, { port }) {
  await app.register(swagger, {
    openapi: {
      info: { title: 'm00-setup', description: 'Module 0 — health check and key/value against Redis', version: '1.0.0' },
      servers: [{ url: `http://localhost:${port}` }],
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });
}

// Must be registered before the routes so it can collect their schemas.
export default fp(swaggerPlugin, { name: 'swagger' });
