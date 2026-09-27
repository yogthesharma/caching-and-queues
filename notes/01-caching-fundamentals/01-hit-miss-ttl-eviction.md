# Hit, miss, TTL, eviction

## Goal

Know the four words every caching conversation uses, and be able to estimate whether a cache is worth it from two numbers: hit rate and miss cost.

## Hit, miss, fill

| Term | Meaning |
|------|---------|
| **Hit** | The value is in the cache — return it, skip the slow source |
| **Miss** | The value isn’t there (never stored, expired, or evicted) |
| **Fill** | After a miss, load from the source and store it for next time |

Every read is one of the first two. The fill is what turns the *next* read into a hit.

## Hit rate decides everything

```
hit rate = hits / (hits + misses)
average latency ≈ hit rate × hit cost + (1 − hit rate) × (miss cost + hit cost)
```

The miss still pays for checking the cache first. With Redis (~0.5 ms) in front of a 50 ms query:

| Hit rate | Average latency | Queries reaching Postgres |
|----------|-----------------|---------------------------|
| 0% | ~50.5 ms (worse than no cache) | 100% |
| 50% | ~25.5 ms | 50% |
| 90% | ~5.5 ms | 10% |
| 99% | ~1 ms | 1% |

Two lessons:

- A cache with a low hit rate makes things **slower** — every request pays the lookup and still goes to the database.
- The big win is often database load, not latency: at 99% hit rate, Postgres sees 1 in 100 reads.

Hit rate is high when **many requests ask for the same keys** and the data **changes rarely**. It’s low when every request is unique (search with free text, per-user random data) or the TTL is shorter than the gap between reads.

## TTL (time to live)

A TTL is how long a cached value may be served before it disappears.

- **Absolute TTL:** expires N seconds after it was *written* (`SET key value EX 60`). The default for caching data.
- **Sliding TTL:** the timer resets on every *read* (`GETEX key EX 60`, or `EXPIRE` after each `GET`). Common for sessions (“log out after 30 minutes of inactivity”). Bad for data: a hot key never expires, so it can stay stale forever.

The TTL is your **maximum staleness**. With a 60-second TTL and no other invalidation, users can see data up to 60 seconds old. Pick it by asking “how stale is acceptable?”, not “how long can I get away with?”.

| Data | Reasonable TTL |
|------|----------------|
| Feature flags / config | 10–60 s (or in-process with a short TTL) |
| Product page | 1–10 min, plus delete on update |
| Weather / exchange rate from a third party | 5–30 min |
| Session | Sliding, 30 min–days |
| Stock count at checkout | Don’t cache |

Even when you invalidate on every write (Module 4), **always set a TTL**. It’s the safety net for the invalidation you forgot or the delete that failed.

## Eviction

TTL removes keys that are *old*. Eviction removes keys because the cache is *full*.

Redis evicts when it reaches `maxmemory`, according to `maxmemory-policy`:

| Policy | Evicts | Use for |
|--------|--------|---------|
| `allkeys-lru` | Least recently used key, any key | **Pure cache** — our `redis-cache` |
| `allkeys-lfu` | Least *frequently* used | Cache with a stable set of hot keys |
| `volatile-lru` / `volatile-ttl` | Only keys that have a TTL | Mixed data where TTL-less keys must survive |
| `noeviction` | Nothing — writes fail with an error when full | **Queues / data you can’t lose** — our `redis-queue` |

LRU (“least recently used”) is a good guess at “least likely to be needed next”. Redis’s version is approximate: it samples a few keys and evicts the oldest of the sample, which is close enough and much cheaper.

A useful consequence: in a cache Redis with `allkeys-lru`, **any key can disappear at any time**. Code must treat every read as “might be a miss” — which cache-aside does naturally.

In-process caches evict too: `lru-cache` takes a `max` entry count and drops the least recently used entry when it’s full.

## Takeaway

A cache is only worth its hit rate. The TTL is your maximum staleness and your safety net, so always set one. Eviction means any key can vanish, so code must survive a miss on every read.
