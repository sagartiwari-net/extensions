import type { FastifyPluginAsync } from 'fastify';
import type { RowDataPacket } from 'mysql2';
import { pool } from '../db.js';
import { sendErr } from '../authz.js';
import { loadLaunchRules } from '../launch-rules.js';
import { createHash } from 'node:crypto';

async function resolveResellerId(clientSlug: string, resellerSlug?: string): Promise<number | null> {
  if (resellerSlug) {
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT id FROM resellers WHERE slug = ? AND is_active = 1 LIMIT 1',
      [resellerSlug],
    );
    if (rows[0]) return Number(rows[0].id);
  }

  const slug = String(clientSlug || '').trim();
  if (!slug) return null;

  const [regs] = await pool.query<RowDataPacket[]>(
    'SELECT reseller_id FROM extension_registrations WHERE client_slug = ? LIMIT 1',
    [slug],
  );
  if (regs[0]?.reseller_id) return Number(regs[0].reseller_id);

  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT id FROM resellers WHERE slug = ? AND is_active = 1 LIMIT 1',
    [slug],
  );
  return rows[0] ? Number(rows[0].id) : null;
}

/** Public extension pull — same shape as launch `rules` (old /config style). */
export const clientRulesRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/client/rules', async (req, reply) => {
    try {
      const q = req.query as { client_slug?: string; reseller_slug?: string };
      const clientSlug = String(q.client_slug || '').trim();
      const resellerSlug = String(q.reseller_slug || '').trim() || undefined;
      if (!clientSlug && !resellerSlug) {
        return reply.code(400).send({ success: false, message: 'client_slug or reseller_slug required' });
      }

      const resellerId = await resolveResellerId(clientSlug || resellerSlug || '', resellerSlug);
      if (!resellerId) {
        return { success: true, version: '0', rules: { blocks: [], redirects: [], css: [] } };
      }

      const rules = await loadLaunchRules(resellerId);
      const version = createHash('sha256')
        .update(
          JSON.stringify({
            b: rules.blocks.map((x) => [x.id, x.url_pattern, x.action, x.redirect_url]),
            r: rules.redirects.map((x) => [x.id, x.source_url, x.destination_url]),
            c: rules.css.map((x) => [x.id, x.url_pattern, x.selector, x.action, x.value]),
          }),
        )
        .digest('hex')
        .slice(0, 16);

      return {
        success: true,
        version,
        reseller_id: resellerId,
        rules,
      };
    } catch (err) {
      return sendErr(reply, err);
    }
  });
};
