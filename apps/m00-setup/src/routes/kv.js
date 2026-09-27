import { getValue, setValue } from '../redis/kv.js';

const keyParams = {
  type: 'object',
  required: ['key'],
  properties: { key: { type: 'string', description: 'Stored in Redis as m00:kv:<key>' } },
};

export default async function kvRoutes(app) {
  app.put('/kv/:key', {
    schema: {
      summary: 'Store a value in redis-cache',
      tags: ['kv'],
      params: keyParams,
      body: {
        type: 'object',
        required: ['value'],
        properties: {
          value: { type: 'string' },
          ttlSeconds: { type: 'integer', minimum: 1, description: 'Omit for no expiry' },
        },
      },
      response: {
        204: { description: 'Stored', type: 'null' },
      },
    },
  }, async (request, reply) => {
    const { value, ttlSeconds } = request.body;
    await setValue(app.redis.cache, request.params.key, value, ttlSeconds);
    reply.code(204);
  });

  app.get('/kv/:key', {
    schema: {
      summary: 'Read a value and its remaining TTL',
      tags: ['kv'],
      params: keyParams,
      response: {
        200: {
          description: 'Found',
          type: 'object',
          properties: {
            key: { type: 'string' },
            value: { type: 'string' },
            ttlSeconds: { type: ['integer', 'null'], description: 'null means no expiry' },
          },
        },
        404: {
          description: 'Key does not exist (or has expired)',
          type: 'object',
          properties: { error: { type: 'string' } },
        },
      },
    },
  }, async (request, reply) => {
    const found = await getValue(app.redis.cache, request.params.key);
    if (!found) {
      reply.code(404);
      return { error: 'not found' };
    }
    return { key: request.params.key, ...found };
  });
}
