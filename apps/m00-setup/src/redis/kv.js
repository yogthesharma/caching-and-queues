const KEY_PREFIX = 'm00:kv:';

export function kvKey(key) {
  return KEY_PREFIX + key;
}

export async function setValue(redis, key, value, ttlSeconds) {
  if (ttlSeconds) {
    await redis.set(kvKey(key), value, 'EX', ttlSeconds);
  } else {
    await redis.set(kvKey(key), value);
  }
}

// Returns null when the key is missing or expired.
export async function getValue(redis, key) {
  const [value, ttl] = await Promise.all([redis.get(kvKey(key)), redis.ttl(kvKey(key))]);
  if (value === null) {
    return null;
  }
  return { value, ttlSeconds: ttl === -1 ? null : ttl };
}
