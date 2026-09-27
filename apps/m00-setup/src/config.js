function required(name) {
  const value = process.env[name];
  if (!value) {
    // Without this, ioredis silently falls back to localhost:6379 — the queue client would talk to the cache instance.
    throw new Error(`Missing env var ${name}. Copy .env.example to .env at the repo root.`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  redisCacheUrl: required('REDIS_CACHE_URL'),
  redisQueueUrl: required('REDIS_QUEUE_URL'),
};
