# redis-cli essentials

## Goal

Inspect and poke Redis by hand. You’ll use `redis-cli` constantly to check what your Node code actually stored.

## Open a session

```bash
docker compose exec redis-cache redis-cli
```

One-shot command without entering the shell:

```bash
docker compose exec redis-cache redis-cli GET user:42
```

## Core commands

| Command | What it does |
|---------|--------------|
| `PING` | Health check → `PONG` |
| `SET key value` | Store a string |
| `GET key` | Read it (`(nil)` if missing) |
| `SET key value EX 60` | Store with a 60-second TTL |
| `SET key value NX` | Only set if the key does **not** exist (basis of locks — Module 10) |
| `TTL key` | Seconds left; `-1` = no expiry, `-2` = key doesn’t exist |
| `EXPIRE key 30` | Add / reset a TTL on an existing key |
| `PERSIST key` | Remove the TTL |
| `EXISTS key` | `1` or `0` |
| `DEL key` | Delete |
| `TYPE key` | `string`, `hash`, `list`, `set`, `zset`, `stream` |
| `INCR key` | Atomic +1 (counters — Module 2) |

## Finding keys: `SCAN`, never `KEYS`

```
SCAN 0 MATCH m00:* COUNT 100
```

- `KEYS pattern` walks **every key in one blocking call**. On a production Redis with millions of keys it freezes all clients for seconds. Only use it on your laptop.
- `SCAN` walks in small batches using a cursor. Repeat with the returned cursor until it returns `0`.

In `redis-cli` there’s a shortcut that runs SCAN for you:

```bash
docker compose exec redis-cache redis-cli --scan --pattern 'm00:*'
```

## Looking at the server

| Command | Use |
|---------|-----|
| `DBSIZE` | Number of keys |
| `INFO memory` | `used_memory_human`, `maxmemory_human`, eviction policy |
| `INFO stats` | `keyspace_hits`, `keyspace_misses`, `evicted_keys` |
| `CONFIG GET maxmemory-policy` | Confirm eviction behavior |
| `MONITOR` | Print **every** command live — great for debugging your app; dev only (slows Redis) |
| `FLUSHDB` | Delete all keys in the current DB — only on your laptop, and **never** on `redis-queue` casually |

`keyspace_hits / (keyspace_hits + keyspace_misses)` is your cache hit rate. We’ll track it properly in Module 3.

## Key naming convention

Redis has no tables. Structure lives in the key name, separated by `:`

```
<app-or-module>:<entity>:<id>[:<field>]

m00:kv:greeting
shop:product:42
shop:user:7:cart
```

- Makes `SCAN MATCH shop:product:*` possible.
- Avoids collisions between features sharing one Redis.
- Keep keys readable; they cost memory like values do, so don’t make them absurdly long.

## Takeaway

`SET … EX`, `GET`, `TTL`, `DEL`, and `SCAN` cover most debugging. Use `MONITOR` to watch your app’s commands. Never run `KEYS` or `FLUSHDB` on anything that matters.
