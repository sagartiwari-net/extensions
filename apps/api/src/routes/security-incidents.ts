import type { FastifyPluginAsync } from 'fastify';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import { z } from 'zod';
import { pool } from '../db.js';
import { requireUser } from '../session.js';
import { scopedResellerId, sendErr } from '../authz.js';
import { requestIp } from '../request-meta.js';

const reportSchema = z.object({
  client_slug: z.string().min(1).max(64),
  detection_type: z.string().min(1).max(64),
  page_url: z.string().max(1024).nullable().optional(),
  website_url: z.string().max(1024).nullable().optional(),
  tool_id: z.number().int().positive().nullable().optional(),
  tool_name: z.string().max(255).nullable().optional(),
  username: z.string().max(255).nullable().optional(),
  client_ip: z.string().max(64).nullable().optional(),
  reseller_id: z.number().int().positive().nullable().optional(),
  extension_id: z.string().max(128).nullable().optional(),
  product_id: z.string().max(64).nullable().optional(),
  mismatches: z.array(z.string()).max(200).optional(),
  meta: z.record(z.unknown()).optional(),
});

function cleanUsername(raw: unknown): string | null {
  const s = String(raw || '').trim();
  if (!s) return null;
  const lower = s.toLowerCase();
  if (lower === 'not available' || lower === 'unknown_user' || lower === 'unknown') return null;
  return s.slice(0, 255);
}

async function resolveResellerId(
  clientSlug: string,
  resellerId?: number | null,
): Promise<number | null> {
  if (resellerId) return resellerId;
  const [regs] = await pool.query<RowDataPacket[]>(
    'SELECT reseller_id FROM extension_registrations WHERE client_slug = ? LIMIT 1',
    [clientSlug],
  );
  if (regs[0]?.reseller_id) return Number(regs[0].reseller_id);
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT id FROM resellers WHERE slug = ? LIMIT 1',
    [clientSlug],
  );
  return rows[0] ? Number(rows[0].id) : null;
}

async function lookupUsernameByIp(
  ip: string | null,
  resellerId: number | null,
): Promise<string | null> {
  if (!ip) return null;
  const params: unknown[] = [ip];
  let resellerClause = '';
  if (resellerId) {
    resellerClause = ' AND reseller_id = ?';
    params.push(resellerId);
  }

  const [launches] = await pool.query<RowDataPacket[]>(
    `SELECT username FROM launch_events
     WHERE client_ip = ? AND username IS NOT NULL AND TRIM(username) != ''
       ${resellerClause}
     ORDER BY id DESC LIMIT 1`,
    params,
  );
  const fromLaunch = cleanUsername(launches[0]?.username);
  if (fromLaunch) return fromLaunch;

  const [access] = await pool.query<RowDataPacket[]>(
    `SELECT username FROM access_logs
     WHERE (client_ip = ? OR request_ip = ?) AND username IS NOT NULL AND TRIM(username) != ''
       ${resellerId ? ' AND reseller_id = ?' : ''}
     ORDER BY id DESC LIMIT 1`,
    resellerId ? [ip, ip, resellerId] : [ip, ip],
  );
  return cleanUsername(access[0]?.username);
}

export const securityIncidentRoutes: FastifyPluginAsync = async (app) => {
  /** Extension posts before self-disable — no admin session */
  app.post('/api/security/devtools-report', async (req, reply) => {
    try {
      const body = reportSchema.parse(req.body);
      const reqIp = requestIp(req);
      const resellerId = await resolveResellerId(body.client_slug, body.reseller_id ?? null);

      let username = cleanUsername(body.username);
      let usernameSource: 'launch' | 'stored' | 'ip_lookup' | 'missing' = username
        ? 'stored'
        : 'missing';

      const memberIp = String(body.client_ip || '').trim() || reqIp || null;
      if (!username && memberIp) {
        const found = await lookupUsernameByIp(memberIp, resellerId);
        if (found) {
          username = found;
          usernameSource = 'ip_lookup';
        }
      }
      if (!username) {
        username = 'not available';
        usernameSource = 'missing';
      }

      const [result] = await pool.query<ResultSetHeader>(
        `INSERT INTO security_incidents
          (reseller_id, client_slug, detection_type, page_url, website_url, tool_id, tool_name,
           username, client_ip, request_ip, extension_id, username_source, meta)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          resellerId,
          body.client_slug,
          body.detection_type,
          body.page_url || null,
          body.website_url || null,
          body.tool_id || null,
          body.tool_name || null,
          username,
          body.client_ip || memberIp || null,
          reqIp || null,
          body.extension_id || null,
          usernameSource,
          JSON.stringify({
            product_id: body.product_id || null,
            reported_username: body.username || null,
            mismatches: body.mismatches || [],
            ...(body.meta || {}),
          }),
        ],
      );


      return {
        success: true,
        id: result.insertId,
        username,
        username_source: usernameSource,
      };
    } catch (err) {
      return sendErr(reply, err);
    }
  });

  /** Admin list — optional type=inspect|tamper|all */
  app.get('/api/security/incidents', async (req, reply) => {
    try {
      const user = requireUser(req);
      const q = req.query as {
        limit?: string;
        q?: string;
        reseller_id?: string;
        type?: string;
      };
      const scope = scopedResellerId(
        user,
        q.reseller_id ? Number(q.reseller_id) : null,
      );
      const limit = Math.min(Number(q.limit) || 100, 500);
      const search = String(q.q || '').trim();
      const type = String(q.type || 'all');

      const clauses: string[] = [];
      const params: unknown[] = [];
      if (scope != null) {
        clauses.push('si.reseller_id = ?');
        params.push(scope);
      }
      if (type === 'tamper') {
        clauses.push(`si.detection_type = 'integrity_tamper'`);
      } else if (type === 'inspect') {
        clauses.push(`si.detection_type <> 'integrity_tamper'`);
      }
      if (search) {
        clauses.push(
          '(si.username LIKE ? OR si.client_ip LIKE ? OR si.page_url LIKE ? OR si.detection_type LIKE ? OR si.tool_name LIKE ?)',
        );
        const like = `%${search}%`;
        params.push(like, like, like, like, like);
      }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      params.push(limit);

      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT si.id, si.reseller_id, r.slug AS reseller_slug, si.client_slug, si.detection_type,
                si.page_url, si.website_url, si.tool_id, si.tool_name, si.username, si.client_ip,
                si.request_ip, si.extension_id, si.username_source, si.meta, si.created_at
         FROM security_incidents si
         LEFT JOIN resellers r ON r.id = si.reseller_id
         ${where}
         ORDER BY si.id DESC
         LIMIT ?`,
        params,
      );
      return {
        success: true,
        items: rows.map((row) => ({
          ...row,
          meta: typeof row.meta === 'string' ? JSON.parse(row.meta) : row.meta,
        })),
      };
    } catch (err) {
      return sendErr(reply, err);
    }
  });
};
