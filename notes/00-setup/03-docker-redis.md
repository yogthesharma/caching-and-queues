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
| `maxmemory` | `64mb` (small on purpose, so you can watch eviction later) | unlimited (container memory) |
| `maxmemory-policy` | `allkeys-lru` — evict least-recently-used keys | `noeviction` — refuse writes instead of deleting |
| Persistence | Off (`save ""`, `appendonly no`) | AOF on (`appendonly yes`), data in a volume |
| If Redis restarts | Cache is empty → app refills from Postgres. Fine. | Jobs survive. Required. |

- Losing a **cache** key is normal: the next read misses and refills from Postgres.
- Losing a **queue** key means a job (an email, a payment follow-up) silently never runs. BullMQ’s docs explicitly require `noeviction` for this reason.

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

Format: `redis://[user:password@]host:port[/db]`. Use `rediss://` (two s’s) for TLS, which managed Redis services require.

## About Redis versions and Valkey

We use the official `redis:8-alpine` image. Valkey is a Linux Foundation fork created after Redis changed its license in 2024; it speaks the same protocol, so `ioredis` and BullMQ work with either. Some cloud providers now offer Valkey by default — nothing in this curriculum changes.

## Security note

Compose publishes these ports on your machine for learning. Never expose Redis to the internet without a password/ACL and TLS — an open Redis is one of the most commonly attacked services.

## Takeaway

`docker compose up -d --wait` gives you a disposable cache Redis (evicts, no persistence) and a durable queue Redis (never evicts, AOF on). Cache data is allowed to disappear; queue data is not.
