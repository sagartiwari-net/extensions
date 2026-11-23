import type { FastifyRequest } from 'fastify';

/** Best-effort API-visible client IP (may be CDN / proxy). */
export function requestIp(req: FastifyRequest): string {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.trim()) {
    return xf.split(',')[0]!.trim();
  }
  if (Array.isArray(xf) && xf[0]) {
    return String(xf[0]).split(',')[0]!.trim();
  }
  return req.ip || '';
}

export function requestUserAgent(req: FastifyRequest): string {
  const ua = req.headers['user-agent'];
  return typeof ua === 'string' ? ua.slice(0, 512) : '';
}
