import type { FastifyPluginAsync } from 'fastify';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { z } from 'zod';
import { pool } from '../db.js';
import { sendErr, scopedResellerId, requireMaster } from '../authz.js';
import { requireUser } from '../session.js';

const cloneSchema = z.object({
  from_reseller_id: z.number().int().positive(),
  include: z
    .array(z.enum(['css', 'redirect', 'block', 'overlay', 'text', 'extension_allow', 'rule_groups']))
    .min(1),
  mode: z.enum(['merge', 'replace']).default('merge'),
});

/** If admin pasted full HTML, extract #id / .class for a real CSS selector. */
function sanitizeCssSelector(raw: string): string {
  const s = String(raw || '').trim();
  if (!s) return s;
  if (!s.startsWith('<')) return s;
  const id = s.match(/\bid\s*=\s*["']([^"']+)["']/i);
  if (id?.[1]) return `#${id[1].replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const cls = s.match(/\bclass\s*=\s*["']([^"']+)["']/i);
  if (cls?.[1]) {
    const first = cls[1].trim().split(/\s+/).find(Boolean);
    if (first) return `.${first.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  }
  const tag = s.match(/^<\s*([a-z0-9]+)/i);
  return tag ? tag[1].toLowerCase() : s;
}

async function assertOwnedRow(
  table: string,
  id: number,
  resellerId: number,
): Promise<RowDataPacket> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM ${table} WHERE id = ? AND reseller_id = ? LIMIT 1`,
    [id, resellerId],
  );
  if (!rows[0]) {
    const err = new Error('Not found') as Error & { statusCode: number };
    err.statusCode = 404;
    throw err;
  }
  return rows[0];
}

export const rulesRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/resellers/:id/rules-summary', async (req, reply) => {
    try {
      const user = requireUser(req);
      const resellerId = Number((req.params as { id: string }).id);
      scopedResellerId(user, resellerId);
      const q = async (sql: string) => {
        const [rows] = await pool.query<RowDataPacket[]>(sql, [resellerId]);
        return Number(rows[0]?.c || 0);
      };
      return {
        success: true,
        summary: {
          rule_groups: await q('SELECT COUNT(*) AS c FROM rule_groups WHERE reseller_id = ?'),
          css: await q('SELECT COUNT(*) AS c FROM css_rules WHERE reseller_id = ?'),
          redirect: await q('SELECT COUNT(*) AS c FROM redirect_rules WHERE reseller_id = ?'),
          block: await q('SELECT COUNT(*) AS c FROM block_url_rules WHERE reseller_id = ?'),
          overlay: await q('SELECT COUNT(*) AS c FROM overlay_rules WHERE reseller_id = ?'),
          text: await q('SELECT COUNT(*) AS c FROM text_rules WHERE reseller_id = ?'),
        },
      };
    } catch (err) {
      return sendErr(reply, err);
    }
  });

  // ── Rule groups ──────────────────────────────────────────────
  app.get('/api/resellers/:id/rule-groups', async (req, reply) => {
    try {
      const user = requireUser(req);
      const resellerId = Number((req.params as { id: string }).id);
      scopedResellerId(user, resellerId);
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, name, url_pattern, is_active, created_at
         FROM rule_groups WHERE reseller_id = ? ORDER BY id DESC`,
        [resellerId],
      );
      return { success: true, items: rows };
    } catch (err) {
      return sendErr(reply, err);
    }
  });

  app.post('/api/resellers/:id/rule-groups', async (req, reply) => {
    try {
      const user = requireUser(req);
      const resellerId = Number((req.params as { id: string }).id);
      scopedResellerId(user, resellerId);
      const body = z
        .object({
          name: z.string().trim().min(1).max(255),
          url_pattern: z.string().trim().min(1).max(500),
          is_active: z.boolean().optional(),
        })
        .parse(req.body);
      const [res] = await pool.query<ResultSetHeader>(
        `INSERT INTO rule_groups (reseller_id, name, url_pattern, is_active) VALUES (?, ?, ?, ?)`,
        [resellerId, body.name, body.url_pattern, body.is_active === false ? 0 : 1],
      );
      return reply.code(201).send({ success: true, item: { id: res.insertId } });
    } catch (err) {
      return sendErr(reply, err);
    }
  });

  app.patch('/api/resellers/:id/rule-groups/:ruleId', async (req, reply) => {
    try {
      const user = requireUser(req);
      const resellerId = Number((req.params as { id: string }).id);
      const ruleId = Number((req.params as { ruleId: string }).ruleId);
      scopedResellerId(user, resellerId);
      await assertOwnedRow('rule_groups', ruleId, resellerId);
      const body = z
        .object({
          name: z.string().trim().min(1).max(255).optional(),
          url_pattern: z.string().trim().min(1).max(500).optional(),
          is_active: z.boolean().optional(),
        })
        .parse(req.body);
      const fields: string[] = [];
      const vals: unknown[] = [];
      if (body.name !== undefined) {
        fields.push('name = ?');
        vals.push(body.name);
      }
      if (body.url_pattern !== undefined) {
        fields.push('url_pattern = ?');
        vals.push(body.url_pattern);
      }
      if (body.is_active !== undefined) {
        fields.push('is_active = ?');
        vals.push(body.is_active ? 1 : 0);
      }
      if (!fields.length) return { success: true };
      vals.push(ruleId, resellerId);
      await pool.query(
        `UPDATE rule_groups SET ${fields.join(', ')} WHERE id = ? AND reseller_id = ?`,
        vals,
      );
      return { success: true };
    } catch (err) {
      return sendErr(reply, err);
    }
  });

  app.delete('/api/resellers/:id/rule-groups/:ruleId', async (req, reply) => {
    try {
      const user = requireUser(req);
      const resellerId = Number((req.params as { id: string }).id);
      const ruleId = Number((req.params as { ruleId: string }).ruleId);
      scopedResellerId(user, resellerId);
      await assertOwnedRow('rule_groups', ruleId, resellerId);
      await pool.query('DELETE FROM rule_groups WHERE id = ? AND reseller_id = ?', [
        ruleId,
        resellerId,
      ]);
      return { success: true };
    } catch (err) {
      return sendErr(reply, err);
    }
  });

  // ── CSS rules (separate from redirect/block) ─────────────────
  app.get('/api/resellers/:id/css-rules', async (req, reply) => {
    try {
      const user = requireUser(req);
      const resellerId = Number((req.params as { id: string }).id);
      scopedResellerId(user, resellerId);
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT c.id, c.group_id, g.name AS group_name, c.selector, c.action, c.value, c.is_active, c.created_at
         FROM css_rules c
         LEFT JOIN rule_groups g ON g.id = c.group_id
         WHERE c.reseller_id = ?
         ORDER BY c.id DESC`,
        [resellerId],
      );
      return { success: true, items: rows };
    } catch (err) {
      return sendErr(reply, err);
    }
  });

  app.post('/api/resellers/:id/css-rules', async (req, reply) => {
    try {
      const user = requireUser(req);
      const resellerId = Number((req.params as { id: string }).id);
      scopedResellerId(user, resellerId);
      const body = z
        .object({
          group_id: z.number().int().positive(),
          selector: z.string().trim().min(1).max(500),
          action: z.enum(['hide', 'replace', 'custom']).default('hide'),
          value: z.string().max(20000).optional().nullable(),
          is_active: z.boolean().optional(),
        })
        .parse(req.body);
      await assertOwnedRow('rule_groups', body.group_id, resellerId);
      const selector = sanitizeCssSelector(body.selector);
      const [res] = await pool.query<ResultSetHeader>(
        `INSERT INTO css_rules (reseller_id, group_id, selector, action, value, is_active)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          resellerId,
          body.group_id,
          selector,
          body.action,
          body.value ?? null,
          body.is_active === false ? 0 : 1,
        ],
      );
      return reply.code(201).send({ success: true, item: { id: res.insertId } });
    } catch (err) {
      return sendErr(reply, err);
    }
  });

  app.patch('/api/resellers/:id/css-rules/:ruleId', async (req, reply) => {
    try {
      const user = requireUser(req);
      const resellerId = Number((req.params as { id: string }).id);
      const ruleId = Number((req.params as { ruleId: string }).ruleId);
      scopedResellerId(user, resellerId);
      await assertOwnedRow('css_rules', ruleId, resellerId);
      const body = z
        .object({
          group_id: z.number().int().positive().optional(),
          selector: z.string().trim().min(1).max(500).optional(),
          action: z.enum(['hide', 'replace', 'custom']).optional(),
          value: z.string().max(20000).optional().nullable(),
          is_active: z.boolean().optional(),
        })
        .parse(req.body);
      if (body.group_id) await assertOwnedRow('rule_groups', body.group_id, resellerId);
      const fields: string[] = [];
      const vals: unknown[] = [];
      for (const [k, v] of Object.entries(body)) {
        if (v === undefined) continue;
        if (k === 'is_active') {
          fields.push('is_active = ?');
          vals.push(v ? 1 : 0);
        } else if (k === 'selector') {
          fields.push('selector = ?');
          vals.push(sanitizeCssSelector(String(v)));
        } else {
          fields.push(`${k} = ?`);
          vals.push(v);
        }
      }
      if (!fields.length) return { success: true };
      vals.push(ruleId, resellerId);
      await pool.query(
        `UPDATE css_rules SET ${fields.join(', ')} WHERE id = ? AND reseller_id = ?`,
        vals,
      );
      return { success: true };
    } catch (err) {
      return sendErr(reply, err);
    }
  });

  app.delete('/api/resellers/:id/css-rules/:ruleId', async (req, reply) => {
    try {
      const user = requireUser(req);
      const resellerId = Number((req.params as { id: string }).id);
      const ruleId = Number((req.params as { ruleId: string }).ruleId);
      scopedResellerId(user, resellerId);
      await assertOwnedRow('css_rules', ruleId, resellerId);
      await pool.query('DELETE FROM css_rules WHERE id = ? AND reseller_id = ?', [ruleId, resellerId]);
      return { success: true };
    } catch (err) {
      return sendErr(reply, err);
    }
  });

  // ── Block URLs ───────────────────────────────────────────────
  app.get('/api/resellers/:id/block-urls', async (req, reply) => {
    try {
      const user = requireUser(req);
      const resellerId = Number((req.params as { id: string }).id);
      scopedResellerId(user, resellerId);
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, group_id, url_pattern, action, redirect_url, is_active, created_at
         FROM block_url_rules WHERE reseller_id = ? ORDER BY id DESC`,
        [resellerId],
      );
      return { success: true, items: rows };
    } catch (err) {
      return sendErr(reply, err);
    }
  });

  app.post('/api/resellers/:id/block-urls', async (req, reply) => {
    try {
      const user = requireUser(req);
      const resellerId = Number((req.params as { id: string }).id);
      scopedResellerId(user, resellerId);
      const body = z
        .object({
          url_pattern: z.string().trim().min(1).max(500),
          action: z.enum(['blank', 'redirect']).default('blank'),
          redirect_url: z.string().max(500).optional().nullable(),
          group_id: z.number().int().positive().optional().nullable(),
          is_active: z.boolean().optional(),
        })
        .parse(req.body);
      const [res] = await pool.query<ResultSetHeader>(
        `INSERT INTO block_url_rules (reseller_id, group_id, url_pattern, action, redirect_url, is_active)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          resellerId,
          body.group_id ?? null,
          body.url_pattern,
          body.action,
          body.redirect_url ?? null,
          body.is_active === false ? 0 : 1,
        ],
      );
      return reply.code(201).send({ success: true, item: { id: res.insertId } });
    } catch (err) {
      return sendErr(reply, err);
    }
  });

  app.patch('/api/resellers/:id/block-urls/:ruleId', async (req, reply) => {
    try {
      const user = requireUser(req);
      const resellerId = Number((req.params as { id: string }).id);
      const ruleId = Number((req.params as { ruleId: string }).ruleId);
      scopedResellerId(user, resellerId);
      await assertOwnedRow('block_url_rules', ruleId, resellerId);
      const body = z
        .object({
          url_pattern: z.string().trim().min(1).max(500).optional(),
          action: z.enum(['blank', 'redirect']).optional(),
          redirect_url: z.string().max(500).optional().nullable(),
          group_id: z.number().int().positive().optional().nullable(),
          is_active: z.boolean().optional(),
        })
        .parse(req.body);
      const fields: string[] = [];
      const vals: unknown[] = [];
      for (const [k, v] of Object.entries(body)) {
        if (v === undefined) continue;
        if (k === 'is_active') {
          fields.push('is_active = ?');
          vals.push(v ? 1 : 0);
        } else {
          fields.push(`${k} = ?`);
          vals.push(v);
        }
      }
      if (!fields.length) return { success: true };
      vals.push(ruleId, resellerId);
      await pool.query(
        `UPDATE block_url_rules SET ${fields.join(', ')} WHERE id = ? AND reseller_id = ?`,
        vals,
      );
      return { success: true };
    } catch (err) {
      return sendErr(reply, err);
    }
  });

  app.delete('/api/resellers/:id/block-urls/:ruleId', async (req, reply) => {
    try {
      const user = requireUser(req);
      const resellerId = Number((req.params as { id: string }).id);
      const ruleId = Number((req.params as { ruleId: string }).ruleId);
      scopedResellerId(user, resellerId);
      await assertOwnedRow('block_url_rules', ruleId, resellerId);
      await pool.query('DELETE FROM block_url_rules WHERE id = ? AND reseller_id = ?', [
        ruleId,
        resellerId,
      ]);
      return { success: true };
    } catch (err) {
      return sendErr(reply, err);
    }
  });

  // ── Redirects ────────────────────────────────────────────────
  app.get('/api/resellers/:id/redirects', async (req, reply) => {
    try {
      const user = requireUser(req);
      const resellerId = Number((req.params as { id: string }).id);
      scopedResellerId(user, resellerId);
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, group_id, source_url, destination_url, description, is_active, created_at
         FROM redirect_rules WHERE reseller_id = ? ORDER BY id DESC`,
        [resellerId],
      );
      return { success: true, items: rows };
    } catch (err) {
      return sendErr(reply, err);
    }
  });

  app.post('/api/resellers/:id/redirects', async (req, reply) => {
    try {
      const user = requireUser(req);
      const resellerId = Number((req.params as { id: string }).id);
      scopedResellerId(user, resellerId);
      const body = z
        .object({
          source_url: z.string().trim().min(1).max(500),
          destination_url: z.string().trim().min(1).max(500),
          description: z.string().max(255).optional().nullable(),
          group_id: z.number().int().positive().optional().nullable(),
          is_active: z.boolean().optional(),
        })
        .parse(req.body);
      const [res] = await pool.query<ResultSetHeader>(
        `INSERT INTO redirect_rules (reseller_id, group_id, source_url, destination_url, description, is_active)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          resellerId,
          body.group_id ?? null,
          body.source_url,
          body.destination_url,
          body.description ?? null,
          body.is_active === false ? 0 : 1,
        ],
      );
      return reply.code(201).send({ success: true, item: { id: res.insertId } });
    } catch (err) {
      return sendErr(reply, err);
    }
  });

  app.patch('/api/resellers/:id/redirects/:ruleId', async (req, reply) => {
    try {
      const user = requireUser(req);
      const resellerId = Number((req.params as { id: string }).id);
      const ruleId = Number((req.params as { ruleId: string }).ruleId);
      scopedResellerId(user, resellerId);
      await assertOwnedRow('redirect_rules', ruleId, resellerId);
      const body = z
        .object({
          source_url: z.string().trim().min(1).max(500).optional(),
          destination_url: z.string().trim().min(1).max(500).optional(),
          description: z.string().max(255).optional().nullable(),
          group_id: z.number().int().positive().optional().nullable(),
          is_active: z.boolean().optional(),
        })
        .parse(req.body);
      const fields: string[] = [];
      const vals: unknown[] = [];
      for (const [k, v] of Object.entries(body)) {
        if (v === undefined) continue;
        if (k === 'is_active') {
          fields.push('is_active = ?');
          vals.push(v ? 1 : 0);
        } else {
          fields.push(`${k} = ?`);
          vals.push(v);
        }
      }
      if (!fields.length) return { success: true };
      vals.push(ruleId, resellerId);
      await pool.query(
        `UPDATE redirect_rules SET ${fields.join(', ')} WHERE id = ? AND reseller_id = ?`,
        vals,
      );
      return { success: true };
    } catch (err) {
      return sendErr(reply, err);
    }
  });

  app.delete('/api/resellers/:id/redirects/:ruleId', async (req, reply) => {
    try {
      const user = requireUser(req);
      const resellerId = Number((req.params as { id: string }).id);
      const ruleId = Number((req.params as { ruleId: string }).ruleId);
      scopedResellerId(user, resellerId);
      await assertOwnedRow('redirect_rules', ruleId, resellerId);
      await pool.query('DELETE FROM redirect_rules WHERE id = ? AND reseller_id = ?', [
        ruleId,
        resellerId,
      ]);
      return { success: true };
    } catch (err) {
      return sendErr(reply, err);
    }
  });

  /** One-shot clone — never live-links rules */
  app.post('/api/resellers/:id/clone-rules', async (req, reply) => {
    try {
      const actor = requireMaster(req);
      const targetId = Number((req.params as { id: string }).id);
      const body = cloneSchema.parse(req.body);
      if (body.from_reseller_id === targetId) {
        return reply.code(400).send({ success: false, message: 'Cannot clone onto self' });
      }

      const created: Record<string, number> = {};
      const copyGroups =
        body.include.includes('rule_groups') || body.include.includes('css');

      if (body.mode === 'replace' && body.include.includes('rule_groups')) {
        await pool.query('DELETE FROM rule_groups WHERE reseller_id = ?', [targetId]);
      }

      const groupMap = new Map<number, number>();
      if (copyGroups) {
        const [groups] = await pool.query<RowDataPacket[]>(
          'SELECT * FROM rule_groups WHERE reseller_id = ?',
          [body.from_reseller_id],
        );
        for (const g of groups) {
          const [res] = await pool.query<ResultSetHeader>(
            `INSERT INTO rule_groups (reseller_id, name, url_pattern, is_active)
             VALUES (?, ?, ?, ?)`,
            [targetId, g.name, g.url_pattern, g.is_active],
          );
          groupMap.set(g.id, res.insertId);
        }
        created.rule_groups = groups.length;
      }

      async function copySimple(
        key: 'redirect' | 'block' | 'overlay' | 'text',
        table: string,
        cols: string[],
      ) {
        if (!body.include.includes(key)) return;
        if (body.mode === 'replace') {
          await pool.query(`DELETE FROM ${table} WHERE reseller_id = ?`, [targetId]);
        }
        const [rows] = await pool.query<RowDataPacket[]>(
          `SELECT * FROM ${table} WHERE reseller_id = ?`,
          [body.from_reseller_id],
        );
        for (const row of rows) {
          const values = cols.map((c) => {
            if (c === 'reseller_id') return targetId;
            if (c === 'group_id') return row.group_id ? groupMap.get(row.group_id) ?? null : null;
            return row[c];
          });
          await pool.query(
            `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
            values,
          );
        }
        created[key] = rows.length;
      }

      if (body.include.includes('css')) {
        if (body.mode === 'replace') {
          await pool.query('DELETE FROM css_rules WHERE reseller_id = ?', [targetId]);
        }
        const [rows] = await pool.query<RowDataPacket[]>(
          'SELECT * FROM css_rules WHERE reseller_id = ?',
          [body.from_reseller_id],
        );
        let n = 0;
        for (const row of rows) {
          const newGroup = row.group_id ? groupMap.get(row.group_id) : null;
          if (!newGroup) continue;
          await pool.query(
            `INSERT INTO css_rules (reseller_id, group_id, selector, action, value, is_active)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [targetId, newGroup, row.selector, row.action, row.value, row.is_active],
          );
          n += 1;
        }
        created.css = n;
      }

      await copySimple('redirect', 'redirect_rules', [
        'reseller_id',
        'group_id',
        'source_url',
        'destination_url',
        'description',
        'is_active',
      ]);
      await copySimple('block', 'block_url_rules', [
        'reseller_id',
        'group_id',
        'url_pattern',
        'action',
        'redirect_url',
        'is_active',
      ]);
      await copySimple('overlay', 'overlay_rules', [
        'reseller_id',
        'group_id',
        'trigger_text',
        'html_content',
        'is_active',
      ]);
      await copySimple('text', 'text_rules', [
        'reseller_id',
        'group_id',
        'find_text',
        'replace_text',
        'is_active',
      ]);

      if (body.include.includes('extension_allow')) {
        const [pol] = await pool.query<RowDataPacket[]>(
          'SELECT id, mode FROM extension_allow_policies WHERE reseller_id = ? LIMIT 1',
          [body.from_reseller_id],
        );
        if (pol[0]) {
          await pool.query(
            `INSERT INTO extension_allow_policies (reseller_id, mode)
             VALUES (?, ?)
             ON DUPLICATE KEY UPDATE mode = VALUES(mode)`,
            [targetId, pol[0].mode],
          );
          const [targetPol] = await pool.query<RowDataPacket[]>(
            'SELECT id FROM extension_allow_policies WHERE reseller_id = ? LIMIT 1',
            [targetId],
          );
          if (body.mode === 'replace') {
            await pool.query('DELETE FROM extension_allow_entries WHERE policy_id = ?', [
              targetPol[0].id,
            ]);
          }
          const [entries] = await pool.query<RowDataPacket[]>(
            'SELECT extension_id, note FROM extension_allow_entries WHERE policy_id = ?',
            [pol[0].id],
          );
          for (const e of entries) {
            await pool.query(
              `INSERT IGNORE INTO extension_allow_entries (policy_id, extension_id, note)
               VALUES (?, ?, ?)`,
              [targetPol[0].id, e.extension_id, e.note],
            );
          }
          created.extension_allow = entries.length;
        }
      }

      await pool.query(
        `INSERT INTO audit_logs (actor_admin_id, reseller_id, action, entity_type, entity_id, meta)
         VALUES (?, ?, 'rules.clone', 'reseller', ?, ?)`,
        [
          actor.id,
          targetId,
          String(targetId),
          JSON.stringify({ from: body.from_reseller_id, created, mode: body.mode }),
        ],
      );

      return { success: true, created };
    } catch (err) {
      return sendErr(reply, err);
    }
  });
};
