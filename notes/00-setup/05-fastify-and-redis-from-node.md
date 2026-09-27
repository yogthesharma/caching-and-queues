# Fastify + Redis from Node

## Goal

Connect to both Redis instances from Node with **`ioredis`**, expose a real health check in Fastify, shut down cleanly — and keep the Redis code separate from the HTTP code.

## The app for this module

`apps/m00-setup/` is split into layers. Read it in this order:

```
src/
├── config.js            # 1. Reads env vars; fails loudly if .env is missing
├── redis/               # 2. Pure Redis code — no Fastify, no HTTP
│   ├── clients.js       #    createRedisClient(): one place for connection options
│   ├── health.js        #    ping() with a timeout
│   └── kv.js            #    setValue() / getValue(): key naming + TTL logic
├── plugins/             # 3. Fastify wiring
│   ├── redis.js         #    Creates both clients, exposes app.redis, closes them on shutdown
│   └── swagger.js       #    OpenAPI spec + /docs UI
├── routes/              # 4. HTTP only: schemas, status codes, call into redis/
│   ├── health.js        #    GET /health
│   └── kv.js            #    PUT /kv/:key, GET /kv/:key
├── app.js               # 5. buildApp(): registers plugins and routes in order
├── server.js            # 6. Entry point: build, listen, handle SIGINT/SIGTERM
└── smoke.js             #    Standalone script reusing redis/clients.js — no Fastify at all
```

Why split it this way:

| Layer | Knows about | Doesn’t know about |
|-------|-------------|--------------------|
| `redis/` | ioredis, key names, TTLs | HTTP, Fastify, status codes |
| `plugins/redis.js` | Fastify lifecycle (decorate, `onClose`) | What the keys mean |
| `routes/` | HTTP: params, bodies, 200/404/503 | Redis commands, key prefixes |

So when you want to see *what Redis actually does*, open `src/redis/`. When you want to see *what the API returns*, open `src/routes/`. `smoke.js` proves the Redis layer works without any web server. Later modules add a `worker.js` that reuses the same `redis/` code.

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

## Connecting — `src/redis/clients.js`

```js
export function createRedisClient(url, name, logger = console, options = {}) {
  const client = new Redis(url, {
    maxRetriesPerRequest: 1,
    connectionName: name,
    ...options,
  });
  client.on('error', (err) => logger.warn({ err }, `${name} error`));
  return client;
}
```

- ioredis connects in the background and **reconnects automatically** if Redis restarts. Reconnect attempts back off: tens of milliseconds apart at first, growing to 2 seconds.
- While disconnected, ioredis holds commands in an **offline queue** and sends them once it reconnects. Each command gives up after `maxRetriesPerRequest` failed reconnect attempts (default 20). `maxRetriesPerRequest: 1` cuts that down, but a command still waits for the *next* attempt, which can be seconds away. Measured on this app with Redis stopped: `GET /kv` took 0.6 s right after the stop and **8.7 s** a few seconds later.
- To really fail fast, the API’s clients also pass `enableOfflineQueue: false` (in `src/plugins/redis.js`). While disconnected, every command is rejected **immediately**, and the same request fails in ~2 ms with a `500`.
- `smoke.js` keeps the offline queue. It sends its first command before the connection is even open, and the queue is what holds that command until it is. That’s why the options are a parameter of the factory rather than hard-coded.
- BullMQ workers need the opposite (`maxRetriesPerRequest: null`) — they should wait for Redis to come back. Module 7.
- `connectionName` labels the connection inside Redis. Run `docker compose exec redis-cache redis-cli CLIENT LIST` while the API runs and you’ll see `name=m00-api:cache`.
- Always attach an `'error'` listener. Without one, connection errors are printed as unhandled noise.

Why a factory function: every client in the app gets the same options from one place. When BullMQ needs different options in Module 7, you’ll see exactly where and why they differ.

### Missing `.env` — `src/config.js`

If `REDIS_QUEUE_URL` were undefined, `new Redis(undefined)` silently connects to `localhost:6379` — the **cache** instance. Your “queue” data would land in the evicting, non-persistent Redis without any error. `config.js` throws at startup instead: `Missing env var REDIS_CACHE_URL. Copy .env.example to .env at the repo root.`

## One client per process (for now) — `src/plugins/redis.js`

```js
const API_OPTIONS = { enableOfflineQueue: false };

async function redisPlugin(app, { cacheUrl, queueUrl }) {
  const cache = createRedisClient(cacheUrl, 'm00-api:cache', app.log, API_OPTIONS);
  const queue = createRedisClient(queueUrl, 'm00-api:queue', app.log, API_OPTIONS);

  app.decorate('redis', { cache, queue });

  app.addHook('onClose', async () => {
    await Promise.all([cache, queue].map(async (client) => {
      try {
        await client.quit();
      } catch {
        client.disconnect();
      }
    }));
  });
}

export default fp(redisPlugin, { name: 'redis' });
```

Create clients **once at startup** and reuse them in every request — same rule as the `pg` Pool. ioredis sends concurrent commands down one connection without waiting for each reply (pipelining), and Redis answers them in order, so one connection handles many requests at once. You don’t need a pool for normal commands.

Fastify details:

- `app.decorate('redis', …)` attaches the clients to the app, so routes use `app.redis.cache` instead of importing globals.
- Fastify plugins are **encapsulated**: a decoration added inside a plugin is normally visible only inside it. Wrapping with `fastify-plugin` (`fp`) lifts it to the parent, so every route can see `app.redis`.
- The plugin that **creates** the clients also **closes** them. Whoever opens a resource owns shutting it down.
- `quit()` is itself a Redis command (`QUIT`). Without the offline queue it’s rejected while Redis is down, which would crash shutdown, so the hook falls back to `disconnect()` (drop the socket right away).

Exceptions that need their **own** connection (coming later):

- Blocking commands like `BRPOP` (Module 6)
- Pub/sub subscribers (Module 9)
- BullMQ workers (Module 7 — BullMQ manages this)

## Redis operations — `src/redis/kv.js`

```js
const KEY_PREFIX = 'm00:kv:';

export async function setValue(redis, key, value, ttlSeconds) {
  if (ttlSeconds) {
    await redis.set(kvKey(key), value, 'EX', ttlSeconds);
  } else {
    await redis.set(kvKey(key), value);
  }
}
```

- The key prefix lives here and nowhere else. Routes pass `greeting`; only this file knows it becomes `m00:kv:greeting`.
- Functions take the client as a parameter (`redis`) instead of importing it. The same function works with any client — the API’s, a script’s, or a test’s.

## A real health check — `src/redis/health.js` + `src/routes/health.js`

```js
const [redisCache, redisQueue] = await Promise.all([ping(app.redis.cache), ping(app.redis.queue)]);
const ok = redisCache === 'up' && redisQueue === 'up';
reply.code(ok ? 200 : 503);
return { status: ok ? 'ok' : 'degraded', redisCache, redisQueue };
```

- `ping()` races each `PING` against a **timeout** (500 ms) so a stuck Redis can’t hang the health check.
- Returns **503** when something is down. Load balancers and Kubernetes use the status code — not the JSON — to stop sending traffic to a broken instance.

Try it: `docker compose stop redis-queue`, hit `/health` (503), `docker compose start redis-queue`, hit it again (200). ioredis reconnects on its own.

## Graceful shutdown — `src/server.js`

```js
const app = await buildApp(config);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    await app.close();
    process.exit(0);
  });
}
```

- `app.close()` stops accepting new requests, lets in-flight ones finish, then runs `onClose` hooks — including the Redis plugin’s `quit()`.
- `quit()` sends Redis a polite `QUIT` after pending commands complete (vs `disconnect()`, which drops immediately).
- Docker and Kubernetes send `SIGTERM` on deploys; `Ctrl+C` sends `SIGINT`. Handle both.

`buildApp()` lives in `app.js`, separate from `listen()` in `server.js`. That lets tests build the app and send fake requests without opening a port (Module 12).

This matters much more for workers (Module 7): a worker killed mid-job without shutdown handling leaves that job half-done.

## Takeaway

Keep Redis code in `redis/`, Fastify wiring in `plugins/`, and HTTP in `routes/`. Create each ioredis client once through a factory, fail fast in the API (`enableOfflineQueue: false` plus `maxRetriesPerRequest: 1`), make `/health` return 503 when a dependency is down, and close connections on `SIGTERM`/`SIGINT`.
