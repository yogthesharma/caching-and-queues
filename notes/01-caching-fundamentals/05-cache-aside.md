# Cache-aside

## Goal

Implement the default caching pattern for APIs, and know exactly what happens on a read, on a write, and when Redis is down.

## The pattern

The **application** talks to both the cache and the database. The cache sits “aside” — it never talks to the database itself.

Read:

```
1. GET from cache
2. hit  → return it
3. miss → read the database
4.        store the result in the cache with a TTL
5.        return it
```

Write:

```
1. write the database
2. DELETE the cache entry (don't update it)
3. the next read misses and refills with fresh data
```

Also called **lazy loading**: only data that someone actually reads ends up in the cache.

## The checkpoint sketch: `GET /products/:id`

```js
async function getProduct(id) {
  const key = `product:v1:${id}`;

  const cached = await redis.get(key);
  if (cached !== null) {
    return JSON.parse(cached);                                  // hit
  }

  const product = await db.query('SELECT * FROM products WHERE id = $1', [id]);   // miss
  if (product) {
    await redis.set(key, JSON.stringify(product), 'EX', 300);   // fill
  }
  return product;
}
```

The real version in `apps/m01-caching-fundamentals/src/cache/products.js` is the same shape with an L1 in front (see [04-in-process-vs-redis.md](./04-in-process-vs-redis.md)) and a fake slow database in place of Postgres.

## Why delete on write instead of updating the cache?

It’s tempting to write the new value into the cache right after the database update. Deleting is safer:

- **Races.** Two concurrent updates can finish their database writes in one order and their cache writes in the other, leaving the *older* value in the cache until the TTL runs out. With delete, the worst case is an extra miss.
- **The cached shape may not be what you wrote.** The cache holds “product with category name and review count”; the update only changed `price`. Rebuilding the cached value correctly means re-running the read query anyway.
- **Many keys can depend on one row.** Deleting is cheap; recomputing every dependent entry is not.

Delete-after-write still has a rare race (a slow reader refills the old value right after your delete). Module 4 covers it and the fixes. For now: **write the database, then delete the key, and keep a TTL as the safety net.**

## Redis down ≠ API down

The cache is an optimization, so a Redis failure should make the API **slower**, not broken:

```js
async function readL2(id) {
  try {
    return await readProduct(redis, id);
  } catch (err) {
    logger.warn({ err, id }, 'L2 read failed, falling back to the database');
    return null;                        // treat it as a miss
  }
}
```

The same goes for the write path. Once the database write has succeeded, a failed `DEL` must not turn into a `500`. The client would think the update failed when it didn’t. Log it loudly and let the TTL bound the staleness (`dropL2()` in `src/cache/products.js`).

Things to watch:

- **The database must handle the full load** when the cache is gone. If it can’t, a Redis outage becomes a database outage. (Module 4: stampedes.)
- **Don’t wait for a dead cache.** As in Module 0, `maxRetriesPerRequest: 1` isn’t enough on its own. While disconnected, ioredis holds each command in its *offline queue* until the next reconnect attempt, and reconnect attempts back off to seconds apart. Measured on this app without the fix, a miss took 1.8 s just after Redis stopped and **17 s** once it had been down for a while (two Redis calls per miss, each waiting). The cache client in `src/plugins/redis.js` also sets `enableOfflineQueue: false`, so while disconnected every command fails instantly and a miss costs the usual ~150 ms. The scripts (`demo.js`, `reset.js`) keep the default, because they send their first command before the connection is up, and the queue is what holds that command until it is.
- **Health checks.** Module 0’s `/health` returned `503` when Redis was down, which was right there because the app had nothing to do without Redis. This app can still serve every read, so its `/health` returns `200` with `status: "degraded"`. If it returned `503`, the load balancer would pull *every* instance at once when the shared Redis died, turning “slower” into “down”. Only report unhealthy for dependencies the instance truly can’t work without.

## Strengths and weaknesses

| Strength | Weakness |
|----------|----------|
| Simple; the cache is optional and the app works without it | The first read of every key is slow (cold cache) |
| Only data that’s actually read gets cached | Data can be stale for up to the TTL if a delete is missed |
| Works with any database and any query | Every read path must implement it (use one helper, like `createProductService`) |
| Cache failures degrade to “slow”, not “down” | Concurrent misses on one hot key all hit the database (Module 4) |

## Not-found results

Our `get()` doesn’t cache `null`. Every request for `/products/999` goes to the database — easy to abuse by requesting random ids. The fix is **negative caching** (store “not found” for a short TTL), in Module 3.

## Takeaway

On a read, check the cache, fall back to the database on a miss, and fill the cache with a TTL. On a write, update the database, then delete the key. If Redis fails, treat it as a miss so the API gets slower instead of going down.
