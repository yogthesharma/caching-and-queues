import Fastify from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { Redis } from 'ioredis';

const PORT = Number(process.env.PORT ?? 3000);
const HEALTH_TIMEOUT_MS = 500;
const KEY_PREFIX = 'm00:kv:';

// Fail fast instead of queueing commands forever while Redis is down.
const cache = new Redis(process.env.REDIS_CACHE_URL, { maxRetriesPerRequest: 1 });
const queue = new Redis(process.env.REDIS_QUEUE_URL, { maxRetriesPerRequest: 1 });

const app = Fastify({ logger: true });

cache.on('error', (err) => app.log.warn({ err }, 'redis-cache error'));
queue.on('error', (err) => app.log.warn({ err }, 'redis-queue error'));

// Must be registered before the routes so it can collect their schemas.
await app.register(swagger, {
  openapi: {
    info: { title: 'm00-setup', description: 'Module 0 — health check and key/value against Redis', version: '1.0.0' },
    servers: [{ url: `http://localhost:${PORT}` }],
  },
});
await app.register(swaggerUi, { routePrefix: '/docs' });

async function ping(client) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), HEALTH_TIMEOUT_MS);
  });
  try {
    await Promise.race([client.ping(), timeout]);
    return 'up';
  } catch {
    return 'down';
  } finally {
    clearTimeout(timer);
  }
}

const healthBody = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['ok', 'degraded'] },
    redisCache: { type: 'string', enum: ['up', 'down'] },
    redisQueue: { type: 'string', enum: ['up', 'down'] },
  },
};

const notFound = {
  description: 'Key does not exist (or has expired)',
  type: 'object',
  properties: { error: { type: 'string' } },
};

const keyParams = {
  type: 'object',
  required: ['key'],
  properties: { key: { type: 'string', description: 'Stored in Redis as m00:kv:<key>' } },
};

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
  const [cacheStatus, queueStatus] = await Promise.all([ping(cache), ping(queue)]);
  const ok = cacheStatus === 'up' && queueStatus === 'up';
  reply.code(ok ? 200 : 503);
  return { status: ok ? 'ok' : 'degraded', redisCache: cacheStatus, redisQueue: queueStatus };
});

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
  const { key } = request.params;
  const { value, ttlSeconds } = request.body;
  if (ttlSeconds) {
    await cache.set(KEY_PREFIX + key, value, 'EX', ttlSeconds);
  } else {
    await cache.set(KEY_PREFIX + key, value);
  }
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
      404: notFound,
    },
  },
}, async (request, reply) => {
  const redisKey = KEY_PREFIX + request.params.key;
  const [value, ttl] = await Promise.all([cache.get(redisKey), cache.ttl(redisKey)]);
  if (value === null) {
    reply.code(404);
    return { error: 'not found' };
  }
  return { key: request.params.key, value, ttlSeconds: ttl === -1 ? null : ttl };
});

app.addHook('onClose', async () => {
  await Promise.all([cache.quit(), queue.quit()]);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    process.exit(0);
  });
}

await app.listen({ port: PORT });
