import type { FastifyPluginAsync } from 'fastify';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { z } from 'zod';
import { pool } from '../db.js';
import { sendErr, scopedResellerId } from '../authz.js';
import { requireUser } from '../session.js';
import { intelSummary, lookupIpsBatch } from '../lib/ip-lookup.js';

const proxySchema = z.object({
  name: z.string().trim().min(1).max(255),
  host: z.string().trim().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  scheme: z.enum(['http', 'https', 'socks5']).default('http'),
  username: z.string().max(255).optional().nullable(),
  password: z.string().max(255).optional().nullable(),
  owner_reseller_id: z.number().int().positive().nullable().optional(),
});

const uaSchema = z.object({
  name: z.string().trim().min(1).max(255),
  user_agent: z.string().trim().min(1).max(512),
  owner_reseller_id: z.number().int().positive().nullable().optional(),
});

export const profileRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/proxy-profiles', async (req, reply) => {
    try {
      const user = requireUser(req);
      const rid = scopedResellerId(
        user,
        (req.query as { reseller_id?: string }).reseller_id
          ? Number((req.query as { reseller_id: string }).reseller_id)
          : null,
      );
      // Global (owner null) + scoped reseller profiles
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, owner_reseller_id, name, host, port, scheme, username,
                password IS NOT NULL AS has_password, is_active, created_at
         FROM proxy_profiles
         WHERE is_active = 1 AND (owner_reseller_id IS NULL ${rid != null ? 'OR owner_reseller_id = ?' : ''})
         ORDER BY id DESC`,
        rid != null ? [rid] : [],
      );
      return { success: true, items: rows };
    } catch (err) {
      return sendErr(reply, err);
    }
  });

  app.post('/api/proxy-profiles', async (req, reply) => {
    try {
      const user = requireUser(req);
      const body = proxySchema.parse(req.body);
      let owner = body.owner_reseller_id ?? null;
      if (user.role !== 'master') {
        owner = user.reseller_id;
      } else if (owner != null) {
        scopedResellerId(user, owner);
      }
      const [res] = await pool.query<ResultSetHeader>(
        `INSERT INTO proxy_profiles
          (owner_reseller_id, name, host, port, scheme, username, password, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
        [
          owner,
          body.name,
          body.host,
          body.port,
          body.scheme,
          body.username ?? null,
          body.password ?? null,
        ],
      );
      return reply.code(201).send({ success: true, item: { id: res.insertId } });
    } catch (err) {
      return sendErr(reply, err);
    }
  });

  app.get('/api/ua-profiles', async (req, reply) => {
    try {
      const user = requireUser(req);
      const rid = scopedResellerId(
        user,
        (req.query as { reseller_id?: string }).reseller_id
          ? Number((req.query as { reseller_id: string }).reseller_id)
          : null,
      );
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, owner_reseller_id, name, user_agent, is_active, created_at
         FROM user_agent_profiles
         WHERE is_active = 1 AND (owner_reseller_id IS NULL ${rid != null ? 'OR owner_reseller_id = ?' : ''})
         ORDER BY id DESC`,
        rid != null ? [rid] : [],
      );
      return { success: true, items: rows };
    } catch (err) {
      return sendErr(reply, err);
    }
  });

  app.post('/api/ua-profiles', async (req, reply) => {
    try {
      const user = requireUser(req);
      const body = uaSchema.parse(req.body);
      let owner = body.owner_reseller_id ?? null;
      if (user.role !== 'master') {
        owner = user.reseller_id;
      }
      const [res] = await pool.query<ResultSetHeader>(
        `INSERT INTO user_agent_profiles (owner_reseller_id, name, user_agent, is_active)
         VALUES (?, ?, ?, 1)`,
        [owner, body.name, body.user_agent],
      );
      return reply.code(201).send({ success: true, item: { id: res.insertId } });
    } catch (err) {
      return sendErr(reply, err);
    }
  });

  /** Attach proxy / UA to a tool */
  app.patch('/api/tools/:id/profiles', async (req, reply) => {
    try {
      const user = requireUser(req);
      const toolId = Number((req.params as { id: string }).id);
      const body = z
        .object({
          proxy_profile_id: z.number().int().positive().nullable().optional(),
          user_agent_profile_id: z.number().int().positive().nullable().optional(),
          proxy_enabled: z.boolean().optional(),
        })
        .parse(req.body);

      const [tools] = await pool.query<RowDataPacket[]>(
        'SELECT id, reseller_id FROM tools WHERE id = ? LIMIT 1',
        [toolId],
      );
      if (!tools[0]) return reply.code(404).send({ success: false, message: 'Tool not found' });
      scopedResellerId(user, tools[0].reseller_id);

      const sets: string[] = [];
      const vals: unknown[] = [];
      if (body.proxy_profile_id !== undefined) {
        sets.push('proxy_profile_id = ?');
        vals.push(body.proxy_profile_id);
      }
      if (body.user_agent_profile_id !== undefined) {
        sets.push('user_agent_profile_id = ?');
        vals.push(body.user_agent_profile_id);
      }
      if (body.proxy_enabled !== undefined) {
        sets.push('proxy_enabled = ?');
        vals.push(body.proxy_enabled ? 1 : 0);
      }
      if (!sets.length) return reply.code(400).send({ success: false, message: 'Nothing to update' });
      vals.push(toolId);
      await pool.query(`UPDATE tools SET ${sets.join(', ')} WHERE id = ?`, vals);
      return { success: true };
    } catch (err) {
      return sendErr(reply, err);
    }
  });

  app.get('/api/launch-events', async (req, reply) => {
    try {
      const user = requireUser(req);
      const q = req.query as { reseller_id?: string; limit?: string };
      const rid = scopedResellerId(user, q.reseller_id ? Number(q.reseller_id) : null);
      const limit = Math.min(Number(q.limit) || 50, 200);
      const params: unknown[] = [];
      let where = '1=1';
      if (rid != null) {
        where = 'le.reseller_id = ?';
        params.push(rid);
      }
      params.push(limit);
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT le.id, le.reseller_id, r.slug AS reseller_slug, le.tool_id, t.name AS tool_name,
                le.success, le.reason, le.inject_strategy, le.duration_ms, le.extension_id,
                le.username, le.client_ip, le.product_id, le.created_at
         FROM launch_events le
         JOIN resellers r ON r.id = le.reseller_id
         JOIN tools t ON t.id = le.tool_id
         WHERE ${where}
         ORDER BY le.id DESC
         LIMIT ?`,
        params,
      );
      const intelMap = await lookupIpsBatch(rows.map((r) => String(r.client_ip || '')));
      return {
        success: true,
        items: rows.map((r) => {
          const summary = intelSummary(intelMap.get(String(r.client_ip || '')));
          return {
            ...r,
            ip_type: summary.ip_type,
            ip_label: summary.ip_label,
            ip_risky: summary.is_risky,
          };
        }),
      };
    } catch (err) {
      return sendErr(reply, err);
    }
  });

  app.get('/api/access-logs', async (req, reply) => {
    try {
      const user = requireUser(req);
      const q = req.query as { reseller_id?: string; limit?: string; q?: string };
      const rid = scopedResellerId(user, q.reseller_id ? Number(q.reseller_id) : null);
      const limit = Math.min(Number(q.limit) || 100, 500);
      const params: unknown[] = [];
      const clauses: string[] = ['1=1'];
      if (rid != null) {
        clauses.push('a.reseller_id = ?');
        params.push(rid);
      }
      const search = (q.q || '').trim();
      if (search) {
        clauses.push('(a.username LIKE ? OR a.client_ip LIKE ? OR a.product_id LIKE ? OR t.name LIKE ?)');
        const like = `%${search}%`;
        params.push(like, like, like, like);
      }
      params.push(limit);
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT a.id, a.reseller_id, r.slug AS reseller_slug, a.tool_id, t.name AS tool_name,
                a.username, a.product_id, a.client_ip, a.request_ip, a.user_agent,
                a.success, a.deny_reason, a.source, a.created_at
         FROM access_logs a
         JOIN resellers r ON r.id = a.reseller_id
         JOIN tools t ON t.id = a.tool_id
         WHERE ${clauses.join(' AND ')}
         ORDER BY a.id DESC
         LIMIT ?`,
        params,
      );
      const intelMap = await lookupIpsBatch(rows.map((r) => String(r.client_ip || '')));
      return {
        success: true,
        items: rows.map((r) => {
          const summary = intelSummary(intelMap.get(String(r.client_ip || '')));
          return {
            ...r,
            ip_type: summary.ip_type,
            ip_label: summary.ip_label,
            ip_risky: summary.is_risky,
          };
        }),
      };
    } catch (err) {
      return sendErr(reply, err);
    }
  });
};