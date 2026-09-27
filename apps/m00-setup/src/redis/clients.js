import { Redis } from 'ioredis';

export function createRedisClient(url, name, logger = console) {
  const client = new Redis(url, {
    // Fail fast instead of queueing commands forever while Redis is down.
    maxRetriesPerRequest: 1,
    // Shows up in `CLIENT LIST`, so you can tell which process owns which connection.
    connectionName: name,
  });
  client.on('error', (err) => logger.warn({ err }, `${name} error`));
  return client;
}
