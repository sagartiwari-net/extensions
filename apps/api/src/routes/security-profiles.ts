import type { FastifyPluginAsync } from 'fastify';
import type { RowDataPacket } from 'mysql2';
import { pool } from '../db.js';
import { requireUser } from '../session.js';
import { scopedResellerId, sendErr } from '../authz.js';
import { lookupIp } from '../lib/ip-lookup.js';

export const securityProfileRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/security/users/:username', async (req, reply) => {
    try {
      const admin = requireUser(req);
      const username = decodeURIComponent(
        String((req.params as { username: string }).username || ''),
      ).trim();
      if (!username) return reply.code(400).send({ success: false, message: 'username required' });
      const scope = scopedResellerId(admin, null);

      const launchParams: unknown[] = [username];
      let launchWhere = 'le.username = ?';
      if (scope != null) {
        launchWhere += ' AND le.reseller_id = ?';
        launchParams.push(scope);
      }
      const [launches] = await pool.query<RowDataPacket[]>(
        `SELECT le.id, r.slug AS reseller_slug, t.name AS tool_name, t.tool_key, le.success,
                le.client_ip, le.product_id, le.created_at
         FROM launch_events le
         JOIN tools t ON t.id = le.tool_id
         JOIN resellers r ON r.id = le.reseller_id
         WHERE ${launchWhere}
         ORDER BY le.id DESC LIMIT 100`,
        launchParams,
      );

      const accessParams: unknown[] = [username];
      let accessWhere = 'a.username = ?';
      if (scope != null) {
        accessWhere += ' AND a.reseller_id = ?';
        accessParams.push(scope);
      }
      const [access] = await pool.query<RowDataPacket[]>(
        `SELECT a.id, r.slug AS reseller_slug, t.name AS tool_name, a.client_ip, a.request_ip,
                a.success, a.source, a.created_at
         FROM access_logs a
         JOIN tools t ON t.id = a.tool_id
         JOIN resellers r ON r.id = a.reseller_id
         WHERE ${accessWhere}
         ORDER BY a.id DESC LIMIT 100`,
        accessParams,
      );

      const incParams: unknown[] = [username];
      let incWhere = 'si.username = ?';
      if (scope != null) {
        incWhere += ' AND si.reseller_id = ?';
        incParams.push(scope);
      }
      const [incidents] = await pool.query<RowDataPacket[]>(
        `SELECT si.id, si.detection_type, si.page_url, si.client_ip, si.tool_name, si.created_at, si.meta
         FROM security_incidents si
         WHERE ${incWhere}
         ORDER BY si.id DESC LIMIT 100`,
        incParams,
      );

      const toolCounts = new Map<string, number>();
      const ips = new Set<string>();
      for (const row of [...launches, ...access]) {
        const name = String(row.tool_name || '');
        if (name) toolCounts.set(name, (toolCounts.get(name) || 0) + 1);
        if (row.client_ip) ips.add(String(row.client_ip));
        if (row.request_ip) ips.add(String(row.request_ip));
      }
      for (const row of incidents) {
        if (row.client_ip) ips.add(String(row.client_ip));
      }

      const tools_used = [...toolCounts.entries()]
        .map(([tool_name, count]) => ({ tool_name, count }))
        .sort((a, b) => b.count - a.count);
      const mostly_used = tools_used[0] || null;

      const ipList = [...ips].filter(Boolean).slice(0, 20);
      const ip_details = [];
      for (const ip of ipList) {
        ip_details.push(await lookupIp(ip));
      }

      return {
        success: true,
        username,
        summary: {
          launch_count: launches.length,
          access_count: access.length,
          incident_count: incidents.length,
          unique_ips: ipList.length,
          mostly_used_tool: mostly_used?.tool_name || null,
          mostly_used_count: mostly_used?.count || 0,
        },
        tools_used,
        ips: ipList,
        ip_details: ip_details.filter(Boolean),
        launches,
        access,
        incidents: incidents.map((row) => ({
          ...row,
          meta: typeof row.meta === 'string' ? JSON.parse(row.meta) : row.meta,
        })),
      };
    } catch (err) {
      return sendErr(reply, err);
    }
  });

  app.get('/api/security/ips/:ip', async (req, reply) => {
    try {
      const admin = requireUser(req);
      const ip = decodeURIComponent(String((req.params as { ip: string }).ip || '')).trim();
      if (!ip) return reply.code(400).send({ success: false, message: 'ip required' });
      const scope = scopedResellerId(admin, null);

      const intel = await lookupIp(ip);

      const launchParams: unknown[] = [ip];
      let launchWhere = 'le.client_ip = ?';
      if (scope != null) {
        launchWhere += ' AND le.reseller_id = ?';
        launchParams.push(scope);
      }
      const [launches] = await pool.query<RowDataPacket[]>(
        `SELECT le.id, le.username, r.slug AS reseller_slug, t.name AS tool_name, le.success,
                le.product_id, le.created_at
         FROM launch_events le
         JOIN tools t ON t.id = le.tool_id
         JOIN resellers r ON r.id = le.reseller_id
         WHERE ${launchWhere}
         ORDER BY le.id DESC LIMIT 100`,
        launchParams,
      );

      const accessParams: unknown[] = [ip, ip];
      let accessWhere = '(a.client_ip = ? OR a.request_ip = ?)';
      if (scope != null) {
        accessWhere += ' AND a.reseller_id = ?';
        accessParams.push(scope);
      }
      const [access] = await pool.query<RowDataPacket[]>(
        `SELECT a.id, a.username, r.slug AS reseller_slug, t.name AS tool_name, a.client_ip,
                a.request_ip, a.success, a.source, a.created_at
         FROM access_logs a
         JOIN tools t ON t.id = a.tool_id
         JOIN resellers r ON r.id = a.reseller_id
         WHERE ${accessWhere}
         ORDER BY a.id DESC LIMIT 100`,
        accessParams,
      );

      const incParams: unknown[] = [ip, ip];
      let incWhere = '(si.client_ip = ? OR si.request_ip = ?)';
      if (scope != null) {
        incWhere += ' AND si.reseller_id = ?';
        incParams.push(scope);
      }
      const [incidents] = await pool.query<RowDataPacket[]>(
        `SELECT si.id, si.username, si.detection_type, si.page_url, si.tool_name, si.created_at, si.meta
         FROM security_incidents si
         WHERE ${incWhere}
         ORDER BY si.id DESC LIMIT 100`,
        incParams,
      );

      const usernames = new Set<string>();
      const toolCounts = new Map<string, number>();
      for (const row of [...launches, ...access]) {
        if (row.username) usernames.add(String(row.username));
        const name = String(row.tool_name || '');
        if (name) toolCounts.set(name, (toolCounts.get(name) || 0) + 1);
      }
      for (const row of incidents) {
        if (row.username) usernames.add(String(row.username));
      }

      const tools_used = [...toolCounts.entries()]
        .map(([tool_name, count]) => ({ tool_name, count }))
        .sort((a, b) => b.count - a.count);

      return {
        success: true,
        ip,
        intel,
        summary: {
          launch_count: launches.length,
          access_count: access.length,
          incident_count: incidents.length,
          unique_usernames: usernames.size,
          mostly_used_tool: tools_used[0]?.tool_name || null,
        },
        usernames: [...usernames],
        tools_used,
        launches,
        access,
        incidents: incidents.map((row) => ({
          ...row,
          meta: typeof row.meta === 'string' ? JSON.parse(row.meta) : row.meta,
        })),
      };
    } catch (err) {
      return sendErr(reply, err);
    }
  });
};
