# Exercise: Docker Redis (two instances)

Read: `notes/00-setup/03-docker-redis.md`

## Tasks

From the **repo root**:

1. `cp .env.example .env` (skip if it exists) and `docker compose up -d --wait`.
2. Confirm both containers are healthy with `docker compose ps`.
3. `PING` both instances with one-shot `redis-cli` commands.
4. Print `maxmemory-policy` for each instance. Which one evicts?
5. Prove persistence differs:
   - `SET survivor yes` on **both** instances.
   - `docker compose restart redis-cache redis-queue`
   - `GET survivor` on both. Which one kept the key, and why?
6. Answer: what does `docker compose down -v` delete in this repo that `docker compose down` does not?
7. Answer: why would it be dangerous to store BullMQ jobs in `redis-cache`?

## Stretch

Run `INFO memory` on `redis-cache` and find `maxmemory_human` and `maxmemory_policy`.

---

## Solutions

3.

```bash
docker compose exec redis-cache redis-cli PING
docker compose exec redis-queue redis-cli PING
```

4.

```bash
docker compose exec redis-cache redis-cli CONFIG GET maxmemory-policy   # allkeys-lru
docker compose exec redis-queue redis-cli CONFIG GET maxmemory-policy   # noeviction
```

`redis-cache` evicts. `redis-queue` returns an error on writes when memory is full instead of deleting anything.

5.

```bash
docker compose exec redis-cache redis-cli SET survivor yes
docker compose exec redis-queue redis-cli SET survivor yes
docker compose restart redis-cache redis-queue
docker compose exec redis-cache redis-cli GET survivor   # (nil)
docker compose exec redis-queue redis-cli GET survivor   # "yes"
```

`redis-cache` has persistence off, so a restart empties it. `redis-queue` writes every change to its append-only file (AOF) in the `redis-queue-data` volume and replays it on startup.

6. `-v` removes the `redis-queue-data` volume, so all queue data (jobs) is gone. The cache has no volume — it’s empty after any restart anyway.
7. `redis-cache` is capped at 64 MB with `allkeys-lru`. When cache writes fill memory, Redis would evict least-recently-used keys — including waiting jobs — and those jobs would silently never run. It also doesn’t persist, so a restart loses every queued job.

Stretch:

```bash
docker compose exec redis-cache redis-cli INFO memory | grep -E 'maxmemory_human|maxmemory_policy'
```
