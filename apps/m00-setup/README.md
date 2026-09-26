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

Notes: `notes/00-setup/05-fastify-and-redis-from-node.md`
