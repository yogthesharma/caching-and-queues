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
6. Answer: why do the API’s clients use `maxRetriesPerRequest: 1` **and** `enableOfflineQueue: false`? Stop `redis-cache`, wait 10 seconds, and time `curl -w '%{time_total}\n' localhost:3000/kv/greeting`. Then remove the `enableOfflineQueue` option in `src/plugins/redis.js` and time it again. Why doesn’t `smoke.js` use that option? (Put the option back and start Redis afterwards.)
7. While the API is running, run `docker compose exec redis-cache redis-cli CLIENT LIST`. Which line is the API’s connection, and which file set that name?
8. Answer: which file would you change to rename every key from `m00:kv:*` to `demo:kv:*`? Would any route file change?

## Stretch

Add `DELETE /kv/:key` that returns `204` if a key was deleted and `404` if it didn’t exist. (Hint: `DEL` returns how many keys it removed.) Keep the layers: the Redis call goes in `src/redis/kv.js`, the HTTP part in `src/routes/kv.js`.

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
6. While disconnected, ioredis holds commands in its offline queue until a reconnect attempt, and each command gives up only after `maxRetriesPerRequest` failed attempts (default 20). Reconnect attempts back off to 2 seconds apart, so with the defaults a request could hang for a long time. `maxRetriesPerRequest: 1` limits it to one attempt, but that attempt can still be seconds away. With the option removed, the request took **8.7 s** before returning `500` in one run. `enableOfflineQueue: false` rejects commands immediately while disconnected, so the same request fails in ~2 ms. For an HTTP API, a fast error beats a hanging request. The health check also has its own 500 ms timeout. `smoke.js` keeps the offline queue because it sends commands the instant the client is created, before the connection is open; without the queue its first `PING` would be rejected.
7. The line containing `name=m00-api:cache`. The name is passed to `createRedisClient()` in `src/plugins/redis.js`, which sets ioredis’s `connectionName` option in `src/redis/clients.js`.
8. Only `KEY_PREFIX` in `src/redis/kv.js`. No route file changes — routes never see the prefix. (The OpenAPI description in `src/routes/kv.js` mentions it, so you’d update that text too.)

Stretch:

```js
// src/redis/kv.js
export async function deleteValue(redis, key) {
  const removed = await redis.del(kvKey(key));
  return removed > 0;
}
```

```js
// src/routes/kv.js — inside kvRoutes(), and add deleteValue to the import
app.delete('/kv/:key', {
  schema: { summary: 'Delete a key', tags: ['kv'], params: keyParams },
}, async (request, reply) => {
  const deleted = await deleteValue(app.redis.cache, request.params.key);
  if (!deleted) {
    reply.code(404);
    return { error: 'not found' };
  }
  reply.code(204);
});
```
