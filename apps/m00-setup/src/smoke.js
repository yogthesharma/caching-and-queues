import { Redis } from 'ioredis';

const cache = new Redis(process.env.REDIS_CACHE_URL);
const queue = new Redis(process.env.REDIS_QUEUE_URL);

try {
  console.log('cache PING ->', await cache.ping());
  console.log('queue PING ->', await queue.ping());

  await cache.set('m00:hello', 'world', 'EX', 60);
  console.log('GET m00:hello ->', await cache.get('m00:hello'));
  console.log('TTL m00:hello ->', await cache.ttl('m00:hello'), 'seconds');

  const [, cachePolicy] = await cache.config('GET', 'maxmemory-policy');
  const [, queuePolicy] = await queue.config('GET', 'maxmemory-policy');
  console.log('cache maxmemory-policy ->', cachePolicy);
  console.log('queue maxmemory-policy ->', queuePolicy);
} finally {
  await Promise.all([cache.quit(), queue.quit()]);
}
