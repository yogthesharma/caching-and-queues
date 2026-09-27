# Cache layers

## Goal

See the whole path a request travels, know which caches sit on it, and know which ones **you** can invalidate.

## The path

```
Browser cache ──► CDN ──► (reverse proxy) ──► App process memory (L1) ──► Redis (L2) ──► Postgres
   per user        shared,        shared          per process               shared           source of truth
                   per region
```

Each layer can answer the request and stop it from going further. The further left the answer comes from, the faster it is and the less work your servers do — but the **harder it is to take back**.

| Layer | Who shares it | Typical hit cost | Can you delete an entry? |
|-------|---------------|------------------|---------------------------|
| Browser | One user | 0 ms (no network) | **No.** You can only wait for `max-age` to run out |
| CDN (Cloudflare, CloudFront) | Everyone near one edge | 5–30 ms | Yes, via a purge API (seconds to propagate) |
| App memory (`lru-cache`) | One process | microseconds | Only in *that* process |
| Redis | Every app process | ~0.5 ms | Yes, `DEL` — instantly visible to everyone |
| Postgres | — | 1 ms to seconds | It *is* the data |

## Two kinds of layers

- **HTTP caches** (browser, CDN, proxy) cache *responses*. You control them with response headers (`Cache-Control`, `ETag`) — covered in [03-http-caching.md](./03-http-caching.md). Your code never sees the requests they answer.
- **Application caches** (L1 memory, Redis) cache *data* inside your code. You decide exactly what goes in and when it leaves — covered in [04-in-process-vs-redis.md](./04-in-process-vs-redis.md) and [05-cache-aside.md](./05-cache-aside.md).

A single request can use both: the app fetches the product from Redis (application cache), then sets `Cache-Control: max-age=10` so the browser reuses the response for 10 seconds (HTTP cache).

## Staleness adds up

Every layer adds its own TTL on top of the one behind it. If Redis holds a product for 60 s and the browser may reuse the response for 60 s, a user can see data up to **120 s** old — Redis refilled just before the change, then the browser cached that stale response just before Redis expired.

So the layers closest to the user get the **shortest** TTLs, especially the ones you can’t invalidate:

| Layer | Example TTL for a product page |
|-------|--------------------------------|
| Browser (`max-age`) | 0–30 s |
| CDN (`s-maxage`) | 1–5 min, purged on update |
| L1 in-process | 5–30 s |
| Redis | 5–10 min, deleted on update |

## What goes where

| Data | Best layer | Why |
|------|------------|-----|
| JS/CSS bundles with a hash in the filename | Browser + CDN, one year | The URL changes when the content does, so it never needs invalidating |
| Public catalog page | CDN + Redis | Same for everyone; CDN absorbs traffic spikes |
| “My orders” page | Redis (per-user key), browser `private` | Per user — must never be stored in a shared CDN |
| Feature flags | L1 | Read on every request, tiny, changes rarely |
| Product by id inside the API | L1 + Redis | Hot, shared across replicas |

## Takeaway

Caches stack up from the browser to Redis. Layers nearer the user are faster and harder to invalidate, and their TTLs add up, so give them the shortest TTLs. Only Redis gives you an instant, global delete.
