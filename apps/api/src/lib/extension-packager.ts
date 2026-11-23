import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { env } from '../env.js';

export type ExtensionBrand = {
  name: string;
  description: string;
  member_domain: string;
  membership_home: string;
  icon_relpath: string | null;
  version: string;
  last_generated_at: string | null;
};

export type PackResult = {
  zipPath: string;
  version: string;
  fileHashes: Record<string, string>;
  workDir: string;
};

function hashTree(dir: string, base = dir, out: Record<string, string> = {}) {
  for (const name of readdirSync(dir)) {
    if (
      name === 'LOAD.txt' ||
      name === 'INSTALL.txt' ||
      name === 'integrity.json' ||
      name === '.hashes.dev.json'
    )
      continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) hashTree(full, base, out);
    else {
      const rel = relative(base, full).split('\\').join('/');
      out[rel] = createHash('sha256').update(readFileSync(full)).digest('hex');
    }
  }
  return out;
}

function hostFromUrlOrDomain(raw: string): string {
  const s = raw.trim();
  if (!s) return '';
  try {
    if (s.includes('://')) return new URL(s).hostname;
  } catch {
    /* */
  }
  return s.replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
}

function originPattern(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  try {
    if (s.includes('://')) {
      const u = new URL(s);
      return `${u.protocol}//${u.host}/*`;
    }
  } catch {
    /* */
  }
  if (s.includes('*')) return s;
  return `https://${s.replace(/\/$/, '')}/*`;
}

export function defaultBrand(slug: string, name: string): ExtensionBrand {
  return {
    name: name || slug,
    description: `${name || slug} access extension`,
    member_domain: '',
    membership_home: '',
    icon_relpath: null,
    version: '1.0.0',
    last_generated_at: null,
  };
}

/** System-fixed connectable origins — never taken from reseller branding. */
function systemConnectableOrigins(): string[] {
  const out = new Set<string>();
  for (const raw of [
    env.adminOrigin,
    ...env.corsOrigins,
    ...env.extensionConnectableOrigins,
  ]) {
    const pat = originPattern(raw);
    if (pat) out.add(pat);
  }
  return [...out];
}

export function parseBrandSettings(
  settings: unknown,
  slug: string,
  name: string,
): ExtensionBrand {
  const base = defaultBrand(slug, name);
  let obj: Record<string, unknown> = {};
  if (typeof settings === 'string') {
    try {
      obj = JSON.parse(settings) as Record<string, unknown>;
    } catch {
      obj = {};
    }
  } else if (settings && typeof settings === 'object') {
    obj = settings as Record<string, unknown>;
  }
  const ext = (obj.extension && typeof obj.extension === 'object'
    ? obj.extension
    : obj) as Record<string, unknown>;
  return {
    name: String(ext.name || base.name).slice(0, 75),
    description: String(ext.description || base.description).slice(0, 132),
    member_domain: String(ext.member_domain || ''),
    membership_home: String(ext.membership_home || base.membership_home),
    icon_relpath: ext.icon_relpath ? String(ext.icon_relpath) : null,
    version: String(ext.version || base.version),
    last_generated_at: ext.last_generated_at ? String(ext.last_generated_at) : null,
  };
}

export function mergeBrandIntoSettings(
  settings: unknown,
  brand: ExtensionBrand,
): Record<string, unknown> {
  let obj: Record<string, unknown> = {};
  if (typeof settings === 'string') {
    try {
      obj = JSON.parse(settings) as Record<string, unknown>;
    } catch {
      obj = {};
    }
  } else if (settings && typeof settings === 'object') {
    obj = { ...(settings as Record<string, unknown>) };
  }
  const { ...safe } = brand;
  obj.extension = { ...safe };
  // Never persist system connection settings from client payloads
  delete (obj.extension as { admin_origin?: string }).admin_origin;
  return obj;
}

export function iconAbsPath(rel: string | null): string | null {
  if (!rel) return null;
  const abs = resolve(env.uploadsDir, rel);
  if (!abs.startsWith(resolve(env.uploadsDir))) return null;
  return existsSync(abs) ? abs : null;
}

export async function saveResellerIcon(resellerId: number, buffer: Buffer): Promise<string> {
  const pngRel = join('resellers', String(resellerId), 'logo.png').split('\\').join('/');
  const abs = resolve(env.uploadsDir, pngRel);
  mkdirSync(dirname(abs), { recursive: true });
  await sharp(buffer).resize(512, 512, { fit: 'cover' }).png().toFile(abs);
  return pngRel;
}

async function writeIcons(outDir: string, logoAbs: string | null, displayName: string) {
  const iconsDir = join(outDir, 'icons');
  mkdirSync(iconsDir, { recursive: true });
  const letter = (displayName || '1').trim()[0]?.toUpperCase() || '1';

  for (const size of [16, 48, 128] as const) {
    const dest = join(iconsDir, `icon-${size}.png`);
    if (logoAbs && existsSync(logoAbs)) {
      await sharp(logoAbs).resize(size, size, { fit: 'cover' }).png().toFile(dest);
    } else {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
        <rect width="100%" height="100%" rx="${Math.round(size * 0.22)}" fill="#111827"/>
        <text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" fill="white"
          font-family="system-ui,sans-serif" font-size="${Math.round(size * 0.48)}" font-weight="700">${letter}</text>
      </svg>`;
      await sharp(Buffer.from(svg)).png().toFile(dest);
    }
  }
}

function bumpVersion(v: string): string {
  const parts = String(v || '1.0.0')
    .split('.')
    .map((n) => Number(n) || 0);
  while (parts.length < 3) parts.push(0);
  parts[2] += 1;
  return parts.slice(0, 3).join('.');
}

function runBuild(clientSlug: string, outdir: string, version: string, obfuscate: boolean) {
  const extRoot = env.extensionSourcePath;
  const args = [
    'build.mjs',
    '--client',
    clientSlug,
    '--outdir',
    outdir,
    '--version',
    version,
  ];
  if (obfuscate) args.push('--obfuscate');
  return new Promise<void>((resolvePromise, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: extRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
    let stderr = '';
    let stdout = '';
    child.stderr?.on('data', (d) => {
      stderr += d.toString();
    });
    child.stdout?.on('data', (d) => {
      stdout += d.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(stderr || stdout || `build.mjs exited ${code}`));
    });
  });
}

function zipDirectory(sourceDir: string, zipPath: string): Promise<void> {
  // Prefer system zip (macOS/Linux) — avoids ESM/CJS issues with archiver.
  return new Promise((resolvePromise, reject) => {
    const child = spawn('zip', ['-qr', zipPath, '.'], {
      cwd: sourceDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr?.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', (err) => {
      reject(new Error(`zip failed to start: ${err.message}`));
    });
    child.on('close', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(stderr || `zip exited ${code}`));
    });
  });
}

export async function packResellerExtension(input: {
  slug: string;
  brand: ExtensionBrand;
}): Promise<PackResult> {
  const extRoot = env.extensionSourcePath;
  if (!existsSync(join(extRoot, 'build.mjs'))) {
    throw new Error(`Extension source missing at ${extRoot}`);
  }

  const version = bumpVersion(input.brand.version || '1.0.0');
  const memberHost = hostFromUrlOrDomain(input.brand.member_domain);
  const membershipHome =
    input.brand.membership_home?.trim() ||
    (memberHost ? `https://${memberHost}/` : '');

  // Production bind: only this reseller's member site. Never share another reseller's domain.
  const memberMatches = memberHost
    ? [`https://${memberHost}/*`, `https://*.${memberHost}/*`]
    : [];

  // Admin /launch handoff — ADMIN_ORIGIN + CORS origins (prod panel URL).
  // Slug guard (client from peek) keeps other reseller packs from consuming the token.
  const bridgeMatches: string[] = [];
  const pushBridge = (raw: string) => {
    const pat = originPattern(raw);
    if (pat && !bridgeMatches.includes(pat)) bridgeMatches.push(pat);
  };
  pushBridge(env.adminOrigin);
  for (const o of env.corsOrigins) pushBridge(o);
  for (const o of env.extensionConnectableOrigins) pushBridge(o);
  try {
    const admin = new URL(env.adminOrigin);
    if (admin.hostname === '127.0.0.1' || admin.hostname === 'localhost') {
      const altHost = admin.hostname === '127.0.0.1' ? 'localhost' : '127.0.0.1';
      pushBridge(`${admin.protocol}//${altHost}:${admin.port || '3000'}`);
    }
  } catch {
    /* */
  }

  // API + admin/panel connectable = system env only. Member site added from branding domain.
  const external = new Set<string>(systemConnectableOrigins());
  for (const m of memberMatches) external.add(m);

  const clientId = `_gen_${input.slug}_${randomBytes(3).toString('hex')}`;
  const configPath = join(extRoot, 'clients', `${clientId}.config.js`);
  const workDir = join(tmpdir(), `oneclk-ext-${input.slug}-${Date.now()}`);
  const outdir = join(workDir, 'dist');
  mkdirSync(outdir, { recursive: true });

  const integrityFiles = [
    'manifest.json',
    'background.js',
    'popup/popup.html',
    'popup/popup.js',
    'content/member.js',
    'content/guard.js',
    'icons/icon-16.png',
    'icons/icon-48.png',
    'icons/icon-128.png',
  ];

  const configJs = `/** Auto-generated — do not commit */
export const CLIENT_CONFIG = ${JSON.stringify(
    {
      SLUG: input.slug,
      RESELLER_SLUG: input.slug,
      NAME: input.brand.name,
      DESCRIPTION: input.brand.description,
      API_BASE: env.extensionApiBase.replace(/\/$/, ''),
      MEMBER_MATCHES: memberMatches.length
        ? memberMatches
        : bridgeMatches.length
          ? bridgeMatches
          : ['http://127.0.0.1/*', 'http://localhost/*'],
      /** Admin /launch handoff (token-only URL lives here) */
      BRIDGE_MATCHES: bridgeMatches,
      MEMBERSHIP_HOME: membershipHome || env.adminOrigin.replace(/\/?$/, '/'),
      EXTERNALLY_CONNECTABLE: [...external],
      INDICATOR_ID: `oneclk-v2-${input.slug}`,
      INTEGRITY_FILES: integrityFiles,
    },
    null,
    2,
  )};
`;
  writeFileSync(configPath, configJs);

  try {
    await runBuild(clientId, outdir, version, env.extensionBuildObfuscate);
    await writeIcons(outdir, iconAbsPath(input.brand.icon_relpath), input.brand.name);

    // Strip helper junk — never ship to users (hashes live on server only)
    for (const junk of ['integrity.json', 'LOAD.txt', 'INSTALL.txt', '.hashes.dev.json']) {
      rmSync(join(outdir, junk), { force: true });
    }

    // Hash final packaged bytes → stored in DB; not written into ZIP
    const hashes = hashTree(outdir);

    const zipDir = join(env.uploadsDir, 'extensions', input.slug);
    mkdirSync(zipDir, { recursive: true });
    const zipPath = join(zipDir, `${input.slug}-extension-v${version}.zip`);
    rmSync(zipPath, { force: true });
    await zipDirectory(outdir, zipPath);

    return { zipPath, version, fileHashes: hashes, workDir };
  } finally {
    rmSync(configPath, { force: true });
  }
}

export function cleanupPackWork(workDir: string) {
  if (workDir.includes(tmpdir()) && workDir.includes('oneclk-ext-')) {
    rmSync(workDir, { recursive: true, force: true });
  }
}

export function getLatestZipPath(slug: string): string | null {
  const dir = join(env.uploadsDir, 'extensions', slug);
  try {
    const files = readdirSync(dir).filter((f) => f.endsWith('.zip'));
    if (!files.length) return null;
    // Prefer newest mtime — lexicographic v1.0.10 sorts before v1.0.9
    let best: { path: string; mtime: number } | null = null;
    for (const f of files) {
      const full = join(dir, f);
      const mtime = statSync(full).mtimeMs;
      if (!best || mtime >= best.mtime) best = { path: full, mtime };
    }
    return best?.path ?? null;
  } catch {
    return null;
  }
}

export function openZipStream(zipPath: string) {
  return createReadStream(zipPath);
}

/** Resolve monorepo root from this file for tests */
export function packageRootHint() {
  return resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
}
