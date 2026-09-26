import Fastify from 'fastify';
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

app.get('/health', async (request, reply) => {
  const [cacheStatus, queueStatus] = await Promise.all([ping(cache), ping(queue)]);
  const ok = cacheStatus === 'up' && queueStatus === 'up';
  reply.code(ok ? 200 : 503);
  return { status: ok ? 'ok' : 'degraded', redisCache: cacheStatus, redisQueue: queueStatus };
});

app.put('/kv/:key', {
  schema: {
    body: {
      type: 'object',
      required: ['value'],
      properties: {
        value: { type: 'string' },
        ttlSeconds: { type: 'integer', minimum: 1 },
      },
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

app.get('/kv/:key', async (request, reply) => {
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
