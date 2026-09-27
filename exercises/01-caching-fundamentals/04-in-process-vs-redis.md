# Exercise: In-process (L1) vs Redis (L2)

Read: `notes/01-caching-fundamentals/04-in-process-vs-redis.md`

## Tasks

1. Run `npm run demo`. For each of the seven lines, explain in one sentence **why** it came from that source.
2. From the demo output: roughly how many times faster is an L1 hit than an L2 hit, and an L2 hit than a miss?
3. With `npm run dev` running, request `/products/2`, wait **6 seconds**, and request it again. What does `X-Cache` show the second time, and why?
4. Run two API instances side by side. They share Redis and the "database" file, just like two replicas share Redis and Postgres; each has its own L1:

   ```bash
   npm run dev                  # terminal 1 → port 3000
   PORT=3001 npm run dev        # terminal 2 → port 3001
   ```

   a) Read `/products/3` from both. What does each show for `X-Cache`?
   b) Within 5 seconds, `PUT /products/3` a new price on **3000**, then immediately read `/products/3` on **3001**. Which price do you see? Read again after 5 seconds.
   c) What is the maximum time a replica can serve the old price, and which constant controls it?
5. A handler does this after an L1 hit: `found.priceCents = Math.round(found.priceCents * 0.9)` to show a sale price. What goes wrong for the next requests? Why doesn’t the same bug happen with Redis-only caching?
6. You run 20 API replicas and want to cache per-user carts for 2 million users. L1, Redis, or both? Why?

## Stretch

Make L1 optional: add an `l1Enabled` option to `createProductService` (default `true`). When `false`, skip the L1 read and writes. Start the app with it off (for example through an `L1_ENABLED=false` env var read in `config.js`) and repeat task 4b — what changes?

---

## Solutions

1.
   - `A reads (cold)` → **db**: nothing in A’s L1 or Redis yet.
   - `A reads again` → **l1**: the miss filled A’s L1.
   - `B reads` → **l2**: B has its own, empty L1, but the miss by A filled Redis, which both share.
   - `A updates…`: database written, A’s L1 entry and the Redis key deleted.
   - `A reads after update` → **db**, new price: both of A’s layers were cleared, so it misses and refills Redis with the new price.
   - `B reads after update` → **l1, old price**: B’s L1 still holds the copy from before the update — nothing told B to drop it.
   - `B reads after 1000 ms` → **l2, new price**: B’s L1 entry expired (the demo uses a 1 s L1 TTL), so B read Redis, which A had refilled.
2. L1 ~0.05–0.15 ms vs L2 ~0.4–0.9 ms: L1 is roughly **5–10×** faster. L2 vs miss (~150 ms): **~200×**. The miss cost here is fake, but the ratio is realistic for a slow query.
3. `L2`. The L1 entry lives 5 s (`l1TtlMs = 5_000` in `src/cache/products.js`) and expired; the Redis copy lives 60 s, so it came from Redis and was copied back into L1.
4.
   a) The first instance to read shows `MISS`; the other shows `L2` (Redis was already filled). Repeat reads on each show `L1`.
   b) Port 3001 shows the **old price** (`X-Cache: L1`) — the update only cleared 3000’s L1 and the shared Redis key. After 5 s, 3001’s L1 expires and it shows the new price (`L2` or `MISS`).
   c) Up to the **L1 TTL: 5 seconds**, set by `l1TtlMs` in `createProductService`. Module 9 removes this window with pub/sub invalidation.
5. L1 returns the **same object** to every request in that process. The handler changes the cached object itself, so the next request applies the discount again to the already-discounted price, and so on, until the entry expires. Redis-only caching parses a **new** object from JSON on every hit, so changes to it never leak into the next request. Fix: copy before changing (`{ ...found, priceCents: … }`), or freeze cached objects.
6. **Redis.** 2 million carts copied into 20 processes’ heaps would waste memory (and each copy would be stale in a different way). Carts are per-user and each is read by only one user, so an L1 hit rate would be poor anyway. L1 only pays off for a small set of keys that every request reads.

Stretch:

```js
// src/cache/products.js
export function createProductService({ redis, logger = console, l1TtlMs = 5_000, l2TtlSeconds = 60, l1Enabled = true }) {
  // ...
  async function get(id) {
    const fromL1 = l1Enabled ? l1.get(id) : undefined;
    // ... and wrap each l1.set(...) in `if (l1Enabled)`
  }
}
```

```js
// src/config.js
l1Enabled: process.env.L1_ENABLED !== 'false',
```

```js
// src/plugins/products.js
async function productsPlugin(app, { l1Enabled }) {
  app.decorate('products', createProductService({ redis: app.redis.cache, logger: app.log, l1Enabled }));
}
```

```js
// src/app.js
await app.register(productsPlugin, { l1Enabled: config.l1Enabled });
```

With L1 off on both instances, task 4b shows the new price on 3001 **immediately**: there is only one copy (Redis), and the update deleted it. You trade ~0.5 ms per read for no cross-replica staleness.
