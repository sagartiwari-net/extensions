import * as esbuild from 'esbuild';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function hashTree(dir, base = dir, out = {}) {
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

function argValue(flag, fallback) {
  const i = process.argv.indexOf(flag);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  const pref = process.argv.find((a) => a.startsWith(`${flag}=`));
  if (pref) return pref.slice(flag.length + 1);
  return fallback;
}

const root = dirname(fileURLToPath(import.meta.url));
const clientSlug = argValue('--client', 'dev');
const watch = process.argv.includes('--watch');
const obfuscate = process.argv.includes('--obfuscate') || process.argv.includes('--prod');
const version = argValue('--version', '0.1.0');
const outdir = argValue('--outdir', join(root, obfuscate ? `dist-prod/${clientSlug}` : 'dist'));

const configPath = join(root, 'clients', `${clientSlug}.config.js`);
if (!existsSync(configPath)) {
  console.error(`Missing client config: clients/${clientSlug}.config.js`);
  process.exit(1);
}
const { CLIENT_CONFIG } = await import(configPath);

if (existsSync(outdir) && !watch) {
  rmSync(outdir, { recursive: true, force: true });
}
mkdirSync(outdir, { recursive: true });
mkdirSync(join(outdir, 'content'), { recursive: true });
mkdirSync(join(outdir, 'icons'), { recursive: true });
mkdirSync(join(outdir, 'popup'), { recursive: true });

const iconPaths = {
  16: 'icons/icon-16.png',
  48: 'icons/icon-48.png',
  128: 'icons/icon-128.png',
};
for (const rel of Object.values(iconPaths)) {
  const src = join(root, rel);
  if (!existsSync(src)) {
    console.error(`Missing ${rel} — place PNG under apps/extension/icons/`);
    process.exit(1);
  }
  cpSync(src, join(outdir, rel));
}

/** Packaged paths hashed at runtime (server stores expected SHA-256). */
const INTEGRITY_FILES = [
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

const configOut = {
  ...CLIENT_CONFIG,
  INTEGRITY_FILES,
};

const manifest = {
  manifest_version: 3,
  name: CLIENT_CONFIG.NAME,
  version,
  description: CLIENT_CONFIG.DESCRIPTION || `1Clk Access — ${CLIENT_CONFIG.SLUG}`,
  icons: iconPaths,
  action: {
    default_popup: 'popup/popup.html',
    default_title: CLIENT_CONFIG.NAME,
    default_icon: iconPaths,
  },
  permissions: [
    'alarms',
    'browsingData',
    'cookies',
    'storage',
    'unlimitedStorage',
    'tabs',
    'scripting',
    'proxy',
    'webNavigation',
    'webRequest',
    'webRequestAuthProvider',
    'declarativeNetRequest',
    'declarativeNetRequestWithHostAccess',
    'management',
    'debugger',
    'windows',
  ],
  host_permissions: (() => {
    const hosts = new Set(['http://*/*', 'https://*/*']);
    try {
      const u = new URL(CLIENT_CONFIG.API_BASE);
      hosts.add(`${u.protocol}//${u.host}/*`);
      if (u.hostname === '127.0.0.1') hosts.add('http://localhost/*');
      if (u.hostname === 'localhost') hosts.add('http://127.0.0.1/*');
    } catch {
      /* */
    }
    return [...hosts];
  })(),
  // Classic SW (no type:module) — DigitaVision-style; survives obfuscator.
  background: { service_worker: 'background.js' },
  content_scripts: [
    {
      // Reseller member domain (+ optional local admin bridge). Not other resellers' sites.
      matches: [...new Set([
        ...(CLIENT_CONFIG.MEMBER_MATCHES || []),
        ...(CLIENT_CONFIG.BRIDGE_MATCHES || []),
      ])].filter(Boolean),
      js: ['content/member.js'],
      run_at: 'document_end',
    },
    {
      matches: ['http://*/*', 'https://*/*'],
      js: ['content/guard.js'],
      run_at: 'document_start',
    },
  ],
  externally_connectable: {
    matches: CLIENT_CONFIG.EXTERNALLY_CONNECTABLE,
  },
  // MAIN-world watchdog probes this after beats stop — distinguishes disable vs CS death
  web_accessible_resources: [
    {
      resources: ['ping.txt', 'icons/icon-16.png'],
      matches: ['http://*/*', 'https://*/*'],
    },
  ],
  // Do not duplicate host_permissions wildcards — Chrome warns + omits them.
};

writeFileSync(join(outdir, 'manifest.json'), JSON.stringify(manifest, null, 2));
writeFileSync(
  join(root, 'src/config.gen.js'),
  `export const CLIENT_CONFIG = ${JSON.stringify(configOut, null, 2)};\n`,
);
cpSync(join(root, 'src/popup/popup.html'), join(outdir, 'popup/popup.html'));
const pingSrc = join(root, 'ping.txt');
if (existsSync(pingSrc)) cpSync(pingSrc, join(outdir, 'ping.txt'));
else writeFileSync(join(outdir, 'ping.txt'), 'ok\n');

const ctx = await esbuild.context({
  entryPoints: {
    background: join(root, 'src/background.js'),
    'content/member': join(root, 'src/content/member.js'),
    'content/guard': join(root, 'src/content/guard.js'),
    'popup/popup': join(root, 'src/popup/popup.js'),
  },
  bundle: true,
  outdir,
  // IIFE classic scripts — Chrome MV3 SW + javascript-obfuscator break under ESM modules.
  format: 'iife',
  target: ['chrome120'],
  minify: obfuscate,
  sourcemap: false,
  logLevel: 'info',
  drop: obfuscate ? ['debugger'] : [],
});

async function obfuscateDist() {
  let JavaScriptObfuscator;
  try {
    JavaScriptObfuscator = require('javascript-obfuscator');
  } catch {
    console.warn(
      'javascript-obfuscator not installed — minify only. Run: npm i -D javascript-obfuscator -w @oneclk/extension',
    );
    return;
  }
  // DigitaVision-style unreadability. Milder on service worker (must boot reliably).
  // CRITICAL: disableConsoleOutput injects `window` — MV3 SW has no window → registration
  // fails with "Uncaught ReferenceError: window is not defined" / status code 15.
  const targets = [
    { rel: 'background.js', strong: false },
    { rel: 'content/member.js', strong: true },
    { rel: 'content/guard.js', strong: true },
    { rel: 'popup/popup.js', strong: true },
  ];
  for (const { rel, strong } of targets) {
    const full = join(outdir, rel);
    if (!existsSync(full)) continue;
    const source = readFileSync(full, 'utf8');
    const isSw = rel === 'background.js';
    const result = JavaScriptObfuscator.obfuscate(source, {
      compact: true,
      controlFlowFlattening: strong,
      controlFlowFlatteningThreshold: strong ? 0.35 : 0,
      deadCodeInjection: false,
      debugProtection: false,
      disableConsoleOutput: false,
      identifierNamesGenerator: 'hexadecimal',
      renameGlobals: false,
      selfDefending: false,
      simplify: true,
      splitStrings: !isSw,
      splitStringsChunkLength: strong ? 6 : 8,
      stringArray: true,
      stringArrayCallsTransform: strong,
      stringArrayEncoding: isSw ? [] : ['base64'],
      stringArrayIndexShift: true,
      stringArrayRotate: true,
      stringArrayShuffle: true,
      stringArrayThreshold: strong ? 0.85 : isSw ? 0.5 : 0.75,
      transformObjectKeys: strong,
      unicodeEscapeSequence: false,
      // browser-no-eval avoids Function()+window console shim paths in SW.
      target: isSw ? 'browser-no-eval' : 'browser',
    });
    writeFileSync(full, result.getObfuscatedCode());
  }
  console.log('obfuscated', targets.map((t) => `${t.rel}${t.strong ? '' : '(sw-safe)'}`).join(', '));
}

if (watch) {
  await ctx.watch();
  console.log(`watching extension (${clientSlug})…`);
} else {
  await ctx.rebuild();
  await ctx.dispose();
  if (obfuscate) await obfuscateDist();
  const hashes = hashTree(outdir);
  // Hashes stay on the server after admin generate — not shipped in the ZIP.
  // Dev-only dump next to dist for local debugging (not packaged by packager).
  if (!obfuscate) {
    writeFileSync(join(outdir, '.hashes.dev.json'), JSON.stringify(hashes, null, 2));
  }
  console.log('extension →', outdir);
  console.log('integrity files (server-side):', Object.keys(hashes).length);
}
