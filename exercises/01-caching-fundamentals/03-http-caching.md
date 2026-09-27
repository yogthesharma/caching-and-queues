# Exercise: HTTP caching

Read: `notes/01-caching-fundamentals/03-http-caching.md`

## Tasks

With the app running:

1. `curl -i localhost:3000/products/1`. Write down the `ETag`, `Cache-Control`, and `X-Cache` headers.
2. Send the same request with `If-None-Match` set to that ETag. What status do you get, and how big is the body? Does the response still have an `X-Cache` header — and what does that tell you about server work?
3. Update the product’s price with `PUT /products/1`, then repeat the conditional request from task 2 with the **old** ETag. What happens, and why?
4. What does `max-age=10` mean for the browser in practice? Why is it `public`, and what would go wrong if a `GET /me` route used the same header?
5. Pick the right `Cache-Control` for each:
   - a) `app.4f2c9a.css`
   - b) `GET /me/profile`
   - c) A page showing a one-time password reset token
   - d) `GET /products/42` behind a CDN: browsers should re-check after 10 s, the CDN may keep it 5 minutes
6. `/products/1` returns the same JSON whether you ask in English or Hindi today. Next month it starts returning a translated `name` based on `Accept-Language`. Which response header must you add, and what goes wrong without it?

## Stretch

`isFresh()` in `src/http/etag.js` handles `W/` prefixes, a comma-separated list, and `*`. Send a request with `If-None-Match: "nope", W/<the current etag>` and confirm you get a `304`. Why would a client or proxy send more than one ETag?

---

## Solutions

1. Something like:

```
etag: "bggvWNfnLxg0puHZ"
cache-control: public, max-age=10
x-cache: MISS          (L1 or L2 on repeat requests)
```

2.

```bash
curl -i -H 'If-None-Match: "bggvWNfnLxg0puHZ"' localhost:3000/products/1
```

`304 Not Modified` with an **empty body** (`content-length` absent or 0). The response still has `x-cache: L1` — the server looked the product up to compute the ETag. A 304 saves **bandwidth**, not server work; making that lookup cheap is Redis’s job.

3.

```bash
curl -s -X PUT localhost:3000/products/1 -H 'content-type: application/json' -d '{"priceCents":6999}'
curl -i -H 'If-None-Match: "bggvWNfnLxg0puHZ"' localhost:3000/products/1
```

`200` with the full new body and a **new** ETag (and `x-cache: MISS`, because the update dropped the cached copies). The ETag is a hash of the body; the price and `updatedAt` changed, so the hash changed and the old ETag no longer matches.

4. For 10 seconds after receiving it, the browser (and any CDN) may reuse the response **without contacting the server**. After that it revalidates with `If-None-Match`. `public` allows shared caches like CDNs to store it — fine because every user gets the same product JSON. On `GET /me`, a CDN would store the first user’s profile and serve it to everyone else requesting `/me`. Per-user responses need `private` (or `no-store`).
5.
   - a) `public, max-age=31536000, immutable` — the hash in the filename changes when the content does.
   - b) `private, no-cache` — the browser may store it but must revalidate every time (pair with an `ETag` so that’s cheap). Or `private, max-age=0`.
   - c) `no-store` — never written to any cache, including the browser’s disk.
   - d) `public, max-age=10, s-maxage=300` — `s-maxage` applies to shared caches only.
6. `Vary: Accept-Language`. HTTP caches key responses by URL, so without it the CDN (or browser) would store the first language it saw and serve it to everyone, e.g. Hindi names for English users.

Stretch:

```bash
ETAG=$(curl -s -D - -o /dev/null localhost:3000/products/1 | grep -i '^etag' | cut -d' ' -f2 | tr -d '\r')
curl -i -H "If-None-Match: \"nope\", W/$ETAG" localhost:3000/products/1     # 304
```

A cache (proxy or CDN) that holds several stored versions of the same URL can send all their ETags at once: “I have any of these — tell me which one is still good.”
