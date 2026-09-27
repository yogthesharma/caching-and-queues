# Exercise: Cache layers

Read: `notes/01-caching-fundamentals/02-cache-layers.md`

## Tasks

1. List the cache layers between a user’s browser and Postgres, from nearest to the user to farthest. For each, say whether **you** can delete a single entry from it on demand.
2. A product is cached in Redis for 5 minutes, and the API sends `Cache-Control: public, max-age=300`. An admin changes the price and the API deletes the Redis key immediately. What is the **longest** time a user might still see the old price? Why?
3. Fix the TTLs from task 2 so the worst case is about 1 minute, without giving up the Redis cache.
4. For each piece of data, pick the layer(s) you’d use and a rough TTL:
   - a) `app.4f2c9a.js` (hashed JS bundle)
   - b) `GET /products/42` on a public e-commerce site
   - c) `GET /me/orders`
   - d) The feature-flag config the API reads on every request
   - e) The “top 10 trending products” list, recomputed from a heavy query
5. Which layer is the only one that gives an **instant** delete visible to every API process?

## Stretch

With the app running, open `http://localhost:3000/docs` in your browser, open DevTools (Network tab), and in the Console run `await fetch('/products/1')` three times: twice within 10 seconds, then once more after 15 seconds. What do the Status / Size columns show each time, and which requests did the server actually receive? (Check the app’s log output.) Then reload the `/products/1` page itself a few times — why does that behave differently?

---

## Solutions

1. Browser (**no** — you can only wait for `max-age`), CDN (**yes**, via its purge API, takes seconds), reverse proxy if you have one (usually yes, it’s yours), in-process L1 (**only inside that one process**), Redis (**yes**, `DEL`, visible to all processes at once), then Postgres (the source of truth, not a cache).
2. Normally **5 minutes**, from the browser. Deleting the Redis key doesn’t reach the browser: if it fetched the page just before the price change, it keeps using that copy for its full `max-age=300`. In a rare race it can reach **~10 minutes**. A reader loads the old row from the database just before the update commits. The update then deletes the key, and *after that* the slow reader writes the old row back into Redis. Redis now serves the old price for up to 5 minutes, and a browser that caches one of those responses near the end adds another 5. (Module 4 covers this race.)
3. Keep Redis at 5 minutes (it’s deleted on update, so its TTL is only a safety net) and cut the browser to `max-age=30`–`60`. With the delete, Redis serves fresh data right after the update, so the browser’s `max-age` becomes the real worst case. Add `ETag` so revalidation after expiry is cheap.
4.
   - a) **Browser + CDN, one year** (`public, max-age=31536000, immutable`). The filename changes when the content does, so it never needs invalidating.
   - b) **CDN (short, purged on update) + Redis (minutes, deleted on update)**, browser `max-age` of a few seconds to a minute.
   - c) **Redis with a per-user key** (short TTL, deleted when that user places an order), `Cache-Control: private`. Never a shared CDN.
   - d) **In-process L1**, 10–60 s. Tiny, read constantly, changes rarely; a Redis round trip on every request is wasteful.
   - e) **Redis**, a few minutes, one key shared by all processes (optionally a short L1 on top). Recomputing it per process or per request would repeat the heavy query.
5. **Redis.** L1 deletes only affect one process; CDN purges take time to propagate; browsers can’t be purged at all.

Stretch: the first fetch shows `200` with a real size, and the server logs the request. The second, within 10 s, shows `(disk cache)` or `(memory cache)` and **no** new log line: the browser answered it itself because of `max-age=10`. After 15 s the copy is stale, so the browser sends `If-None-Match` and gets a `304` (the server was hit, but no body was sent), or a `200` if the product changed. You’ll see a new log line but only a tiny transfer size. Reloading the page is different: a reload deliberately revalidates the page even while it’s fresh, so every reload reaches the server (usually as a `304`).
