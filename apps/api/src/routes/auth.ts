import type { FastifyPluginAsync } from 'fastify';
import bcrypt from 'bcryptjs';
import { loginBodySchema } from '@oneclk/shared';
import type { RowDataPacket } from 'mysql2';
import { z } from 'zod';
import { pool } from '../db.js';
import { clearSession, readSession, setSession, type SessionUser } from '../session.js';

type AdminRow = RowDataPacket & {
  id: number;
  username: string;
  password_hash: string;
  role: 'master' | 'reseller';
  reseller_id: number | null;
  is_active: number;
};

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post('/api/auth/login', async (req, reply) => {
    const body = loginBodySchema.parse(req.body);
    const [rows] = await pool.query<AdminRow[]>(
      'SELECT id, username, password_hash, role, reseller_id, is_active FROM admin_users WHERE username = ? LIMIT 1',
      [body.username],
    );
    const row = rows[0];
    if (!row || !row.is_active) {
      return reply.code(401).send({ success: false, message: 'Invalid credentials' });
    }
    const ok = await bcrypt.compare(body.password, row.password_hash);
    if (!ok) {
      return reply.code(401).send({ success: false, message: 'Invalid credentials' });
    }
    await pool.query('UPDATE admin_users SET last_login_at = NOW() WHERE id = ?', [row.id]);
    const user: SessionUser = {
      id: row.id,
      username: row.username,
      role: row.role,
      reseller_id: row.reseller_id,
    };
    setSession(reply, user);
    return { success: true, user };
  });

  app.post('/api/auth/logout', async (_req, reply) => {
    clearSession(reply);
    return { success: true };
  });

  app.get('/api/auth/me', async (req, reply) => {
    const user = readSession(req);
    if (!user) return reply.code(401).send({ success: false, message: 'Unauthorized' });
    return { success: true, user };
  });

  /** Any logged-in admin can change their own password (current password required). */
  app.post('/api/auth/change-password', async (req, reply) => {
    try {
      const user = readSession(req);
      if (!user) return reply.code(401).send({ success: false, message: 'Unauthorized' });
      const body = z
        .object({
          current_password: z.string().min(1).max(200),
          new_password: z.string().min(6).max(200),
        })
        .parse(req.body);

      const [rows] = await pool.query<AdminRow[]>(
        'SELECT id, password_hash FROM admin_users WHERE id = ? LIMIT 1',
        [user.id],
      );
      const row = rows[0];
      if (!row) return reply.code(404).send({ success: false, message: 'User not found' });
      const ok = await bcrypt.compare(body.current_password, row.password_hash);
      if (!ok) {
        return reply.code(400).send({ success: false, message: 'Current password is wrong' });
      }
      const hash = await bcrypt.hash(body.new_password, 10);
      await pool.query('UPDATE admin_users SET password_hash = ? WHERE id = ?', [hash, user.id]);
      return { success: true, message: 'Password updated' };
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode ?? 400;
      const message = err instanceof Error ? err.message : 'Error';
      return reply.code(status).send({ success: false, message });
    }
  });
};
