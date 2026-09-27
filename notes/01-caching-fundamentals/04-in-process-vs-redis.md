# In-process (L1) vs Redis (L2)

## Goal

Know when a cache in the Node process’s own memory is enough, when you need Redis, and how to combine them without confusing yourself about staleness.

## Side by side

| | In-process (`lru-cache`, a `Map`) | Redis |
|--|-----------------------------------|-------|
| Read cost | ~microseconds, no network | ~0.2–1 ms network round trip |
| Stores | Real JS objects (no serialization) | Strings/bytes — you `JSON.stringify` / `JSON.parse` |
| Shared across replicas | **No** — each process has its own copy | **Yes** — one copy for every process |
| Survives a restart / deploy | No | Yes (until TTL or eviction) |
| Invalidate from anywhere | No — only the process holding it | Yes — one `DEL` |
| Memory | Counts against the Node heap | Separate server with its own limit |

## Why not just a `Map`?

A plain `Map` has no size limit and no expiry — it grows until the process runs out of memory. `lru-cache` adds both:

```js
import { LRUCache } from 'lru-cache';

const l1 = new LRUCache({ max: 500, ttl: 5_000 });   // at most 500 entries, each lives 5 s
l1.set(1, product);
l1.get(1);   // product, or undefined once expired or evicted
```

## The replica problem

Production APIs run several copies (replicas) behind a load balancer. With only an in-process cache:

- Each replica fills its own cache → N times the database load on a cold start.
- An update is invalidated only in the replica that handled the write. **The other replicas keep serving the old value until their TTL runs out.**
- Requests from the same user bounce between replicas and see the value flip between old and new.

Redis fixes all three because there’s only one copy. That’s why Redis is the default **shared** cache, and in-process caching is an optional extra layer.

## Two-tier: L1 in front of L2

```
request ──► L1 (this process, 5 s) ──► L2 Redis (shared, 60 s) ──► database
```

From `src/cache/products.js`:

```js
const fromL1 = l1.get(id);
if (fromL1) return { product: fromL1, source: 'l1' };

const fromL2 = await readL2(id);
if (fromL2) {
  l1.set(id, fromL2);               // copy into L1 for the next few seconds
  return { product: fromL2, source: 'l2' };
}

const product = await findProductById(id);
await fillL2(product);              // fill both on the way back
l1.set(id, product);
```

Why bother, when Redis is already under a millisecond?

- A very hot key (home page config read 5,000×/s per process) turns into one Redis call per process every 5 s instead of 5,000/s.
- No JSON parsing on L1 hits.
- Redis briefly unreachable → hot keys still served from memory.

The price is the replica problem again, but **bounded by the L1 TTL**. Keep L1 TTLs short (seconds) so “other replicas may be stale” means “for up to 5 s”. Module 9 removes even that with pub/sub: every replica drops its L1 entry when told to.

See it happen:

```bash
npm run demo
```

```
A reads (cold)                     source=db  price=7999  152 ms
A reads again                      source=l1  price=7999  0.15 ms
B reads (its L1 is empty)          source=l2  price=7999  0.43 ms
A updates price to 6999 (drops A’s L1 + Redis)
A reads after update               source=db  price=6999  151 ms
B reads after update (STALE L1)    source=l1  price=7999  0.04 ms
B reads after 1000 ms (L1 expired) source=l2  price=6999  0.89 ms
```

## L1 gotcha: shared objects

An L1 hit returns **the same object** to every request. If a handler does `product.price = applyDiscount(product.price)`, every later request sees the discounted price. Treat cached objects as read-only (copy before modifying, or `Object.freeze` them). Redis doesn’t have this problem because every read parses a fresh object.

## Choosing

| Situation | Choice |
|-----------|--------|
| Single process, data can be a bit stale, restarts are fine | L1 only |
| Multiple replicas, or updates must be visible everywhere quickly | Redis |
| Extremely hot keys on top of Redis | L1 (short TTL) + Redis |
| Per-user data with millions of users | Redis — it won’t fit in every process’s heap |

## Takeaway

In-process memory is the fastest cache, but each replica has its own copy that only it can invalidate. Redis is one shared copy with a global delete. Use Redis by default, and put a short-TTL L1 in front only for very hot keys.
