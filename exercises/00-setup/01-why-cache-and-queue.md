# Exercise: Why cache, why queue

Read: `notes/00-setup/01-why-cache-and-queue.md`

## Tasks

For each scenario, answer **cache**, **queue**, **both**, or **neither**, with one sentence of why.

1. A blog’s home page lists the 20 latest posts. 50,000 views/hour, a new post twice a day.
2. `GET /me/balance` in a banking app.
3. After a user uploads a profile picture, generate 3 thumbnail sizes.
4. `GET /users/:id` by primary key on an internal admin tool used by 5 people.
5. An e-commerce checkout sends an order confirmation email and updates a sales dashboard.
6. A weather widget calls a paid third-party API that allows 1,000 requests/day; your site gets 200,000 views/day.
7. `GET /search?q=...` over 2 million products with free-text queries.
8. Stripe sends payment webhooks; your handler updates orders and sends receipts. Stripe retries if you take longer than a few seconds.

## Stretch

Pick an app you use daily (Instagram, Swiggy, YouTube…). List two things it almost certainly caches and two things it almost certainly queues.

---

## Solutions

1. **Cache.** Same answer for everyone, read ~25,000× between changes; a TTL of a minute or two (or invalidate on publish) is harmless.
2. **Neither.** A balance must be exactly current; it’s a fast indexed query anyway. Caching risks showing money that isn’t there.
3. **Queue.** CPU-heavy, the user doesn’t need all sizes in the upload response, and retries are useful.
4. **Neither.** Primary-key lookups are ~1 ms and traffic is tiny — a cache adds invalidation bugs for no gain.
5. **Queue** (both side effects). The order insert is sync; email and dashboard updates can happen seconds later and should retry on failure.
6. **Cache.** Weather changes slowly; cache per city for ~10–30 minutes and you stay far under the quota. Without it you’d burn the daily limit in minutes.
7. **Usually neither at first** — this is a search-index problem (Postgres full-text search / a search engine). Caching arbitrary queries has a poor hit rate; you *might* cache the top popular queries later.
8. **Queue.** Verify the signature, store the event, respond `200` immediately, and process in a worker. Stripe retries mean you’ll get duplicates, so processing must be idempotent (Module 8).

Stretch (examples): Instagram caches profile headers and feed pages, and queues video transcoding and notification fan-out. Swiggy caches restaurant menus and queues order-status notifications.
