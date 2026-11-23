import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AdminRole } from '@oneclk/shared';
import { env } from './env.js';

export type SessionUser = {
  id: number;
  username: string;
  role: AdminRole;
  reseller_id: number | null;
};

const COOKIE = 'oneclk_session';

function sign(payload: string): string {
  return createHmac('sha256', env.sessionSecret).update(payload).digest('base64url');
}

export function setSession(reply: FastifyReply, user: SessionUser): void {
  const body = Buffer.from(JSON.stringify(user), 'utf8').toString('base64url');
  const value = `${body}.${sign(body)}`;
  const sameSite = env.cookieSameSite;
  reply.setCookie(COOKIE, value, {
    path: '/',
    httpOnly: true,
    sameSite,
    // Browsers require Secure when SameSite=None
    secure: sameSite === 'none' ? true : env.cookieSecure,
    maxAge: 60 * 60 * 24 * 7,
  });
}

export function clearSession(reply: FastifyReply): void {
  const sameSite = env.cookieSameSite;
  reply.clearCookie(COOKIE, {
    path: '/',
    httpOnly: true,
    sameSite,
    secure: sameSite === 'none' ? true : env.cookieSecure,
  });
}

export function readSession(req: FastifyRequest): SessionUser | null {
  const raw = req.cookies?.[COOKIE];
  if (!raw) return null;
  const [body, sig] = raw.split('.');
  if (!body || !sig) return null;
  const expected = sign(body);
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const user = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionUser;
    if (!user?.id || !user.username || !user.role) return null;
    return user;
  } catch {
    return null;
  }
}

export function requireUser(req: FastifyRequest): SessionUser {
  const user = readSession(req);
  if (!user) {
    const err = new Error('Unauthorized') as Error & { statusCode: number };
    err.statusCode = 401;
    throw err;
  }
  return user;
}