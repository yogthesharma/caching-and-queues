# m00-setup

Module 0 checkpoint: Node + Fastify talking to both Redis instances.

```bash
# from repo root
cp .env.example .env
docker compose up -d --wait

cd apps/m00-setup
npm install
npm run smoke      # ping both, set/get with TTL, print eviction policies
npm run dev        # Fastify on http://localhost:3000
```

| Route | Does |
|-------|------|
| `GET /health` | Pings both Redis instances; `200` if both up, `503` otherwise |
| `PUT /kv/:key` | Body `{ "value": "...", "ttlSeconds": 30 }` → stores in `redis-cache` |
| `GET /kv/:key` | Returns value + remaining TTL, or `404` |

## Code layout

```
src/
├── config.js          # env vars (fails if .env is missing)
├── redis/             # pure Redis code — start here
│   ├── clients.js     # createRedisClient(): connection options in one place
│   ├── health.js      # ping() with timeout
│   └── kv.js          # setValue() / getValue(): key prefix + TTL
├── plugins/
│   ├── redis.js       # creates clients → app.redis, quits them on close
│   └── swagger.js     # OpenAPI + /docs
├── routes/            # HTTP only; calls into redis/
│   ├── health.js
│   └── kv.js
├── app.js             # buildApp(): plugins + routes
├── server.js          # listen + SIGINT/SIGTERM
└── smoke.js           # script using redis/ without Fastify
```

## API docs

- Swagger UI: <http://localhost:3000/docs>
- OpenAPI JSON (live, generated from the route schemas): <http://localhost:3000/docs/json>
- Saved copy: [`openapi.json`](./openapi.json) — refresh with `npm run openapi` while the server is running
- Bruno requests: `bruno/m00-setup/` at the repo root

Notes: `notes/00-setup/05-fastify-and-redis-from-node.md`
