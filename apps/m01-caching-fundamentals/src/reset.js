// Back to a clean slate: seed data in the "database" and no m01 keys in Redis.
import { config } from './config.js';
import { resetProducts } from './db/products.js';
import { createRedisClient } from './redis/clients.js';

const redis = createRedisClient(config.redisCacheUrl, 'm01-reset:cache');

try {
  await resetProducts();

  let deleted = 0;
  for await (const keys of redis.scanStream({ match: 'm01:*', count: 100 })) {
    if (keys.length > 0) {
      deleted += await redis.del(...keys);
    }
  }
  console.log(`database reset to seed data, deleted ${deleted} m01:* keys from redis-cache`);
  console.log('restart any running m01 app to clear its in-process L1 cache');
} finally {
  await redis.quit();
}
