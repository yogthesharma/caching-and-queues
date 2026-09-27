# Exercise: Cache key design

Read: `notes/01-caching-fundamentals/07-cache-key-design.md`

## Tasks

1. Find the bug in each key design:
   - a) `GET /me` is cached under `user:profile`
   - b) A multi-tenant SaaS caches `GET /projects/:id` under `project:<id>`
   - c) `GET /products?category=shoes&page=2` is cached under `products:list`
   - d) The same list is cached under `products:` + `request.url`, so `?category=shoes&page=2` and `?page=2&category=shoes` are different keys
   - e) A route builds `'m01:product:' + id` by hand, while `productKey()` builds `m01:product:v1:<id>`
2. Design keys (app prefix `shop`) for:
   - a) Product `42`, English, prices in INR
   - b) Page 3 of the “shoes” category, sorted by price
   - c) User `9`’s cart
   - d) The admin dashboard, which shows different numbers to `admin` and `viewer` roles
3. With the app running, find all Module 1 keys without using `KEYS`. What version segment do they have?
4. You’re adding a `category` field to the cached product. Change `KEY_VERSION` in `src/redis/product-cache.js` to `'v2'`, let the app restart, read `/products/1` twice, and list the keys again. What do you see? What happens to the `v1` key, and why is that safe during a rolling deploy?
5. Why is `KEYS m01:*` dangerous on a production Redis, even though it works fine locally?

## Stretch

Write `productListKey(filters)` that turns `{ category: 'shoes', page: 2, sort: 'price' }` into a short, stable key. The same filters in any order must give the same key, and `page: 1` (the default) should give the same key as leaving `page` out.

---

## Solutions

1.
   - a) **No user id.** The first user’s profile is cached and served to everyone. Use `app:user:<userId>:profile:v1`.
   - b) **No tenant id.** If ids aren’t globally unique (or a bug lets someone request another tenant’s id), tenants can see each other’s data. Use `app:t:<tenantId>:project:v1:<id>`.
   - c) **Missing the query parameters.** Every category and page shares one entry — page 2 of shoes gets served for page 1 of hats.
   - d) **Not normalized.** Same result, two cache entries (and two misses). Sort parameters and drop defaults before building the key.
   - e) **Keys built in two places.** The route writes a key that the service never reads (and vice versa): the cache silently never hits, or a delete misses the real key. Build every key with one function.
2.
   - a) `shop:product:v1:42:en:INR`
   - b) `shop:products:v1:list:category=shoes:page=3:sort=price`
   - c) `shop:user:9:cart:v1`
   - d) `shop:dashboard:v1:role=admin` and `shop:dashboard:v1:role=viewer` (one per role, not one per user — better hit rate)
3.

```bash
docker compose exec redis-cache redis-cli --scan --pattern 'm01:*'
```

Keys like `m01:product:v1:1` — version `v1`.

4. After the change, `--scan` shows `m01:product:v2:1` next to the old `m01:product:v1:1`. The first read after the restart was a `MISS` (nothing under `v2` yet), then `L1`. The `v1` key is never read again and disappears when its 60-second TTL runs out. During a rolling deploy, old instances keep reading and writing `v1` and new instances use `v2`, so neither reads the other’s shape. (Change it back to `'v1'` when you’re done.)
5. `KEYS` walks **every** key in one blocking call. Redis runs commands one at a time, so on a production instance with millions of keys, every other client — every API request — waits until it finishes (often hundreds of ms to seconds). `SCAN` returns the keys in small batches and lets other commands run in between.

Stretch:

```js
import { createHash } from 'node:crypto';

const DEFAULTS = { page: 1, sort: 'newest' };

export function productListKey(filters) {
  const meaningful = Object.entries(filters)
    .filter(([name, value]) => value !== undefined && DEFAULTS[name] !== value)
    .sort(([a], [b]) => a.localeCompare(b));
  const hash = createHash('sha1').update(JSON.stringify(meaningful)).digest('hex').slice(0, 16);
  return `m01:products:v1:list:${hash}`;
}

productListKey({ category: 'shoes', page: 2, sort: 'price' }) === productListKey({ sort: 'price', page: 2, category: 'shoes' });   // true
productListKey({ category: 'shoes', page: 1 }) === productListKey({ category: 'shoes' });                                         // true
```

The hash keeps keys short no matter how many filters there are. The trade-off: you can’t read the filters from the key in `redis-cli` anymore — for a handful of simple filters, the readable form from task 2b is often nicer.
