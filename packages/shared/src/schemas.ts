import { z } from 'zod';
import { COOKIE_FORMATS, INJECT_STRATEGIES } from './inject.js';
import { SECURITY_TIERS } from './security.js';

export const loginBodySchema = z.object({
  username: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(200),
});

/** aMember / member-site host or URL — baked into that reseller's extension only */
const memberDomainSchema = z.string().trim().max(255).optional();

export const createResellerSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9_-]*$/),
  name: z.string().trim().min(1).max(255),
  /** Forced tool_key prefix — e.g. tm, tw, sg */
  key_prefix: z
    .string()
    .trim()
    .toLowerCase()
    .min(2)
    .max(8)
    .regex(/^[a-z0-9]+$/),
  /** Member site domain — extension content script binds to this host */
  member_domain: memberDomainSchema,
  username: z.string().trim().min(2).max(100).optional(),
  password: z.string().min(6).max(200).optional(),
});

export const updateResellerSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9_-]*$/)
    .optional(),
  key_prefix: z
    .string()
    .trim()
    .toLowerCase()
    .min(2)
    .max(8)
    .regex(/^[a-z0-9]+$/)
    .optional(),
  member_domain: memberDomainSchema,
  is_active: z.boolean().optional(),
  username: z.string().trim().min(2).max(100).optional(),
  password: z.string().min(6).max(200).optional(),
});

export const createToolSchema = z.object({
  reseller_id: z.number().int().positive().optional(),
  /** Site code only — server forces reseller prefix: spyfu → tmspyfu */
  tool_key: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9_-]*$/i),
  name: z.string().trim().min(1).max(255),
  web_url: z.string().url().max(500),
  /** Optional label — when vault is pasted, server derives this from formats (cookies/LS/IDB). */
  inject_strategy: z.enum(INJECT_STRATEGIES).optional().default('cookies'),
  /** Where HTTP cookies live: auto detect | browser jar | extension DNR only. */
  cookie_jar_mode: z.enum(['auto', 'browser', 'extension_only']).default('auto'),
  security_tier: z
    .number()
    .int()
    .refine((n) => (SECURITY_TIERS as readonly number[]).includes(n))
    .default(1),
  cookie_password: z.string().min(1).max(255).optional(),
  cookie_plain: z.string().optional(),
  /** Optional Referer applied when saving vault (merged into cookie JSON). */
  referer: z
    .string()
    .max(500)
    .optional()
    .refine((v) => !v || v === '' || /^https?:\/\//i.test(v), {
      message: 'referer must be empty or an http(s) URL',
    }),
  cookie_formats: z.array(z.enum(COOKIE_FORMATS)).optional(),
  status: z.enum(['active', 'updating', 'disabled']).optional(),
});

export const updateToolSchema = createToolSchema
  .partial()
  .omit({ tool_key: true })
  .extend({
    tool_key: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9][a-z0-9_-]*$/i)
      .optional(),
  });

/**
 * aMember / member-site initiate.
 * Accepts legacy aliases: client_slug, tool, secret_key, plan_ids.
 */
export const initiateSessionSchema = z
  .object({
    reseller_slug: z.string().trim().min(1).max(64).optional(),
    client_slug: z.string().trim().min(1).max(64).optional(),
    tool_key: z.string().trim().min(1).max(64).optional(),
    tool: z.string().trim().min(1).max(64).optional(),
    member_secret: z.string().trim().min(8).max(255).optional(),
    secret_key: z.string().trim().min(8).max(255).optional(),
    source: z.enum(['amember', 'admin_access', 'other']).default('amember'),
    username: z.string().trim().min(1).max(255),
    product_id: z.string().trim().max(64).optional(),
    /** Legacy aMember: "1,2,5" or ["1","2"] — first id used as product_id */
    plan_ids: z.union([z.string(), z.array(z.union([z.string(), z.number()]))]).optional(),
    client_ip: z.string().trim().max(64).optional(),
    website_url: z.string().trim().max(1024).optional(),
    email: z.string().trim().max(255).optional(),
  })
  .transform((raw) => {
    const reseller_slug = (raw.reseller_slug || raw.client_slug || '').trim();
    const tool_key = (raw.tool_key || raw.tool || '').trim();
    const member_secret = (raw.member_secret || raw.secret_key || '').trim();
    let product_id = (raw.product_id || '').trim();
    if (!product_id && raw.plan_ids != null) {
      if (Array.isArray(raw.plan_ids)) {
        product_id = String(raw.plan_ids[0] ?? '').trim();
      } else {
        product_id = String(raw.plan_ids).split(',')[0]?.trim() || '';
      }
    }
    return {
      reseller_slug,
      tool_key,
      member_secret,
      source: raw.source,
      username: raw.username,
      product_id: product_id || undefined,
      client_ip: raw.client_ip,
      website_url: raw.website_url,
      email: raw.email,
    };
  })
  .pipe(
    z.object({
      reseller_slug: z.string().trim().min(1).max(64),
      tool_key: z.string().trim().min(1).max(64),
      member_secret: z.string().trim().min(8).max(255),
      source: z.enum(['amember', 'admin_access', 'other']),
      username: z.string().trim().min(1).max(255),
      product_id: z.string().trim().min(1).max(64),
      client_ip: z.string().trim().max(64).optional(),
      website_url: z.string().trim().max(1024).optional(),
      email: z.string().trim().max(255).optional(),
    }),
  );

export const healthSchema = z.object({
  ok: z.literal(true),
  service: z.string(),
  time: z.string(),
});
