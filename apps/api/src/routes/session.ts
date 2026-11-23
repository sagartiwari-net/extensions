import type { FastifyPluginAsync } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import type { RowDataPacket } from 'mysql2';
import { initiateSessionSchema } from '@oneclk/shared';
import { pool } from '../db.js';
import { sendErr } from '../authz.js';
import { env } from '../env.js';
import { consumeSessionToken, createLaunchToken, peekLaunchToken } from '../launch.js';
import { parseBrandSettings } from '../lib/extension-packager.js';
import { requestIp, requestUserAgent } from '../request-meta.js';

function secretsEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** Soft block: last access_log for username/IP was an explicit block deny */
async function isAccessBlocked(opts: {
  resellerId: number;
  username: string;
  clientIp: string | null;
}): Promise<string | null> {
  const [byUser] = await pool.query<RowDataPacket[]>(
    `SELECT deny_reason FROM access_logs
     WHERE reseller_id = ? AND username = ? AND success = 0
       AND deny_reason IS NOT NULL AND deny_reason LIKE 'block%'
     ORDER BY id DESC LIMIT 1`,
    [opts.resellerId, opts.username],
  );
  if (byUser[0]?.deny_reason) return String(byUser[0].deny_reason);

  if (opts.clientIp) {
    const [byIp] = await pool.query<RowDataPacket[]>(
      `SELECT deny_reason FROM access_logs
       WHERE reseller_id = ? AND (client_ip = ? OR request_ip = ?) AND success = 0
         AND deny_reason IS NOT NULL AND deny_reason LIKE 'block%'
       ORDER BY id DESC LIMIT 1`,
      [opts.resellerId, opts.clientIp, opts.clientIp],
    );
    if (byIp[0]?.deny_reason) return String(byIp[0].deny_reason);
  }
  return null;
}

export const sessionRoutes: FastifyPluginAsync = async (app) => {
  /** Member / aMember style initiate — requires member_secret (admin uses /api/tools/:id/access) */
  app.post('/api/session/initiate', async (req, reply) => {
    try {
      const body = initiateSessionSchema.parse(req.body);
      const reqIp = requestIp(req);
      const ua = requestUserAgent(req);
      const clientIp = body.client_ip || reqIp || null;

      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT t.id AS tool_id, t.reseller_id, t.name AS tool_name, t.status,
                r.is_active AS reseller_active, r.slug AS reseller_slug, r.name AS reseller_name,
                r.member_secret, r.settings AS reseller_settings
         FROM tools t
         JOIN resellers r ON r.id = t.reseller_id
         WHERE r.slug = ? AND t.tool_key = ?
         LIMIT 1`,
        [body.reseller_slug, body.tool_key],
      );
      const row = rows[0];
      if (!row || !row.reseller_active) {
        return reply.code(404).send({ success: false, message: 'Tool not found for reseller' });
      }
      const expected = String(row.member_secret || '');
      if (!expected || !secretsEqual(expected, body.member_secret)) {
        await pool.query(
          `INSERT INTO access_logs
            (reseller_id, tool_id, username, product_id, client_ip, request_ip, user_agent, success, deny_reason, source)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'invalid_member_secret', ?)`,
          [
            row.reseller_id,
            row.tool_id,
            body.username,
            body.product_id,
            clientIp,
            reqIp,
            ua,
            body.source,
          ],
        );
        return reply.code(401).send({ success: false, message: 'Invalid member_secret' });
      }

      const blockReason = await isAccessBlocked({
        resellerId: row.reseller_id,
        username: body.username,
        clientIp,
      });
      if (blockReason) {
        await pool.query(
          `INSERT INTO access_logs
            (reseller_id, tool_id, username, product_id, client_ip, request_ip, user_agent, success, deny_reason, source)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
          [
            row.reseller_id,
            row.tool_id,
            body.username,
            body.product_id,
            clientIp,
            reqIp,
            ua,
            blockReason,
            body.source,
          ],
        );
        return reply.code(403).send({
          success: false,
          message: 'Access blocked. Contact your service provider.',
          blocked: true,
          reason_label: blockReason,
        });
      }

      if (row.status === 'disabled') {
        await pool.query(
          `INSERT INTO access_logs
            (reseller_id, tool_id, username, product_id, client_ip, request_ip, user_agent, success, deny_reason, source)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'tool_disabled', ?)`,
          [
            row.reseller_id,
            row.tool_id,
            body.username,
            body.product_id,
            clientIp,
            reqIp,
            ua,
            body.source,
          ],
        );
        return reply.code(400).send({ success: false, message: 'Tool disabled' });
      }
      if (row.status === 'updating') {
        await pool.query(
          `INSERT INTO access_logs
            (reseller_id, tool_id, username, product_id, client_ip, request_ip, user_agent, success, deny_reason, source)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'tool_updating', ?)`,
          [
            row.reseller_id,
            row.tool_id,
            body.username,
            body.product_id,
            clientIp,
            reqIp,
            ua,
            body.source,
          ],
        );
        return reply.code(403).send({
          success: false,
          message: 'This tool is updating — try again in a few minutes.',
        });
      }

      const token = await createLaunchToken({
        resellerId: row.reseller_id,
        toolId: row.tool_id,
        source: body.source,
        payload: {
          username: body.username,
          product_id: body.product_id,
          client_ip: clientIp,
          website_url: body.website_url ?? null,
          email: body.email ?? null,
        },
      });

      await pool.query(
        `INSERT INTO access_logs
          (reseller_id, tool_id, username, product_id, client_ip, request_ip, user_agent, success, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        [
          row.reseller_id,
          row.tool_id,
          body.username,
          body.product_id,
          clientIp,
          reqIp,
          ua,
          body.source,
        ],
      );

      // URL carries only the one-time token
      const launchUrl = `${env.adminOrigin}/launch?token=${encodeURIComponent(token)}`;
      const brand = parseBrandSettings(row.reseller_settings, row.reseller_slug, row.reseller_name);
      return {
        success: true,
        token,
        launch_url: launchUrl,
        expires_in: env.tokenTtlSeconds,
        tool_key: body.tool_key,
        tool_name: row.tool_name,
        client: row.reseller_slug,
        username: body.username,
        product_id: body.product_id,
        site: brand.name || row.reseller_name || row.reseller_slug,
      };
    } catch (err) {
      return sendErr(reply, err);
    }
  });

  /** Bridge UI — username / site from token without consuming it */
  app.get('/api/session/peek', async (req, reply) => {
    try {
      const token = String((req.query as { token?: string }).token || '');
      if (!token) return reply.code(400).send({ success: false, message: 'token required' });
      const meta = await peekLaunchToken(token);
      return { success: true, ...meta };
    } catch (err) {
      return sendErr(reply, err);
    }
  });

  /** Extension pulls session once */
  app.get('/api/session/data', async (req, reply) => {
    try {
      const token = String((req.query as { token?: string }).token || '');
      if (!token) return reply.code(400).send({ success: false, message: 'token required' });
      const data = await consumeSessionToken(token);
      return { success: true, data };
    } catch (err) {
      return sendErr(reply, err);
    }
  });

  app.post('/api/launch-events', async (req, reply) => {
    try {
      const body = req.body as {
        reseller_id?: number;
        tool_id?: number;
        success?: boolean;
        reason?: string;
        inject_strategy?: string;
        duration_ms?: number;
        extension_id?: string;
        username?: string;
        client_ip?: string;
        product_id?: string;
      };
      if (!body.reseller_id || !body.tool_id || typeof body.success !== 'boolean') {
        return reply.code(400).send({ success: false, message: 'invalid payload' });
      }
      await pool.query(
        `INSERT INTO launch_events
          (reseller_id, tool_id, success, reason, inject_strategy, duration_ms, extension_id, username, client_ip, product_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          body.reseller_id,
          body.tool_id,
          body.success ? 1 : 0,
          body.reason ?? null,
          body.inject_strategy ?? null,
          body.duration_ms ?? null,
          body.extension_id ?? null,
          body.username ?? null,
          body.client_ip ?? null,
          body.product_id ?? null,
        ],
      );
      return { success: true };
    } catch (err) {
      return sendErr(reply, err);
    }
  });
};
