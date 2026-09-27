import fp from 'fastify-plugin';
import { createProductService } from '../cache/products.js';

async function productsPlugin(app) {
  app.decorate('products', createProductService({ redis: app.redis.cache, logger: app.log }));
}

export default fp(productsPlugin, { name: 'products', dependencies: ['redis'] });
