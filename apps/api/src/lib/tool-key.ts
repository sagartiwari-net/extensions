/** Normalize reseller key_prefix → lowercase a-z0-9 (2–8 chars). */
export function normalizeKeyPrefix(raw: string): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 8);
}

/** Site code only: lowercase a-z0-9 (no dashes). */
export function normalizeSiteCode(raw: string): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Force tool_key = `{prefix}{site}` e.g. tm + spyfu → tmspyfu (no dash).
 * Accepts "semrush", "tm-semrush", "tm-semrush-3", "tmspyfu".
 */
export function applyToolKeyPrefix(prefix: string, toolKey: string): string {
  const p = normalizeKeyPrefix(prefix);
  if (!p) {
    const err = new Error('Reseller key_prefix missing') as Error & { statusCode: number };
    err.statusCode = 400;
    throw err;
  }

  let rest = String(toolKey || '')
    .trim()
    .toLowerCase()
    // drop separators first
    .replace(/[^a-z0-9_-]/g, '');

  // strip leading prefix forms: "tm-", "tm_", "tm"
  const re = new RegExp(`^${p}[-_]?`, 'i');
  rest = rest.replace(re, '');

  // drop leftover dashes/underscores
  rest = rest.replace(/[^a-z0-9]/g, '');

  // strip trailing legacy dump id: ...80 from old "name-80" (only pure trailing digits after we already removed dashes)
  // If user typed "canva1" keep it — only strip when key looked like name + old numeric id separated earlier.
  // Handled in migrate; here keep rest as typed.

  if (!rest || rest.length < 1) {
    const err = new Error('Tool key (site code) required after prefix') as Error & {
      statusCode: number;
    };
    err.statusCode = 400;
    throw err;
  }

  const full = `${p}${rest}`.slice(0, 64);
  if (!/^[a-z0-9]+$/.test(full)) {
    const err = new Error('Invalid tool key') as Error & { statusCode: number };
    err.statusCode = 400;
    throw err;
  }
  return full;
}

/**
 * From old keys like tm-spyfu-80 / tm-canva1-11 → site code spyfu / canva1
 * (strip prefix + trailing -{id} from seed).
 */
export function siteCodeFromLegacyKey(prefix: string, toolKey: string): string {
  const p = normalizeKeyPrefix(prefix);
  let rest = String(toolKey || '')
    .trim()
    .toLowerCase();
  if (p) {
    rest = rest.replace(new RegExp(`^${p}[-_]?`, 'i'), '');
  }
  // trailing -digits = old tool id from seed
  rest = rest.replace(/-\d+$/, '');
  return normalizeSiteCode(rest);
}

/** Site part for UI (without prefix). */
export function stripToolKeyPrefix(prefix: string, toolKey: string): string {
  const p = normalizeKeyPrefix(prefix);
  let key = String(toolKey || '').trim().toLowerCase();
  if (!p) return key.replace(/[^a-z0-9]/g, '');
  if (key.startsWith(p)) key = key.slice(p.length);
  return key.replace(/[^a-z0-9]/g, '');
}

/**
 * If base key taken, append 1,2,3… until free.
 * First copy stays plain (tmspyfu); next tmspyfu1, tmspyfu2…
 */
export function nextUniqueToolKey(base: string, existing: Set<string>): string {
  const root = base.slice(0, 64);
  if (!existing.has(root)) return root;
  for (let n = 1; n < 1000; n++) {
    const candidate = `${root}${n}`.slice(0, 64);
    if (!existing.has(candidate)) return candidate;
  }
  throw new Error('Could not allocate unique tool key');
}
