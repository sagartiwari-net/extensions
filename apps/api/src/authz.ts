import type { FastifyReply, FastifyRequest } from 'fastify';
import { requireUser, type SessionUser } from './session.js';

export function requireMaster(req: FastifyRequest): SessionUser {
  const user = requireUser(req);
  if (user.role !== 'master') {
    const err = new Error('Master only') as Error & { statusCode: number };
    err.statusCode = 403;
    throw err;
  }
  return user;
}

/** Reseller may only touch own reseller_id; master may pass any. */
export function scopedResellerId(user: SessionUser, requested?: number | null): number | null {
  if (user.role === 'master') return requested ?? null;
  if (!user.reseller_id) {
    const err = new Error('No reseller assigned') as Error & { statusCode: number };
    err.statusCode = 403;
    throw err;
  }
  if (requested != null && requested !== user.reseller_id) {
    const err = new Error('Forbidden reseller') as Error & { statusCode: number };
    err.statusCode = 403;
    throw err;
  }
  return user.reseller_id;
}

export function sendErr(reply: FastifyReply, err: unknown) {
  // Zod validation → 400 (not 500)
  if (err && typeof err === 'object' && (err as { name?: string }).name === 'ZodError') {
    const issues = (err as { issues?: Array<{ path: (string | number)[]; message: string }> }).issues;
    const message =
      issues?.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ') || 'Validation failed';
    return reply.code(400).send({ success: false, message });
  }
  const status = (err as { statusCode?: number }).statusCode ?? 500;
  const message = err instanceof Error ? err.message : 'Error';
  return reply.code(status).send({ success: false, message });
}