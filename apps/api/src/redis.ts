import { Redis as RedisClient } from 'ioredis';
import { env } from './env.js';

let client: RedisClient | null = null;

export function getRedis(): RedisClient {
  if (!client) {
    client = new RedisClient(env.redisUrl, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    });
  }
  return client;
}

export async function pingRedis(): Promise<boolean> {
  try {
    const r = getRedis();
    if (r.status !== 'ready') await r.connect();
    const pong = await r.ping();
    return pong === 'PONG';
  } catch {
    return false;
  }
}
