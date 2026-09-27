# Module 1 — Caching fundamentals

The vocabulary and patterns every later module builds on: what a hit and a miss cost, where caches live, how HTTP caching works, and why **cache-aside** is the default in APIs.

| # | Concept | Notes | Exercises |
|---|---------|-------|-----------|
| 01 | Hit, miss, TTL, eviction | [01-hit-miss-ttl-eviction.md](./01-hit-miss-ttl-eviction.md) | matching under `exercises/01-caching-fundamentals/` |
| 02 | Cache layers | [02-cache-layers.md](./02-cache-layers.md) | matching |
| 03 | HTTP caching | [03-http-caching.md](./03-http-caching.md) | matching |
| 04 | In-process (L1) vs Redis (L2) | [04-in-process-vs-redis.md](./04-in-process-vs-redis.md) | matching |
| 05 | Cache-aside | [05-cache-aside.md](./05-cache-aside.md) | matching |
| 06 | Write-through, write-behind, write-around | [06-write-patterns.md](./06-write-patterns.md) | matching |
| 07 | Cache key design | [07-cache-key-design.md](./07-cache-key-design.md) | matching |

App: `apps/m01-caching-fundamentals` — `GET /products/:id` through L1 → Redis → a slow fake database, with `ETag` / `Cache-Control`.

**Checkpoint:** Sketch cache-aside for `GET /products/:id` (miss → database → set → return), then run the app and show a `MISS` followed by `L1`, and a `304` for a conditional request.
