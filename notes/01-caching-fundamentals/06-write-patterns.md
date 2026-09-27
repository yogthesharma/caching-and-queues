# Write-through, write-behind, write-around

## Goal

Recognize the other caching patterns by name, know what problem each solves, and know why cache-aside is still the default for a Fastify API.

## The four patterns on one page

| Pattern | On write | On read | Main risk |
|---------|----------|---------|-----------|
| **Cache-aside** | App writes DB, deletes cache key | App: cache → DB on miss → fill | Stale up to TTL if a delete is missed |
| **Write-through** | Write goes to cache **and** DB together, synchronously | Always from the cache | Slower writes; caches data nobody reads |
| **Write-behind** (write-back) | Write goes to cache; DB updated **later**, in batches | From the cache | **Data loss** if the cache dies before flushing |
| **Write-around** | Write goes to DB only; cache not touched | Cache-aside style: fill on miss | First read after a write is a miss |

“Read-through” is cache-aside where a caching library (not your code) loads from the database on a miss. Same behavior, different owner.

## Write-through

```
write(product) → cache.set(product) + db.update(product)  (both, before responding)
```

- **Good:** reads right after a write are hits and fresh.
- **Bad:** every write pays two writes; you cache things that may never be read; keeping the two in sync when one of them fails is your problem.
- **Where you see it:** caching layers built into some databases and ORMs, session stores, “last known state” values (a device’s latest status).

In app code, write-through usually means “after updating the row, `SET` the new value into Redis” — which has the race described in [05-cache-aside.md](./05-cache-aside.md). That’s why we delete instead.

## Write-behind (write-back)

```
write(event) → cache.incr(counter)            (fast, respond)
every 10 s   → flush counters to the database (batch)
```

- **Good:** absorbs huge write rates; the database sees one batched update instead of thousands.
- **Bad:** anything not flushed yet is **lost** if the cache crashes. Readers of the database see old values until the flush.
- **Where you see it:** view counters, likes, analytics events, rate-limit counters, “last seen at” timestamps — numbers where losing a few seconds is acceptable.

Never for orders, payments, or anything you must not lose. (In this repo, a durable version of “do the database write later” is a **queue** — Module 7.)

## Write-around

```
write(product) → db.update(product)   (cache untouched — or its key deleted)
read           → cache-aside
```

- **Good:** writes don’t pollute the cache with data that may never be read (bulk imports, logs, archived rows).
- **Bad:** the first read after a write is always a miss.

Our `PUT /products/:id` is write-around plus deleting the old copy — which is exactly the write half of cache-aside. In practice, “cache-aside” and “write-around + invalidate” describe the same code.

## Choosing

| Situation | Pattern |
|-----------|---------|
| Normal API reads over Postgres | **Cache-aside** |
| Data is read immediately after almost every write, and writes are rare | Write-through (or cache-aside + delete; the next read refills it) |
| Very high-rate counters where a few seconds of loss is fine | Write-behind |
| Bulk writes of data that’s rarely read | Write-around |

## Takeaway

Cache-aside is the default. Write-through keeps the cache warm but costs every write. Write-behind is fast but can lose data, so use it only for counters and analytics. Write-around avoids filling the cache with data nobody reads.
