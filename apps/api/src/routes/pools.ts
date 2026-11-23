import type { FastifyPluginAsync } from 'fastify';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { randomBytes } from 'node:crypto';
import { encryptCookieData, sha256Hex } from '@oneclk/crypto';
import { z } from 'zod';
import { pool } from '../db.js';
import { sendErr, requireMaster, scopedResellerId } from '../authz.js';
import { requireUser } from '../session.js';

type PoolRow = RowDataPacket & {
  id: number;
  name: string;
  created_by_reseller_id: number | null;
  updated_at: Date | null;
  updated_by_tool_id: number | null;
  member_count: number;
  has_cookie: number;
};

const createPoolSchema = z.object({
  name: z.string().trim().min(1).max(255),
  seed_tool_id: z.number().int().positive().optional(),
  /** Extra tools to link at create time (Azad 10-tools style). */
  member_tool_ids: z.array(z.number().int().positive()).max(100).optional(),
});

async function linkToolToPool(
  user: ReturnType<typeof requireUser>,
  poolId: number,
  toolId: number,
  poolRow: { cookie_payload: string | null; cookie_password: string | null },
) {
  const tool = await assertTool(user, toolId);
  if (tool.pool_id && tool.pool_id !== poolId) {
    const err = new Error(`Tool #${toolId} already in another pool — leave first`) as Error & {
      statusCode: number;
    };
    err.statusCode = 400;
    throw err;
  }
  await pool.query(
    'INSERT INTO cookie_sync_members (pool_id, tool_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE pool_id = VALUES(pool_id)',
    [poolId, toolId],
  );
  if (poolRow.cookie_payload) {
    await pool.query(
      'UPDATE tools SET pool_id = ?, cookie_payload = ?, cookie_password = ?, config_version = config_version + 1 WHERE id = ?',
      [poolId, poolRow.cookie_payload, poolRow.cookie_password, toolId],
    );
  } else {
    await pool.query('UPDATE tools SET pool_id = ? WHERE id = ?', [poolId, toolId]);
  }
}

async function assertTool(user: ReturnType<typeof requireUser>, toolId: number) {
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT id, reseller_id, pool_id, cookie_payload, cookie_password FROM tools WHERE id = ? LIMIT 1',
    [toolId],
  );
  const tool = rows[0];
  if (!tool) {
    const err = new Error('Tool not found') as Error & { statusCode: number };
    err.statusCode = 404;
    throw err;
  }
  scopedResellerId(user, tool.reseller_id);
  return tool as RowDataPacket & {
    id: number;
    reseller_id: number;
    pool_id: number | null;
    cookie_payload: string | null;
    cookie_password: string | null;
  };
}

export const poolRoutes: FastifyPluginAsync = async (app) => {
  // Tool groups / cookie pools — master admin only
  app.addHook('preHandler', async (req) => {
    requireMaster(req);
  });

  app.get('/api/cookie-pools', async (req, reply) => {
    try {
      requireUser(req);
      const sql = `
        SELECT p.id, p.name, p.created_by_reseller_id, p.updated_at, p.updated_by_tool_id,
               (SELECT COUNT(*) FROM cookie_sync_members m WHERE m.pool_id = p.id) AS member_count,
               (p.cookie_payload IS NOT NULL AND p.cookie_payload <> '') AS has_cookie
        FROM cookie_sync_pools p
        ORDER BY p.id DESC LIMIT 200
      `;
      const [rows] = await pool.query<PoolRow[]>(sql);
      return { success: true, items: rows };
    } catch (err) {
      return sendErr(reply, err);
    }
  });

  app.get('/api/cookie-pools/:id', async (req, reply) => {
    try {
      requireUser(req);
      const id = Number((req.params as { id: string }).id);
      const [pools] = await pool.query<PoolRow[]>(
        `SELECT p.id, p.name, p.created_by_reseller_id, p.updated_at, p.updated_by_tool_id,
                (SELECT COUNT(*) FROM cookie_sync_members m WHERE m.pool_id = p.id) AS member_count,
                (p.cookie_payload IS NOT NULL AND p.cookie_payload <> '') AS has_cookie
         FROM cookie_sync_pools p WHERE p.id = ? LIMIT 1`,
        [id],
      );
      const p = pools[0];
      if (!p) return reply.code(404).send({ success: false, message: 'Pool not found' });

      const [members] = await pool.query<RowDataPacket[]>(
        `SELECT t.id AS tool_id, t.name, t.tool_key, t.reseller_id, r.slug AS reseller_slug
         FROM cookie_sync_members m
         JOIN tools t ON t.id = m.tool_id
         JOIN resellers r ON r.id = t.reseller_id
         WHERE m.pool_id = ?
         ORDER BY t.id`,
        [id],
      );

      return { success: true, item: p, members };
    } catch (err) {
      return sendErr(reply, err);
    }
  });

  app.post('/api/cookie-pools', async (req, reply) => {
    try {
      const user = requireUser(req);
      const body = createPoolSchema.parse(req.body);
      let seedPayload: string | null = null;
      let seedPassword: string | null = null;
      let seedToolId: number | null = null;
      let creatorResellerId = user.reseller_id;

      if (body.seed_tool_id) {
        const tool = await assertTool(user, body.seed_tool_id);
        seedPayload = tool.cookie_payload;
        seedPassword = tool.cookie_password;
        seedToolId = tool.id;
        creatorResellerId = tool.reseller_id;
      } else if (user.role === 'master' && !creatorResellerId) {
        // master creating empty pool without seed — allow null creator
        creatorResellerId = null;
      } else if (!creatorResellerId) {
        return reply.code(400).send({ success: false, message: 'seed_tool_id required' });
      }

      const [res] = await pool.query<ResultSetHeader>(
        `INSERT INTO cookie_sync_pools
          (name, created_by_reseller_id, cookie_payload, cookie_password, payload_sha256, updated_by_tool_id, updated_by_admin_id, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          body.name,
          creatorResellerId,
          seedPayload,
          seedPassword,
          seedPayload ? sha256Hex(seedPayload) : null,
          seedToolId,
          user.id,
        ],
      );
      const poolId = res.insertId;

      const [poolRows] = await pool.query<RowDataPacket[]>(
        'SELECT cookie_payload, cookie_password FROM cookie_sync_pools WHERE id = ? LIMIT 1',
        [poolId],
      );
      const poolCookie = {
        cookie_payload: (poolRows[0]?.cookie_payload as string | null) ?? null,
        cookie_password: (poolRows[0]?.cookie_password as string | null) ?? null,
      };

      const memberIds = new Set<number>();
      if (seedToolId) memberIds.add(seedToolId);
      for (const mid of body.member_tool_ids || []) memberIds.add(mid);

      for (const mid of memberIds) {
        await linkToolToPool(user, poolId, mid, poolCookie);
      }

      await pool.query(
        `INSERT INTO audit_logs (actor_admin_id, reseller_id, action, entity_type, entity_id, meta)
         VALUES (?, ?, 'pool.create', 'cookie_pool', ?, ?)`,
        [
          user.id,
          creatorResellerId,
          String(poolId),
          JSON.stringify({ seed_tool_id: seedToolId, member_tool_ids: [...memberIds] }),
        ],
      );

      return reply
        .code(201)
        .send({ success: true, item: { id: poolId, name: body.name, member_count: memberIds.size } });
    } catch (err) {
      return sendErr(reply, err);
    }
  });

  /** Link one or many tools into a pool. */
  app.post('/api/cookie-pools/:id/members', async (req, reply) => {
    try {
      const user = requireUser(req);
      const poolId = Number((req.params as { id: string }).id);
      const body = z
        .object({
          tool_id: z.number().int().positive().optional(),
          tool_ids: z.array(z.number().int().positive()).max(100).optional(),
        })
        .parse(req.body || {});
      const ids = [...new Set([...(body.tool_ids || []), ...(body.tool_id ? [body.tool_id] : [])])];
      if (!ids.length) return reply.code(400).send({ success: false, message: 'tool_id or tool_ids required' });

      const [pools] = await pool.query<RowDataPacket[]>(
        'SELECT id, cookie_payload, cookie_password FROM cookie_sync_pools WHERE id = ? LIMIT 1',
        [poolId],
      );
      const p = pools[0];
      if (!p) return reply.code(404).send({ success: false, message: 'Pool not found' });

      // Cross-reseller join: master only; same-reseller: ok
      if (user.role !== 'master') {
        const [creator] = await pool.query<RowDataPacket[]>(
          'SELECT created_by_reseller_id FROM cookie_sync_pools WHERE id = ?',
          [poolId],
        );
        const createdBy = creator[0]?.created_by_reseller_id;
        if (createdBy != null && createdBy !== user.reseller_id) {
          // allow if already a member reseller — else master must link cross-tenant
          const [existing] = await pool.query<RowDataPacket[]>(
            `SELECT 1 FROM cookie_sync_members m
             JOIN tools t ON t.id = m.tool_id
             WHERE m.pool_id = ? AND t.reseller_id = ? LIMIT 1`,
            [poolId, user.reseller_id],
          );
          if (!existing[0] && createdBy !== user.reseller_id) {
            return reply.code(403).send({
              success: false,
              message: 'Cross-reseller pool link requires master',
            });
          }
        }
      }

      // If pool empty, seed from first linked tool that has a cookie
      let poolCookie = {
        cookie_payload: (p.cookie_payload as string | null) ?? null,
        cookie_password: (p.cookie_password as string | null) ?? null,
      };
      if (!poolCookie.cookie_payload) {
        for (const toolId of ids) {
          const tool = await assertTool(user, toolId);
          if (tool.cookie_payload) {
            await pool.query(
              `UPDATE cookie_sync_pools
               SET cookie_payload = ?, cookie_password = ?, payload_sha256 = ?,
                   updated_by_tool_id = ?, updated_by_admin_id = ?, updated_at = NOW()
               WHERE id = ?`,
              [
                tool.cookie_payload,
                tool.cookie_password,
                sha256Hex(tool.cookie_payload),
                toolId,
                user.id,
                poolId,
              ],
            );
            poolCookie = {
              cookie_payload: tool.cookie_payload,
              cookie_password: tool.cookie_password,
            };
            break;
          }
        }
      }

      for (const toolId of ids) {
        await linkToolToPool(user, poolId, toolId, poolCookie);
      }

      return { success: true, linked: ids.length };
    } catch (err) {
      return sendErr(reply, err);
    }
  });

  app.delete('/api/cookie-pools/:id/members/:toolId', async (req, reply) => {
    try {
      const user = requireUser(req);
      const poolId = Number((req.params as { id: string }).id);
      const toolId = Number((req.params as { toolId: string }).toolId);
      const tool = await assertTool(user, toolId);

      const [pools] = await pool.query<RowDataPacket[]>(
        'SELECT cookie_payload, cookie_password FROM cookie_sync_pools WHERE id = ? LIMIT 1',
        [poolId],
      );
      const p = pools[0];
      if (!p) return reply.code(404).send({ success: false, message: 'Pool not found' });

      // Snapshot last pool cookie onto tool, then unlink
      if (p.cookie_payload) {
        await pool.query(
          'UPDATE tools SET cookie_payload = ?, cookie_password = ?, pool_id = NULL WHERE id = ?',
          [p.cookie_payload, p.cookie_password, toolId],
        );
      } else {
        await pool.query('UPDATE tools SET pool_id = NULL WHERE id = ?', [toolId]);
      }
      await pool.query('DELETE FROM cookie_sync_members WHERE pool_id = ? AND tool_id = ?', [poolId, toolId]);

      await pool.query(
        `INSERT INTO audit_logs (actor_admin_id, reseller_id, action, entity_type, entity_id, meta)
         VALUES (?, ?, 'pool.leave', 'cookie_pool', ?, ?)`,
        [user.id, tool.reseller_id, String(poolId), JSON.stringify({ tool_id: toolId })],
      );

      return { success: true };
    } catch (err) {
      return sendErr(reply, err);
    }
  });

  /** Write cookie to pool (bi-directional sync) */
  app.put('/api/cookie-pools/:id/cookie', async (req, reply) => {
    try {
      const user = requireUser(req);
      const poolId = Number((req.params as { id: string }).id);
      const body = req.body as {
        cookie_plain?: string;
        cookie_password?: string;
        from_tool_id?: number;
      };
      if (!body.cookie_plain?.trim()) {
        return reply.code(400).send({ success: false, message: 'cookie_plain required' });
      }

      const [members] = await pool.query<RowDataPacket[]>(
        `SELECT t.id, t.reseller_id FROM cookie_sync_members m
         JOIN tools t ON t.id = m.tool_id WHERE m.pool_id = ?`,
        [poolId],
      );
      if (!members.length) return reply.code(404).send({ success: false, message: 'Pool has no members' });

      if (user.role !== 'master') {
        const allowed = members.some((m) => m.reseller_id === user.reseller_id);
        if (!allowed) return reply.code(403).send({ success: false, message: 'Forbidden' });
      }

      const password =
        body.cookie_password ||
        (
          await pool.query<RowDataPacket[]>(
            'SELECT cookie_password FROM cookie_sync_pools WHERE id = ?',
            [poolId],
          )
        )[0][0]?.cookie_password ||
        cryptoRandom();

      const cipher = encryptCookieData(body.cookie_plain.trim(), password);
      await pool.query(
        `UPDATE cookie_sync_pools
         SET cookie_payload = ?, cookie_password = ?, payload_sha256 = ?,
             updated_by_tool_id = ?, updated_by_admin_id = ?, updated_at = NOW()
         WHERE id = ?`,
        [
          cipher,
          password,
          sha256Hex(cipher),
          body.from_tool_id ?? null,
          user.id,
          poolId,
        ],
      );

      // Mirror onto member tools for admin list "has_cookie" convenience
      await pool.query(
        `UPDATE tools SET cookie_payload = ?, cookie_password = ?, config_version = config_version + 1
         WHERE pool_id = ?`,
        [cipher, password, poolId],
      );

      await pool.query(
        `INSERT INTO audit_logs (actor_admin_id, reseller_id, action, entity_type, entity_id, meta)
         VALUES (?, ?, 'pool.cookie_update', 'cookie_pool', ?, ?)`,
        [
          user.id,
          user.reseller_id,
          String(poolId),
          JSON.stringify({
            payload_sha256: sha256Hex(cipher),
            synced_member_count: members.length,
            from_tool_id: body.from_tool_id ?? null,
          }),
        ],
      );

      return { success: true, synced_member_count: members.length };
    } catch (err) {
      return sendErr(reply, err);
    }
  });

  /** Rename group */
  app.patch('/api/cookie-pools/:id', async (req, reply) => {
    try {
      const user = requireUser(req);
      const poolId = Number((req.params as { id: string }).id);
      const body = z.object({ name: z.string().trim().min(1).max(255) }).parse(req.body);
      const [rows] = await pool.query<RowDataPacket[]>(
        'SELECT id, created_by_reseller_id FROM cookie_sync_pools WHERE id = ? LIMIT 1',
        [poolId],
      );
      const p = rows[0];
      if (!p) return reply.code(404).send({ success: false, message: 'Pool not found' });
      if (user.role !== 'master') {
        scopedResellerId(user, p.created_by_reseller_id);
      }
      await pool.query('UPDATE cookie_sync_pools SET name = ? WHERE id = ?', [body.name, poolId]);
      return { success: true };
    } catch (err) {
      return sendErr(reply, err);
    }
  });

  /** Delete group — members keep last cookie snapshot and leave. */
  app.delete('/api/cookie-pools/:id', async (req, reply) => {
    try {
      const user = requireUser(req);
      const poolId = Number((req.params as { id: string }).id);
      const [rows] = await pool.query<RowDataPacket[]>(
        'SELECT id, created_by_reseller_id, cookie_payload, cookie_password FROM cookie_sync_pools WHERE id = ? LIMIT 1',
        [poolId],
      );
      const p = rows[0];
      if (!p) return reply.code(404).send({ success: false, message: 'Pool not found' });
      if (user.role !== 'master') {
        scopedResellerId(user, p.created_by_reseller_id);
      }

      const [members] = await pool.query<RowDataPacket[]>(
        'SELECT tool_id FROM cookie_sync_members WHERE pool_id = ?',
        [poolId],
      );
      for (const m of members) {
        if (p.cookie_payload) {
          await pool.query(
            'UPDATE tools SET cookie_payload = ?, cookie_password = ?, pool_id = NULL WHERE id = ?',
            [p.cookie_payload, p.cookie_password, m.tool_id],
          );
        } else {
          await pool.query('UPDATE tools SET pool_id = NULL WHERE id = ?', [m.tool_id]);
        }
      }
      await pool.query('DELETE FROM cookie_sync_members WHERE pool_id = ?', [poolId]);
      await pool.query('DELETE FROM cookie_sync_pools WHERE id = ?', [poolId]);
      return { success: true, released_tools: members.length };
    } catch (err) {
      return sendErr(reply, err);
    }
  });
};

function cryptoRandom() {
  return randomBytes(12).toString('hex');
}