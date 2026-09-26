# Why cache, why queue

## Goal

Know which problem each tool solves, so you reach for a cache or a queue because of a real symptom — not because “scalable apps use Redis”.

## Three different problems

| Symptom | Tool | What it buys you | What it costs |
|---------|------|------------------|---------------|
| Reads are slow or hammer the DB | **Cache** | Lower latency, less DB load | Data can be **stale**; invalidation work |
| Work is slow, flaky, or spiky | **Queue** | Fast responses, retries, smoothing spikes | Result arrives **later**; more moving parts |
| One part of the system must not wait on another | **Queue** (or pub/sub) | **Decoupling** — producer doesn’t care who consumes | Harder to trace a request end-to-end |

Short version:

- A **cache trades freshness for speed.**
- A **queue trades immediacy for reliability and smoothness.**

## Rough latency ladder (ballpark, same data center)

| Where the data comes from | Typical time |
|---------------------------|--------------|
| In-process memory (a JS `Map`, `lru-cache`) | nanoseconds to microseconds |
| Redis over the network | ~0.2–1 ms |
| Postgres, indexed single-row lookup | ~1–5 ms |
| Postgres, heavy join / aggregate | 50 ms to seconds |
| Third-party HTTP API (email, payments) | 100 ms to seconds, sometimes fails |

Caching pays off when you skip a *slow rung* many times. Queuing pays off when a slow or unreliable rung (third-party APIs, big computations) doesn’t need to be inside the user’s request.

## Throughput and spikes

A queue is a buffer. If 5,000 image uploads arrive in one minute but your workers handle 500/minute, the queue holds the backlog and workers drain it over ~10 minutes. Without a queue, those 5,000 requests all compete for CPU at once and many time out.

Caches help throughput differently: every cache hit is a query Postgres never sees, so the same database serves more users.

## When NOT to cache

- The data must be exactly current on every read: account balances, stock count at checkout, permissions right after revocation.
- The query is already fast (a primary-key lookup in Postgres is ~1 ms — Redis saves almost nothing and adds invalidation bugs).
- The data is different for almost every request (low hit rate = pure overhead).
- Traffic is low. Caching a page viewed 10 times a day is complexity without benefit.

## When NOT to queue

- The user needs the result **in this response** (login, “is this username taken?”, search results).
- The work is tiny and reliable (a single fast insert). Adding a queue adds latency and failure modes.
- One-off scripts and migrations — just run them.

## Best use cases to remember

| Use case | Tool | Why |
|----------|------|-----|
| Product page viewed 10k×/min, changes daily | Cache | Same answer, many readers |
| Session / token lookup on every request | Cache | Hot, small, read-heavy |
| Feature flags / app config | Cache (often in-process) | Read constantly, changes rarely |
| “Send welcome email after signup” | Queue | Slow third party; retry if it fails |
| Generate monthly PDF report | Queue | Seconds of CPU; user can be notified later |
| Resize uploaded images | Queue | CPU-heavy, spiky |
| Receive 1,000 webhooks/sec from Stripe | Queue | Acknowledge fast, process at your own pace |
| Tell all API instances “product 42 changed” | Pub/sub | Fan-out signal, fine if one is missed (TTL covers it) |

## Decision questions

1. Does the user need the result right now? **No** → consider a queue.
2. Is the same data read far more often than it changes? **Yes** → consider a cache.
3. Would stale data for N seconds hurt anyone? **Yes** → don’t cache it (or keep N tiny and invalidate on write).
4. Is the current approach actually slow? Measure first. **No** → do nothing.

## Takeaway

Cache = speed at the cost of freshness. Queue = reliability and smoothing at the cost of “later”. Postgres stays the source of truth for both.
