# Module 0 — Setup & mental model

Understand what caches and queues are *for*, run Redis in Docker, and talk to it from Node + Fastify.

| # | Concept | Notes | Exercises |
|---|---------|-------|-----------|
| 01 | Why cache, why queue | [01-why-cache-and-queue.md](./01-why-cache-and-queue.md) | matching under `exercises/00-setup/` |
| 02 | Sync vs async boundary | [02-sync-vs-async-boundary.md](./02-sync-vs-async-boundary.md) | matching |
| 03 | Docker Redis (two instances) | [03-docker-redis.md](./03-docker-redis.md) | matching |
| 04 | redis-cli essentials | [04-redis-cli-essentials.md](./04-redis-cli-essentials.md) | matching |
| 05 | Fastify + Redis from Node | [05-fastify-and-redis-from-node.md](./05-fastify-and-redis-from-node.md) | matching |

**Checkpoint:** Redis `PING` on both instances, Fastify `GET /health` returns 200, set/get one key from Node (`apps/m00-setup`).
