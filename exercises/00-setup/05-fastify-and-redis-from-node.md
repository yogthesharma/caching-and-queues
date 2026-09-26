# Exercise: Fastify + Redis from Node

Read: `notes/00-setup/05-fastify-and-redis-from-node.md`

## Tasks

From `apps/m00-setup/`:

1. `npm install`, then `npm run smoke`. Confirm both `PONG`s and both eviction policies print.
2. `npm run dev`, then in another terminal:
   - `curl -i localhost:3000/health` → expect `200`.
   - Store a key with a 30-second TTL via `PUT /kv/greeting`, then read it back with `GET /kv/greeting`.
   - `GET /kv/does-not-exist` → which status code?
   - `PUT /kv/x` with an empty JSON body `{}` → which status code, and who produced that error?
3. Find the key you stored using `redis-cli` (hint: the app prefixes keys). What is its full name?
4. Stop the queue Redis (`docker compose stop redis-queue` from the repo root) and call `/health`. What status and body do you get? Start it again and call `/health` once more — did you need to restart the API?
5. Press `Ctrl+C` on the API. Which log line shows the shutdown was graceful?
6. Answer: why does the API use `maxRetriesPerRequest: 1` instead of the ioredis default?

## Stretch

Add `DELETE /kv/:key` that returns `204` if a key was deleted and `404` if it didn’t exist. (Hint: `DEL` returns how many keys it removed.)

---

## Solutions

2.

```bash
curl -i localhost:3000/health
curl -i -X PUT localhost:3000/kv/greeting \
  -H 'content-type: application/json' \
  -d '{"value":"hi","ttlSeconds":30}'          # 204
curl -s localhost:3000/kv/greeting              # {"key":"greeting","value":"hi","ttlSeconds":30}
curl -i localhost:3000/kv/does-not-exist        # 404
curl -i -X PUT localhost:3000/kv/x \
  -H 'content-type: application/json' -d '{}'  # 400
```

The `400` comes from Fastify’s built-in JSON Schema validation (`FST_ERR_VALIDATION`, “body must have required property 'value'”) — the handler never runs.

3. `m00:kv:greeting`:

```bash
docker compose exec redis-cache redis-cli --scan --pattern 'm00:*'
```

4. `503` with `{"status":"degraded","redisCache":"up","redisQueue":"down"}`. After `docker compose start redis-queue`, `/health` returns `200` again **without** restarting the API — ioredis reconnects automatically.
5. `"signal":"SIGINT","msg":"shutting down"`, then the process exits after Fastify closes and both Redis clients `quit()`.
6. The default (20 retries, with commands queued while disconnected) can make a request hang for a long time when Redis is down. For an HTTP API it’s better to fail fast and return an error; the health check also uses its own 500 ms timeout.

Stretch:

```js
app.delete('/kv/:key', async (request, reply) => {
  const removed = await cache.del(KEY_PREFIX + request.params.key);
  if (removed === 0) {
    reply.code(404);
    return { error: 'not found' };
  }
  reply.code(204);
});
```
