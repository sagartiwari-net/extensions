import type { FastifyPluginAsync } from 'fastify';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { createToolSchema, updateToolSchema } from '@oneclk/shared';
import { encryptCookieData, sha256Hex } from '@oneclk/crypto';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { pool } from '../db.js';
import { sendErr, scopedResellerId } from '../authz.js';
import { requireUser } from '../session.js';
import { env } from '../env.js';
import { createLaunchToken } from '../launch.js';
import { getRedis } from '../redis.js';
import { requestIp, requestUserAgent } from '../request-meta.js';
import {
  applyToolKeyPrefix,
  nextUniqueToolKey,
} from '../lib/tool-key.js';
import { parseBrandSettings } from '../lib/extension-packager.js';

async function existingKeysForReseller(
  resellerId: number,
  exceptToolId?: number,
): Promise<Set<string>> {
  const [rows] = await pool.query<RowDataPacket[]>(
    exceptToolId
      ? 'SELECT tool_key FROM tools WHERE reseller_id = ? AND id <> ?'
      : 'SELECT tool_key FROM tools WHERE reseller_id = ?',
    exceptToolId ? [resellerId, exceptToolId] : [resellerId],
  );
  return new Set(rows.map((r) => String(r.tool_key).toLowerCase()));
}

const DEFAULT_MASTER_RESELLER_SLUG = 'toolsmandi';

async function resellerPrefix(resellerId: number): Promise<string> {
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT key_prefix FROM resellers WHERE id = ? LIMIT 1',
    [resellerId],
  );
  const prefix = String(rows[0]?.key_prefix || '');
  if (!prefix) {
    const err = new Error('Reseller has no key_prefix — set it on Resellers page') as Error & {
      statusCode: number;
    };
    err.statusCode = 400;
    throw err;
  }
  return prefix;
}

async function defaultToolsMandiId(): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT id FROM resellers WHERE slug = ? LIMIT 1',
    [DEFAULT_MASTER_RESELLER_SLUG],
  );
  if (!rows[0]) {
    const err = new Error('Default reseller toolsmandi missing') as Error & { statusCode: number };
    err.statusCode = 500;
    throw err;
  }
  return Number(rows[0].id);
}

async function bustToolsListCache() {
  try {
    const redis = getRedis();
    if (redis.status !== 'ready') await redis.connect().catch(() => null);
    if (redis.status !== 'ready') return;
    const keys = await redis.keys('tools:list:*');
    if (keys.length) await redis.del(...keys);
  } catch {
    /* optional */
  }
}

type ToolListRow = RowDataPacket & {
  id: number;
  reseller_id: number;
  reseller_slug: string;
  tool_key: string;
  name: string;
  web_url: string;
  status: string;
  inject_strategy: string;
  security_tier: number;
  pool_id: number | null;
  has_cookie: number;
  updated_at: Date;
};

type ToolRow = ToolListRow & {
  cookie_payload: string | null;
  cookie_password: string | null;
  cookie_formats: unknown;
  updating_message: string | null;
  proxy_enabled: number;
  proxy_profile_id: number | null;
  user_agent_profile_id: number | null;
  reseller_name?: string;
  reseller_settings?: unknown;
};

async function resolveResellerId(
  user: ReturnType<typeof requireUser>,
  bodyResellerId?: number,
): Promise<number> {
  if (user.role === 'master') {
    // Master tools default to ToolsMandi catalog (not "under" master).
    if (!bodyResellerId) return defaultToolsMandiId();
    return bodyResellerId;
  }
  const rid = scopedResellerId(user);
  if (!rid) {
    const err = new Error('No reseller') as Error & { statusCode: number };
    err.statusCode = 403;
    throw err;
  }
  // Reseller may only create under self
  if (bodyResellerId != null && bodyResellerId !== rid) {
    const err = new Error('Forbidden reseller') as Error & { statusCode: number };
    err.statusCode = 403;
    throw err;
  }
  return rid;
}

async function assertToolAccess(user: ReturnType<typeof requireUser>, toolId: number): Promise<ToolRow> {
  const [rows] = await pool.query<ToolRow[]>(
    `SELECT t.*, r.slug AS reseller_slug, r.name AS reseller_name, r.settings AS reseller_settings,
            (t.cookie_payload IS NOT NULL AND t.cookie_payload <> '') AS has_cookie
     FROM tools t
     JOIN resellers r ON r.id = t.reseller_id
     WHERE t.id = ? LIMIT 1`,
    [toolId],
  );
  const tool = rows[0];
  if (!tool) {
    const err = new Error('Tool not found') as Error & { statusCode: number };
    err.statusCode = 404;
    throw err;
  }
  scopedResellerId(user, tool.reseller_id);
  return tool;
}

export const toolRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/tools', async (req, reply) => {
    try {
      const user = requireUser(req);
      const q = req.query as {
        reseller_id?: string;
        limit?: string;
        offset?: string;
        q?: string;
        search?: string;
        status?: string;
      };
      const rid = scopedResellerId(user, q.reseller_id ? Number(q.reseller_id) : null);
      const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 200);
      const offset = Math.max(Number(q.offset) || 0, 0);
      const search = String(q.q || q.search || '')
        .trim()
        .slice(0, 100);
      const status = ['active', 'updating', 'disabled'].includes(String(q.status || ''))
        ? String(q.status)
        : '';

      const cacheKey = `tools:list:${user.role}:${user.id}:${rid ?? 'all'}:${limit}:${offset}:${search}:${status || 'any'}`;
      try {
        const redis = getRedis();
        if (redis.status !== 'ready') await redis.connect().catch(() => null);
        if (redis.status === 'ready') {
          const hit = await redis.get(cacheKey);
          if (hit) return JSON.parse(hit);
        }
      } catch {
        /* redis optional */
      }

      const params: unknown[] = [];
      const clauses: string[] = ['1=1'];
      if (rid != null) {
        clauses.push('t.reseller_id = ?');
        params.push(rid);
      }
      if (search) {
        clauses.push('(t.name LIKE ? OR t.tool_key LIKE ? OR r.slug LIKE ?)');
        const like = `%${search}%`;
        params.push(like, like, like);
      }
      if (status) {
        clauses.push('t.status = ?');
        params.push(status);
      }
      const where = clauses.join(' AND ');

      const [countRows] = await pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS total
         FROM tools t
         JOIN resellers r ON r.id = t.reseller_id
         WHERE ${where}`,
        params,
      );
      const total = Number(countRows[0]?.total || 0);

      const [rows] = await pool.query<ToolListRow[]>(
        `SELECT t.id, t.reseller_id, r.slug AS reseller_slug, t.tool_key, t.name, t.web_url,
                t.status, t.inject_strategy, t.security_tier, t.pool_id, t.updated_at,
                (t.cookie_payload IS NOT NULL AND t.cookie_payload <> '') AS has_cookie
         FROM tools t
         JOIN resellers r ON r.id = t.reseller_id
         WHERE ${where}
         ORDER BY t.id DESC
         LIMIT ? OFFSET ?`,
        [...params, limit, offset],
      );

      const payload = {
        success: true,
        items: rows,
        total,
        limit,
        offset,
      };

      try {
        const redis = getRedis();
        if (redis.status === 'ready') {
          await redis.set(cacheKey, JSON.stringify(payload), 'EX', 15);
        }
      } catch {
        /* ignore */
      }

      return payload;
    } catch (err) {
      return sendErr(reply, err);
    }
  });

  /** Bulk delete / status — ids must all be accessible to the caller. */
  app.post('/api/tools/bulk', async (req, reply) => {
    try {
      const user = requireUser(req);
      const body = z
        .object({
          ids: z.array(z.number().int().positive()).min(1).max(200),
          action: z.enum(['delete', 'set_status']),
          status: z.enum(['active', 'updating', 'disabled']).optional(),
        })
        .parse(req.body);

      if (body.action === 'set_status' && !body.status) {
        return reply.code(400).send({ success: false, message: 'status required' });
      }

      let done = 0;
      for (const id of body.ids) {
        await assertToolAccess(user, id);
        if (body.action === 'delete') {
          await pool.query('DELETE FROM tools WHERE id = ?', [id]);
        } else {
          await pool.query('UPDATE tools SET status = ?, config_version = config_version + 1 WHERE id = ?', [
            body.status,
            id,
          ]);
        }
        done += 1;
      }
      await bustToolsListCache();
      return { success: true, done, action: body.action };
    } catch (err) {
      return sendErr(reply, err);
    }
  });

  app.get('/api/tools/:id', async (req, reply) => {
    try {
      const user = requireUser(req);
      const id = Number((req.params as { id: string }).id);
      const tool = await assertToolAccess(user, id);
      return {
        success: true,
        item: {
          id: tool.id,
          reseller_id: tool.reseller_id,
          reseller_slug: tool.reseller_slug,
          tool_key: tool.tool_key,
          name: tool.name,
          web_url: tool.web_url,
          status: tool.status,
          inject_strategy: tool.inject_strategy,
          security_tier: tool.security_tier,
          pool_id: tool.pool_id,
          cookie_formats: tool.cookie_formats,
          updating_message: tool.updating_message,
          has_cookie: Boolean(tool.has_cookie),
          proxy_enabled: tool.proxy_enabled,
          proxy_profile_id: tool.proxy_profile_id,
          user_agent_profile_id: tool.user_agent_profile_id,
          updated_at: tool.updated_at,
        },
      };
    } catch (err) {
      return sendErr(reply, err);
    }
  });

  app.post('/api/tools', async (req, reply) => {
    try {
      const user = requireUser(req);
      const body = createToolSchema.parse(req.body);
      const resellerId = await resolveResellerId(user, body.reseller_id);
      const prefix = await resellerPrefix(resellerId);
      const baseKey = applyToolKeyPrefix(prefix, body.tool_key);
      const existing = await existingKeysForReseller(resellerId);
      const toolKey = nextUniqueToolKey(baseKey, existing);
      const password = body.cookie_password || randomBytes(12).toString('hex');
      let payload: string | null = null;
      if (body.cookie_plain?.trim()) {
        payload = encryptCookieData(body.cookie_plain.trim(), password);
      }
      const formats = JSON.stringify(body.cookie_formats ?? ['cookies']);
      const [res] = await pool.query<ResultSetHeader>(
        `INSERT INTO tools
          (reseller_id, tool_key, name, web_url, status, inject_strategy, cookie_formats,
           cookie_payload, cookie_password, security_tier)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          resellerId,
          toolKey,
          body.name,
          body.web_url,
          body.status ?? 'active',
          body.inject_strategy,
          formats,
          payload,
          password,
          body.security_tier,
        ],
      );
      await bustToolsListCache();
      return reply.code(201).send({ success: true, item: { id: res.insertId, tool_key: toolKey } });
    } catch (err) {
      if ((err as { code?: string }).code === 'ER_DUP_ENTRY') {
        return reply.code(409).send({ success: false, message: 'tool_key already exists for reseller' });
      }
      return sendErr(reply, err);
    }
  });

  app.patch('/api/tools/:id', async (req, reply) => {
    try {
      const user = requireUser(req);
      const id = Number((req.params as { id: string }).id);
      const tool = await assertToolAccess(user, id);
      const body = updateToolSchema.parse(req.body);

      const fields: string[] = [];
      const vals: unknown[] = [];
      let nextToolKey: string | undefined;
      if (body.tool_key !== undefined) {
        const prefix = await resellerPrefix(tool.reseller_id);
        const baseKey = applyToolKeyPrefix(prefix, body.tool_key);
        const existing = await existingKeysForReseller(tool.reseller_id, id);
        nextToolKey = nextUniqueToolKey(baseKey, existing);
      }
      const map: Record<string, unknown> = {
        name: body.name,
        web_url: body.web_url,
        inject_strategy: body.inject_strategy,
        security_tier: body.security_tier,
        status: body.status,
        tool_key: nextToolKey,
      };
      for (const [k, v] of Object.entries(map)) {
        if (v !== undefined) {
          fields.push(`${k} = ?`);
          vals.push(v);
        }
      }
      if (body.cookie_formats) {
        fields.push('cookie_formats = ?');
        vals.push(JSON.stringify(body.cookie_formats));
      }
      if (body.cookie_plain?.trim()) {
        const password = body.cookie_password || tool.cookie_password || randomBytes(12).toString('hex');
        const cipher = encryptCookieData(body.cookie_plain.trim(), password);

        if (tool.pool_id) {
          // Bi-directional: any linked tool save updates the whole pool
          await pool.query(
            `UPDATE cookie_sync_pools
             SET cookie_payload = ?, cookie_password = ?, payload_sha256 = ?,
                 updated_by_tool_id = ?, updated_by_admin_id = ?, updated_at = NOW()
             WHERE id = ?`,
            [cipher, password, sha256Hex(cipher), id, user.id, tool.pool_id],
          );
          await pool.query(
            `UPDATE tools SET cookie_payload = ?, cookie_password = ?, config_version = config_version + 1
             WHERE pool_id = ?`,
            [cipher, password, tool.pool_id],
          );
          await pool.query(
            `INSERT INTO audit_logs (actor_admin_id, reseller_id, action, entity_type, entity_id, meta)
             VALUES (?, ?, 'pool.cookie_update', 'cookie_pool', ?, ?)`,
            [
              user.id,
              tool.reseller_id,
              String(tool.pool_id),
              JSON.stringify({ from_tool_id: id, payload_sha256: sha256Hex(cipher) }),
            ],
          );
          // skip local field update — already mirrored
          const otherFields = fields.length > 0;
          if (otherFields) {
            vals.push(id);
            await pool.query(`UPDATE tools SET ${fields.join(', ')} WHERE id = ?`, vals);
          }
          await bustToolsListCache();
          return { success: true, synced_via_pool: tool.pool_id };
        }

        fields.push('cookie_payload = ?', 'cookie_password = ?');
        vals.push(cipher, password);
        await pool.query(
          `INSERT INTO audit_logs (actor_admin_id, reseller_id, action, entity_type, entity_id, meta)
           VALUES (?, ?, 'tool.cookie_update', 'tool', ?, ?)`,
          [
            user.id,
            tool.reseller_id,
            String(id),
            JSON.stringify({ payload_sha256: sha256Hex(cipher) }),
          ],
        );
      } else if (body.cookie_password) {
        fields.push('cookie_password = ?');
        vals.push(body.cookie_password);
      }
      if (!fields.length) {
        await bustToolsListCache();
        return { success: true };
      }
      fields.push('config_version = config_version + 1');
      vals.push(id);
      await pool.query(`UPDATE tools SET ${fields.join(', ')} WHERE id = ?`, vals);
      await bustToolsListCache();
      return { success: true };
    } catch (err) {
      return sendErr(reply, err);
    }
  });

  app.delete('/api/tools/:id', async (req, reply) => {
    try {
      const user = requireUser(req);
      const id = Number((req.params as { id: string }).id);
      await assertToolAccess(user, id);
      await pool.query('DELETE FROM tools WHERE id = ?', [id]);
      await bustToolsListCache();
      return { success: true };
    } catch (err) {
      return sendErr(reply, err);
    }
  });

  /** Admin Access button — short-lived token + launch URL on admin origin */
  app.post('/api/tools/:id/access', async (req, reply) => {
    try {
      const user = requireUser(req);
      const id = Number((req.params as { id: string }).id);
      const tool = await assertToolAccess(user, id);
      const body = z
        .object({
          username: z.string().trim().min(1).max(255),
          product_id: z.string().trim().min(1).max(64),
          /** Optional — when sent must match this tool's key (aMember-style body) */
          tool_key: z.string().trim().min(1).max(64).optional(),
          client_ip: z
            .string()
            .trim()
            .regex(/^(?:\d{1,3}\.){3}\d{1,3}$/, 'client_ip must be IPv4'),
        })
        .parse(req.body ?? {});

      if (body.tool_key && body.tool_key !== tool.tool_key) {
        return reply.code(400).send({
          success: false,
          message: 'tool_key does not match the selected tool',
        });
      }

      const reqIp = requestIp(req);
      const ua = requestUserAgent(req);

      if (tool.status === 'disabled') {
        await pool.query(
          `INSERT INTO access_logs
            (reseller_id, tool_id, username, product_id, client_ip, request_ip, user_agent, success, deny_reason, source)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'tool_disabled', 'admin_access')`,
          [tool.reseller_id, tool.id, body.username, body.product_id, body.client_ip, reqIp, ua],
        );
        return reply.code(400).send({ success: false, message: 'Tool disabled' });
      }

      const token = await createLaunchToken({
        resellerId: tool.reseller_id,
        toolId: tool.id,
        source: 'admin_access',
        payload: {
          username: body.username,
          product_id: body.product_id,
          client_ip: body.client_ip,
        },
      });

      await pool.query(
        `INSERT INTO access_logs
          (reseller_id, tool_id, username, product_id, client_ip, request_ip, user_agent, success, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'admin_access')`,
        [tool.reseller_id, tool.id, body.username, body.product_id, body.client_ip, reqIp, ua],
      );

      const brand = parseBrandSettings(
        tool.reseller_settings,
        String(tool.reseller_slug || ''),
        String(tool.reseller_name || tool.reseller_slug || ''),
      );
      const siteLabel =
        brand.name ||
        String(tool.reseller_name || '') ||
        String(tool.reseller_slug || 'Member');
      let siteHost = '';
      try {
        if (brand.member_domain) {
          siteHost = brand.member_domain.includes('://')
            ? new URL(brand.member_domain).host
            : brand.member_domain.replace(/^www\./, '');
        } else if (brand.membership_home) {
          siteHost = new URL(brand.membership_home).host;
        }
      } catch {
        siteHost = brand.member_domain || '';
      }

      // One-time token only in the URL — identity travels in the POST body / bridge meta
      const launchUrl = `${env.adminOrigin}/launch?token=${encodeURIComponent(token)}`;
      return {
        success: true,
        token,
        launch_url: launchUrl,
        web_url: tool.web_url,
        tool_name: tool.name,
        tool_key: tool.tool_key,
        expires_in: env.tokenTtlSeconds,
        client_ip: body.client_ip,
        client: tool.reseller_slug || null,
        username: body.username,
        product_id: body.product_id,
        site: siteLabel,
        host: siteHost || null,
      };
    } catch (err) {
      return sendErr(reply, err);
    }
  });
};