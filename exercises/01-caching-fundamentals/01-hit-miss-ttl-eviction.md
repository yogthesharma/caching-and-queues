# Exercise: Hit, miss, TTL, eviction

Read: `notes/01-caching-fundamentals/01-hit-miss-ttl-eviction.md`

## Tasks

1. Redis answers in 1 ms, the database query takes 80 ms. At an **80%** hit rate, what’s the average latency, and what fraction of reads reach the database? At what hit rate does the cache stop being worth it?
2. With the app running, request products `1`, `1`, `1`, `2`, `2`, `999` (curl or Bruno), then call `GET /stats`. Work out the hit rate yourself and compare it with `hitRate`.
3. In `redis-cli` on `redis-cache`, store `m01:ex:session` with a 20-second TTL. Wait 5 seconds and check its `TTL`. Now read it with `GETEX m01:ex:session EX 20` and check `TTL` again. Which of the two is an **absolute** TTL and which is **sliding**?
4. Pick a TTL (or “don’t cache”) for each, with one sentence of why:
   - a) the list of countries in a signup form
   - b) a product’s price on the product page (the price changes a few times a week)
   - c) “items left in stock” on the checkout button
   - d) a user’s login session
   - e) a USD→INR exchange rate from a paid API
5. Run `CONFIG GET maxmemory-policy` on both Redis instances. For each, what happens when it reaches `maxmemory` and a client runs `SET`?
6. The app deletes the cached product on every update. Why does it still set a 60-second TTL?

## Stretch

Fill `redis-cache` past its 64 MB limit and watch eviction happen:

```bash
docker compose exec redis-cache redis-benchmark -t set -n 200000 -r 1000000 -d 1000 -q
docker compose exec redis-cache redis-cli INFO stats | grep evicted_keys
docker compose exec redis-cache redis-cli INFO memory | grep -E '^used_memory_human|^maxmemory_human'
docker compose exec redis-cache redis-cli DBSIZE
```

How many keys were evicted, and why is `DBSIZE` much smaller than 200,000? Would it be safe to run the same benchmark against `redis-queue`? Clean up afterwards:

```bash
docker compose exec redis-cache sh -c "redis-cli --scan --pattern 'key:*' | xargs -r -n 1000 redis-cli DEL"
```

---

## Solutions

1. `0.8 × 1 + 0.2 × (80 + 1) = 0.8 + 16.2 = 17 ms` on average (vs 80 ms without a cache), and **20%** of reads reach the database. The cache stops paying off near **0%** hits: every miss costs 81 ms instead of 80 ms. In practice the extra code, memory, and staleness aren’t worth it below roughly 50–70%.
2. `1` → MISS, L1, L1; `2` → MISS, L1; `999` → MISS (not found, nothing cached). That’s 3 hits out of 6 lookups = **0.5**. `/stats` shows `l1Hits: 3, misses: 3, hitRate: 0.5`. (If you waited more than 5 seconds between requests for the same id, some hits show as `l2Hits` instead. If `1` or `2` was still in Redis from earlier, its first read is an L2 hit, not a miss.) `dbQueries` counts the misses — 3 here — and resets when the app restarts.
3.

```
SET m01:ex:session user-7 EX 20
TTL m01:ex:session                → 15           (5 seconds later)
GETEX m01:ex:session EX 20        → "user-7"
TTL m01:ex:session                → 20           reset by the read
```

`SET ... EX` alone is **absolute** — the key expires 20 s after it was written, no matter how often it’s read. `GETEX ... EX` on every read makes it **sliding**.

4.
   - a) **Hours or a day** (or in-process). Practically never changes; same for everyone.
   - b) **A few minutes, plus delete on update.** Read constantly, changes rarely; the delete makes changes show up immediately and the TTL catches any missed deletes.
   - c) **Don’t cache** (or at most 1–2 seconds for display only, and check stock for real in the checkout transaction). A stale count oversells.
   - d) **Sliding TTL**, e.g. 30 minutes of inactivity, stored in Redis.
   - e) **5–30 minutes**, one key for everyone. Rates move slowly for display purposes, and the paid API is called once per TTL instead of once per request.
5. `redis-cache` → `allkeys-lru`: Redis evicts the least recently used keys (any key) to make room, and the `SET` succeeds. `redis-queue` → `noeviction`: nothing is removed; the `SET` fails with `OOM command not allowed when used memory > 'maxmemory'`. That’s what you want for job data — an error you can see instead of silently lost jobs.
6. The TTL is the safety net. A delete can be missed (the process crashes between the database write and the `DEL`, Redis is briefly unreachable, someone updates the row directly in `psql`, or a new write path forgets to invalidate). Without a TTL, that stale value would be served **forever**. With it, the worst case is 60 seconds of stale data.

Stretch: in one run, `evicted_keys` was ~130,000, `used_memory_human` ~63.9M against `maxmemory_human` 64.00M, and `DBSIZE` ~60,000. The benchmark wrote ~180k unique 1 KB values (random keys from a range of 1,000,000), but only ~60k fit in 64 MB — Redis evicted the rest, least recently used first. Any real cache keys (like `m00:kv:greeting`) may also have been evicted: in a cache instance, **any key can disappear**. Against `redis-queue`, the writes would start failing with `OOM` errors at 256 MB instead of evicting — and filling it would block BullMQ from adding jobs later. Don’t.
