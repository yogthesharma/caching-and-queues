import { etagFor, isFresh } from '../http/etag.js';

// Browsers and CDNs may reuse a response for this long without asking again.
const BROWSER_MAX_AGE_SECONDS = 10;

const idParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'integer', minimum: 1, description: 'Cached in Redis as m01:product:v1:<id>' } },
};

const product = {
  type: 'object',
  properties: {
    id: { type: 'integer' },
    name: { type: 'string' },
    priceCents: { type: 'integer' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};

const notFound = {
  description: 'No product with this id',
  type: 'object',
  properties: { error: { type: 'string' } },
};

export default async function productRoutes(app) {
  app.get('/products/:id', {
    schema: {
      summary: 'Read a product (L1 → Redis → database)',
      description: 'The `X-Cache` response header says which layer answered: `L1`, `L2`, or `MISS`.',
      tags: ['products'],
      params: idParams,
      response: {
        200: { description: 'Found', ...product },
        304: { description: 'Client copy is still current (If-None-Match matched the ETag)', type: 'null' },
        404: notFound,
      },
    },
  }, async (request, reply) => {
    const { product: found, source } = await app.products.get(request.params.id);
    reply.header('x-cache', source === 'db' ? 'MISS' : source.toUpperCase());

    if (!found) {
      reply.code(404);
      return { error: 'not found' };
    }

    const etag = etagFor(found);
    reply.header('etag', etag);
    reply.header('cache-control', `public, max-age=${BROWSER_MAX_AGE_SECONDS}`);

    if (isFresh(request, etag)) {
      return reply.code(304).send();
    }
    return found;
  });

  app.put('/products/:id', {
    schema: {
      summary: 'Update a product, then drop its cached copies',
      tags: ['products'],
      params: idParams,
      body: {
        type: 'object',
        minProperties: 1,
        additionalProperties: false,
        properties: {
          name: { type: 'string', minLength: 1 },
          priceCents: { type: 'integer', minimum: 0 },
        },
      },
      response: {
        200: { description: 'Updated', ...product },
        404: notFound,
      },
    },
  }, async (request, reply) => {
    const updated = await app.products.update(request.params.id, request.body);
    if (!updated) {
      reply.code(404);
      return { error: 'not found' };
    }
    return updated;
  });
}
