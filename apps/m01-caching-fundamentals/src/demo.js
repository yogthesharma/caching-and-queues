// Two "API replicas" in one script: each has its own L1, both share Redis (L2) and the database.
import { setTimeout as sleep } from 'node:timers/promises';
import { config } from './config.js';
import { createRedisClient } from './redis/clients.js';
import { deleteProduct } from './redis/product-cache.js';
import { findProductById, updateProduct } from './db/products.js';
import { createProductService } from './cache/products.js';

const L1_TTL_MS = 1_000;

const redis = createRedisClient(config.redisCacheUrl, 'm01-demo:cache');
const replicaA = createProductService({ redis, l1TtlMs: L1_TTL_MS });
const replicaB = createProductService({ redis, l1TtlMs: L1_TTL_MS });

async function read(label, replica) {
  const start = performance.now();
  const { product, source } = await replica.get(1);
  const ms = (performance.now() - start).toFixed(2);
  console.log(`${label.padEnd(34)} source=${source.padEnd(2)}  price=${product.priceCents}  ${ms} ms`);
}

const original = await findProductById(1);
const newPrice = original.priceCents - 1000;

try {
  await deleteProduct(redis, 1);

  await read('A reads (cold)', replicaA);
  await read('A reads again', replicaA);
  await read('B reads (its L1 is empty)', replicaB);

  await replicaA.update(1, { priceCents: newPrice });
  console.log(`A updates price to ${newPrice} (drops A’s L1 + Redis)`);

  await read('A reads after update', replicaA);
  await read('B reads after update (STALE L1)', replicaB);

  await sleep(L1_TTL_MS + 100);
  await read(`B reads after ${L1_TTL_MS} ms (L1 expired)`, replicaB);
} finally {
  // Leave the database and Redis as we found them, so a running API doesn't see the demo's price.
  await updateProduct(1, { priceCents: original.priceCents });
  await deleteProduct(redis, 1);
  await redis.quit();
}
