import type { RowDataPacket } from 'mysql2';
import { pool } from './db.js';

export type LaunchRules = {
  blocks: { id: number; url_pattern: string; action: string; redirect_url: string | null }[];
  redirects: { id: number; source_url: string; destination_url: string }[];
  css: {
    id: number;
    url_pattern: string;
    selector: string;
    action: string;
    value: string | null;
  }[];
};

/** Slim reseller rules for extension launch (apply on launch tab / DNR). */
export async function loadLaunchRules(resellerId: number): Promise<LaunchRules> {
  const [blocks] = await pool.query<RowDataPacket[]>(
    `SELECT id, url_pattern, action, redirect_url
     FROM block_url_rules
     WHERE reseller_id = ? AND is_active = 1
     ORDER BY id ASC
     LIMIT 200`,
    [resellerId],
  );
  const [redirects] = await pool.query<RowDataPacket[]>(
    `SELECT id, source_url, destination_url
     FROM redirect_rules
     WHERE reseller_id = ? AND is_active = 1
     ORDER BY id ASC
     LIMIT 200`,
    [resellerId],
  );
  const [css] = await pool.query<RowDataPacket[]>(
    `SELECT c.id, g.url_pattern, c.selector, c.action, c.value
     FROM css_rules c
     JOIN rule_groups g ON g.id = c.group_id AND g.reseller_id = c.reseller_id
     WHERE c.reseller_id = ? AND c.is_active = 1 AND g.is_active = 1
     ORDER BY c.id ASC
     LIMIT 500`,
    [resellerId],
  );

  return {
    blocks: blocks.map((b) => ({
      id: b.id,
      url_pattern: b.url_pattern,
      action: b.action,
      redirect_url: b.redirect_url,
    })),
    redirects: redirects.map((r) => ({
      id: r.id,
      source_url: r.source_url,
      destination_url: r.destination_url,
    })),
    css: css.map((c) => ({
      id: c.id,
      url_pattern: c.url_pattern,
      selector: c.selector,
      action: c.action,
      value: c.value,
    })),
  };
}
