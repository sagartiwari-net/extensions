import type { FastifyPluginAsync } from 'fastify';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { pool } from '../db.js';
import { sendErr, scopedResellerId } from '../authz.js';
import { requireUser } from '../session.js';

const hashesSchema = z.record(z.string().min(1), z.string().regex(/^[a-f0-9]{64}$/i));

const upsertRegSchema = z.object({
  reseller_id: z.number().int().positive(),
  client_slug: z.string().trim().min(1).max(64),
  extension_id: z.string().trim().min(1).max(128),
  file_hashes: hashesSchema.default({}),
  integrity_mode: z.enum(['off', 'warn', 'block']).default('warn'),
  is_active: z.boolean().optional(),
});

export const extensionRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/extensions', async (req, reply) => {
    try {
      const user = requireUser(req);
      const rid = scopedResellerId(
        user,
        (req.query as { reseller_id?: string }).reseller_id
          ? Number((req.query as { reseller_id: string }).reseller_id)
          : null,
      );
      const params: number[] = [];
      let where = '1=1';
      if (rid != null) {
        where = 'e.reseller_id = ?';
        params.push(rid);
      }
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT e.id, e.reseller_id, r.slug AS reseller_slug, r.name AS reseller_name,
                e.client_slug, e.extension_id, e.file_hashes, e.integrity_mode,
                e.is_active, e.updated_at,
                (SELECT mode FROM extension_allow_policies p WHERE p.reseller_id = e.reseller_id LIMIT 1) AS allow_mode
         FROM extension_registrations e
         JOIN resellers r ON r.id = e.reseller_id
         WHERE ${where}
         ORDER BY e.id DESC`,
        params,
      );
      return {
        success: true,
        items: rows.map((row) => ({
          ...row,
          file_hashes:
            typeof row.file_hashes === 'string' ? JSON.parse(row.file_hashes) : row.file_hashes,
        })),
      };
    } catch (err) {
      return sendErr(reply, err);
    }
  });

  /**
   * Paths to live-hash (no expected hashes — those stay server-side only).
   * Extension hashes local files, then POSTs to check-integrity.
   */
  app.get('/api/extensions/integrity-files', async (req, reply) => {
    try {
      const slug = String((req.query as { client_slug?: string }).client_slug || '').trim();
      if (!slug) return reply.code(400).send({ success: false, message: 'client_slug required' });
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT file_hashes, is_active FROM extension_registrations WHERE client_slug = ? LIMIT 1`,
        [slug],
      );
      const reg = rows[0];
      if (!reg || !reg.is_active) {
        return { success: true, files: [] };
      }
      const expected =
        typeof reg.file_hashes === 'string' ? JSON.parse(reg.file_hashes) : reg.file_hashes || {};
      return { success: true, files: Object.keys(expected as Record<string, string>).sort() };
    } catch (err) {
      return sendErr(reply, err);
    }
  });

  /** Soft integrity check from extension (no admin session) — before :id */
  app.post('/api/extensions/check-integrity', async (req, reply) => {
    try {
      const body = z
        .object({
          client_slug: z.string().trim().min(1),
          extension_id: z.string().trim().min(1),
          file_hashes: hashesSchema,
        })
        .parse(req.body);

      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, extension_id, file_hashes, integrity_mode, is_active
         FROM extension_registrations WHERE client_slug = ? LIMIT 1`,
        [body.client_slug],
      );
      const reg = rows[0];
      if (!reg || !reg.is_active) {
        return { success: true, status: 'unregistered', action: 'allow' };
      }

      const expected =
        typeof reg.file_hashes === 'string' ? JSON.parse(reg.file_hashes) : reg.file_hashes || {};
      const mismatches: string[] = [];
      for (const [path, hash] of Object.entries(expected as Record<string, string>)) {
        const got = body.file_hashes[path];
        if (!got || got.toLowerCase() !== String(hash).toLowerCase()) {
          mismatches.push(path);
        }
      }

      const registeredId = String(reg.extension_id || '').trim();
      const idPending =
        !registeredId || registeredId === 'pending' || registeredId === 'unassigned';
      const fileOk = mismatches.length === 0;

      // Only claim Chrome ID after file hashes match (never on tampered first load)
      if (idPending && fileOk && body.extension_id) {
        await pool.query(
          `UPDATE extension_registrations SET extension_id = ?, updated_at = NOW()
           WHERE id = ? AND (extension_id IS NULL OR extension_id IN ('pending','unassigned',''))`,
          [body.extension_id, reg.id],
        );
      } else if (!idPending && registeredId && registeredId !== body.extension_id) {
        mismatches.push('extension_id');
      }

      const mode = reg.integrity_mode as 'off' | 'warn' | 'block';
      if (mode === 'off' || mismatches.length === 0) {
        return { success: true, status: 'ok', action: 'allow', mismatches: [] };
      }
      if (mode === 'warn') {
        return { success: true, status: 'mismatch', action: 'warn', mismatches };
      }
      return { success: true, status: 'mismatch', action: 'block', mismatches };
    } catch (err) {
      return sendErr(reply, err);
    }
  });

  app.get('/api/extensions/policy', async (req, reply) => {
    try {
      const slug = String((req.query as { client_slug?: string }).client_slug || '');
      if (!slug) return reply.code(400).send({ success: false, message: 'client_slug required' });
      const [regs] = await pool.query<RowDataPacket[]>(
        'SELECT reseller_id, integrity_mode, extension_id FROM extension_registrations WHERE client_slug = ? LIMIT 1',
        [slug],
      );
      if (!regs[0]) {
        return { success: true, integrity_mode: 'off', allow_mode: 'off', allowed: [], blocked: [] };
      }
      const [pol] = await pool.query<RowDataPacket[]>(
        'SELECT id, mode FROM extension_allow_policies WHERE reseller_id = ? LIMIT 1',
        [regs[0].reseller_id],
      );
      let allowed: string[] = [];
      if (pol[0]?.mode === 'whitelist') {
        const [ents] = await pool.query<RowDataPacket[]>(
          'SELECT extension_id FROM extension_allow_entries WHERE policy_id = ?',
          [pol[0].id],
        );
        allowed = ents.map((e) => e.extension_id);
        // Auto-allow only a real claimed Chrome ID (32 chars) — never pending/placeholders
        const rid = String(regs[0].extension_id || '').trim();
        const realChromeId = /^[a-p]{32}$/i.test(rid);
        if (realChromeId && !allowed.includes(rid)) {
          allowed = [...allowed, rid];
        }
      }
      return {
        success: true,
        integrity_mode: regs[0].integrity_mode,
        registered_extension_id: regs[0].extension_id,
        allow_mode: pol[0]?.mode || 'off',
        allowed,
        blocked: [],
      };
    } catch (err) {
      return sendErr(reply, err);
    }
  });

  /** Extension posts installed inventory (no admin session) */
  app.post('/api/extensions/scan', async (req, reply) => {
    try {
      const body = z
        .object({
          reporter_id: z.string().trim().min(1).max(128),
          client_slug: z.string().trim().min(1).max(64),
          extensions: z
            .array(
              z.object({
                id: z.string(),
                name: z.string().optional(),
                install_type: z.string().optional(),
                enabled: z.boolean().optional(),
                uses_cookies: z.boolean().optional(),
              }),
            )
            .max(500),
        })
        .parse(req.body);

      const [regs] = await pool.query<RowDataPacket[]>(
        'SELECT reseller_id FROM extension_registrations WHERE client_slug = ? LIMIT 1',
        [body.client_slug],
      );
      const resellerId = regs[0]?.reseller_id ?? null;
      const risky = body.extensions.filter((e) => e.uses_cookies);
      const enabledRisky = risky.filter((e) => e.enabled);

      await pool.query(
        `INSERT INTO extension_scans
          (reseller_id, client_slug, reporter_id, extensions_json, risky_count, enabled_risky_count)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          resellerId,
          body.client_slug,
          body.reporter_id,
          JSON.stringify(body.extensions),
          risky.length,
          enabledRisky.length,
        ],
      );
      return { success: true, risky_count: risky.length, enabled_risky_count: enabledRisky.length };
    } catch (err) {
      return sendErr(reply, err);
    }
  });

  app.get('/api/extensions/scans', async (req, reply) => {
    try {
      const user = requireUser(req);
      const q = req.query as { reseller_id?: string; limit?: string };
      const rid = scopedResellerId(user, q.reseller_id ? Number(q.reseller_id) : null);
      const limit = Math.min(Number(q.limit) || 50, 200);
      const params: unknown[] = [];
      let where = '1=1';
      if (rid != null) {
        where = 's.reseller_id = ?';
        params.push(rid);
      }
      params.push(limit);
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT s.id, s.reseller_id, s.client_slug, s.reporter_id, s.extensions_json,
                s.risky_count, s.enabled_risky_count, s.created_at
         FROM extension_scans s
         WHERE ${where}
         ORDER BY s.id DESC
         LIMIT ?`,
        params,
      );
      return {
        success: true,
        items: rows.map((row) => ({
          ...row,
          extensions_json:
            typeof row.extensions_json === 'string'
              ? JSON.parse(row.extensions_json)
              : row.extensions_json,
        })),
      };
    } catch (err) {
      return sendErr(reply, err);
    }
  });

  app.get('/api/extensions/:id', async (req, reply) => {
    try {
      const user = requireUser(req);
      const id = Number((req.params as { id: string }).id);
      if (!Number.isFinite(id)) {
        return reply.code(400).send({ success: false, message: 'Invalid id' });
      }
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT e.*, r.slug AS reseller_slug, r.name AS reseller_name
         FROM extension_registrations e
         JOIN resellers r ON r.id = e.reseller_id
         WHERE e.id = ? LIMIT 1`,
        [id],
      );
      const row = rows[0];
      if (!row) return reply.code(404).send({ success: false, message: 'Not found' });
      scopedResellerId(user, row.reseller_id);
      const [pol] = await pool.query<RowDataPacket[]>(
        'SELECT id, mode FROM extension_allow_policies WHERE reseller_id = ? LIMIT 1',
        [row.reseller_id],
      );
      let entries: RowDataPacket[] = [];
      if (pol[0]) {
        const [ents] = await pool.query<RowDataPacket[]>(
          'SELECT id, extension_id, note FROM extension_allow_entries WHERE policy_id = ?',
          [pol[0].id],
        );
        entries = ents;
      }
      return {
        success: true,
        item: {
          id: row.id,
          reseller_id: row.reseller_id,
          reseller_slug: row.reseller_slug,
          reseller_name: row.reseller_name,
          client_slug: row.client_slug,
          extension_id: row.extension_id,
          file_hashes:
            typeof row.file_hashes === 'string' ? JSON.parse(row.file_hashes) : row.file_hashes,
          integrity_mode: row.integrity_mode,
          is_active: row.is_active,
          updated_at: row.updated_at,
          allow_policy: pol[0] ? { mode: pol[0].mode, entries } : { mode: 'off', entries: [] },
        },
      };
    } catch (err) {
      return sendErr(reply, err);
    }
  });

  app.post('/api/extensions', async (req, reply) => {
    try {
      const user = requireUser(req);
      const body = upsertRegSchema.parse(req.body);
      scopedResellerId(user, body.reseller_id);
      const secret = randomBytes(24).toString('hex');

      const [existing] = await pool.query<RowDataPacket[]>(
        'SELECT id, extension_id FROM extension_registrations WHERE reseller_id = ? LIMIT 1',
        [body.reseller_id],
      );
      const curId = String(existing[0]?.extension_id || '');
      const pending = !curId || curId === 'pending' || curId === 'unassigned';
      // Don't let Extensions form overwrite pending after My extension generate
      // (Chrome ID is claimed via check-integrity). Master may force-set.
      const nextExtId =
        user.role === 'master' || !existing[0] || !pending
          ? body.extension_id
          : curId;

      // Preserve generated hashes if UI posts empty {}
      let nextHashes = body.file_hashes || {};
      if (existing[0]) {
        const [cur] = await pool.query<RowDataPacket[]>(
          'SELECT file_hashes FROM extension_registrations WHERE id = ? LIMIT 1',
          [existing[0].id],
        );
        const prev =
          typeof cur[0]?.file_hashes === 'string'
            ? (JSON.parse(cur[0].file_hashes) as Record<string, string>)
            : (cur[0]?.file_hashes as Record<string, string>) || {};
        const incomingEmpty = !nextHashes || Object.keys(nextHashes).length === 0;
        if (incomingEmpty && prev && Object.keys(prev).length > 0) {
          nextHashes = prev;
        }
      }

      await pool.query(
        `INSERT INTO extension_registrations
          (reseller_id, client_slug, extension_id, file_hashes, secret, integrity_mode, is_active)
         VALUES (?, ?, ?, ?, ?, ?, 1)
         ON DUPLICATE KEY UPDATE
           client_slug = VALUES(client_slug),
           extension_id = VALUES(extension_id),
           file_hashes = VALUES(file_hashes),
           integrity_mode = VALUES(integrity_mode),
           is_active = 1`,
        [
          body.reseller_id,
          body.client_slug,
          nextExtId,
          JSON.stringify(nextHashes),
          secret,
          body.integrity_mode,
        ],
      );
      const [found] = await pool.query<RowDataPacket[]>(
        'SELECT id FROM extension_registrations WHERE reseller_id = ? LIMIT 1',
        [body.reseller_id],
      );
      return reply.code(201).send({ success: true, item: { id: found[0]?.id } });
    } catch (err) {
      return sendErr(reply, err);
    }
  });

  app.patch('/api/extensions/:id', async (req, reply) => {
    try {
      const user = requireUser(req);
      const id = Number((req.params as { id: string }).id);
      const body = z
        .object({
          extension_id: z.string().trim().min(1).max(128).optional(),
          client_slug: z.string().trim().min(1).max(64).optional(),
          file_hashes: hashesSchema.optional(),
          integrity_mode: z.enum(['off', 'warn', 'block']).optional(),
          is_active: z.boolean().optional(),
        })
        .parse(req.body);

      const [rows] = await pool.query<RowDataPacket[]>(
        'SELECT id, reseller_id FROM extension_registrations WHERE id = ? LIMIT 1',
        [id],
      );
      if (!rows[0]) return reply.code(404).send({ success: false, message: 'Not found' });
      scopedResellerId(user, rows[0].reseller_id);

      const sets: string[] = [];
      const vals: unknown[] = [];
      if (body.extension_id != null) {
        // Resellers cannot manually set Chrome ID (use generate → check-integrity claim)
        if (user.role !== 'master') {
          return reply.code(403).send({
            success: false,
            message: 'Only master can set extension_id manually',
          });
        }
        sets.push('extension_id = ?');
        vals.push(body.extension_id);
      }
      if (body.client_slug != null) {
        sets.push('client_slug = ?');
        vals.push(body.client_slug);
      }
      if (body.file_hashes != null) {
        if (user.role !== 'master') {
          return reply.code(403).send({
            success: false,
            message: 'Only master can replace file_hashes (use My extension → Generate)',
          });
        }
        sets.push('file_hashes = ?');
        vals.push(JSON.stringify(body.file_hashes));
      }
      if (body.integrity_mode != null) {
        if (user.role !== 'master') {
          return reply.code(403).send({
            success: false,
            message: 'Only master can change integrity_mode',
          });
        }
        sets.push('integrity_mode = ?');
        vals.push(body.integrity_mode);
      }
      if (body.is_active != null) {
        if (user.role !== 'master') {
          return reply.code(403).send({
            success: false,
            message: 'Only master can activate/deactivate registration',
          });
        }
        sets.push('is_active = ?');
        vals.push(body.is_active ? 1 : 0);
      }
      if (!sets.length) return reply.code(400).send({ success: false, message: 'Nothing to update' });
      vals.push(id);
      await pool.query(`UPDATE extension_registrations SET ${sets.join(', ')} WHERE id = ?`, vals);

      await pool.query(
        `INSERT INTO audit_logs (actor_admin_id, reseller_id, action, entity_type, entity_id, meta)
         VALUES (?, ?, 'extension.update', 'extension_registration', ?, ?)`,
        [user.id, rows[0].reseller_id, String(id), JSON.stringify({ fields: Object.keys(body) })],
      );

      return { success: true };
    } catch (err) {
      return sendErr(reply, err);
    }
  });

  app.get('/api/resellers/:id/allowlist', async (req, reply) => {
    try {
      const user = requireUser(req);
      const resellerId = Number((req.params as { id: string }).id);
      scopedResellerId(user, resellerId);
      const [pol] = await pool.query<RowDataPacket[]>(
        'SELECT id, mode FROM extension_allow_policies WHERE reseller_id = ? LIMIT 1',
        [resellerId],
      );
      if (!pol[0]) return { success: true, policy: { mode: 'off', entries: [] } };
      const [entries] = await pool.query<RowDataPacket[]>(
        'SELECT id, extension_id, note FROM extension_allow_entries WHERE policy_id = ? ORDER BY id',
        [pol[0].id],
      );
      return { success: true, policy: { mode: pol[0].mode, entries } };
    } catch (err) {
      return sendErr(reply, err);
    }
  });

  /** One-click allow a single Chrome extension ID (from inventory scan). */
  app.post('/api/resellers/:id/allowlist/entries', async (req, reply) => {
    try {
      const user = requireUser(req);
      const resellerId = Number((req.params as { id: string }).id);
      scopedResellerId(user, resellerId);
      const body = z
        .object({
          extension_id: z.string().trim().min(1).max(128),
          note: z.string().max(255).optional(),
        })
        .parse(req.body);

      await pool.query(
        `INSERT INTO extension_allow_policies (reseller_id, mode)
         VALUES (?, 'whitelist')
         ON DUPLICATE KEY UPDATE mode = 'whitelist'`,
        [resellerId],
      );
      const [pol] = await pool.query<RowDataPacket[]>(
        'SELECT id FROM extension_allow_policies WHERE reseller_id = ? LIMIT 1',
        [resellerId],
      );
      await pool.query(
        `INSERT INTO extension_allow_entries (policy_id, extension_id, note)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE note = COALESCE(VALUES(note), note)`,
        [pol[0].id, body.extension_id, body.note ?? null],
      );
      await pool.query(
        `INSERT INTO audit_logs (actor_admin_id, reseller_id, action, entity_type, entity_id, meta)
         VALUES (?, ?, 'allowlist.allow', 'extension', ?, ?)`,
        [user.id, resellerId, body.extension_id, JSON.stringify({ note: body.note ?? null })],
      );
      return { success: true };
    } catch (err) {
      return sendErr(reply, err);
    }
  });

  app.delete('/api/resellers/:id/allowlist/entries/:extensionId', async (req, reply) => {
    try {
      const user = requireUser(req);
      const resellerId = Number((req.params as { id: string }).id);
      const extensionId = decodeURIComponent((req.params as { extensionId: string }).extensionId);
      scopedResellerId(user, resellerId);
      const [pol] = await pool.query<RowDataPacket[]>(
        'SELECT id FROM extension_allow_policies WHERE reseller_id = ? LIMIT 1',
        [resellerId],
      );
      if (!pol[0]) return { success: true };
      await pool.query(
        'DELETE FROM extension_allow_entries WHERE policy_id = ? AND extension_id = ?',
        [pol[0].id, extensionId],
      );
      return { success: true };
    } catch (err) {
      return sendErr(reply, err);
    }
  });

  app.put('/api/resellers/:id/allowlist', async (req, reply) => {
    try {
      const user = requireUser(req);
      const resellerId = Number((req.params as { id: string }).id);
      scopedResellerId(user, resellerId);
      const body = z
        .object({
          mode: z.enum(['off', 'whitelist']),
          entries: z
            .array(
              z.object({
                extension_id: z.string().trim().min(1).max(128),
                note: z.string().max(255).optional(),
              }),
            )
            .default([]),
        })
        .parse(req.body);

      await pool.query(
        `INSERT INTO extension_allow_policies (reseller_id, mode)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE mode = VALUES(mode)`,
        [resellerId, body.mode],
      );
      const [pol] = await pool.query<RowDataPacket[]>(
        'SELECT id FROM extension_allow_policies WHERE reseller_id = ? LIMIT 1',
        [resellerId],
      );
      await pool.query('DELETE FROM extension_allow_entries WHERE policy_id = ?', [pol[0].id]);
      for (const e of body.entries) {
        await pool.query(
          `INSERT INTO extension_allow_entries (policy_id, extension_id, note) VALUES (?, ?, ?)`,
          [pol[0].id, e.extension_id, e.note ?? null],
        );
      }
      await pool.query(
        `INSERT INTO audit_logs (actor_admin_id, reseller_id, action, entity_type, entity_id, meta)
         VALUES (?, ?, 'allowlist.update', 'reseller', ?, ?)`,
        [
          user.id,
          resellerId,
          String(resellerId),
          JSON.stringify({ mode: body.mode, count: body.entries.length }),
        ],
      );
      return { success: true };
    } catch (err) {
      return sendErr(reply, err);
    }
  });
};