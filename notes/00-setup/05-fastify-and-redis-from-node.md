# Fastify + Redis from Node

## Goal

Connect to both Redis instances from Node with **`ioredis`**, expose a real health check in Fastify, and shut down cleanly.

## The app for this module

`apps/m00-setup/`:

| File | What it shows |
|------|---------------|
| `src/smoke.js` | Plain script: ping both instances, set/get with TTL, read eviction policies |
| `src/server.js` | Fastify API: `GET /health`, `PUT /kv/:key`, `GET /kv/:key`, graceful shutdown |

Run it:

```bash
cd apps/m00-setup
npm install
npm run smoke
npm run dev        # restarts on file changes
```

Scripts use Node’s built-in `--env-file=../../.env`, so there’s no `dotenv` dependency.

## ioredis vs node-redis

| | `ioredis` | `redis` (node-redis) |
|--|-----------|----------------------|
| Used by BullMQ | **Yes** (required) | No |
| Style | `redis.set(k, v, 'EX', 60)` | `client.set(k, v, { EX: 60 })` |
| Reconnect / cluster / sentinel | Built in | Built in |

Both are fine. We use `ioredis` everywhere so the cache code and BullMQ (Module 7) share one library.

## Connecting

```js
import { Redis } from 'ioredis';

const cache = new Redis(process.env.REDIS_CACHE_URL, { maxRetriesPerRequest: 1 });
```

- ioredis connects in the background and **reconnects automatically** if Redis restarts.
- By default, while disconnected it **queues commands** and retries each up to 20 times — a request could hang for a long time. `maxRetriesPerRequest: 1` makes API commands fail fast so Fastify can return an error instead.
- BullMQ workers need the opposite (`maxRetriesPerRequest: null`) — they should wait for Redis to come back. Module 7.
- Always attach an `'error'` listener. Without one, connection errors are printed as unhandled noise.

## One client per process (for now)

Create clients **once at startup** and reuse them in every request — same rule as the `pg` Pool. A Redis client multiplexes many concurrent commands over one connection, so you don’t need a pool for normal commands.

Exceptions that need their **own** connection (coming later):

- Blocking commands like `BRPOP` (Module 6)
- Pub/sub subscribers (Module 9)
- BullMQ workers (Module 7 — BullMQ manages this)

## A real health check

```js
app.get('/health', async (request, reply) => {
  const [cacheStatus, queueStatus] = await Promise.all([ping(cache), ping(queue)]);
  const ok = cacheStatus === 'up' && queueStatus === 'up';
  reply.code(ok ? 200 : 503);
  return { status: ok ? 'ok' : 'degraded', redisCache: cacheStatus, redisQueue: queueStatus };
});
```

- Pings each dependency with a **timeout** (500 ms) so a stuck Redis can’t hang the health check.
- Returns **503** when something is down. Load balancers and Kubernetes use the status code — not the JSON — to stop sending traffic to a broken instance.

Try it: `docker compose stop redis-queue`, hit `/health` (503), `docker compose start redis-queue`, hit it again (200). ioredis reconnects on its own.

## Graceful shutdown

```js
app.addHook('onClose', async () => {
  await Promise.all([cache.quit(), queue.quit()]);
});

process.once('SIGTERM', async () => {
  await app.close();
  process.exit(0);
});
```

- `app.close()` stops accepting new requests, lets in-flight ones finish, then runs `onClose` hooks.
- `quit()` sends Redis a polite `QUIT` after pending commands complete (vs `disconnect()`, which drops immediately).
- Docker and Kubernetes send `SIGTERM` on deploys; `Ctrl+C` sends `SIGINT`. Handle both.

This matters much more for workers (Module 7): a worker killed mid-job without shutdown handling leaves that job half-done.

## Planned layout for bigger apps

```
apps/<module-app>/
├── src/
│   ├── server.js     # Fastify API process
│   ├── worker.js     # Background job process (Modules 6+)
│   └── redis.js      # Shared client factory
└── package.json      # "start:api" and "start:worker" scripts
```

Same codebase, two processes, started and scaled separately.

## Takeaway

Create each ioredis client once, fail fast in the API (`maxRetriesPerRequest: 1`), make `/health` return 503 when a dependency is down, and close connections on `SIGTERM`/`SIGINT`.
