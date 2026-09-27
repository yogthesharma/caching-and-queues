import { LRUCache } from 'lru-cache';
import { findProductById, getQueryCount, updateProduct } from '../db/products.js';
import { deleteProduct, readProduct, writeProduct } from '../redis/product-cache.js';

// Cache-aside over two layers: L1 (this process's memory) → L2 (Redis, shared) → the database.
export function createProductService({ redis, logger = console, l1TtlMs = 5_000, l2TtlSeconds = 60 }) {
  // Cached objects are shared by every request in this process — callers must not mutate them.
  const l1 = new LRUCache({ max: 500, ttl: l1TtlMs });
  const stats = { l1Hits: 0, l2Hits: 0, misses: 0 };

  // A cache is an optimization: if Redis is down, fall through to the database instead of failing the request.
  async function readL2(id) {
    try {
      return await readProduct(redis, id);
    } catch (err) {
      logger.warn({ err, id }, 'L2 read failed, falling back to the database');
      return null;
    }
  }

  async function fillL2(product) {
    try {
      await writeProduct(redis, product, l2TtlSeconds);
    } catch (err) {
      logger.warn({ err, id: product.id }, 'L2 write failed');
    }
  }

  async function get(id) {
    const fromL1 = l1.get(id);
    if (fromL1) {
      stats.l1Hits += 1;
      return { product: fromL1, source: 'l1' };
    }

    const fromL2 = await readL2(id);
    if (fromL2) {
      stats.l2Hits += 1;
      l1.set(id, fromL2);
      return { product: fromL2, source: 'l2' };
    }

    stats.misses += 1;
    const product = await findProductById(id);
    if (product) {
      await fillL2(product);
      l1.set(id, product);
    }
    return { product, source: 'db' };
  }

  // The write already succeeded, so a failed delete must not fail the request: the L2 TTL bounds the staleness.
  async function dropL2(id) {
    try {
      await deleteProduct(redis, id);
    } catch (err) {
      logger.error({ err, id }, `L2 delete failed, readers may see stale data for up to ${l2TtlSeconds} s`);
    }
  }

  // Write the database, then drop the cached copies; the next read refills them.
  // Other processes keep their own L1 copy until it expires (up to l1TtlMs of stale reads).
  async function update(id, changes) {
    const product = await updateProduct(id, changes);
    if (product) {
      l1.delete(id);
      await dropL2(id);
    }
    return product;
  }

  function getStats() {
    const lookups = stats.l1Hits + stats.l2Hits + stats.misses;
    const hitRate = lookups === 0 ? null : (stats.l1Hits + stats.l2Hits) / lookups;
    return { ...stats, lookups, hitRate, dbQueries: getQueryCount(), l1Size: l1.size };
  }

  return { get, update, getStats };
}
