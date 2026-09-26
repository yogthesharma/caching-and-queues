# Docker Redis (two instances)

## Goal

Run Redis **only in Docker** via Compose in this repo — and understand why we run **two** of them.

## Files in this repo

| File | Role |
|------|------|
| `docker-compose.yml` | Defines `redis-cache` and `redis-queue` |
| `.env.example` | Copy to `.env` for ports and `REDIS_*_URL` |

## First-time setup

From the **repo root**:

```bash
cp .env.example .env
docker compose up -d --wait
docker compose ps
```

Both services should show `(healthy)`. Then:

```bash
docker compose exec redis-cache redis-cli PING
docker compose exec redis-queue redis-cli PING
```

Both should answer `PONG`.

## Why two Redis instances?

A cache and a queue want **opposite** behavior when memory runs out:

| | `redis-cache` (port 6379) | `redis-queue` (port 6380) |
|--|---------------------------|---------------------------|
| `maxmemory` | `64mb` (small on purpose, so you can watch eviction later) | `256mb` |
| `maxmemory-policy` | `allkeys-lru` — evict least-recently-used keys | `noeviction` — refuse writes (`OOM` error) instead of deleting |
| Persistence | Off (`save ""`, `appendonly no`) | AOF on (`appendonly yes`), data in a volume |
| If Redis restarts | Cache is empty → app refills from Postgres. Fine. | Jobs survive. Required. |

Two details that are easy to get wrong:

- **An eviction policy only applies once `maxmemory` is set.** With the default `maxmemory 0` (no limit), Redis never evicts *or* refuses writes — it grows until the operating system kills it. That’s why the queue instance has a limit too.
- **AOF with the default `appendfsync everysec`** flushes to disk once per second. A clean restart loses nothing, but a hard crash (power loss, `kill -9`) can lose up to about one second of writes. `appendfsync always` closes that gap at a large speed cost; most teams accept `everysec`.

- Losing a **cache** key is normal: the next read misses and refills from Postgres.
- Losing a **queue** key means a job (an email, a payment follow-up) silently never runs. BullMQ’s production guide says to use `noeviction` for this reason, and BullMQ logs a warning at startup if the policy is anything else.

If both lived in one Redis with `allkeys-lru`, a burst of cache writes could evict your pending jobs. In production, teams usually run separate instances (or separate managed databases) for the same reason.

## Useful commands

```bash
# Start / stop
docker compose up -d --wait
docker compose down          # stop & remove containers; keeps the queue volume
docker compose down -v       # ALSO deletes the queue volume (all jobs gone)

# Logs
docker compose logs -f redis-queue

# Interactive redis-cli
docker compose exec redis-cache redis-cli
docker compose exec redis-queue redis-cli

# Check the config that matters
docker compose exec redis-cache redis-cli CONFIG GET maxmemory-policy
```

## Connection from the host (Node)

```
REDIS_CACHE_URL=redis://localhost:6379
REDIS_QUEUE_URL=redis://localhost:6380
```

Format: `redis://[user:password@]host:port[/db]`. Use `rediss://` (two s’s) for TLS, which most managed Redis services require.

## About Redis versions and Valkey

We use the official `redis:8-alpine` image. In 2024 Redis moved away from its open-source license, and the Linux Foundation started **Valkey** as a fork. Redis 8 (2025) added an open-source option again (AGPLv3). Both speak the same protocol, so `ioredis` and BullMQ work with either. Some cloud providers (e.g. AWS ElastiCache) now steer new users toward Valkey — nothing in this curriculum changes.

## Security note

The official Redis image turns **protected mode off** and has **no password**, so anyone who can reach the port can read, change, or wipe everything. On Linux, Docker’s published ports also bypass your firewall rules.

That’s why our Compose file publishes ports as `127.0.0.1:6379:6379` — reachable from your own machine only, not from other devices on your Wi-Fi. A plain `"6379:6379"` would listen on every network interface.

In any real deployment: keep Redis on a private network, set a password or ACL users, and use TLS. Open Redis servers are scanned for and attacked constantly.

## Takeaway

`docker compose up -d --wait` gives you a disposable cache Redis (evicts, no persistence) and a durable queue Redis (never evicts, AOF on), both reachable only from your machine. Cache data is allowed to disappear; queue data is not.
