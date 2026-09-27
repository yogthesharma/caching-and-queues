// Bump when the cached JSON shape changes: old entries are ignored and expire on their own.
const KEY_VERSION = 'v1';

export function productKey(id) {
  return `m01:product:${KEY_VERSION}:${id}`;
}

// Returns null on a miss.
export async function readProduct(redis, id) {
  const raw = await redis.get(productKey(id));
  return raw === null ? null : JSON.parse(raw);
}

export async function writeProduct(redis, product, ttlSeconds) {
  await redis.set(productKey(product.id), JSON.stringify(product), 'EX', ttlSeconds);
}

export async function deleteProduct(redis, id) {
  await redis.del(productKey(id));
}
