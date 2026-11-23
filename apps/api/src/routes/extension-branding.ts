import type { FastifyPluginAsync } from 'fastify';
import type { RowDataPacket } from 'mysql2';
import { createReadStream, existsSync } from 'node:fs';
import { basename } from 'node:path';
import { z } from 'zod';
import { pool } from '../db.js';
import { sendErr, scopedResellerId } from '../authz.js';
import { requireUser } from '../session.js';
import { randomBytes } from 'node:crypto';
import {
  cleanupPackWork,
  getLatestZipPath,
  iconAbsPath,
  mergeBrandIntoSettings,
  openZipStream,
  packResellerExtension,
  parseBrandSettings,
  saveResellerIcon,
} from '../lib/extension-packager.js';

const brandBodySchema = z.object({
  name: z.string().trim().min(1).max(75),
  description: z.string().trim().min(1).max(132),
  member_domain: z.string().trim().max(255).optional().default(''),
  membership_home: z.string().trim().max(512).optional().default(''),
  icon_base64: z.string().optional(),
});

async function loadReseller(id: number) {
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT id, slug, name, settings FROM resellers WHERE id = ? LIMIT 1',
    [id],
  );
  return rows[0] || null;
}

export const extensionBrandingRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/resellers/:id/extension-branding', async (req, reply) => {
    try {
      const user = requireUser(req);
      const id = Number((req.params as { id: string }).id);
      scopedResellerId(user, id);
      const row = await loadReseller(id);
      if (!row) return reply.code(404).send({ success: false, message: 'Reseller not found' });
      const brand = parseBrandSettings(row.settings, row.slug, row.name);
      const zip = getLatestZipPath(row.slug);
      return {
        success: true,
        item: {
          reseller_id: row.id,
          slug: row.slug,
          ...brand,
          has_icon: !!iconAbsPath(brand.icon_relpath),
          has_zip: !!zip,
          zip_name: zip ? basename(zip) : null,
        },
      };
    } catch (err) {
      return sendErr(reply, err);
    }
  });

  app.put('/api/resellers/:id/extension-branding', async (req, reply) => {
    try {
      const user = requireUser(req);
      const id = Number((req.params as { id: string }).id);
      scopedResellerId(user, id);
      const row = await loadReseller(id);
      if (!row) return reply.code(404).send({ success: false, message: 'Reseller not found' });

      const body = brandBodySchema.parse(req.body);
      const prev = parseBrandSettings(row.settings, row.slug, row.name);
      let iconRel = prev.icon_relpath;

      if (body.icon_base64) {
        const raw = body.icon_base64.replace(/^data:image\/\w+;base64,/, '');
        const buf = Buffer.from(raw, 'base64');
        if (buf.length < 32 || buf.length > 3 * 1024 * 1024) {
          return reply.code(400).send({ success: false, message: 'Icon must be under 3MB' });
        }
        iconRel = await saveResellerIcon(id, buf);
      }

      const brand = {
        ...prev,
        name: body.name,
        description: body.description,
        member_domain: body.member_domain || '',
        membership_home: body.membership_home || prev.membership_home,
        icon_relpath: iconRel,
      };
      const settings = mergeBrandIntoSettings(row.settings, brand);
      await pool.query('UPDATE resellers SET settings = ? WHERE id = ?', [
        JSON.stringify(settings),
        id,
      ]);

      return {
        success: true,
        item: {
          reseller_id: id,
          slug: row.slug,
          ...brand,
          has_icon: !!iconAbsPath(brand.icon_relpath),
        },
      };
    } catch (err) {
      return sendErr(reply, err);
    }
  });

  app.get('/api/resellers/:id/extension-branding/icon', async (req, reply) => {
    try {
      const user = requireUser(req);
      const id = Number((req.params as { id: string }).id);
      scopedResellerId(user, id);
      const row = await loadReseller(id);
      if (!row) return reply.code(404).send({ success: false, message: 'Not found' });
      const brand = parseBrandSettings(row.settings, row.slug, row.name);
      const abs = iconAbsPath(brand.icon_relpath);
      if (!abs) return reply.code(404).send({ success: false, message: 'No icon' });
      reply.header('Content-Type', 'image/png');
      reply.header('Cache-Control', 'private, max-age=60');
      return reply.send(createReadStream(abs));
    } catch (err) {
      return sendErr(reply, err);
    }
  });

  app.post('/api/resellers/:id/generate-extension', async (req, reply) => {
    try {
      const user = requireUser(req);
      const id = Number((req.params as { id: string }).id);
      scopedResellerId(user, id);
      const row = await loadReseller(id);
      if (!row) return reply.code(404).send({ success: false, message: 'Reseller not found' });

      const brand = parseBrandSettings(row.settings, row.slug, row.name);
      let workDir = '';
      try {
        const packed = await packResellerExtension({ slug: row.slug, brand });
        workDir = packed.workDir;

        const nextBrand = {
          ...brand,
          version: packed.version,
          last_generated_at: new Date().toISOString(),
        };
        const settings = mergeBrandIntoSettings(row.settings, nextBrand);
        await pool.query('UPDATE resellers SET settings = ? WHERE id = ?', [
          JSON.stringify(settings),
          id,
        ]);

        // Upsert integrity registration so hash checks match this ZIP
        const [regs] = await pool.query<RowDataPacket[]>(
          'SELECT id, secret FROM extension_registrations WHERE reseller_id = ? LIMIT 1',
          [id],
        );
        const secret = regs[0]?.secret || randomBytes(24).toString('hex');
        if (regs[0]) {
          // Reset Chrome ID — remove+reload after generate assigns a new ID
          await pool.query(
            `UPDATE extension_registrations
             SET client_slug = ?, file_hashes = ?, extension_id = 'pending',
                 is_active = 1, updated_at = NOW()
             WHERE id = ?`,
            [row.slug, JSON.stringify(packed.fileHashes), regs[0].id],
          );
        } else {
          await pool.query(
            `INSERT INTO extension_registrations
               (reseller_id, client_slug, extension_id, file_hashes, secret, integrity_mode, is_active)
             VALUES (?, ?, 'pending', ?, ?, 'warn', 1)`,
            [id, row.slug, JSON.stringify(packed.fileHashes), secret],
          );
        }

        const filename = `${row.slug}-extension-v${packed.version}.zip`;
        reply.header('Content-Type', 'application/zip');
        reply.header('Content-Disposition', `attachment; filename="${filename}"`);
        reply.header('X-Extension-Version', packed.version);
        return reply.send(openZipStream(packed.zipPath));
      } finally {
        if (workDir) cleanupPackWork(workDir);
      }
    } catch (err) {
      return sendErr(reply, err);
    }
  });

  app.get('/api/resellers/:id/generate-extension', async (req, reply) => {
    try {
      const user = requireUser(req);
      const id = Number((req.params as { id: string }).id);
      scopedResellerId(user, id);
      const row = await loadReseller(id);
      if (!row) return reply.code(404).send({ success: false, message: 'Reseller not found' });
      const zip = getLatestZipPath(row.slug);
      if (!zip || !existsSync(zip)) {
        return reply.code(404).send({ success: false, message: 'No ZIP yet — generate first' });
      }
      reply.header('Content-Type', 'application/zip');
      reply.header(
        'Content-Disposition',
        `attachment; filename="${basename(zip)}"`,
      );
      return reply.send(openZipStream(zip));
    } catch (err) {
      return sendErr(reply, err);
    }
  });
};
