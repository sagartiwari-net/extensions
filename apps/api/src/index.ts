import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import { env } from './env.js';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { resellerRoutes } from './routes/resellers.js';
import { toolRoutes } from './routes/tools.js';
import { sessionRoutes } from './routes/session.js';
import { poolRoutes } from './routes/pools.js';
import { rulesRoutes } from './routes/rules.js';
import { clientRulesRoutes } from './routes/client-rules.js';
import { securityIncidentRoutes } from './routes/security-incidents.js';
import { securityProfileRoutes } from './routes/security-profiles.js';
import { extensionRoutes } from './routes/extensions.js';
import { extensionBrandingRoutes } from './routes/extension-branding.js';
import { profileRoutes } from './routes/profiles.js';

const app = Fastify({
  logger: true,
  trustProxy: env.trustProxy,
  // Cookie JSON vaults can be large (Cookie-Editor exports).
  bodyLimit: 10 * 1024 * 1024,
});

await app.register(cors, {
  origin(origin, cb) {
    // Extension / curl often omit Origin — allow. Browsers send Origin.
    if (!origin) {
      cb(null, true);
      return;
    }
    if (env.corsOrigins.includes('*') || env.corsOrigins.includes(origin)) {
      cb(null, true);
      return;
    }
    cb(null, false);
  },
  credentials: true,
  // Default was GET,HEAD,POST only — browser PATCH/DELETE preflight → "Failed to fetch".
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  // Cross-origin admin (:3000) → API (:4000) needs these to name ZIP downloads.
  exposedHeaders: ['Content-Disposition', 'Content-Type', 'X-Extension-Version'],
});
await app.register(cookie);

app.addHook('onSend', async (_req, reply, payload) => {
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  reply.header('X-Frame-Options', 'DENY');
  if (env.isProd) {
    reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  return payload;
});

await app.register(healthRoutes);
await app.register(authRoutes);
await app.register(resellerRoutes);
await app.register(toolRoutes);
await app.register(sessionRoutes);
await app.register(poolRoutes);
await app.register(rulesRoutes);
await app.register(clientRulesRoutes);
await app.register(securityIncidentRoutes);
await app.register(securityProfileRoutes);
await app.register(extensionRoutes);
await app.register(extensionBrandingRoutes);
await app.register(profileRoutes);

app.setErrorHandler((err, _req, reply) => {
  const status = (err as { statusCode?: number }).statusCode ?? 500;
  const message = err instanceof Error ? err.message : 'Error';
  if (status >= 500) app.log.error(err);
  reply.code(status).send({
    success: false,
    message: status >= 500 && env.isProd ? 'Internal error' : message,
  });
});

await app.listen({ host: env.host, port: env.port });
app.log.info(`API http://${env.host}:${env.port} env=${env.nodeEnv}`);
