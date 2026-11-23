import type { FastifyPluginAsync } from 'fastify';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { createResellerSchema, updateResellerSchema } from '@oneclk/shared';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { pool } from '../db.js';
import { requireMaster, sendErr, scopedResellerId } from '../authz.js';
import { requireUser } from '../session.js';
import { normalizeKeyPrefix } from '../lib/tool-key.js';
import {
  mergeBrandIntoSettings,
  parseBrandSettings,
} from '../lib/extension-packager.js';

type ResellerRow = RowDataPacket & {
  id: number;
  slug: string;
  name: string;
  key_prefix: string;
  is_active: number;
  created_at: Date;
  tool_count: number;
  admin_username: string | null;
};

export const resellerRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/resellers', async (req, reply) => {
    try {
      const user = requireUser(req);
      const mapRow = (row: ResellerRow & { settings?: unknown }) => {
        const brand = parseBrandSettings(row.settings, row.slug, row.name);
        const { settings: _s, ...rest } = row as ResellerRow & { settings?: unknown };
        return { ...rest, member_domain: brand.member_domain || '' };
      };
      if (user.role === 'master') {
        const [rows] = await pool.query<(ResellerRow & { settings?: unknown })[]>(
          `SELECT r.id, r.slug, r.name, r.key_prefix, r.is_active, r.created_at, r.settings,
                  (SELECT COUNT(*) FROM tools t WHERE t.reseller_id = r.id) AS tool_count,
                  (SELECT a.username FROM admin_users a
                   WHERE a.reseller_id = r.id AND a.role = 'reseller'
                   ORDER BY a.id ASC LIMIT 1) AS admin_username
           FROM resellers r ORDER BY r.id ASC`,
        );
        return { success: true, items: rows.map(mapRow) };
      }
      const rid = scopedResellerId(user);
      const [rows] = await pool.query<(ResellerRow & { settings?: unknown })[]>(
        `SELECT r.id, r.slug, r.name, r.key_prefix, r.is_active, r.created_at, r.settings,
                (SELECT COUNT(*) FROM tools t WHERE t.reseller_id = r.id) AS tool_count,
                (SELECT a.username FROM admin_users a
                 WHERE a.reseller_id = r.id AND a.role = 'reseller'
                 ORDER BY a.id ASC LIMIT 1) AS admin_username
         FROM resellers r WHERE r.id = ?`,
        [rid],
      );
      return { success: true, items: rows.map(mapRow) };
    } catch (err) {
      return sendErr(reply, err);
    }
  });

  app.post('/api/resellers', async (req, reply) => {
    try {
      requireMaster(req);
      const body = createResellerSchema.parse(req.body);
      const prefix = normalizeKeyPrefix(body.key_prefix);
      if (prefix.length < 2) {
        return reply.code(400).send({ success: false, message: 'key_prefix must be 2–8 letters/digits' });
      }
      const memberSecret = randomBytes(24).toString('hex');
      const settings = body.member_domain
        ? JSON.stringify({
            extension: {
              name: body.name,
              member_domain: body.member_domain,
              membership_home: body.member_domain.includes('://')
                ? body.member_domain.replace(/\/?$/, '/')
                : `https://${body.member_domain.replace(/\/$/, '')}/`,
            },
          })
        : null;
      const [res] = await pool.query<ResultSetHeader>(
        `INSERT INTO resellers (slug, name, key_prefix, member_secret, settings, is_active)
         VALUES (?, ?, ?, ?, ?, 1)`,
        [body.slug, body.name, prefix, memberSecret, settings],
      );
      const resellerId = res.insertId;

      if (body.password) {
        const username = (body.username ?? body.slug).trim();
        const hash = await bcrypt.hash(body.password, 10);
        await pool.query(
          `INSERT INTO admin_users (username, password_hash, role, reseller_id, is_active)
           VALUES (?, ?, 'reseller', ?, 1)`,
          [username, hash, resellerId],
        );
      }

      await pool.query(
        `INSERT INTO extension_allow_policies (reseller_id, mode) VALUES (?, 'off')`,
        [resellerId],
      );

      return reply.code(201).send({
        success: true,
        item: {
          id: resellerId,
          slug: body.slug,
          name: body.name,
          key_prefix: prefix,
          member_secret: memberSecret,
        },
      });
    } catch (err) {
      if ((err as { code?: string }).code === 'ER_DUP_ENTRY') {
        return reply
          .code(409)
          .send({ success: false, message: 'Slug, prefix, or username already exists' });
      }
      return sendErr(reply, err);
    }
  });

  app.patch('/api/resellers/:id', async (req, reply) => {
    try {
      const actor = requireUser(req);
      const id = Number((req.params as { id: string }).id);
      scopedResellerId(actor, id);
      // Only master may edit reseller catalog / passwords for others
      if (actor.role !== 'master' && actor.reseller_id !== id) {
        return reply.code(403).send({ success: false, message: 'Forbidden' });
      }
      const body = updateResellerSchema.parse(req.body);

      const fields: string[] = [];
      const vals: unknown[] = [];
      if (body.name !== undefined) {
        fields.push('name = ?');
        vals.push(body.name);
      }
      if (actor.role === 'master' && body.slug !== undefined) {
        fields.push('slug = ?');
        vals.push(body.slug);
      }
      if (actor.role === 'master' && body.key_prefix !== undefined) {
        fields.push('key_prefix = ?');
        vals.push(normalizeKeyPrefix(body.key_prefix));
      }
      if (actor.role === 'master' && body.is_active !== undefined) {
        fields.push('is_active = ?');
        vals.push(body.is_active ? 1 : 0);
      }
      if (fields.length) {
        vals.push(id);
        await pool.query(`UPDATE resellers SET ${fields.join(', ')} WHERE id = ?`, vals);
      }

      if (actor.role === 'master' && body.member_domain !== undefined) {
        const [cur] = await pool.query<RowDataPacket[]>(
          'SELECT slug, name, settings FROM resellers WHERE id = ? LIMIT 1',
          [id],
        );
        if (cur[0]) {
          const brand = parseBrandSettings(cur[0].settings, cur[0].slug, cur[0].name);
          brand.member_domain = body.member_domain || '';
          if (brand.member_domain && !brand.membership_home) {
            brand.membership_home = brand.member_domain.includes('://')
              ? brand.member_domain.replace(/\/?$/, '/')
              : `https://${brand.member_domain.replace(/\/$/, '')}/`;
          }
          const settings = mergeBrandIntoSettings(cur[0].settings, brand);
          await pool.query('UPDATE resellers SET settings = ? WHERE id = ?', [
            JSON.stringify(settings),
            id,
          ]);
        }
      }

      if (body.password || body.username) {
        // Resellers change their own password only via POST /api/auth/change-password
        // (requires current password). Master may reset reseller login here.
        if (actor.role !== 'master') {
          return reply.code(403).send({
            success: false,
            message: 'Use Account → Change password (current password required)',
          });
        }
        const [admins] = await pool.query<RowDataPacket[]>(
          `SELECT id, username FROM admin_users
           WHERE reseller_id = ? AND role = 'reseller' ORDER BY id ASC LIMIT 1`,
          [id],
        );
        if (admins[0]) {
          const sets: string[] = [];
          const av: unknown[] = [];
          if (body.password) {
            sets.push('password_hash = ?');
            av.push(await bcrypt.hash(body.password, 10));
          }
          if (body.username) {
            sets.push('username = ?');
            av.push(body.username);
          }
          if (sets.length) {
            av.push(admins[0].id);
            await pool.query(`UPDATE admin_users SET ${sets.join(', ')} WHERE id = ?`, av);
          }
        } else if (body.password) {
          const [r] = await pool.query<RowDataPacket[]>(
            'SELECT slug FROM resellers WHERE id = ? LIMIT 1',
            [id],
          );
          const username = (body.username || r[0]?.slug || `reseller${id}`).trim();
          const hash = await bcrypt.hash(body.password, 10);
          await pool.query(
            `INSERT INTO admin_users (username, password_hash, role, reseller_id, is_active)
             VALUES (?, ?, 'reseller', ?, 1)`,
            [username, hash, id],
          );
        }
      }

      return { success: true };
    } catch (err) {
      if ((err as { code?: string }).code === 'ER_DUP_ENTRY') {
        return reply
          .code(409)
          .send({ success: false, message: 'Slug, prefix, or username already exists' });
      }
      return sendErr(reply, err);
    }
  });

  /** Reveal member_secret for aMember wiring (scoped: master any, reseller own). */
  app.get('/api/resellers/:id/member-secret', async (req, reply) => {
    try {
      const user = requireUser(req);
      const id = Number((req.params as { id: string }).id);
      scopedResellerId(user, id);
      const [rows] = await pool.query<RowDataPacket[]>(
        'SELECT id, slug, member_secret FROM resellers WHERE id = ? LIMIT 1',
        [id],
      );
      if (!rows[0]) return reply.code(404).send({ success: false, message: 'Not found' });
      return {
        success: true,
        item: {
          reseller_id: rows[0].id,
          slug: rows[0].slug,
          member_secret: rows[0].member_secret || null,
        },
      };
    } catch (err) {
      return sendErr(reply, err);
    }
  });

  app.delete('/api/resellers/:id', async (req, reply) => {
    try {
      requireMaster(req);
      const id = Number((req.params as { id: string }).id);
      const [rows] = await pool.query<RowDataPacket[]>(
        'SELECT id, slug FROM resellers WHERE id = ? LIMIT 1',
        [id],
      );
      if (!rows[0]) return reply.code(404).send({ success: false, message: 'Not found' });
      // tools/rules cascade via FK
      await pool.query('DELETE FROM admin_users WHERE reseller_id = ?', [id]);
      await pool.query('DELETE FROM resellers WHERE id = ?', [id]);
      return { success: true, deleted: rows[0].slug };
    } catch (err) {
      return sendErr(reply, err);
    }
  });
};
