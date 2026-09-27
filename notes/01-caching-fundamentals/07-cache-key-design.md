# Cache key design

## Goal

Build keys that never collide, are easy to find and delete, and let you change the cached format without a flag day.

## Anatomy

```
m01:product:v1:42
│   │       │  └─ id — what makes this entry unique
│   │       └──── version of the cached shape
│   └──────────── entity
└──────────────── app / namespace
```

From `src/redis/product-cache.js`:

```js
const KEY_VERSION = 'v1';

export function productKey(id) {
  return `m01:product:${KEY_VERSION}:${id}`;
}
```

Rules:

- **One function builds each kind of key.** Routes and services never write key strings by hand. A typo in one place (`prodcut:42`) is a cache that silently never hits.
- **Prefix with the app/namespace.** Several services often share one Redis. The prefix prevents collisions and lets you `SCAN` for one app’s keys.
- **Colons as separators** — a Redis convention; Beekeeper and RedisInsight show keys as a folder tree by colon.
- **Readable over compact.** You’ll read these in `redis-cli` during an incident.

## Include everything the value depends on

The key must change whenever the cached value would change. Missing a dimension serves the wrong data:

| Value depends on | Key must include | Example |
|------------------|------------------|---------|
| Tenant / organization | tenant id | `app:t:17:product:v1:42` |
| The user | user id | `app:user:9:cart:v1` |
| Language / currency | locale | `app:product:v1:42:en-IN` |
| Query parameters | the parameters, normalized | `app:products:v1:list:cat=shoes:page=2:sort=price` |
| Permissions / role | role, if the response differs | `app:dashboard:v1:role=admin` |

The classic bug: caching `GET /me` under `user:me`. The first user to request it gets cached, and everyone else sees their profile.

For long or messy inputs (a search filter object), **normalize then hash**: sort the keys, drop defaults, `JSON.stringify`, then hash with `sha1` so the key stays short:

```js
const filters = { sort: 'price', category: 'shoes' };   // same as { category: 'shoes', sort: 'price' }
const normalized = JSON.stringify(Object.entries(filters).sort(([a], [b]) => a.localeCompare(b)));
const key = `app:products:v1:search:${createHash('sha1').update(normalized).digest('hex')}`;
```

Without normalization, `?a=1&b=2` and `?b=2&a=1` are two cache entries for the same result.

## Versioning

The `v1` segment is for **shape changes**. Say you add `category` to the cached product:

- Without a version: new code reads an old cached product without `category` and crashes or renders `undefined` — for up to a full TTL after the deploy.
- With a version: bump to `v2`. New code reads `m01:product:v2:*` (all misses, refilled with the new shape). Old `v1` keys are simply never read again and expire on their own. During a rolling deploy, old and new code run side by side without breaking each other.

Module 4 uses the same idea for invalidation: a version number per entity (or per list) that you increment on write, so every old key becomes unreachable at once.

## Size and count

- Keys and values count against `maxmemory` (64 MB for our `redis-cache`). Cache what you serve, not whole rows with columns you never return.
- Big values (hundreds of KB) are slow to transfer and parse on every hit. Cache smaller pieces or the specific fields you need.
- **Never use `KEYS pattern` in production** — it blocks Redis while it walks every key. Use `SCAN` (Module 0).

## Takeaway

Build every key with one function in the form `app:entity:version:id`, and include everything the value depends on (tenant, user, locale, parameters). When the cached shape changes, bump the version so old entries stop being read and expire on their own.
