# m01-caching-fundamentals

Module 1 checkpoint: cache-aside for `GET /products/:id` over two layers — in-process `lru-cache` (L1) and Redis (L2) — in front of a slow "database", plus `ETag` / `Cache-Control` for the browser layer.

```bash
# from repo root
cp .env.example .env
docker compose up -d --wait

cd apps/m01-caching-fundamentals
npm install
npm run demo       # two "replicas" in one script: L1 vs L2, and a stale L1 after an update
npm run dev        # Fastify on http://localhost:3000
npm run reset      # seed data back in the "database", m01:* keys deleted from Redis
```

Stop the Module 0 app first — both use port 3000 (or run this one with `PORT=3001 npm run dev`).

| Route | Does |
|-------|------|
| `GET /health` | Pings `redis-cache`; always `200`, with `status: "degraded"` when Redis is down (reads still work via the database) |
| `GET /products/:id` | L1 → Redis → database. `X-Cache: L1 / L2 / MISS`, plus `ETag` and `Cache-Control`; `304` if `If-None-Match` matches |
| `PUT /products/:id` | Body `{ "name"?: "...", "priceCents"?: 123 }` → updates the database, drops the cached copies |
| `GET /stats` | Hits per layer, misses, hit rate, database query count (this process only) |

The "database" (`src/db/products.js`) is a JSON file (`.data/products.json`, gitignored, created on the first update) with a 150 ms delay per query, so misses are easy to see. It's a file rather than memory so that every process — two API instances, the demo, the reset script — shares one source of truth, just like Postgres would. Edits survive restarts; `npm run reset` undoes them. Module 3 swaps it for real Postgres.

## Code layout

```
src/
├── config.js              # env vars (fails if .env is missing)
├── db/
│   └── products.js        # fake slow "Postgres" (a JSON file) — the source of truth
├── redis/                 # pure Redis code
│   ├── clients.js         # createRedisClient()
│   ├── health.js          # ping() with timeout
│   └── product-cache.js   # key naming (m01:product:v1:<id>), JSON, TTL
├── cache/
│   └── products.js        # createProductService(): cache-aside over L1 + L2 — start here
├── http/
│   └── etag.js            # ETag + If-None-Match check
├── plugins/
│   ├── redis.js           # app.redis.cache, quit on close
│   ├── products.js        # app.products = createProductService(...)
│   └── swagger.js         # OpenAPI + /docs
├── routes/                # HTTP only
│   ├── health.js
│   ├── products.js        # X-Cache, ETag, Cache-Control, 304
│   └── stats.js
├── app.js                 # buildApp()
├── server.js              # listen + SIGINT/SIGTERM
├── demo.js                # two services sharing Redis, no Fastify
└── reset.js               # seed data + delete m01:* keys
```

## API docs

- Swagger UI: <http://localhost:3000/docs>
- OpenAPI JSON (live): <http://localhost:3000/docs/json>
- Saved copy: [`openapi.json`](./openapi.json) — refresh with `npm run openapi` while the server is running
- Bruno requests: `bruno/m01-caching-fundamentals/` at the repo root

Notes: `notes/01-caching-fundamentals/`
