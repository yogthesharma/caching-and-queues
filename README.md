# Caching and Queues

Standalone learning repo. Work here on its own — no other repos required.

**Phase (for your own roadmap):** Backend  
**Primary engine:** Redis (cache, locks, simple queues, pub/sub)  
**Job system:** BullMQ (Redis-backed — the Node-native default)  
**App context:** Node.js + Fastify only (`ioredis` / `redis`, BullMQ). Stay in the JS world for all app and worker code.

## Context

Caches cut latency on hot reads. Queues absorb spikes, decouple slow work from HTTP, and make retries safe. After Postgres, this is the next layer most production Node APIs need: **Redis patterns + background jobs**, practiced end-to-end with Fastify.

This repository is the single place for everything related to **Caching and Queues**: notes, exercises, and small projects. Clone it, open it, and treat it as a complete unit of study.

## Stack (deliberate boundaries)

| Use | Tool | Why |
| --- | --- | --- |
| Cache / counters / locks / pub-sub | **Redis** via Docker | Industry default for Node backends |
| Background jobs | **BullMQ** | First-class Node API; retries, delays, priorities, workers |
| HTTP API | **Fastify** | Same stack as the rest of this full-stack path |
| Source of truth (when needed) | **Postgres** (you already know it) | Cache sits *in front of* the DB — never replaces it |
| In-process cache (optional L1) | **lru-cache** | Microsecond reads before hitting Redis |

**Two Redis instances, on purpose:** `redis-cache` (evicts with `allkeys-lru`) and `redis-queue` (`noeviction`, persistence on). BullMQ can lose jobs if Redis evicts keys, so cache and queue data never share an eviction policy.

**Out of scope for app code:** Python/Go/Java workers, Spring, Celery, etc.  
**Awareness only (not the hands-on path):** Kafka, RabbitMQ, SQS — know *when* teams pick them (Module 5); we implement with Redis + BullMQ.  
**Alternatives worth knowing:** Valkey (drop-in Redis fork after Redis licensing changes), `pg-boss` (Postgres-backed jobs in JS — Module 6).

## Outcomes

When you finish this curriculum, you should be able to:

- Decide **cache vs queue vs just hit Postgres** for a given problem
- Implement cache-aside, TTLs, and safe invalidation in a Fastify read path
- Explain and mitigate stampedes, penetration, and stale-data tradeoffs
- Enqueue work from an HTTP handler and process it in a BullMQ worker
- Design for **at-least-once** delivery (idempotent consumers, retries, dead letters)
- Reason about pub/sub vs durable work queues (and when Redis pub/sub is the wrong tool)

---

## Curriculum

Work top to bottom. Each module → notes in `notes/`, drills in `exercises/`, then apply in `projects/` when noted.

### Module 0 — Setup & mental model

- Latency vs throughput vs decoupling — what cache and queue each buy you
- Sync request path vs async boundary (“return 202, do the work later”)
- Redis via **Docker Compose in this repo only** (cache instance + queue instance)
- Fastify + Node project layout (API process vs worker process)
- When **not** to cache / queue (correctness, tiny data, one-off scripts)

**Best use cases to remember:** hot product pages, session/token lookups, “send email after signup”, report generation, webhook fan-in.

**Checkpoint:** Redis `PING`, Fastify `GET /health`, set/get one key from Node.

---

### Module 1 — Caching fundamentals

- Hit / miss / fill; TTL; eviction (awareness: LRU / volatile-*)
- Cache layers: browser → CDN → app process (L1) → Redis (L2) → Postgres
- HTTP caching: `Cache-Control`, `ETag` / `304 Not Modified`, `Vary`, `private` vs `public`
- Process memory (`lru-cache`) vs Redis — single instance vs shared across replicas; two-tier L1 + L2
- **Cache-aside** (lazy load) — the default pattern in APIs
- Write-through, write-behind, write-around — when each shows up
- Cache key design: namespaces, versions, tenant/user scoping

**Best use cases:** DB query results, rendered fragments, config flags, “user profile by id”; HTTP caching for public, rarely-changing responses (assets, public catalog pages).  
**Avoid caching:** money balances without a clear invalidation story; anything that must be strongly consistent on every read.

**Checkpoint:** Sketch cache-aside for `GET /products/:id` (miss → Postgres → set → return).

---

### Module 2 — Redis as a data structure server

- Strings, hashes, lists, sets, sorted sets — what each is *for*
- Key naming conventions (`app:entity:id:field`)
- TTL: `EXPIRE`, `SET EX`, sliding vs absolute expiry
- Atomic ops: `INCR`, `SET NX`, `GETDEL` mindset
- Pipelines (fewer round trips) vs `MULTI` / `EXEC` (grouped execution) vs Lua scripts (true read-modify-write atomicity)

**Best use cases by structure:**

| Structure | Use |
| --- | --- |
| String | Cached JSON blob, feature flag, mutex token |
| Hash | Object fields (`user:42` → name, email) without re-serializing all |
| List | Simple queue / recent activity (limited) |
| Set | Unique tags, “online user ids” |
| Sorted set | Leaderboards, time-ordered feeds, delayed scores |

**Checkpoint:** Page-view counter with `INCR` + a small leaderboard with sorted sets + one Lua script that increments and reads atomically.

---

### Module 3 — Caching in Fastify (read path)

- Wire `ioredis` (or `redis`) into Fastify (plugin / decorator; close on shutdown)
- Cache-aside with Postgres: miss path, serialize, TTL
- Serialization pitfalls: `Date` comes back as a string, `BigInt` / `numeric` from `pg`, large payloads
- Negative caching: cache “not found” briefly so missing ids don’t hit Postgres every time
- Setting `Cache-Control` / `ETag` from Fastify alongside Redis (different layers, different jobs)
- Measuring: hit / miss counters, timing the miss path

**Best use cases:** public catalog reads, “home feed” aggregates, expensive joins you already profiled.  
**Remember:** measure hit rate; a cache you never hit is just complexity.

**Checkpoint:** Fastify route that is slow without Redis and fast with a warm cache; prove with timings.

---

### Module 4 — Invalidation, consistency & cache failure modes

- Source of truth is still Postgres — cache is a **hint with a TTL**
- TTL-only expiry vs event-driven delete/update on write
- Delete-after-commit ordering (update DB, then `DEL`) and the race that leaves stale data
- Versioned keys vs `DEL` on write
- Multi-key / relational invalidation pain (why “cache the join” is hard)
- Failure modes and their fixes (all in one place):
  - **Stampede / breakdown** (hot key expires, everyone refills) → single-flight lock, probabilistic early refresh
  - **Penetration** (ids that don’t exist) → negative caching, input validation
  - **Avalanche** (many keys expire together) → TTL jitter
  - **Stale reads** → soft TTL / stale-while-revalidate

**Best use cases for explicit invalidation:** admin updates a product → `DEL product:{id}` (+ list keys if you cached lists).  
**Remember:** invalidation is the hard part; prefer short TTL + versioned keys when unsure.

**Checkpoint:** Update a row in Postgres and show the API reflects it without waiting for full TTL (invalidate on write); then load-test an expiring hot key and show single-flight keeps Postgres at one query.

---

### Module 5 — Queues mental model

- Why not do heavy work inside the HTTP handler (timeouts, retries, UX)
- Work queue vs pub/sub vs stream — durable competing consumers vs fan-out
- Delivery: at-most-once, at-least-once, exactly-once (**practical**: design for at-least-once)
- Producer / consumer / broker roles
- Idempotency keys and “process once” as an **app** concern
- The broker landscape (awareness): BullMQ / Redis (Node jobs), RabbitMQ (routing, classic broker), Kafka (event log, replay, huge throughput), SQS (managed, no servers) — when teams outgrow Redis

**Best use cases:** emails, image/PDF processing, webhooks outbound, search indexing, slow reports.  
**Not a queue problem:** needing the result in the same request to show the user immediately (unless you poll / push later).

**Checkpoint:** Take 5 product features and label each: sync, cache, or queue (and why).

---

### Module 6 — Hand-rolled queues (Redis lists, streams & Postgres)

- List pattern: `LPUSH` / `BRPOP` — competing workers; a blocking call needs its own connection
- Limitations: a crashed worker loses its job, no retries/priorities/UI — teaching tool, not the endgame
- Redis Streams: `XADD`, consumer groups, `XACK`, pending entries — durable, replayable (the one place Streams are taught)
- Postgres as a queue: `FOR UPDATE SKIP LOCKED` job table; `pg-boss` as the JS library for it
- When to stop hand-rolling and use BullMQ

**Best use cases:** lists for learning labs; Streams for event logs with history; Postgres queues when you want jobs in the same transaction as your data and don’t want to run Redis.  
**Remember:** production Node apps usually pick **BullMQ** (or a cloud queue) over raw lists.

**Checkpoint:** Two Node workers competing on one Redis list; show only one processes each job. Then do the same with a Postgres `SKIP LOCKED` table.

---

### Module 7 — Background jobs with BullMQ

- Queue, Producer (Fastify), Worker (separate process)
- Connection setup: ioredis with `maxRetriesPerRequest: null` for workers; points at the `noeviction` queue Redis
- Job data, job id, delay, priority, attempts, backoff
- Concurrency and rate-limited workers
- Scheduled & repeating jobs (job schedulers / cron) — nightly reports, cleanups
- Cleanup: `removeOnComplete` / `removeOnFail` so finished jobs don’t fill Redis memory
- Graceful shutdown: `worker.close()` on `SIGTERM` so in-flight jobs finish
- CPU-heavy jobs: sandboxed processors (separate process) so the event loop stays free
- Job progress & results; flows (parent/child jobs) — awareness
- Dashboard awareness (Bull Board) — optional
- Naming queues by domain (`email`, `reports`, `webhooks`)

**Best use cases:** anything you’d put in “Module 5 use cases”, with real retries.  
**Remember:** enqueue in the request; **never** `await` the whole job in the request unless the job is tiny.

**Checkpoint:** `POST /orders` returns fast; a worker logs/sends a fake “order confirmation” with 1 forced retry; a repeating job runs every minute; `Ctrl+C` on the worker finishes the current job before exiting.

---

### Module 8 — Retries, failures & reliability

- Poison messages and max attempts
- Failed-job handling / dead-letter mindset
- Idempotent consumers (unique constraints, “processed_jobs” table, job id)
- The dual-write problem: Postgres commit succeeds but enqueue fails (or the reverse)
- Transactional **outbox** pattern (Postgres write + enqueue without losing jobs)
- Partial failure: cache updated but queue missed (and the reverse)

**Best use cases:** payments side-effects, inventory reservation follow-ups, “notify after commit”.  
**Remember:** at-least-once ⇒ handlers must tolerate duplicates.

**Checkpoint:** Kill the worker mid-job; restart; job retries safely without double side effects (idempotent handler).

---

### Module 9 — Pub/Sub & fan-out

- Redis `PUBLISH` / `SUBSCRIBE` — ephemeral, fire-and-forget
- A subscribed connection can’t run other commands — use a dedicated subscriber client
- Why pub/sub is **not** a work queue (no persistence, no competing-consumer ack)
- Fan-out: “user updated” → invalidate caches (including each instance’s L1 `lru-cache`) / notify sockets
- SSE or WebSocket awareness with Fastify (push after events)
- Choosing: pub/sub (live, lossy) vs Streams from Module 6 (history, consumer groups) vs Postgres `LISTEN/NOTIFY`

**Best use cases:** live UI hints, cache bust signals across API instances, chat presence.  
**Remember:** if a missed message is unacceptable, use a queue/stream — not bare pub/sub.

**Checkpoint:** Two Fastify instances; publish an event; both invalidate the same cache key.

---

### Module 10 — Rate limits, locks & coordination

- Fixed-window, sliding-window (sorted set + Lua), and token-bucket rate limits in Redis
- `@fastify/rate-limit` with a Redis store vs hand-rolled
- Distributed locks: `SET NX EX` with a unique token, safe release via Lua — and **Redlock caveats** (know the criticism)
- Fencing tokens: why a lock alone can’t protect against a paused process
- Idempotency store for POST APIs (`Idempotency-Key` header → stored response)
- When coordination belongs in Postgres instead (row locks you already learned)

**Best use cases:** public API throttling, “only one report generator”, login brute-force counters.  
**Remember:** locks are for short critical sections; don’t hold a lock across slow I/O.

**Checkpoint:** Fastify rate-limit plugin (or hand-rolled) that returns `429` after N requests/minute.

---

### Module 11 — Operations lite (enough to not fear Redis)

- Memory & eviction policies (`maxmemory`, `allkeys-lru`, `noeviction`) — why cache and queue Redis differ
- Persistence awareness: RDB vs AOF (cache can be volatile; queue Redis needs AOF)
- Connections from Node: one shared client for normal commands, plus dedicated connections for blocking commands, subscribers, and BullMQ workers; reconnect behavior
- Metrics that matter: hit rate, queue depth, job lag, failed count
- Security basics: don’t expose Redis to the internet; `requirepass` / ACL awareness

**Checkpoint:** Explain what happens to cache vs BullMQ jobs if Redis restarts with no persistence.

---

### Module 12 — App lab: Fastify + Redis + BullMQ

- End-to-end slice: cached read API + write path that invalidates + async follow-up job
- Separate processes: `api` and `worker`
- Structured logging of job ids; basic failure path
- Testing: real Redis in Docker for tests, flush between tests, test cache hit/miss, wait for job completion in worker tests
- Tie back to Postgres as source of truth

**Checkpoint:** One small product flow (e.g. create post → cache list → worker “notify followers”) you can demo and explain, with at least one automated test for the cache and one for the worker.

---

## Suggested projects (ship at least 2)

1. **Cached catalog API** — Postgres products + Redis cache-aside + invalidate on update
2. **Job pipeline** — Fastify enqueues image/PDF “processing” (simulated); BullMQ retries + failed queue
3. **Rate-limited public API** — Redis counters + clear 429 behavior
4. **Outbox mini** — transactional Postgres outbox → worker publishes jobs reliably
5. **Live invalidate** — pub/sub across two API instances busting the same keys

---

## How to work in this repo

1. Start infra: `cp .env.example .env` then `docker compose up -d --wait`.
2. Read a concept under `notes/<module>/`.
3. Do the **same-named** file under `exercises/<module>/`.
4. Run API/worker with Node; use `redis-cli` via Docker for inspection.
5. Ship projects under `projects/` later.
6. Tick the progress checklist below as you go.

Notes and exercises share paths: `notes/01-caching-fundamentals/...` ↔ `exercises/01-caching-fundamentals/...`.

You do not need any other curriculum repo open while you work here.

## Layout

```
caching-and-queues/
├── README.md                 # Context and curriculum (this file)
├── docker-compose.yml        # redis-cache (6379) + redis-queue (6380)
├── .env.example
├── notes/
│   ├── 00-setup/
│   ├── 01-caching-fundamentals/
│   ├── 02-redis-data-structures/
│   ├── 03-caching-in-fastify/
│   ├── 04-invalidation-consistency/
│   ├── 05-queues-mental-model/
│   ├── 06-hand-rolled-queues/
│   ├── 07-bullmq-jobs/
│   ├── 08-retries-reliability/
│   ├── 09-pubsub-fanout/
│   ├── 10-rate-limits-locks/
│   ├── 11-operations-lite/
│   └── 12-app-lab/
├── exercises/                # Same module/concept filenames as notes/
├── apps/                     # Module checkpoints (Node + Fastify)
│   └── m00-setup/            # Health check + set/get against both Redis instances
└── projects/                 # Optional mini-projects
```

---

## Progress

### Modules

- [ ] 0 — Setup & mental model
- [ ] 1 — Caching fundamentals
- [ ] 2 — Redis data structures
- [ ] 3 — Caching in Fastify
- [ ] 4 — Invalidation, consistency & failure modes
- [ ] 5 — Queues mental model
- [ ] 6 — Hand-rolled queues (lists, streams, Postgres)
- [ ] 7 — BullMQ background jobs
- [ ] 8 — Retries & reliability
- [ ] 9 — Pub/Sub & fan-out
- [ ] 10 — Rate limits & locks
- [ ] 11 — Operations lite
- [ ] 12 — App lab (Fastify + Redis + BullMQ)

### Repo outcomes

- [ ] Core concepts noted under `notes/`
- [ ] Exercises completed under `exercises/`
- [ ] At least two mini-projects shipped under `projects/` (optional)
- [ ] Can explain cache-aside, stampede, at-least-once, and when not to use pub/sub cold

---

## Resources

Keep this list local to this topic; add as you find them.

### Canonical

- [Redis commands / data types](https://redis.io/docs/latest/develop/data-types/) — primary Redis reference
- [BullMQ docs](https://docs.bullmq.io/) — jobs, workers, patterns
- [Fastify docs](https://fastify.dev/docs/latest/) — plugins, decorators
- [ioredis](https://github.com/redis/ioredis) or [node-redis](https://github.com/redis/node-redis)
- [BullMQ: going to production](https://docs.bullmq.io/guide/going-to-production) — `noeviction`, connections, shutdown
- [pg-boss](https://github.com/timgit/pg-boss) — Postgres-backed jobs for Node
- [Valkey](https://valkey.io/) — open-source Redis fork

### Deeper (optional)

- *Designing Data-Intensive Applications* — caching, queues, replication chapters
- Redis persistence and eviction docs (ops module)
- Transactional outbox pattern write-ups (reliability module)

---

_This repo is independent. Progress elsewhere does not block work here._
