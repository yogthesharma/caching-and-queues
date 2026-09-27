# Exercise: Write-through, write-behind, write-around

Read: `notes/01-caching-fundamentals/06-write-patterns.md`

## Tasks

1. In one sentence each, what happens on a **write** in cache-aside, write-through, write-behind, and write-around?
2. Which pattern does `PUT /products/:id` in the Module 1 app use? Point at the lines.
3. For each scenario, pick a pattern and say why:
   - a) A video’s view counter, incremented 20,000 times a minute
   - b) Product details on an e-commerce site, read constantly, edited a few times a day
   - c) Nightly bulk import of 2 million archived orders that users rarely open
   - d) A user’s “last seen at” timestamp shown on their profile
   - e) An order’s payment status
4. Write-behind stores the new value in Redis and writes the database later. What exactly is lost if `redis-cache` restarts before the flush? Which Redis setting in this repo makes that worse?
5. A teammate changes `update()` to do this instead of deleting:

   ```js
   const product = await updateProduct(id, changes);
   await writeProduct(redis, product, 60);
   ```

   Describe a sequence of two concurrent updates that leaves the **wrong** price in Redis for up to 60 seconds.

## Stretch

Sketch (pseudocode is fine) a write-behind view counter with Redis: `POST /products/:id/view` increments a counter, and a timer flushes all counters to the database every 10 seconds. Which Redis command lets you read a counter and reset it to 0 in one atomic step?

---

## Solutions

1.
   - **Cache-aside:** the app writes the database and deletes the cache key; the next read refills it.
   - **Write-through:** the value is written to the cache and the database together, before responding.
   - **Write-behind:** the value is written to the cache only, and the database is updated later, in batches.
   - **Write-around:** the value is written to the database only; the cache isn’t touched (or the old copy is just deleted).
2. Cache-aside’s write side, which is also write-around plus invalidation. In `src/cache/products.js`:

```js
const product = await updateProduct(id, changes);   // database first
if (product) {
  l1.delete(id);                                    // drop the cached copies
  await dropL2(id);                                 // DEL m01:product:v1:<id>
}
```

3.
   - a) **Write-behind.** `INCR` in Redis, flush totals to the database every few seconds. Losing a few seconds of views on a crash is acceptable; 20,000 row updates a minute is not.
   - b) **Cache-aside.** Read-heavy, rare writes; delete on update.
   - c) **Write-around.** Don’t fill the cache with 2 million rows that almost nobody reads; the few that are opened get cached on read.
   - d) **Write-behind** (or just a throttled database write, e.g. at most once per minute per user). High frequency, loss of a few seconds is harmless.
   - e) **No write caching — write the database.** Payment status must never be lost or stale. You can still cache-aside it for reads with a delete on every change, but many teams just read it from Postgres.
4. Every change since the last flush — e.g. up to 10 seconds of view counts. Our `redis-cache` runs with **no persistence** (`--save ""`, `--appendonly no` in `docker-compose.yml`), so a restart loses everything in it. That’s fine for a cache that can be refilled from the database; it’s why write-behind only suits data you can afford to lose.
5. Price starts at 100.
   1. Request A updates the price to 90 in the database.
   2. Request B updates the price to 80 in the database (so the database now has **80**).
   3. B writes `80` to Redis.
   4. A (delayed by a GC pause or a slow network) writes `90` to Redis.

   The database says 80, Redis says **90** until the TTL expires. With `DEL`, both requests just delete the key, and the next read loads 80.

Stretch:

```js
// POST /products/:id/view
await redis.incr(`m01:views:${id}`);
reply.code(204);

// every 10 s
setInterval(async () => {
  for await (const keys of redis.scanStream({ match: 'm01:views:*' })) {
    for (const key of keys) {
      const count = Number(await redis.getset(key, 0));   // read and reset atomically
      if (count > 0) {
        await db.query('UPDATE products SET views = views + $1 WHERE id = $2', [count, key.split(':')[2]]);
      }
    }
  }
}, 10_000);
```

`GETSET key 0` (or `SET key 0 GET` in newer Redis) returns the old value and sets 0 in one step, so no increments slip in between the read and the reset. `GETDEL` also works: it returns the value and deletes the key, and the next `INCR` recreates it from 0. With several API processes, only one should run the flush (a lock — Module 10 — or a BullMQ repeating job — Module 7).
