import type { FastifyPluginAsync } from 'fastify';
import { pingDb } from '../db.js';
import { pingRedis } from '../redis.js';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', async () => {
    const [db, redis] = await Promise.all([pingDb(), pingRedis()]);
    return {
      ok: true as const,
      service: 'oneclk-api',
      time: new Date().toISOString(),
      db,
      redis,
    };
  });
};