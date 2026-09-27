# Exercise: Cache-aside

Read: `notes/01-caching-fundamentals/05-cache-aside.md`

## Tasks

1. **Checkpoint.** Without looking at the notes, write the cache-aside read path for `GET /products/:id` as pseudocode or JS: key, hit, miss, fill with TTL, return. Then write the update path.
2. Open `src/cache/products.js`. For a request that misses both layers, list every Redis command and database call it makes, in order.
3. With the app running, read `/products/4` so it’s cached, then watch Redis in a second terminal:

   ```bash
   docker compose exec redis-cache redis-cli MONITOR
   ```

   a) Read `/products/4` again right away. What shows up in `MONITOR`? Why?
   b) Wait 6 seconds and read it again. What shows up now?
   c) `PUT /products/4` a new name. What commands appear?
4. Check the Redis copy directly:

   ```bash
   docker compose exec redis-cache redis-cli GET m01:product:v1:4
   docker compose exec redis-cache redis-cli TTL m01:product:v1:4
   ```

   Now `DEL` that key in `redis-cli` and read `/products/4` within 5 seconds, then again after 5 seconds. Explain both `X-Cache` values.
5. Stop Redis (`docker compose stop redis-cache`) and request `/products/5` with `curl -w '%{time_total}\n'`. Does it succeed? Is it faster or slower than a normal miss, and why? What status and body does `/health` return, and why isn’t it `503` like Module 0’s? Try a `PUT` too. Now remove `{ enableOfflineQueue: false }` from `src/plugins/redis.js`, let the app restart, stop Redis again, wait 10 seconds, and time another miss. What changed? Put the option back and start Redis afterwards.
6. Why does `update()` **delete** the cached copies instead of writing the updated product into them?
7. Request `/products/999` five times and check `/stats`. How many database queries did it cost? Why is that a problem?

## Stretch

Write a generic helper and use it in `get()` for the L2 layer:

```js
// src/redis/cached.js
export async function cached(redis, key, ttlSeconds, loader) { /* ... */ }
```

It should return the parsed cached value on a hit, and on a miss call `loader()`, store the result as JSON with the TTL (only if it isn’t `null`), and return it.

---

## Solutions

1.

```js
async function getProduct(id) {
  const key = `product:v1:${id}`;
  const cached = await redis.get(key);
  if (cached !== null) return JSON.parse(cached);

  const product = await db.findProduct(id);
  if (product) await redis.set(key, JSON.stringify(product), 'EX', 300);
  return product;
}

async function updateProduct(id, changes) {
  const product = await db.updateProduct(id, changes);
  await redis.del(`product:v1:${id}`);
  return product;
}
```

2. L1 lookup (memory, no command) → `GET m01:product:v1:<id>` (nil) → database read (150 ms) → `SET m01:product:v1:<id> <json> EX 60` → L1 `set`.
3.
   a) **Nothing.** The read was an L1 hit — it never left the process.
   b) `"GET" "m01:product:v1:4"` — L1 expired after 5 s, so it read Redis (and refilled L1).
   c) `"DEL" "m01:product:v1:4"`, after the database update. Then the next read shows a `GET` (nil) followed by a `SET … EX 60`.
4. `GET` returns the product JSON; `TTL` returns ≤ 60. After deleting the key:
   - Within 5 s: `X-Cache: L1` — the process’s own copy is still alive; deleting from Redis doesn’t reach it.
   - After 5 s: `X-Cache: MISS` — L1 expired and Redis no longer has it, so it reads the database and refills both.
5. It **succeeds** (`200`), because `readL2()` and `fillL2()` catch Redis errors and fall back to the database. It takes about as long as a normal miss (~150 ms): with `enableOfflineQueue: false`, ioredis rejects commands instantly while disconnected (“Stream isn’t writeable…”), so the only real cost is the database read. `/health` returns `200` with `{"status":"degraded","redisCache":"down"}`. Every instance can still serve reads from the database. A `503` would make a load balancer remove all of them at once, since they all share the same Redis, turning “slower” into a full outage. The `PUT` also succeeds: the database write went through, and the failed `DEL` is only logged (the TTL bounds any staleness).

   Without `enableOfflineQueue: false`, the miss takes **seconds** (17 s in one run). Each Redis command sits in ioredis’s offline queue until the next reconnect attempt, which backs off to seconds apart, and `maxRetriesPerRequest: 1` only gives up after that attempt fails. A miss makes two Redis calls (`GET`, then `SET`), so it waits twice. For an optional cache, fail instantly; for a queue client (BullMQ, Module 7), waiting for Redis to come back is exactly what you want.
6. Deleting avoids races: two concurrent updates can write the database in one order and the cache in the other, leaving the older value cached until the TTL runs out. A delete just causes one extra miss, and the next read loads whatever the database has **now**. Deleting also avoids rebuilding the cached shape (which may include joins) in every write path.
7. **5 database queries** (`misses` goes up by 5, and so does `dbQueries`). Not-found results aren’t cached, so anyone can make every request hit the database by asking for ids that don’t exist (cache **penetration**). Module 3 fixes it with negative caching.

Stretch:

```js
// src/redis/cached.js
export async function cached(redis, key, ttlSeconds, loader) {
  const hit = await redis.get(key);
  if (hit !== null) {
    return JSON.parse(hit);
  }
  const value = await loader();
  if (value !== null) {
    await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  }
  return value;
}
```

Every cache-aside read in the app can now be one line, e.g. `cached(redis, productKey(id), 60, () => findProductById(id))`. (To keep the “Redis down → use the database” behavior, wrap the `get`/`set` calls in `try`/`catch` as `readL2`/`fillL2` do.)
