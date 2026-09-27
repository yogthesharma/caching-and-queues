# HTTP caching

## Goal

Tell browsers and CDNs what they may cache and for how long, using headers — and know the difference between **skipping a request** (`Cache-Control`) and **skipping a download** (`ETag` / `304`).

## Two mechanisms

| Mechanism | Header(s) | What it saves |
|-----------|-----------|---------------|
| **Freshness** | `Cache-Control: max-age=N` | The whole request. The browser doesn’t contact you for N seconds |
| **Revalidation** | `ETag` + `If-None-Match` → `304` | The response body. The browser asks “still the same?” and you answer “yes” with no body |

They work together: fresh → use the copy with no request; stale → revalidate; changed → full `200`.

## `Cache-Control`

Set on the **response**:

| Directive | Meaning |
|-----------|---------|
| `max-age=60` | Any cache may reuse this for 60 s without asking |
| `s-maxage=300` | Shared caches (CDN, proxy) use this instead of `max-age` |
| `public` | Shared caches may store it, even for requests with auth |
| `private` | Only the user’s browser may store it — never a CDN |
| `no-cache` | May be stored, but must be **revalidated every time** before use (misleading name) |
| `no-store` | Don’t store it anywhere. For truly sensitive responses |
| `stale-while-revalidate=30` | After it goes stale, serve the old copy for up to 30 s while refreshing in the background |

Common combinations:

```
Cache-Control: public, max-age=31536000, immutable   # hashed assets (app.3f9a1c.js)
Cache-Control: public, max-age=10, s-maxage=300      # public catalog page
Cache-Control: private, max-age=0, no-cache          # "my account" page: store, but always check
Cache-Control: no-store                              # bank statement, one-time tokens
```

**The danger:** `public` on a per-user response. A CDN will store Alice’s `/me` response and serve it to Bob. If the response depends on who is asking, use `private` (or `no-store`).

**The other danger:** a long `max-age` can’t be taken back. You can’t delete something from a user’s browser. Keep `max-age` short for anything that can change, and use versioned URLs for things that should be cached forever.

## `ETag` and `304 Not Modified`

1. Server sends `ETag: "abc123"` — a fingerprint of the response body.
2. When its copy goes stale, the browser sends `If-None-Match: "abc123"`.
3. If the current fingerprint still matches, the server responds `304 Not Modified` with **no body**. Otherwise `200` with the new body and a new ETag.

From the app (`src/http/etag.js` and `src/routes/products.js`):

```js
const etag = etagFor(found);                  // hash of the JSON body
reply.header('etag', etag);
reply.header('cache-control', 'public, max-age=10');

if (isFresh(request, etag)) {                 // If-None-Match matched
  return reply.code(304).send();
}
return found;
```

What a `304` does and doesn’t save:

- **Saves:** bandwidth and the time to download and parse the body. Big win for large responses and slow mobile networks.
- **Doesn’t save:** server work. We still looked up the product to compute the ETag. That’s why the application cache (Redis) and the HTTP cache are *different jobs*: Redis makes computing the answer cheap; `ETag` makes sending it cheap.

`W/"..."` is a **weak** ETag: “semantically the same” (e.g. the same content re-compressed). Fine for `If-None-Match`. `@fastify/etag` can generate ETags for every route; we write it by hand here to see how it works.

`Last-Modified` + `If-Modified-Since` is the older, timestamp-based version of the same idea. It only has 1-second precision; prefer ETags.

## `Vary`

A cache stores responses **by URL**. If your response changes based on a request header, say so, or the cache will serve the wrong variant:

```
Vary: Accept-Encoding      # gzip vs br vs plain — servers/CDNs usually add this
Vary: Accept-Language      # /products/1 in English vs Hindi
```

`Vary: Authorization` or `Vary: Cookie` technically works for per-user responses but kills the shared-cache hit rate — use `private` instead.

## Try it

```bash
curl -i localhost:3000/products/1                                   # note the ETag
curl -i -H 'If-None-Match: "<paste the etag>"' localhost:3000/products/1   # 304, empty body
```

In a browser, open `http://localhost:3000/docs`, then DevTools → Console, and run `await fetch('/products/1')` twice within 10 s. The Network tab shows the second one as `(disk cache)` / `(memory cache)`: the request never reached the server, and no log line appears. (Pressing reload doesn’t show this: a reload deliberately revalidates the page, so you get a `304` instead.)

## Takeaway

`Cache-Control` decides who may store a response and for how long. `ETag` + `304` avoid re-sending an unchanged body. Use `private` for per-user responses and short `max-age` for anything that can change. HTTP caching and Redis solve different problems and you’ll often use both.
