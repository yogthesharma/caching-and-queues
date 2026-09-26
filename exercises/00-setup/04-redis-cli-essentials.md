# Exercise: redis-cli essentials

Read: `notes/00-setup/04-redis-cli-essentials.md`

Use `redis-cache` for everything here:

```bash
docker compose exec redis-cache redis-cli
```

## Tasks

1. Store `shop:product:1` = `Keyboard` with no expiry. Check its `TTL`. What does the number mean?
2. Store `shop:session:abc` = `user-7` expiring in 20 seconds. Check `TTL` a few times. After it expires, what do `GET` and `TTL` return?
3. Add a 100-second TTL to `shop:product:1`, then remove it again. Which commands did you use?
4. Use `SET ... NX` to set `shop:lock:report` = `worker-1`. Run the same command again with `worker-2`. What happens the second time, and what’s the current value?
5. Create keys `shop:product:2` and `shop:product:3`, then list all `shop:product:*` keys **without** using `KEYS`.
6. What is the `TYPE` of `shop:product:1`?
7. Open a second terminal running `MONITOR`. In the first, run `GET shop:product:1`. What shows up in the monitor?
8. Delete every key you created in this exercise.

## Stretch

Run `INFO stats` and find `keyspace_hits` and `keyspace_misses`. Do a few `GET`s on existing and missing keys and watch them change. Compute the hit rate.

---

## Solutions

1.

```
SET shop:product:1 Keyboard
TTL shop:product:1        → (integer) -1
```

`-1` means the key exists but never expires.

2.

```
SET shop:session:abc user-7 EX 20
TTL shop:session:abc      → 20, 17, 12 ...
GET shop:session:abc      → (nil)          after expiry
TTL shop:session:abc      → (integer) -2   key doesn't exist
```

3.

```
EXPIRE shop:product:1 100
TTL shop:product:1        → ~100
PERSIST shop:product:1
TTL shop:product:1        → -1
```

4.

```
SET shop:lock:report worker-1 NX    → OK
SET shop:lock:report worker-2 NX    → (nil)   not set, key already exists
GET shop:lock:report                → "worker-1"
```

This “only the first writer wins” behavior is the building block of distributed locks (Module 10).

5.

```
SET shop:product:2 Mouse
SET shop:product:3 Monitor
SCAN 0 MATCH shop:product:* COUNT 100
```

Or from the host: `docker compose exec redis-cache redis-cli --scan --pattern 'shop:product:*'`

6. `string`.
7. A line like `1790000000.123456 [0 127.0.0.1:54012] "GET" "shop:product:1"` — Unix timestamp, `[database-number client-address]`, and the exact command. (Your Node app would show up with a Docker network address like `172.x.x.x` instead.)
8.

```
DEL shop:product:1 shop:product:2 shop:product:3 shop:session:abc shop:lock:report
```

Stretch: hit rate = `keyspace_hits / (keyspace_hits + keyspace_misses)`. `GET` on a missing key increases misses; on an existing key, hits.
